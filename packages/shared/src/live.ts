// Live updates (v1.30.0). Pages that used to ask the API every few seconds
// ("anything new?") now keep one connection open and are told when
// something they show has changed, then fetch it once.
//
// - Every write to a watched model (LIVE_MODELS), from the API or the bot,
//   is turned into topics ("loot:<sessionId>", "auctions:<guildId>", …) by a
//   Prisma middleware (installLiveUpdates) and sent with pg_notify on
//   LIVE_CHANNEL. Topics name what changed, never the data itself.
// - The API LISTENs and forwards matching topics to each browser's
//   GET /api/live stream; the browser refetches the queries for that topic.
// - Polling stays as a slow safety net while the stream is up, and goes back
//   to its old pace when it isn't.

export const LIVE_CHANNEL = 'asop_live';
/** Most topics one browser stream may watch. */
export const LIVE_MAX_TOPICS = 24;

type Row = Record<string, unknown>;

/** Lookups for rows that don't carry the key their topic needs. */
export interface LiveLookups {
  /** LootItem id → its LootSession id */
  itemSession(itemId: string): Promise<string | null>;
  /** LootAuction id → its LootSession id */
  lootAuctionSession(auctionId: string): Promise<string | null>;
  /** Auction (DKP auction) id → its Discord server id */
  auctionGuild(auctionId: string): Promise<string | null>;
}

interface LiveModelSpec {
  /** Fields the topics are built from. */
  keys: string[];
  topics(row: Row, look: LiveLookups): Promise<(string | null | undefined | false)[]>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const t = (prefix: string, v: unknown) => { const s = str(v); return s ? `${prefix}:${s}` : null; };

export const LIVE_MODELS: Record<string, LiveModelSpec> = {
  LootSession: { keys: ['id', 'guildId', 'eventId'], topics: async (r) => [t('loot', r.id), t('loot-guild', r.guildId), t('loot-event', r.eventId)] },
  LootItem: { keys: ['sessionId'], topics: async (r) => [t('loot', r.sessionId)] },
  LootDraftQueue: { keys: ['sessionId'], topics: async (r) => [t('loot', r.sessionId)] },
  LootAuction: { keys: ['sessionId'], topics: async (r) => [t('loot', r.sessionId)] },
  LootAssignment: { keys: ['itemId'], topics: async (r, look) => [t('loot', str(r.itemId) && await look.itemSession(r.itemId as string))] },
  LootAuctionBid: { keys: ['auctionId'], topics: async (r, look) => [t('loot', str(r.auctionId) && await look.lootAuctionSession(r.auctionId as string))] },
  Auction: { keys: ['guildId'], topics: async (r) => [t('auctions', r.guildId)] },
  AuctionBid: { keys: ['auctionId'], topics: async (r, look) => [t('auctions', str(r.auctionId) && await look.auctionGuild(r.auctionId as string))] },
  Trade: { keys: ['id'], topics: async (r) => [t('trade', r.id)] },
  TradeMessage: { keys: ['tradeId'], topics: async (r) => [t('trade', r.tradeId)] },
};

/** Topics a browser may ask for. Server-wide ones are checked against the person's servers. */
const TOPIC_RE = /^(loot|loot-event|trade|loot-guild|auctions):[A-Za-z0-9_-]{1,64}$/;
export function isLiveTopic(topic: string): boolean {
  return TOPIC_RE.test(topic);
}
/** The Discord server a server-wide topic belongs to, else null (an id topic). */
export function liveTopicGuild(topic: string): string | null {
  const m = /^(loot-guild|auctions):(.+)$/.exec(topic);
  return m ? m[2]! : null;
}

// ── Collecting writes ─────────────────────────────────────────────────────────

/**
 * Collects topics and publishes them shortly after, so a burst of writes is
 * one notice. A write inside a transaction may be published before the
 * transaction commits, so those topics are sent once more a little later.
 */
export function createLiveQueue(publish: (topics: string[]) => Promise<void>, opts: { delayMs?: number; txFollowUpMs?: number } = {}) {
  const delayMs = opts.delayMs ?? 250;
  const followUpMs = opts.txFollowUpMs ?? 2_000;
  const pending = new Set<string>();
  const later = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let laterTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = (set: Set<string>) => {
    const topics = [...set];
    set.clear();
    // pg_notify payloads are capped at 8000 bytes: send in chunks.
    for (let i = 0; i < topics.length; i += 40) void publish(topics.slice(i, i + 40));
  };
  return {
    add(topics: string[], inTransaction: boolean) {
      if (!topics.length) return;
      for (const x of topics) pending.add(x);
      if (!timer) timer = setTimeout(() => { timer = null; flush(pending); }, delayMs);
      if (inTransaction) {
        for (const x of topics) later.add(x);
        if (!laterTimer) laterTimer = setTimeout(() => { laterTimer = null; flush(later); }, followUpMs);
      }
    },
  };
}

// ── Prisma middleware ────────────────────────────────────────────────────────

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

interface MiddlewareParams { model?: string; action: string; args?: any; runInTransaction?: boolean }

export interface LiveMiddlewareDeps {
  /** Reads `keys` of the rows matching `where` (at most a few hundred). */
  findKeys(model: string, where: unknown, keys: string[]): Promise<Row[]>;
  lookups: LiveLookups;
  queue: { add(topics: string[], inTransaction: boolean): void };
  onError(err: unknown): void;
}

/** A Prisma `$use` middleware that turns watched writes into topics. Never fails a write. */
export function liveMiddleware(deps: LiveMiddlewareDeps) {
  return async (params: MiddlewareParams, next: (p: MiddlewareParams) => Promise<any>) => {
    const spec = params.model ? LIVE_MODELS[params.model] : undefined;
    if (!spec || !WRITES.has(params.action)) return next(params);
    const model = params.model!;

    // updateMany/deleteMany return a count, and a deleted row can't be read
    // afterwards: read the keys first.
    let rows: Row[] | null = null;
    const before = params.action === 'updateMany' || params.action === 'deleteMany' || (params.action === 'delete' && params.args?.select);
    if (before) {
      try { rows = await deps.findKeys(model, params.args?.where ?? {}, spec.keys); } catch (err) { deps.onError(err); }
    }

    const result = await next(params);

    try {
      if (!rows) {
        if (params.action === 'createMany') rows = ([] as Row[]).concat(params.args?.data ?? []);
        else if (Array.isArray(result)) rows = result as Row[];
        else rows = result && typeof result === 'object' ? [result as Row] : [];
        // A `select` can leave the keys out: read them by id.
        const missing = rows.filter((r) => spec.keys.some((k) => !(k in r)));
        if (missing.length) {
          const ids = missing.map((r) => str(r.id)).filter((x): x is string => !!x);
          rows = rows.filter((r) => !missing.includes(r));
          if (ids.length) rows.push(...await deps.findKeys(model, { id: { in: ids } }, spec.keys));
        }
      }
      const topics = new Set<string>();
      for (const r of rows) for (const x of await spec.topics(r, deps.lookups)) if (x) topics.add(x);
      deps.queue.add([...topics], !!params.runInTransaction);
    } catch (err) {
      deps.onError(err);
    }
    return result;
  };
}

/** The parts of a PrismaClient installLiveUpdates uses. */
export interface LivePrismaLike {
  $use(mw: (params: any, next: (params: any) => Promise<any>) => Promise<any>): void;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

const delegateOf = (model: string) => model[0]!.toLowerCase() + model.slice(1);

/** Small id → id cache; ids never move between parents. */
function cached(load: (id: string) => Promise<string | null>) {
  const map = new Map<string, string>();
  return async (id: string) => {
    const hit = map.get(id);
    if (hit) return hit;
    const v = await load(id);
    if (v) { if (map.size > 5_000) map.clear(); map.set(id, v); }
    return v;
  };
}

/**
 * Sends a live notice for every watched write made through `prisma` (API
 * and bot both call this once at start-up).
 */
export function installLiveUpdates(prisma: LivePrismaLike, onError: (err: unknown) => void = (err) => console.warn('[live] notice not sent:', err)) {
  const db = prisma as any;
  const findUniqueField = (model: string, field: string) => cached(async (id) => {
    const row = await db[delegateOf(model)].findUnique({ where: { id }, select: { [field]: true } });
    return str(row?.[field]);
  });
  const queue = createLiveQueue(async (topics) => {
    try { await prisma.$executeRawUnsafe('SELECT pg_notify($1, $2)', LIVE_CHANNEL, JSON.stringify({ t: topics })); } catch (err) { onError(err); }
  });
  prisma.$use(liveMiddleware({
    findKeys: (model, where, keys) => db[delegateOf(model)].findMany({ where, select: Object.fromEntries(keys.map((k) => [k, true])), take: 500 }),
    lookups: {
      itemSession: findUniqueField('LootItem', 'sessionId'),
      lootAuctionSession: findUniqueField('LootAuction', 'sessionId'),
      auctionGuild: findUniqueField('Auction', 'guildId'),
    },
    queue,
    onError,
  }));
}

/** Reads a notice sent on LIVE_CHANNEL; [] if it isn't one. */
export function parseLiveNotice(payload: string | undefined): string[] {
  try {
    const t = (JSON.parse(payload ?? '') as { t?: unknown }).t;
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
