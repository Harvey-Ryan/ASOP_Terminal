// v1.13.0: error capture and the admin panel API.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

// Discord's answers for the server detail page and the feed channel check.
const discord = vi.hoisted(() => ({ channels: [{ id: '200000000000000001', name: 'events', type: 15, parent_id: null, position: 1 }, { id: '200000000000000002', name: 'admin-feed', type: 0, parent_id: null, position: 2 }] }));
vi.mock('../lib/discordRest.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/discordRest.js')>();
  return {
    ...real,
    cachedDiscordGet: vi.fn(async (_key: string, path: string) => {
      if (path.endsWith('/channels')) return { ok: true, data: discord.channels };
      if (path.endsWith('/roles')) return { ok: true, data: [{ id: '300000000000000001', name: 'Officer', color: 0, position: 2, managed: false }, { id: '1', name: '@everyone', color: 0, position: 0, managed: false }] };
      return { ok: true, data: { approximate_member_count: 42, owner_id: '400000000000000001' } };
    }),
  };
});

const { createServer } = await import('../server/app.js');
const { apiErrors, webErrors } = await import('../lib/errorLog.js');
const { PrismaClient } = await import('@prisma/client');
const { createUser, createGuild, createGuildSettings, createEvent } = await import('./factories.js');

const app = createServer();
const prisma = new PrismaClient();
const ADMIN_DISCORD_ID = '1135606224155586571'; // PLATFORM_ADMIN_DISCORD_IDS default

let n = 0;
async function signedIn(discordId?: string, managedGuildIds: string[] = []) {
  const user = await createUser({ discordId: discordId ?? `6000000000000000${String(++n).padStart(2, '0')}` });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds });
  return { user, agent };
}
const admin = () => signedIn(ADMIN_DISCORD_ID);
const flush = () => Promise.all([apiErrors.flush(), webErrors.flush()]);
// Anything still queued is written before the next test wipes the tables.
afterEach(flush);

describe('who gets in', () => {
  it('everyone but a platform admin gets 404, signed out gets 401', async () => {
    await request(app).get('/api/admin/overview').expect(401);
    const { agent } = await signedIn();
    for (const path of ['/overview', '/errors', '/errors/groups', '/guilds', '/log', '/config']) await agent.get(`/api/admin${path}`).expect(404);
    await agent.put('/api/admin/config').send({}).expect(404);
  });

  it('/auth/me says whether you are one', async () => {
    const { agent } = await admin();
    // /me needs a Discord account to list servers; without one it still answers.
    const res = await agent.get('/api/auth/me').expect(200);
    expect(res.body.data.isPlatformAdmin).toBe(true);
    const other = await signedIn();
    expect((await other.agent.get('/api/auth/me').expect(200)).body.data.isPlatformAdmin).toBe(false);
  });
});

describe('error capture', () => {
  it('a failing request is stored with its ref, route, server and user, and the ref is in the response header', async () => {
    const guild = await createGuild();
    await createGuildSettings(guild.id);
    const { user, agent } = await signedIn(undefined, [guild.guildId]);
    const ev = await createEvent(guild.guildId, 'someone');
    await prisma.user.delete({ where: { id: user.id } }); // the RSVP route's findUniqueOrThrow now rejects
    const res = await agent.put(`/api/guilds/${guild.guildId}/events/${ev.id}/rsvp`).send({ role: null }).expect(500);
    const ref = res.headers['x-request-id'];
    expect(ref).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    await flush();
    const rows = await prisma.errorEvent.findMany({ where: { ref } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'api', level: 'error', guildId: guild.guildId });
    expect(rows[0]!.message).toMatch(/NotFound|No User found|not found/i);
    expect(JSON.parse(rows[0]!.context)).toMatchObject({ method: 'PUT', route: expect.stringContaining('/rsvp'), status: 500 });
    expect(rows[0]!.stack).toBeTruthy();
  });

  it('console.error inside a request is stored with that request\'s ref', async () => {
    const { captureConsole } = await import('@dem/shared');
    const restore = { error: console.error, warn: console.warn };
    captureConsole(apiErrors);
    try {
      // GET /events for a server the bot doesn't know logs nothing; a broken settings row does:
      const guild = await createGuild();
      const { agent } = await signedIn(undefined, [guild.guildId]);
      await prisma.guildSettings.create({ data: { guildId: guild.id, eventCreatorRoles: 'not json' } });
      const res = await agent.get(`/api/guilds/${guild.guildId}/settings`);
      await flush();
      const rows = await prisma.errorEvent.findMany({ where: { ref: res.headers['x-request-id'] } });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.guildId === guild.guildId)).toBe(true);
    } finally {
      console.error = restore.error; console.warn = restore.warn;
    }
  });

  it('browsers can report errors; the user is attached, and reports are rate-limited', async () => {
    const { user, agent } = await signedIn();
    await agent.post('/api/client-errors').send({ message: 'TypeError: x is undefined', stack: 'TypeError\n    at LootPage (https://h/assets/LootPage-AbCdEf12.js:1:2)', kind: 'render crash', url: 'https://h/dashboard/servers/111111111111111111/loot', ref: 'K7QW3P' }).expect(202);
    await agent.post('/api/client-errors').send({ kind: 'x' }).expect(400);
    await flush();
    const [row] = await prisma.errorEvent.findMany({ where: { source: 'web' } });
    expect(row).toMatchObject({ source: 'web', userId: user.discordId, guildId: '111111111111111111', ref: 'K7QW3P' });
    expect(JSON.parse(row!.context)).toMatchObject({ kind: 'render crash', page: '/dashboard/servers/111111111111111111/loot' });
    const anon = request.agent(app);
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await anon.post('/api/client-errors').send({ message: `boom ${i}` })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});

describe('errors in the admin panel', () => {
  async function seed() {
    const guild = await createGuild({ guildId: '500000000000000001', name: 'Alpha' });
    for (let i = 0; i < 3; i++) apiErrors.record({ message: `Loot session c${'x'.repeat(24)}${i} not found`, ref: `REF00${i}`, guildId: guild.guildId });
    apiErrors.record({ message: 'Discord said no', level: 'warn' });
    webErrors.record({ message: 'TypeError: boom' });
    await flush();
    return guild;
  }

  it('lists occurrences newest first, filters them, and pages both ways', async () => {
    await seed();
    const { agent } = await admin();
    const all = (await agent.get('/api/admin/errors').expect(200)).body.data as { id: number; source: string; guildName: string | null }[];
    expect(all).toHaveLength(5);
    expect(all.map((e) => e.id)).toEqual([...all.map((e) => e.id)].sort((a, b) => b - a));
    expect((await agent.get('/api/admin/errors?source=web').expect(200)).body.data).toHaveLength(1);
    expect((await agent.get('/api/admin/errors?level=warn').expect(200)).body.data).toHaveLength(1);
    expect((await agent.get('/api/admin/errors?ref=ref001').expect(200)).body.data).toHaveLength(1);
    expect((await agent.get('/api/admin/errors?q=discord%20SAID').expect(200)).body.data).toHaveLength(1);
    expect(all.find((e) => e.guildName)?.guildName).toBe('Alpha');
    const oldest = all[all.length - 1]!.id;
    const live = (await agent.get(`/api/admin/errors?after=${oldest}`).expect(200)).body.data as { id: number }[];
    expect(live.map((e) => e.id)).toEqual(all.slice(0, -1).map((e) => e.id).reverse());
    expect((await agent.get(`/api/admin/errors?before=${all[1]!.id}`).expect(200)).body.data).toHaveLength(3);
  });

  it('groups the same kind together; resolving hides it until it happens again', async () => {
    await seed();
    const { agent } = await admin();
    const groups = (await agent.get('/api/admin/errors/groups?period=24h').expect(200)).body.data as { fingerprint: string; count: number; message: string; status: string; isNew: boolean; servers: number }[];
    expect(groups).toHaveLength(3);
    const loot = groups.find((g) => g.message.startsWith('Loot session'))!;
    expect(loot).toMatchObject({ count: 3, status: 'open', isNew: true, servers: 1 });

    await agent.patch(`/api/admin/errors/groups/${loot.fingerprint}`).send({ status: 'resolved', note: 'Fixed in 1.13.1' }).expect(200);
    let open = (await agent.get('/api/admin/errors/groups?status=open').expect(200)).body.data as { fingerprint: string }[];
    expect(open.some((g) => g.fingerprint === loot.fingerprint)).toBe(false);
    const log = (await agent.get('/api/admin/log?kind=admin.errors').expect(200)).body.data as { summary: string }[];
    expect(log[0]!.summary).toMatch(/as resolved/);

    await new Promise((r) => setTimeout(r, 20));
    apiErrors.record({ message: `Loot session c${'y'.repeat(25)} not found` });
    await flush();
    open = (await agent.get('/api/admin/errors/groups?status=open').expect(200)).body.data;
    expect(open.some((g) => g.fingerprint === loot.fingerprint)).toBe(true);
    await agent.patch(`/api/admin/errors/groups/${loot.fingerprint}`).send({ status: 'nope' }).expect(400);
  });

  it('the detail view has the stack, the kind\'s history and the same request\'s other errors', async () => {
    apiErrors.record({ message: 'first', ref: 'SAMERF', stack: 'Error: first\n    at x (/app/a.js:1:1)' });
    apiErrors.record({ message: 'second', ref: 'SAMERF' });
    await flush();
    const { agent } = await admin();
    const [second] = (await agent.get('/api/admin/errors?ref=SAMERF').expect(200)).body.data as { id: number }[];
    const d = (await agent.get(`/api/admin/errors/${second!.id}`).expect(200)).body.data;
    expect(d.event.message).toBe('second');
    expect(d.sameRef.map((e: { message: string }) => e.message)).toEqual(['first']);
    expect(d.sameRef[0].stack).toMatch(/at x/);
    expect(d.group.count).toBe(1);
    await agent.get('/api/admin/errors/999999').expect(404);
  });
});

describe('servers', () => {
  it('lists every server with its modules, setup problems and counts', async () => {
    const g = await createGuild({ guildId: '500000000000000002', name: 'Bravo' });
    await createGuildSettings(g.id, { forumChannelId: null, lootEnabled: false, timezone: 'UTC' });
    await createEvent(g.guildId, 'u', { startTime: new Date(Date.now() + 86_400_000) });
    const { agent } = await admin();
    const list = (await agent.get('/api/admin/guilds').expect(200)).body.data as { guildId: string; modules: Record<string, boolean>; setupIssues: string[]; counts: { upcomingEvents: number } }[];
    const b = list.find((x) => x.guildId === g.guildId)!;
    expect(b.modules['lootEnabled']).toBe(false);
    expect(b.modules['eventBotEnabled']).toBe(true);
    expect(b.setupIssues.join(' ')).toMatch(/event forum/);
    expect(b.setupIssues.join(' ')).not.toMatch(/time zone/); // not a setup step since v1.21.2
    expect(b.setupIssues.join(' ')).not.toMatch(/loot results/);
    expect(b.counts.upcomingEvents).toBe(1);
  });

  it('one server: settings, Discord info and channels', async () => {
    const g = await createGuild({ guildId: '500000000000000003', name: 'Charlie' });
    await createGuildSettings(g.id, { eventCreatorRoles: JSON.stringify(['300000000000000001']) });
    const { agent } = await admin();
    const d = (await agent.get(`/api/admin/guilds/${g.guildId}`).expect(200)).body.data;
    expect(d.name).toBe('Charlie');
    expect(d.settings.eventCreatorRoles).toEqual(['300000000000000001']);
    expect(d.discord.memberCount).toBe(42);
    expect(d.discord.channels.map((c: { name: string }) => c.name)).toEqual(['events', 'admin-feed']);
    expect(d.discord.roles.map((r: { name: string }) => r.name)).toEqual(['Officer']);
    await agent.get('/api/admin/guilds/999').expect(404);
  });

  it('changing settings uses the normal rules and is audit-logged with before and after', async () => {
    const g = await createGuild({ guildId: '500000000000000004', name: 'Delta' });
    await createGuildSettings(g.id, { forumChannelId: null });
    const { agent } = await admin();
    const url = `/api/admin/guilds/${g.guildId}/settings`;
    const res = await agent.patch(url).send({ forumChannelId: '200000000000000001', lootEnabled: false, timezone: 'America/Chicago' }).expect(200);
    expect(res.body.data.changed.sort()).toEqual(['forumChannelId', 'lootEnabled', 'timezone']);
    const s = await prisma.guildSettings.findUnique({ where: { guildId: g.id } });
    expect(s).toMatchObject({ forumChannelId: '200000000000000001', lootEnabled: false, timezone: 'America/Chicago' });
    const [entry] = (await agent.get(`/api/admin/log?guildId=${g.guildId}`).expect(200)).body.data;
    expect(entry).toMatchObject({ kind: 'admin.settings', actorId: ADMIN_DISCORD_ID, guildName: 'Delta' });
    expect(entry.summary).toMatch(/Event forum/);
    expect(entry.details.changes.lootEnabled).toEqual([true, false]);

    // Nothing changed → nothing logged; unknown fields and bad values refused.
    await agent.patch(url).send({ lootEnabled: false }).expect(200);
    expect((await agent.get(`/api/admin/log?guildId=${g.guildId}`).expect(200)).body.data).toHaveLength(1);
    await agent.patch(url).send({ statusMessageId: 'x' }).expect(400);
    await agent.patch(url).send({ timezone: 'Mars/Olympus' }).expect(400);
    await agent.patch(url).send({ lootEnabled: 'yes' }).expect(400);
  });
});

describe('the admin Discord feed settings', () => {
  it('saves a channel in a server, refuses one that isn\'t there, and the test needs a channel', async () => {
    const { agent } = await admin();
    expect((await agent.get('/api/admin/config').expect(200)).body.data).toMatchObject({ feedChannelId: null, alertsEnabled: true, digestHour: 8 });
    await agent.post('/api/admin/config/test').expect(400);
    const body = { feedGuildId: '500000000000000009', feedChannelId: '200000000000000002', alertsEnabled: true, digestEnabled: false, digestHour: 9, digestTimezone: 'America/Chicago' };
    await agent.put('/api/admin/config').send({ ...body, feedChannelId: '299999999999999999' }).expect(400);
    await agent.put('/api/admin/config').send({ ...body, digestHour: 24 }).expect(400);
    apiErrors.record({ message: 'old backlog' }); await flush();
    const saved = (await agent.put('/api/admin/config').send(body).expect(200)).body.data;
    expect(saved).toMatchObject({ feedChannelId: '200000000000000002', digestEnabled: false, digestHour: 9 });
    // A new channel starts after the existing backlog.
    const cfg = await prisma.adminConfig.findUnique({ where: { id: 1 } });
    expect(cfg!.alertCursor).toBe((await prisma.errorEvent.aggregate({ _max: { id: true } }))._max.id);
    await agent.post('/api/admin/config/test').expect(200);
    expect(await prisma.adminLog.count({ where: { kind: 'admin.test', posted: false } })).toBe(1);
  });
});

describe('overview', () => {
  it('reports services, errors and activity', async () => {
    await prisma.serviceHeartbeat.create({ data: { service: 'bot', startedAt: new Date(), beatAt: new Date(), release: '1.13.0', details: JSON.stringify({ guilds: 6 }) } });
    await prisma.serviceHeartbeat.create({ data: { service: 'api', startedAt: new Date(), beatAt: new Date(Date.now() - 10 * 60_000), release: '1.13.0' } });
    apiErrors.record({ message: 'a' }); webErrors.record({ message: 'b' }); apiErrors.record({ message: 'c', level: 'warn' });
    await flush();
    const { agent } = await admin();
    const o = (await agent.get('/api/admin/overview').expect(200)).body.data;
    expect(o.services.find((s: { service: string }) => s.service === 'bot')).toMatchObject({ up: true, details: { guilds: 6 } });
    expect(o.services.find((s: { service: string }) => s.service === 'api').up).toBe(false);
    expect(o.errors).toMatchObject({ last24h: 2, lastHour: 2, warnings24h: 1, bySource24h: { api: 1, web: 1 }, newKinds24h: 2 });
    expect(o.errorsByHour).toHaveLength(24);
    expect(o.errorsByHour[23]).toMatchObject({ errors: 2, warnings: 1 });
    expect(o.database.ok).toBe(true);
  });

  it('request logging is off by default: no request numbers, Traffic gone; sign-ins count from sessions', async () => {
    await prisma.session.create({ data: { sid: `s${Date.now()}`, sess: { userId: 'someone' }, expire: new Date(Date.now() + 86_400_000) } });
    const { agent } = await admin();
    const o = (await agent.get('/api/admin/overview').expect(200)).body.data;
    expect(o.requests).toBeNull();
    expect(o.activity.activeUsers7d).toBeGreaterThanOrEqual(1);
    const { requestLoggingOn } = await import('../lib/requestLogger.js');
    expect(requestLoggingOn()).toBe(false);
  });
});

describe('keeping the tables small', () => {
  it('prunes errors and request logs older than 90 days, and the admin log after a year', async () => {
    const { pruneOldErrors } = await import('../lib/errorLog.js');
    const old = new Date(Date.now() - 91 * 86_400_000);
    const recent = new Date(Date.now() - 89 * 86_400_000);
    await prisma.errorEvent.createMany({ data: [old, recent].map((createdAt) => ({ createdAt, source: 'api', level: 'error', message: 'x', fingerprint: 'f' })) });
    await prisma.requestLog.createMany({ data: [old, old, recent].map((createdAt) => ({ createdAt, method: 'GET', path: '/x', module: 'x', statusCode: 200, durationMs: 1 })) });
    await prisma.adminLog.createMany({ data: [new Date(Date.now() - 400 * 86_400_000), old].map((createdAt) => ({ createdAt, kind: 'guild.joined', summary: 's' })) });
    await pruneOldErrors();
    expect(await prisma.errorEvent.count()).toBe(1);
    expect(await prisma.requestLog.count({ where: { path: '/x' } })).toBe(1);
    expect(await prisma.adminLog.count()).toBe(1);
    await prisma.requestLog.deleteMany({ where: { path: '/x' } });
  });
});
