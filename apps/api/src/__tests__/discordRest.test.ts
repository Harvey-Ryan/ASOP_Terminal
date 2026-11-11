import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import {
  discordGet, getGuildMember, getMemberNames, cachedDiscordGet, resetDiscordRest,
  MEMBER_TTL_MS, NO_ACCESS_TTL_MS,
} from '../lib/discordRest.js';
import { DISCORD_BUSY_MESSAGE } from '../lib/memberRoles.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

// Discord calls from the API (v1.11.1): cached, merged, throttled, and never
// made while Discord has said to wait.

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; delayMs?: number };
let calls: string[] = [];
let replies: ((url: string) => Reply)[] = [];
let inFlight = 0;
let maxInFlight = 0;

function fakeFetch(url: string): Promise<Response> {
  calls.push(url.replace('https://discord.com/api/v10', ''));
  const make = replies.length > 1 ? replies.shift()! : replies[0]!;
  const r = make(url);
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  return new Promise((resolve) => setTimeout(() => {
    inFlight--;
    resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } }));
  }, r.delayMs ?? 1));
}

const member = (id: string, roles: string[] = [], nick: string | null = null) => ({ user: { id, username: `user-${id}`, global_name: null }, nick, roles });
const ok = (body: unknown): Reply => ({ status: 200, body });
const prevToken = process.env['DISCORD_TOKEN'];
let now = 1_800_000_000_000;

beforeEach(() => {
  resetDiscordRest();
  calls = []; replies = [() => ok(member('u1', ['r1']))]; inFlight = 0; maxInFlight = 0;
  process.env['DISCORD_TOKEN'] = 'test-token';
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env['DISCORD_TOKEN'] = prevToken;
});

describe('member lookups', () => {
  it('are cached for a minute, then asked again', async () => {
    expect((await getGuildMember('g1', 'u1')).status).toBe('member');
    expect((await getGuildMember('g1', 'u1')).status).toBe('member');
    expect(calls).toEqual(['/guilds/g1/members/u1']);
    now += MEMBER_TTL_MS + 1;
    await getGuildMember('g1', 'u1');
    expect(calls).toHaveLength(2);
  });

  it('identical lookups at the same moment make one call', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, () => getGuildMember('g1', 'u1')));
    expect(all.every((r) => r.status === 'member')).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('are per server and per person', async () => {
    await getGuildMember('g1', 'u1');
    await getGuildMember('g1', 'u2');
    await getGuildMember('g2', 'u1');
    expect(calls).toHaveLength(3);
  });

  it('a non-member (404) is remembered too', async () => {
    replies = [() => ({ status: 404, body: { code: 10007 } })];
    expect((await getGuildMember('g1', 'u9')).status).toBe('not-member');
    expect((await getGuildMember('g1', 'u9')).status).toBe('not-member');
    expect(calls).toHaveLength(1);
  });

  it('a server the bot can\'t see (403) isn\'t asked again for 5 minutes', async () => {
    replies = [() => ({ status: 403, body: { code: 50001 } })];
    expect((await getGuildMember('g1', 'u1')).status).toBe('not-member');
    now += NO_ACCESS_TTL_MS - 1000;
    await getGuildMember('g1', 'u1');
    expect(calls).toHaveLength(1);
  });

  it('when Discord fails, a recent answer is used; with none, it says unavailable', async () => {
    await getGuildMember('g1', 'u1');
    now += MEMBER_TTL_MS + 1;
    replies = [() => ({ status: 502 })];
    expect(await getGuildMember('g1', 'u1')).toMatchObject({ status: 'member' });
    expect((await getGuildMember('g1', 'u2')).status).toBe('unavailable');
  });

  it('no more than 4 requests are in flight at once', async () => {
    replies = [(url) => ({ ...ok(member(url.split('/').pop()!)), delayMs: 20 })];
    await Promise.all(Array.from({ length: 12 }, (_, i) => getGuildMember('g1', `u${i}`)));
    expect(calls).toHaveLength(12);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});

describe('rate limits', () => {
  it('a short 429 is waited out and retried once', async () => {
    replies = [() => ({ status: 429, body: { retry_after: 0.05, global: false } }), () => ok(member('u1'))];
    vi.restoreAllMocks(); // real clock: the wait is real
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    expect((await getGuildMember('g1', 'u1')).status).toBe('member');
    expect(calls).toHaveLength(2);
  });

  it('a long 429 answers unavailable, and Discord isn\'t asked again until it clears', async () => {
    replies = [() => ({ status: 429, body: { retry_after: 30, global: false } })];
    expect((await getGuildMember('g1', 'u1')).status).toBe('unavailable');
    expect((await getGuildMember('g1', 'u2')).status).toBe('unavailable');
    expect(calls).toHaveLength(1); // the second lookup never reached Discord
    now += 31_000;
    replies = [() => ok(member('u2'))];
    expect((await getGuildMember('g1', 'u2')).status).toBe('member');
    expect(calls).toHaveLength(2);
  });

  it('the pause is per server unless Discord says it is global', async () => {
    replies = [() => ({ status: 429, body: { retry_after: 30 } }), () => ok(member('u1'))];
    await getGuildMember('g1', 'u1');
    expect((await getGuildMember('g2', 'u1')).status).toBe('member');
    resetDiscordRest(); calls = [];
    replies = [() => ({ status: 429, body: { retry_after: 30, global: true } }), () => ok(member('u1'))];
    await getGuildMember('g1', 'u1');
    expect((await getGuildMember('g2', 'u1')).status).toBe('unavailable');
    expect(calls).toHaveLength(1);
  });

  it('an exhausted bucket (remaining 0) pauses that route until it resets', async () => {
    replies = [() => ({ ...ok(member('u1')), headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '10' } }), () => ok(member('u2'))];
    await getGuildMember('g1', 'u1');
    expect((await getGuildMember('g1', 'u2', { maxWaitMs: 0 })).status).toBe('unavailable');
    expect(calls).toHaveLength(1);
    now += 10_001;
    expect((await getGuildMember('g1', 'u2', { maxWaitMs: 0 })).status).toBe('member');
  });

  it('no token: nothing is sent', async () => {
    delete process.env['DISCORD_TOKEN'];
    expect(await discordGet('/x', 'b')).toMatchObject({ ok: false, unavailable: true });
    expect(calls).toHaveLength(0);
  });
});

describe('names and lists', () => {
  it('display names: nickname, then global name, then username; missing members are skipped', async () => {
    replies = [(url) => {
      const id = url.split('/').pop()!;
      if (id === 'gone') return { status: 404 };
      return ok(id === 'a' ? member('a', [], 'Nick A') : { user: { id, username: 'plain', global_name: id === 'b' ? 'Global B' : null }, roles: [] });
    }];
    const names = await getMemberNames('g1', ['a', 'b', 'c', 'gone', 'a']);
    expect(Object.fromEntries(names)).toEqual({ a: 'Nick A', b: 'Global B', c: 'plain' });
    expect(calls).toHaveLength(4);
  });

  it('display names never wait on a rate limit', async () => {
    replies = [() => ({ status: 429, body: { retry_after: 5 } })];
    await getGuildMember('g1', 'x');
    calls = [];
    expect((await getMemberNames('g1', ['a', 'b'])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('cached lists are reused, and an older copy covers a Discord outage', async () => {
    replies = [() => ok([{ id: 'r1' }])];
    expect(await cachedDiscordGet('roles:g1', '/guilds/g1/roles', 'roles:g1', 30_000)).toMatchObject({ ok: true });
    await cachedDiscordGet('roles:g1', '/guilds/g1/roles', 'roles:g1', 30_000);
    expect(calls).toHaveLength(1);
    now += 31_000;
    replies = [() => ({ status: 503 })];
    expect(await cachedDiscordGet('roles:g1', '/guilds/g1/roles', 'roles:g1', 30_000)).toEqual({ ok: true, data: [{ id: 'r1' }] });
  });
});

describe('role checks on the website', () => {
  const app = createServer();

  async function viewer(viewerRoles: string[]) {
    const guild = await createGuild({ name: 'Alpha' });
    await createGuildSettings(guild.id, { viewerRoles: JSON.stringify(viewerRoles) });
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
    return { guild, user, agent, url: `/api/guilds/${guild.guildId}/events` };
  }

  it('a member with a viewer role gets in, and repeat visits don\'t ask Discord again', async () => {
    const v = await viewer(['role-viewer']);
    replies = [() => ok(member(v.user.discordId, ['role-viewer']))];
    await v.agent.get(v.url).expect(200);
    await v.agent.get(v.url).expect(200);
    await v.agent.get(v.url).expect(200);
    expect(calls.filter((c) => c.includes('/members/'))).toHaveLength(1);
  });

  it('without the role: 403 as before', async () => {
    const v = await viewer(['role-viewer']);
    replies = [() => ok(member(v.user.discordId, ['other']))];
    await v.agent.get(v.url).expect(403);
  });

  it('when Discord can\'t answer: 503 "try again", not Forbidden', async () => {
    const v = await viewer(['role-viewer']);
    replies = [() => ({ status: 429, body: { retry_after: 30 } })];
    const res = await v.agent.get(v.url).expect(503);
    expect(res.body).toEqual({ success: false, error: DISCORD_BUSY_MESSAGE });
    expect(res.headers['retry-after']).toBe('5');
  });

  it('servers with no role settings never ask Discord', async () => {
    const v = await viewer([]);
    await v.agent.get(v.url).expect(403);
    expect(calls).toHaveLength(0);
  });
});
