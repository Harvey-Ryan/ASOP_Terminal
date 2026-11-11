// /api/admin/*: the admin panel (v1.13.0). Platform admins only
// (PLATFORM_ADMIN_DISCORD_IDS); everyone else gets 404.
//
//   GET   /overview                     health, versions, counts, errors per hour
//   GET   /errors                       occurrences (filters; ?after= for the live feed, ?before= for paging)
//   GET   /errors/groups                one row per kind of error in a period
//   GET   /errors/:id                   one occurrence, its kind, same-ref errors
//   PATCH /errors/groups/:fingerprint   resolve / ignore / reopen, with a note
//   GET   /guilds                       every server the bot is in
//   GET   /guilds/:guildId              one server: settings, Discord info, errors, log
//   PATCH /guilds/:guildId/settings     change its settings (same rules as its own settings page; audit-logged)
//   GET   /log                          the admin activity log
//   GET   /config, PUT /config          the admin Discord feed
//   POST  /config/test                  send a test message to the feed

import { Router, type Request, type Response } from 'express';
import {
  ADMIN_SETTING_FIELDS,
  ERROR_SOURCES,
  getGuildIconUrl,
  isValidTimeZone,
  setupChecklist,
  setupProblems,
  type AdminConfigDto,
  type AdminGuildDetailDto,
  type AdminGuildDto,
  type AdminLogDto,
  type AdminOverviewDto,
  type ApiResponse,
  type ErrorDetailDto,
  type ErrorEventDto,
  type ErrorGroupDto,
  type ErrorGroupStatus,
  type ErrorLevel,
  type ErrorSource,
} from '@dem/shared';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePlatformAdmin } from '../../lib/platformAdmin.js';
import { APP_COMMIT, APP_VERSION } from '../../lib/appVersion.js';
import { readGameDataStatus } from './gameData.js';
import { adminLog } from '../../lib/adminLog.js';
import { ValidationError } from '../../lib/validate.js';
import { applySettingsPatch, parseSettingsPatch } from '../../lib/guildSettings.js';
import { cachedDiscordGet } from '../../lib/discordRest.js';
import { triggerBot } from '../../lib/triggerBot.js';
import { requestLoggingOn } from '../../lib/requestLogger.js';
import type { ErrorEvent, Prisma } from '@prisma/client';

export const adminRouter = Router();
adminRouter.use(requireAuth, requirePlatformAdmin);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Admin = { discordId: string; username: string };
const adminOf = (res: Response): Admin => res.locals['admin'] as Admin;

const ok = <T>(res: Response, data: T) => res.json({ success: true, data } satisfies ApiResponse<T>);
const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error } satisfies ApiResponse);

const parseJson = (s: string): Record<string, unknown> => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; } };

/** Names for the servers and users in a list of errors. */
async function namesFor(rows: { guildId: string | null; userId: string | null }[]) {
  const guildIds = [...new Set(rows.map((r) => r.guildId).filter((g): g is string => !!g))];
  const userIds = [...new Set(rows.map((r) => r.userId).filter((u): u is string => !!u))];
  const [guilds, users] = await Promise.all([
    guildIds.length ? prisma.guild.findMany({ where: { guildId: { in: guildIds } }, select: { guildId: true, name: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { discordId: { in: userIds } }, select: { discordId: true, username: true, globalName: true } }) : [],
  ]);
  return {
    guild: new Map(guilds.map((g) => [g.guildId, g.name])),
    user: new Map(users.map((u) => [u.discordId, u.globalName ?? u.username])),
  };
}

function toEventDto(e: ErrorEvent, names: Awaited<ReturnType<typeof namesFor>>, withStack = false): ErrorEventDto {
  return {
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    source: e.source as ErrorSource,
    level: e.level as ErrorLevel,
    message: e.message,
    ...(withStack ? { stack: e.stack } : {}),
    fingerprint: e.fingerprint,
    ref: e.ref,
    guildId: e.guildId,
    guildName: e.guildId ? names.guild.get(e.guildId) ?? null : null,
    userId: e.userId,
    userName: e.userId ? names.user.get(e.userId) ?? null : null,
    context: parseJson(e.context),
    release: e.release,
    suppressed: e.suppressed,
  };
}

async function eventDtos(rows: ErrorEvent[], withStack = false): Promise<ErrorEventDto[]> {
  const names = await namesFor(rows);
  return rows.map((r) => toEventDto(r, names, withStack));
}

// ── Overview ────────────────────────────────────────────────────────────────

adminRouter.get('/overview', async (_req, res) => {
  const now = Date.now();
  const since24h = new Date(now - DAY);
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatency = Date.now() - t0;

  const logging = requestLoggingOn();
  const [beats, gameData, guilds, joined7d, left7d, lastHour, bySource, warnings24h, kinds24h, openKinds, requests, failed, slowest,
    upcoming, live, openLoot, activeUsers, hourly, config] = await Promise.all([
    prisma.serviceHeartbeat.findMany(),
    readGameDataStatus().catch(() => null),
    prisma.guild.count(),
    prisma.adminLog.count({ where: { kind: 'guild.joined', createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.adminLog.count({ where: { kind: 'guild.left', createdAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.errorEvent.count({ where: { level: 'error', createdAt: { gte: new Date(now - HOUR) } } }),
    prisma.errorEvent.groupBy({ by: ['source'], where: { level: 'error', createdAt: { gte: since24h } }, _count: { _all: true } }),
    prisma.errorEvent.count({ where: { level: 'warn', createdAt: { gte: since24h } } }),
    // Kinds first seen in the last 24 hours
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT fingerprint FROM "ErrorEvent" WHERE level = 'error' GROUP BY fingerprint HAVING min("createdAt") >= ${since24h}) k`,
    // Kinds seen in the last 7 days that aren't resolved or ignored
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT e.fingerprint FROM "ErrorEvent" e LEFT JOIN "ErrorGroupState" s ON s.fingerprint = e.fingerprint
      WHERE e.level = 'error' AND e."createdAt" >= ${new Date(now - 7 * DAY)} GROUP BY e.fingerprint, s.status, s."resolvedAt"
      HAVING coalesce(s.status, 'open') = 'open' OR (s.status = 'resolved' AND max(e."createdAt") > s."resolvedAt")) k`,
    logging ? prisma.requestLog.count({ where: { createdAt: { gte: since24h } } }) : 0,
    logging ? prisma.requestLog.count({ where: { createdAt: { gte: since24h }, statusCode: { gte: 500 } } }) : 0,
    logging ? prisma.requestLog.aggregate({ where: { createdAt: { gte: since24h } }, _max: { durationMs: true } }) : null,
    prisma.event.count({ where: { status: 'PENDING', startTime: { gte: new Date(now) } } }),
    prisma.event.count({ where: { status: 'ACTIVE' } }),
    prisma.lootSession.count({ where: { status: 'OPEN' } }),
    // Signed in during the last 7 days: sign-ins last 7 days, so a live session is one.
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT sess->>'userId') AS n FROM "session" WHERE expire > now() AND sess->>'userId' IS NOT NULL`,
    prisma.$queryRaw<{ hour: Date; errors: bigint; warnings: bigint }[]>`
      SELECT date_trunc('hour', "createdAt") AS hour,
             count(*) FILTER (WHERE level = 'error') AS errors,
             count(*) FILTER (WHERE level = 'warn') AS warnings
      FROM "ErrorEvent" WHERE "createdAt" >= ${new Date(now - 23 * HOUR - (now % HOUR))}
      GROUP BY 1 ORDER BY 1`,
    prisma.adminConfig.findUnique({ where: { id: 1 } }),
  ]);

  const byHour = new Map(hourly.map((h) => [h.hour.toISOString(), h]));
  const firstHour = now - (now % HOUR) - 23 * HOUR;
  const errorsByHour = Array.from({ length: 24 }, (_, i) => {
    const hour = new Date(firstHour + i * HOUR).toISOString();
    const h = byHour.get(hour);
    return { hour, errors: Number(h?.errors ?? 0), warnings: Number(h?.warnings ?? 0) };
  });

  const services = (['api', 'bot'] as const).map((service) => {
    const b = beats.find((x) => x.service === service);
    return {
      service,
      up: !!b && now - b.beatAt.getTime() < 3 * 60_000,
      startedAt: b?.startedAt.toISOString() ?? null,
      beatAt: b?.beatAt.toISOString() ?? null,
      release: b?.release ?? '',
      details: b ? parseJson(b.details) : {},
    };
  });

  const bySource24h: Partial<Record<ErrorSource, number>> = {};
  for (const r of bySource) bySource24h[r.source as ErrorSource] = r._count._all;

  ok<AdminOverviewDto>(res, {
    release: { version: APP_VERSION, commit: APP_COMMIT },
    services,
    database: { ok: true, latencyMs: dbLatency },
    gameData: gameData ? { build: gameData.build, syncedAt: gameData.syncedAt, checkedAt: gameData.lastCheckAt } : null,
    servers: { total: guilds, joined7d, left7d },
    errors: {
      lastHour, warnings24h,
      last24h: Object.values(bySource24h).reduce((a, b) => a + (b ?? 0), 0),
      bySource24h,
      newKinds24h: Number(kinds24h[0]?.n ?? 0),
      openKinds: Number(openKinds[0]?.n ?? 0),
    },
    requests: logging ? { last24h: requests, failed24h: failed, slowest24hMs: slowest?._max.durationMs ?? 0 } : null,
    activity: { upcomingEvents: upcoming, liveEvents: live, openLootSessions: openLoot, activeUsers7d: Number(activeUsers[0]?.n ?? 0) },
    errorsByHour,
    feed: { configured: !!config?.feedChannelId, alertsEnabled: config?.alertsEnabled ?? true, digestEnabled: config?.digestEnabled ?? true },
  });
});

// ── Errors ──────────────────────────────────────────────────────────────────

/** Filters shared by the list and the groups: ?source=&level=&q=&guildId=&userId=&ref=&fingerprint=&release=&since=&until= */
function errorFilter(req: Request): Prisma.ErrorEventWhereInput {
  const q = req.query as Record<string, string | undefined>;
  const where: Prisma.ErrorEventWhereInput = {};
  if (q['source'] && (ERROR_SOURCES as readonly string[]).includes(q['source'])) where.source = q['source'];
  if (q['level'] === 'error' || q['level'] === 'warn') where.level = q['level'];
  if (q['guildId']) where.guildId = q['guildId'];
  if (q['userId']) where.userId = q['userId'];
  if (q['ref']) where.ref = q['ref'].trim().toUpperCase().replace(/^REF[\s:#]+/, ''); // "Ref K7QW3P" pasted whole
  if (q['fingerprint']) where.fingerprint = q['fingerprint'];
  if (q['release']) where.release = { startsWith: q['release'] };
  if (q['q']) {
    const text = q['q'].slice(0, 200);
    where.OR = [{ message: { contains: text, mode: 'insensitive' } }, { stack: { contains: text, mode: 'insensitive' } }, { context: { contains: text, mode: 'insensitive' } }];
  }
  const since = q['since'] ? new Date(q['since']) : null;
  const until = q['until'] ? new Date(q['until']) : null;
  if ((since && !isNaN(+since)) || (until && !isNaN(+until))) {
    where.createdAt = { ...(since && !isNaN(+since) ? { gte: since } : {}), ...(until && !isNaN(+until) ? { lt: until } : {}) };
  }
  return where;
}

adminRouter.get('/errors', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const limit = Math.min(200, Math.max(1, Number(q['limit']) || 50));
  const after = Number(q['after']) || 0;   // live feed: newer than this id, oldest first
  const before = Number(q['before']) || 0; // history: older than this id, newest first
  const where = errorFilter(req);
  if (after) where.id = { gt: after };
  else if (before) where.id = { lt: before };
  const rows = await prisma.errorEvent.findMany({ where, orderBy: { id: after ? 'asc' : 'desc' }, take: limit });
  ok(res, await eventDtos(rows));
});

const PERIODS: Record<string, number> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY };

adminRouter.get('/errors/groups', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const since = new Date(Date.now() - (PERIODS[q['period'] ?? '24h'] ?? DAY));
  const where = { ...errorFilter(req), createdAt: { gte: since } };
  const groups = await prisma.errorEvent.groupBy({
    by: ['fingerprint'], where,
    _count: { _all: true }, _sum: { suppressed: true }, _min: { createdAt: true }, _max: { createdAt: true, id: true },
    orderBy: { _max: { id: 'desc' } }, take: 200,
  });
  const fps = groups.map((g) => g.fingerprint);
  const [latest, states, everFirst, spread] = await Promise.all([
    prisma.errorEvent.findMany({ where: { id: { in: groups.map((g) => g._max.id!).filter(Boolean) } } }),
    prisma.errorGroupState.findMany({ where: { fingerprint: { in: fps } } }),
    prisma.errorEvent.groupBy({ by: ['fingerprint'], where: { fingerprint: { in: fps } }, _min: { createdAt: true } }),
    fps.length ? prisma.$queryRaw<{ fingerprint: string; servers: bigint; users: bigint; releases: string[] }[]>`
      SELECT fingerprint, count(DISTINCT "guildId") AS servers, count(DISTINCT "userId") AS users, array_agg(DISTINCT release) AS releases
      FROM "ErrorEvent" WHERE fingerprint = ANY(${fps}) AND "createdAt" >= ${since} GROUP BY fingerprint` : [],
  ]);
  const latestBy = new Map(latest.map((e) => [e.fingerprint, e]));
  const stateBy = new Map(states.map((s) => [s.fingerprint, s]));
  const firstBy = new Map(everFirst.map((f) => [f.fingerprint, f._min.createdAt]));
  const spreadBy = new Map(spread.map((s) => [s.fingerprint, s]));
  const statusFilter = q['status'];

  const out: ErrorGroupDto[] = [];
  for (const g of groups) {
    const e = latestBy.get(g.fingerprint);
    if (!e) continue;
    const st = stateBy.get(g.fingerprint);
    // A resolved kind that happened again since is open again.
    const reopened = st?.status === 'resolved' && st.resolvedAt && g._max.createdAt! > st.resolvedAt;
    const status: ErrorGroupStatus = reopened ? 'open' : ((st?.status as ErrorGroupStatus | undefined) ?? 'open');
    if (statusFilter && statusFilter !== 'all' && status !== statusFilter) continue;
    const first = firstBy.get(g.fingerprint) ?? g._min.createdAt!;
    const sp = spreadBy.get(g.fingerprint);
    out.push({
      fingerprint: g.fingerprint,
      source: e.source as ErrorSource,
      level: e.level as ErrorLevel,
      message: e.message,
      count: g._count._all + (g._sum.suppressed ?? 0),
      firstSeen: first.toISOString(),
      lastSeen: g._max.createdAt!.toISOString(),
      servers: Number(sp?.servers ?? 0),
      users: Number(sp?.users ?? 0),
      releases: (sp?.releases ?? []).filter(Boolean),
      status,
      note: st?.note ?? '',
      isNew: first >= since,
    });
  }
  ok(res, out);
});

adminRouter.get('/errors/:id', async (req, res) => {
  const id = Number(req.params['id']);
  const e = Number.isInteger(id) ? await prisma.errorEvent.findUnique({ where: { id } }) : null;
  if (!e) { fail(res, 404, 'Error not found'); return; }
  const [sameRef, recent, state, agg] = await Promise.all([
    e.ref ? prisma.errorEvent.findMany({ where: { ref: e.ref, id: { not: e.id } }, orderBy: { id: 'asc' }, take: 50 }) : [],
    prisma.errorEvent.findMany({ where: { fingerprint: e.fingerprint, id: { not: e.id } }, orderBy: { id: 'desc' }, take: 20 }),
    prisma.errorGroupState.findUnique({ where: { fingerprint: e.fingerprint } }),
    prisma.errorEvent.aggregate({ where: { fingerprint: e.fingerprint }, _count: { _all: true }, _sum: { suppressed: true }, _min: { createdAt: true }, _max: { createdAt: true } }),
  ]);
  const names = await namesFor([e, ...sameRef, ...recent]);
  const reopened = state?.status === 'resolved' && state.resolvedAt && agg._max.createdAt! > state.resolvedAt;
  ok<ErrorDetailDto>(res, {
    event: toEventDto(e, names, true),
    group: {
      fingerprint: e.fingerprint, source: e.source as ErrorSource, level: e.level as ErrorLevel, message: e.message,
      count: agg._count._all + (agg._sum.suppressed ?? 0),
      firstSeen: agg._min.createdAt!.toISOString(), lastSeen: agg._max.createdAt!.toISOString(),
      servers: 0, users: 0, releases: [],
      status: reopened ? 'open' : ((state?.status as ErrorGroupStatus | undefined) ?? 'open'),
      note: state?.note ?? '', isNew: false,
    },
    sameRef: sameRef.map((r) => toEventDto(r, names, true)),
    recent: recent.map((r) => toEventDto(r, names)),
  });
});

adminRouter.patch('/errors/groups/:fingerprint', async (req, res) => {
  const fingerprint = String(req.params['fingerprint']);
  const body = req.body as { status?: unknown; note?: unknown };
  const status = body.status;
  if (status !== undefined && status !== 'open' && status !== 'resolved' && status !== 'ignored') { fail(res, 400, 'status must be open, resolved or ignored'); return; }
  if (body.note !== undefined && typeof body.note !== 'string') { fail(res, 400, 'note must be text'); return; }
  const sample = await prisma.errorEvent.findFirst({ where: { fingerprint }, orderBy: { id: 'desc' } });
  if (!sample) { fail(res, 404, 'Error kind not found'); return; }
  const note = typeof body.note === 'string' ? body.note.slice(0, 2_000) : undefined;
  const data = {
    ...(status ? { status, resolvedAt: status === 'resolved' ? new Date() : null } : {}),
    ...(note !== undefined ? { note } : {}),
  };
  const saved = await prisma.errorGroupState.upsert({ where: { fingerprint }, create: { fingerprint, ...data }, update: data });
  if (status) {
    await adminLog({
      kind: 'admin.errors', actor: adminOf(res),
      summary: `Marked "${sample.message.slice(0, 120)}" as ${status}`,
      details: { fingerprint, status, ...(note ? { note } : {}) },
    });
  }
  ok(res, { fingerprint, status: saved.status, note: saved.note, resolvedAt: saved.resolvedAt?.toISOString() ?? null });
});

// ── Servers ─────────────────────────────────────────────────────────────────

const MODULE_KEYS = ADMIN_SETTING_FIELDS.filter((f) => f.group === 'Modules').map((f) => f.key);

type SettingsRow = Record<string, unknown> | null;

/** Plain-words problems with a server's setup: the officers' checklist without the Discord checks. */
function setupIssues(s: SettingsRow): string[] {
  if (!s) return ['Never set up: no settings saved yet.'];
  return setupProblems(setupChecklist({ settings: s, hasEvents: true, discord: null }));
}

function modulesOf(s: SettingsRow): Record<string, boolean> {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, s ? s[k] !== false : true]));
}

async function guildSummaries(guildIds?: string[]): Promise<AdminGuildDto[]> {
  const guilds = await prisma.guild.findMany({
    where: guildIds ? { guildId: { in: guildIds } } : {},
    include: { settings: true, _count: { select: { allyLinksA: { where: { status: 'ACCEPTED' } }, allyLinksB: { where: { status: 'ACCEPTED' } }, members: true } } },
    orderBy: { name: 'asc' },
  });
  const ids = guilds.map((g) => g.guildId);
  const now = Date.now();
  const [upcoming, recent, last, errors] = await Promise.all([
    prisma.event.groupBy({ by: ['guildId'], where: { guildId: { in: ids }, status: { in: ['PENDING', 'ACTIVE'] } }, _count: { _all: true } }),
    prisma.event.groupBy({ by: ['guildId'], where: { guildId: { in: ids }, startTime: { gte: new Date(now - 30 * DAY), lte: new Date(now) } }, _count: { _all: true } }),
    prisma.event.groupBy({ by: ['guildId'], where: { guildId: { in: ids }, startTime: { lte: new Date(now) } }, _max: { startTime: true } }),
    prisma.errorEvent.groupBy({ by: ['guildId'], where: { guildId: { in: ids }, level: 'error', createdAt: { gte: new Date(now - 7 * DAY) } }, _count: { _all: true } }),
  ]);
  const count = (rows: { guildId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.guildId === id)?._count._all ?? 0;
  return guilds.map((g) => {
    const s = g.settings as unknown as SettingsRow;
    return {
      guildId: g.guildId,
      name: g.name,
      iconUrl: getGuildIconUrl(g.guildId, g.icon),
      joinedAt: g.createdAt.toISOString(),
      modules: modulesOf(s),
      setupIssues: setupIssues(s),
      counts: {
        upcomingEvents: count(upcoming, g.guildId),
        events30d: count(recent, g.guildId),
        members: g._count.members,
        allies: g._count.allyLinksA + g._count.allyLinksB,
      },
      errors7d: count(errors, g.guildId),
      lastEventAt: last.find((r) => r.guildId === g.guildId)?._max.startTime?.toISOString() ?? null,
    };
  });
}

adminRouter.get('/guilds', async (_req, res) => {
  ok(res, await guildSummaries());
});

/** Settings as the admin form shows them: every editable field, roles as arrays. */
function settingsView(s: SettingsRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ADMIN_SETTING_FIELDS) {
    const v = s?.[f.key];
    out[f.key] = f.type === 'roles' ? (typeof v === 'string' ? (JSON.parse(v) as unknown) : []) : v ?? (f.type === 'boolean' ? true : null);
  }
  return out;
}

adminRouter.get('/guilds/:guildId', async (req, res) => {
  const guildId = String(req.params['guildId']);
  const [summary] = await guildSummaries([guildId]);
  if (!summary) { fail(res, 404, 'The bot isn\'t in that server'); return; }
  const settings = await prisma.guildSettings.findFirst({ where: { guild: { guildId } } });
  const [errors, log, guildInfo, channels, roles] = await Promise.all([
    prisma.errorEvent.findMany({ where: { guildId }, orderBy: { id: 'desc' }, take: 25 }),
    prisma.adminLog.findMany({ where: { guildId }, orderBy: { id: 'desc' }, take: 25 }),
    cachedDiscordGet<{ approximate_member_count?: number; owner_id?: string }>(`admin-guild:${guildId}`, `/guilds/${guildId}?with_counts=true`, `guild:${guildId}`, 60_000),
    cachedDiscordGet<{ id: string; name: string; type: number; parent_id: string | null; position: number }[]>(`channels:${guildId}`, `/guilds/${guildId}/channels`, `channels:${guildId}`, 30_000),
    cachedDiscordGet<{ id: string; name: string; color: number; position: number; managed: boolean }[]>(`roles:${guildId}`, `/guilds/${guildId}/roles`, `roles:${guildId}`, 60_000),
  ]);
  ok<AdminGuildDetailDto>(res, {
    ...summary,
    settings: settingsView(settings as unknown as SettingsRow),
    discord: guildInfo.ok || channels.ok ? {
      memberCount: guildInfo.ok ? guildInfo.data.approximate_member_count ?? null : null,
      ownerId: guildInfo.ok ? guildInfo.data.owner_id ?? null : null,
      channels: channels.ok ? [...channels.data].sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parent_id })) : [],
      roles: roles.ok ? roles.data.filter((r) => r.name !== '@everyone' && !r.managed).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.color })) : [],
    } : null,
    recentErrors: await eventDtos(errors),
    log: log.map(logDto),
  });
});

adminRouter.patch('/guilds/:guildId/settings', async (req, res) => {
  const guildId = String(req.params['guildId']);
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const editable = new Set(ADMIN_SETTING_FIELDS.map((f) => f.key));
  const unknown = Object.keys(raw).filter((k) => !editable.has(k));
  if (unknown.length) { fail(res, 400, `Not editable here: ${unknown.join(', ')}`); return; }
  let patch;
  try {
    patch = parseSettingsPatch(raw);
    if (typeof raw['timezone'] === 'string' && !isValidTimeZone(raw['timezone'])) throw new ValidationError('timezone is not a known time zone');
  } catch (err) {
    if (err instanceof ValidationError) { fail(res, 400, err.message); return; }
    throw err;
  }
  const guild = await prisma.guild.findUnique({ where: { guildId }, include: { settings: true } });
  if (!guild) { fail(res, 404, 'The bot isn\'t in that server'); return; }
  const before = settingsView(guild.settings as unknown as SettingsRow);
  const saved = await applySettingsPatch(guildId, patch);
  if (!saved) { fail(res, 404, 'The bot isn\'t in that server'); return; }
  const after = settingsView(await prisma.guildSettings.findFirst({ where: { guild: { guildId } } }) as unknown as SettingsRow);

  const changes: Record<string, [unknown, unknown]> = {};
  for (const f of ADMIN_SETTING_FIELDS) {
    if (JSON.stringify(before[f.key]) !== JSON.stringify(after[f.key])) changes[f.key] = [before[f.key], after[f.key]];
  }
  if (Object.keys(changes).length > 0) {
    const labels = Object.keys(changes).map((k) => ADMIN_SETTING_FIELDS.find((f) => f.key === k)?.label ?? k);
    await adminLog({
      kind: 'admin.settings', actor: adminOf(res), guildId, guildName: guild.name,
      summary: `Changed ${labels.join(', ')}`,
      details: { changes },
    });
  }
  ok(res, { settings: after, changed: Object.keys(changes) });
});

// ── Activity log ────────────────────────────────────────────────────────────

function logDto(l: { id: number; createdAt: Date; kind: string; actorId: string | null; actorName: string | null; guildId: string | null; guildName: string | null; summary: string; details: string }): AdminLogDto {
  return { id: l.id, createdAt: l.createdAt.toISOString(), kind: l.kind, actorId: l.actorId, actorName: l.actorName, guildId: l.guildId, guildName: l.guildName, summary: l.summary, details: parseJson(l.details) };
}

adminRouter.get('/log', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const before = Number(q['before']) || 0;
  const rows = await prisma.adminLog.findMany({
    where: {
      ...(q['kind'] ? { kind: { startsWith: q['kind'] } } : {}),
      ...(q['guildId'] ? { guildId: q['guildId'] } : {}),
      ...(before ? { id: { lt: before } } : {}),
    },
    orderBy: { id: 'desc' },
    take: Math.min(200, Number(q['limit']) || 50),
  });
  ok(res, rows.map(logDto));
});

// ── Admin Discord feed ──────────────────────────────────────────────────────

function configDto(c: { feedGuildId: string | null; feedChannelId: string | null; alertsEnabled: boolean; digestEnabled: boolean; digestHour: number; digestTimezone: string; lastDigestDate: string | null } | null): AdminConfigDto {
  return {
    feedGuildId: c?.feedGuildId ?? null, feedChannelId: c?.feedChannelId ?? null,
    alertsEnabled: c?.alertsEnabled ?? true, digestEnabled: c?.digestEnabled ?? true,
    digestHour: c?.digestHour ?? 8, digestTimezone: c?.digestTimezone ?? 'America/Chicago',
    lastDigestDate: c?.lastDigestDate ?? null,
  };
}

adminRouter.get('/config', async (_req, res) => {
  ok(res, configDto(await prisma.adminConfig.findUnique({ where: { id: 1 } })));
});

adminRouter.put('/config', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const snowflake = (v: unknown) => v === null || v === '' ? null : typeof v === 'string' && /^\d{15,21}$/.test(v) ? v : undefined;
  const feedGuildId = snowflake(b['feedGuildId']);
  const feedChannelId = snowflake(b['feedChannelId']);
  if (feedGuildId === undefined || feedChannelId === undefined) { fail(res, 400, 'Pick a server and channel'); return; }
  if (feedChannelId && !feedGuildId) { fail(res, 400, 'Pick the server the channel is in'); return; }
  const hour = Number(b['digestHour']);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) { fail(res, 400, 'digestHour must be 0–23'); return; }
  const tz = typeof b['digestTimezone'] === 'string' && isValidTimeZone(b['digestTimezone']) ? b['digestTimezone'] : null;
  if (!tz) { fail(res, 400, 'digestTimezone is not a known time zone'); return; }
  if (feedChannelId) {
    const ch = await cachedDiscordGet<{ id: string }[]>(`channels:${feedGuildId}`, `/guilds/${feedGuildId}/channels`, `channels:${feedGuildId}`, 30_000);
    if (ch.ok && !ch.data.some((c) => c.id === feedChannelId)) { fail(res, 400, 'That channel isn\'t in that server'); return; }
  }
  const data = {
    feedGuildId, feedChannelId,
    alertsEnabled: b['alertsEnabled'] !== false, digestEnabled: b['digestEnabled'] !== false,
    digestHour: hour, digestTimezone: tz,
  };
  const before = await prisma.adminConfig.findUnique({ where: { id: 1 } });
  // A newly chosen channel only gets errors from now on, not the backlog.
  const fresh = feedChannelId && feedChannelId !== before?.feedChannelId
    ? { alertCursor: (await prisma.errorEvent.aggregate({ _max: { id: true } }))._max.id ?? 0 } : {};
  const saved = await prisma.adminConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data, ...fresh }, update: { ...data, ...fresh } });
  await adminLog({ kind: 'admin.config', actor: adminOf(res), summary: feedChannelId ? 'Updated the admin Discord feed' : 'Turned off the admin Discord feed', details: data });
  ok(res, configDto(saved));
});

adminRouter.post('/config/test', async (_req, res) => {
  const c = await prisma.adminConfig.findUnique({ where: { id: 1 } });
  if (!c?.feedChannelId) { fail(res, 400, 'Choose a channel first'); return; }
  await adminLog({ kind: 'admin.test', actor: adminOf(res), summary: 'Sent a test message to the admin feed' });
  triggerBot('/trigger/admin-feed');
  ok(res, { queued: true });
});
