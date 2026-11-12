// Every Discord REST read the API makes with the bot token goes through here
// (v1.11.1). The bot process shares this token, so the API must not burn its
// rate limit, and refused requests (401/403/429) count towards Discord's
// invalid-request limit, which can block the bot's IP for a while.
//
// - At most MAX_CONCURRENT requests in flight; the rest wait their turn.
// - Rate limits: a 429's retry_after (global or per route) and an exhausted
//   bucket (X-RateLimit-Remaining: 0) pause that route; callers that can't wait
//   that long get "unavailable" instead of a request Discord would refuse.
// - Member lookups are cached (60 s; a missing member 60 s; a server the bot
//   can't see 5 min) and identical lookups in flight are merged, so polling
//   pages cost about one Discord call per person per server per minute.
// - When Discord can't answer, a recent cached answer (up to 10 min) is used.

const API = 'https://discord.com/api/v10';
const MAX_CONCURRENT = 4;

export const MEMBER_TTL_MS = 60_000;
export const NOT_MEMBER_TTL_MS = 60_000;
export const NO_ACCESS_TTL_MS = 5 * 60_000;
export const STALE_MAX_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 10_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Throttling ───────────────────────────────────────────────────────────────

let active = 0;
const queue: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise<void>((r) => queue.push(r)); // the slot is handed over in release()
}
function release(): void {
  const next = queue.shift();
  if (next) next(); else active--;
}

let globalBlockedUntil = 0;
const bucketBlockedUntil = new Map<string, number>();
const lastWarn = new Map<string, number>();
function warnOncePerMinute(key: string, msg: string) {
  const now = Date.now();
  if (now - (lastWarn.get(key) ?? 0) < 60_000) return;
  lastWarn.set(key, now);
  console.warn(msg);
}

export type DiscordGetResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: number | null; unavailable: boolean };

/**
 * GET from Discord with the bot token. `bucket` groups requests Discord limits
 * together (e.g. `member:<guildId>`). Waits up to `maxWaitMs` for a rate limit
 * to clear (once); longer than that answers unavailable without calling Discord.
 */
export async function discordGet<T>(path: string, bucket: string, opts: { maxWaitMs?: number } = {}): Promise<DiscordGetResult<T>> {
  const token = process.env['DISCORD_TOKEN'];
  if (!token) return { ok: false, status: 0, code: null, unavailable: true };
  const maxWaitMs = opts.maxWaitMs ?? 2_000;

  let waited = false; // wait for a rate limit at most once per call
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = Math.max(globalBlockedUntil, bucketBlockedUntil.get(bucket) ?? 0) - Date.now();
    if (wait > 0) {
      if (wait > maxWaitMs || waited) return { ok: false, status: 429, code: null, unavailable: true };
      waited = true;
      await sleep(wait);
    }

    let res: Response;
    await acquire();
    try {
      res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${token}` } });
    } catch (err) {
      warnOncePerMinute(`net:${bucket}`, `[discord] ${path}: ${(err as Error).message}`);
      return { ok: false, status: 0, code: null, unavailable: true };
    } finally {
      release();
    }

    // Out of requests in this bucket: pause it until Discord says it resets.
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const resetAfter = parseFloat(res.headers.get('x-ratelimit-reset-after') ?? '');
      if (Number.isFinite(resetAfter)) bucketBlockedUntil.set(bucket, Date.now() + resetAfter * 1000);
    }

    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
      const retryAfterMs = Math.ceil(1000 * (body.retry_after ?? parseFloat(res.headers.get('retry-after') ?? '1')));
      const until = Date.now() + retryAfterMs;
      if (body.global || res.headers.get('x-ratelimit-global') === 'true') globalBlockedUntil = until;
      else bucketBlockedUntil.set(bucket, until);
      warnOncePerMinute(`429:${bucket}`, `[discord] Rate limited on ${bucket} for ${retryAfterMs} ms${body.global ? ' (global)' : ''}`);
      continue; // the loop waits (if short enough) and tries once more
    }

    if (res.ok) return { ok: true, data: (await res.json()) as T };
    const body = (await res.json().catch(() => ({}))) as { code?: number };
    return { ok: false, status: res.status, code: body.code ?? null, unavailable: res.status >= 500 };
  }
  return { ok: false, status: 429, code: null, unavailable: true };
}

/**
 * POST to Discord with the bot token (v1.29.0: the setup checklist's "Create
 * it"). Same queue and rate-limit pauses as discordGet; never retried, since a
 * repeat could create a second channel. `reason` shows in the server's audit log.
 */
export async function discordPost<T>(path: string, body: unknown, bucket: string, reason?: string): Promise<DiscordGetResult<T>> {
  const token = process.env['DISCORD_TOKEN'];
  if (!token) return { ok: false, status: 0, code: null, unavailable: true };
  if (Math.max(globalBlockedUntil, bucketBlockedUntil.get(bucket) ?? 0) > Date.now()) return { ok: false, status: 429, code: null, unavailable: true };
  let res: Response;
  await acquire();
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    warnOncePerMinute(`net:${bucket}`, `[discord] POST ${path}: ${(err as Error).message}`);
    return { ok: false, status: 0, code: null, unavailable: true };
  } finally {
    release();
  }
  if (res.status === 429) {
    const b = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
    const until = Date.now() + Math.ceil(1000 * (b.retry_after ?? 1));
    if (b.global) globalBlockedUntil = until; else bucketBlockedUntil.set(bucket, until);
    return { ok: false, status: 429, code: null, unavailable: true };
  }
  if (res.ok) return { ok: true, data: (await res.json()) as T };
  const b = (await res.json().catch(() => ({}))) as { code?: number };
  return { ok: false, status: res.status, code: b.code ?? null, unavailable: res.status >= 500 };
}

// ── Cached reads ─────────────────────────────────────────────────────────────

interface Entry<T> { value: T; fetchedAt: number; ttl: number }

class TtlCache<T> {
  private map = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<unknown>>();
  get(key: string): Entry<T> | undefined { return this.map.get(key); }
  set(key: string, value: T, ttl: number) {
    if (this.map.size >= MAX_CACHE_ENTRIES) this.map.delete(this.map.keys().next().value!); // oldest first
    this.map.delete(key);
    this.map.set(key, { value, fetchedAt: Date.now(), ttl });
  }
  /** Runs `fn` once for concurrent callers asking for the same key. */
  once<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const running = this.inflight.get(key) as Promise<R> | undefined;
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  delete(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); this.inflight.clear(); }
}

export interface DiscordMember {
  user: { id: string; username: string; global_name?: string | null };
  nick?: string | null;
  roles: string[];
}

export type MemberLookup =
  | { status: 'member'; member: DiscordMember }
  | { status: 'not-member' }
  | { status: 'unavailable' };

const members = new TtlCache<DiscordMember | null>();
const fresh = (e: Entry<unknown> | undefined) => !!e && Date.now() - e.fetchedAt < e.ttl;
const usable = (e: Entry<unknown> | undefined) => !!e && Date.now() - e.fetchedAt < Math.max(e.ttl, STALE_MAX_MS);
const toLookup = (m: DiscordMember | null): MemberLookup => (m ? { status: 'member', member: m } : { status: 'not-member' });

/**
 * A server member (roles, nickname), from cache when fresh. `maxWaitMs: 0`
 * never waits on a rate limit (for nice-to-have lookups like display names).
 */
export async function getGuildMember(guildId: string, userId: string, opts: { maxWaitMs?: number } = {}): Promise<MemberLookup> {
  const key = `${guildId}:${userId}`;
  const cached = members.get(key);
  if (fresh(cached)) return toLookup(cached!.value);

  return members.once(key, async () => {
    const r = await discordGet<DiscordMember>(`/guilds/${guildId}/members/${userId}`, `member:${guildId}`, opts);
    if (r.ok) {
      members.set(key, r.data, MEMBER_TTL_MS);
      return toLookup(r.data);
    }
    if (r.status === 404) { // Unknown Member / Unknown Guild
      members.set(key, null, NOT_MEMBER_TTL_MS);
      return toLookup(null);
    }
    if (r.status === 401 || r.status === 403) { // the bot can't see that server: don't keep asking
      warnOncePerMinute(`noaccess:${guildId}`, `[discord] No access to members of server ${guildId} (${r.status})`);
      members.set(key, null, NO_ACCESS_TTL_MS);
      return toLookup(null);
    }
    const prev = members.get(key);
    if (usable(prev)) return toLookup(prev!.value);
    return { status: 'unavailable' } as const;
  });
}

/** Display names (nickname, else global name, else username) for these users; skips any Discord can't give right now. */
export async function getMemberNames(guildId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await Promise.all([...new Set(userIds)].map(async (uid) => {
    const r = await getGuildMember(guildId, uid, { maxWaitMs: 0 });
    if (r.status === 'member') names.set(uid, r.member.nick ?? r.member.user.global_name ?? r.member.user.username);
  }));
  return names;
}

const lists = new TtlCache<unknown>();

/** A cached GET (roles, channels, member lists): `ttlMs` fresh, older answers reused while Discord can't answer. */
export async function cachedDiscordGet<T>(key: string, path: string, bucket: string, ttlMs: number): Promise<DiscordGetResult<T>> {
  const cached = lists.get(key);
  if (fresh(cached)) return { ok: true, data: cached!.value as T };
  return lists.once(key, async () => {
    const r = await discordGet<T>(path, bucket);
    if (r.ok) { lists.set(key, r.data, ttlMs); return r; }
    const prev = lists.get(key);
    if (r.unavailable && usable(prev)) return { ok: true as const, data: prev!.value as T };
    return r;
  });
}

/**
 * Everyone in a server (id → display name), for views that list members'
 * things (the fleet, v1.32.0). Up to 10,000 members, cached 10 minutes;
 * null when Discord can't answer right now.
 */
export async function getGuildMemberList(guildId: string): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  let after = '0';
  for (let page = 0; page < 10; page++) {
    const r = await cachedDiscordGet<DiscordMember[]>(`members:${guildId}:${after}`, `/guilds/${guildId}/members?limit=1000&after=${after}`, `members:${guildId}`, 10 * 60_000);
    if (!r.ok) return page === 0 ? null : out;
    for (const m of r.data) out.set(m.user.id, m.nick ?? m.user.global_name ?? m.user.username);
    if (r.data.length < 1000) break;
    after = r.data[r.data.length - 1]!.user.id;
  }
  return out;
}

/** Drops one cachedDiscordGet answer, e.g. a channel list right after creating a channel. */
export function forgetCached(key: string): void {
  lists.delete(key);
}

/** For tests: forget cached answers and rate-limit pauses. */
export function resetDiscordRest(): void {
  members.clear();
  lists.clear();
  globalBlockedUntil = 0;
  bucketBlockedUntil.clear();
  lastWarn.clear();
}
