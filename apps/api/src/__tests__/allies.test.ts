import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

type TestAgent = ReturnType<typeof request.agent>;

const app = createServer();
const prisma = new PrismaClient();

/** An org with an officer signed in who manages it. */
async function org(name: string, settings: Record<string, unknown> = {}) {
  const guild = await createGuild({ name });
  await createGuildSettings(guild.id, settings);
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
  return { guild, user, agent, base: `/api/guilds/${guild.guildId}/allies` };
}
type Org = Awaited<ReturnType<typeof org>>;

const listed = { allyDirectoryListed: true };
const ask = (from: Org, to: Org, extra: Record<string, unknown> = {}) =>
  from.agent.post(`${from.base}/requests`).send({ targetGuildId: to.guild.guildId, ...extra });
const overview = async (o: Org) => (await o.agent.get(o.base).expect(200)).body.data;
const linkBetween = async (x: Org, y: Org) => {
  const [a, b] = x.guild.id < y.guild.id ? [x.guild.id, y.guild.id] : [y.guild.id, x.guild.id];
  return prisma.guildAlly.findUnique({ where: { guildAId_guildBId: { guildAId: a, guildBId: b } } });
};

beforeEach(async () => {
  await prisma.guildAlly.deleteMany();
});

describe('who can use /allies', () => {
  it('needs a signed-in user', async () => {
    const a = await org('Alpha');
    await request(app).get(a.base).expect(401);
  });

  it('needs an officer who manages that org', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const res = await b.agent.get(a.base).expect(403);
    expect(res.body.success).toBe(false);
    await b.agent.post(`${a.base}/requests`).send({ targetGuildId: b.guild.guildId }).expect(403);
  });

  it('answers 404 for an org the bot does not know', async () => {
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: ['999'] });
    await agent.get('/api/guilds/999/allies').expect(404);
  });
});

describe('overview, listing and ally code', () => {
  it('starts empty, unlisted, with an ally code made on first visit', async () => {
    const a = await org('Alpha');
    const data = await overview(a);
    expect(data).toMatchObject({ allies: [], incoming: [], outgoing: [], blocked: [], pendingCount: 0, listing: { listed: false } });
    expect(data.listing.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await overview(a)).listing.code).toBe(data.listing.code); // stable
  });

  it('creates the settings row when an org has none yet', async () => {
    const guild = await createGuild({ name: 'Bare' });
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
    const res = await agent.get(`/api/guilds/${guild.guildId}/allies`).expect(200);
    expect(res.body.data.listing.code).toHaveLength(8);
    await agent.patch(`/api/guilds/${guild.guildId}/allies/listing`).send({ listed: true }).expect(200);
  });

  it('toggles the directory listing, and validates it', async () => {
    const a = await org('Alpha');
    await a.agent.patch(`${a.base}/listing`).send({ listed: true }).expect(200);
    expect((await overview(a)).listing.listed).toBe(true);
    await a.agent.patch(`${a.base}/listing`).send({ listed: 'yes' }).expect(400);
  });

  it('regenerates the code; the old one stops working', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const old = (await overview(b)).listing.code;
    const fresh = (await b.agent.post(`${b.base}/code`).expect(200)).body.data.code;
    expect(fresh).not.toBe(old);
    await a.agent.post(`${a.base}/requests`).send({ code: old }).expect(404);
    await a.agent.post(`${a.base}/requests`).send({ code: fresh }).expect(201);
  });
});

describe('directory', () => {
  it('lists only orgs that opted in, by name or tag, never yourself', async () => {
    const a = await org('Alpha Wing', listed);
    await org('Alpha Hidden');
    await org('Bravo', { ...listed, allianceTag: 'BRV', rsiOrgTag: 'BRAVOCORP' });
    const names = async (q: string) => (await a.agent.get(`${a.base}/directory`).query({ q }).expect(200)).body.data.map((e: { guild: { name: string } }) => e.guild.name);
    expect(await names('alpha')).toEqual([]);
    expect(await names('bra')).toEqual(['Bravo']);
    expect(await names('brv')).toEqual(['Bravo']);
    expect(await names('bravocorp')).toEqual(['Bravo']);
    expect(await names('b')).toEqual([]); // 2+ letters
  });

  it('leaves out allies, pending requests and orgs that blocked you; shows the wait after a rejection', async () => {
    const a = await org('Alpha', listed);
    const b = await org('Bravo Ally', listed);
    const c = await org('Bravo Pending', listed);
    const d = await org('Bravo Blocker', listed);
    const e = await org('Bravo Rejecter', listed);
    await ask(a, b).expect(201);
    const bReq = (await overview(b)).incoming[0];
    await b.agent.post(`${b.base}/requests/${bReq.id}/accept`).expect(200);
    await ask(a, c).expect(201);
    await ask(a, d).expect(201);
    await d.agent.post(`${d.base}/requests/${(await overview(d)).incoming[0].id}/block`).expect(200);
    await ask(a, e).expect(201);
    await e.agent.post(`${e.base}/requests/${(await overview(e)).incoming[0].id}/reject`).expect(200);

    const res = (await a.agent.get(`${a.base}/directory`).query({ q: 'bravo' }).expect(200)).body.data;
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ guild: { name: 'Bravo Rejecter' }, requestable: false });
    expect(res[0].reason).toMatch(/ask again after \d{4}-\d{2}-\d{2}/);
    // the org that rejected can still find A and ask it
    const fromE = (await e.agent.get(`${e.base}/directory`).query({ q: 'alpha' }).expect(200)).body.data;
    expect(fromE).toEqual([expect.objectContaining({ requestable: true })]);
  });
});

describe('sending requests', () => {
  it('sends to a listed org, with an optional message, and both sides see it', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    const res = await ask(a, b, { message: '  Joint mining op? ' }).expect(201);
    expect(res.body.data).toMatchObject({ outcome: 'requested', guild: { name: 'Bravo' } });
    const out = (await overview(a)).outgoing;
    expect(out).toEqual([expect.objectContaining({ status: 'PENDING', message: 'Joint mining op?', guild: expect.objectContaining({ name: 'Bravo' }) })]);
    const inc = await overview(b);
    expect(inc.incoming).toEqual([expect.objectContaining({ guild: expect.objectContaining({ name: 'Alpha' }) })]);
    expect(inc.pendingCount).toBe(1);
    expect((await b.agent.get(`${b.base}/pending-count`).expect(200)).body.data.count).toBe(1);
    expect((await a.agent.get(`${a.base}/pending-count`).expect(200)).body.data.count).toBe(0);
    const row = await linkBetween(a, b);
    expect(row).toMatchObject({ status: 'PENDING', requestedByGuildId: a.guild.id, requestedBy: a.user.discordId });
    expect(row!.guildAId < row!.guildBId).toBe(true);
  });

  it('reaches an unlisted org only by its code (any spacing or case)', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ask(a, b).expect(404);
    const code = (await overview(b)).listing.code;
    await a.agent.post(`${a.base}/requests`).send({ code: ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} ` }).expect(201);
  });

  it('refuses bad input', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    await a.agent.post(`${a.base}/requests`).send({}).expect(400);
    await a.agent.post(`${a.base}/requests`).send({ code: 'NOPE' }).expect(400);
    await a.agent.post(`${a.base}/requests`).send({ code: 'ZZZZ-ZZZZ' }).expect(404);
    await a.agent.post(`${a.base}/requests`).send({ code: (await overview(a)).listing.code }).expect(400); // yourself
    await ask(a, b, { message: 'x'.repeat(201) }).expect(400);
    await ask(a, b, { message: 'x'.repeat(200) }).expect(201);
  });

  it('refuses a second request while the first is pending', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const res = await ask(a, b).expect(409);
    expect(res.body.error).toMatch(/already waiting/);
  });

  it('turns crossing requests into allies', async () => {
    const a = await org('Alpha', listed);
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const res = await ask(b, a).expect(201);
    expect(res.body.data.outcome).toBe('accepted');
    expect((await overview(a)).allies).toHaveLength(1);
    expect((await overview(b)).allies).toHaveLength(1);
    expect((await linkBetween(a, b))!.status).toBe('ACCEPTED');
  });

  it('requests sent by both orgs at the same moment end as allies, with one row', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await org(`Alpha ${i}`, listed);
      const b = await org(`Bravo ${i}`, listed);
      const [r1, r2] = await Promise.all([ask(a, b), ask(b, a)]);
      expect([r1.status, r2.status]).toEqual([201, 201]);
      expect([r1.body.data.outcome, r2.body.data.outcome].sort()).toEqual(['accepted', 'requested']);
      expect((await linkBetween(a, b))!.status).toBe('ACCEPTED');
    }
  });

  it('accept and cancel racing: exactly one wins', async () => {
    const a = await org('Alpha', listed);
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const id = (await overview(b)).incoming[0].id;
    const [acc, can] = await Promise.all([
      b.agent.post(`${b.base}/requests/${id}/accept`),
      a.agent.delete(`${a.base}/requests/${id}`),
    ]);
    expect([acc.status, can.status].filter((s) => s === 200)).toHaveLength(1);
    const row = await linkBetween(a, b);
    expect(acc.status === 200 ? row?.status : row).toBe(acc.status === 200 ? 'ACCEPTED' : null);
  });

  it('caps open outgoing requests at 10', async () => {
    const a = await org('Alpha');
    for (let i = 0; i < 10; i++) await ask(a, await org(`Target ${i}`, listed)).expect(201);
    const res = await ask(a, await org('One Too Many', listed)).expect(429);
    expect(res.body.error).toMatch(/10 requests waiting/);
  });
});

describe('answering requests', () => {
  async function pending() {
    const a = await org('Alpha', listed);
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const id = (await overview(b)).incoming[0].id as string;
    return { a, b, id };
  }

  it('accept: both sides become allies, approve-each by default', async () => {
    const { a, b, id } = await pending();
    await b.agent.post(`${b.base}/requests/${id}/accept`).expect(200);
    const ally = (await overview(a)).allies[0];
    expect(ally).toMatchObject({ id, guild: { name: 'Bravo' }, autoAcceptTheirEvents: false });
    expect((await overview(b)).allies[0]).toMatchObject({ guild: { name: 'Alpha' } });
    const row = await linkBetween(a, b);
    expect(row).toMatchObject({ status: 'ACCEPTED', respondedBy: b.user.discordId });
    expect(row!.acceptedAt).toBeInstanceOf(Date);
  });

  it('only the asked org can answer; nobody else learns the request exists', async () => {
    const { a, b, id } = await pending();
    const c = await org('Charlie');
    await a.agent.post(`${a.base}/requests/${id}/accept`).expect(403);
    await c.agent.post(`${c.base}/requests/${id}/accept`).expect(404);
    await b.agent.post(`${b.base}/requests/does-not-exist/accept`).expect(404);
    await b.agent.post(`${b.base}/requests/${id}/accept`).expect(200);
    await b.agent.post(`${b.base}/requests/${id}/reject`).expect(409); // already answered
  });

  it('reject: the requester waits 7 days, then may ask again; the rejecter may ask any time', async () => {
    const { a, b, id } = await pending();
    await b.agent.post(`${b.base}/requests/${id}/reject`).expect(200);
    const out = (await overview(a)).outgoing[0];
    expect(out.status).toBe('REJECTED');
    const days = (Date.parse(out.retryAfter) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    expect((await overview(b)).incoming).toEqual([]);
    expect((await ask(a, b).expect(409)).body.error).toMatch(/declined your last request/);

    await prisma.guildAlly.update({ where: { id }, data: { retryAfter: new Date(Date.now() - 1000) } });
    expect((await overview(a)).outgoing).toEqual([]); // the wait is over
    await ask(a, b, { message: 'Second try' }).expect(201);
    expect(await linkBetween(a, b)).toMatchObject({ status: 'PENDING', message: 'Second try', retryAfter: null, respondedAt: null });
  });

  it('the org that rejected can ask the other way straight away', async () => {
    const { a, b, id } = await pending();
    await b.agent.post(`${b.base}/requests/${id}/reject`).expect(200);
    await ask(b, a).expect(201);
    expect(await linkBetween(a, b)).toMatchObject({ status: 'PENDING', requestedByGuildId: b.guild.id });
  });

  it('block: the blocked org is told nothing specific and cannot ask; only the blocker can unblock', async () => {
    const { a, b, id } = await pending();
    await b.agent.post(`${b.base}/requests/${id}/block`).expect(200);
    expect((await overview(b)).blocked).toEqual([expect.objectContaining({ id, guild: expect.objectContaining({ name: 'Alpha' }) })]);
    const aView = await overview(a);
    expect(aView.outgoing).toEqual([]);
    expect(aView.blocked).toEqual([]);
    const refused = await ask(a, b).expect(409);
    expect(refused.body.error).not.toMatch(/block/i);
    expect((await ask(b, a).expect(409)).body.error).toMatch(/Unblock it first/);
    await a.agent.delete(`${a.base}/blocks/${id}`).expect(403);
    await b.agent.delete(`${b.base}/blocks/${id}`).expect(200);
    expect(await linkBetween(a, b)).toBeNull();
    await ask(a, b).expect(201);
  });

  it('cancel: only the sender, only while pending', async () => {
    const { a, b, id } = await pending();
    await b.agent.delete(`${b.base}/requests/${id}`).expect(403);
    await a.agent.delete(`${a.base}/requests/${id}`).expect(200);
    expect(await linkBetween(a, b)).toBeNull();
    await a.agent.delete(`${a.base}/requests/${id}`).expect(404);
  });
});

describe('allies', () => {
  async function allied() {
    const a = await org('Alpha', listed);
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const id = (await overview(b)).incoming[0].id as string;
    await b.agent.post(`${b.base}/requests/${id}/accept`).expect(200);
    return { a, b, id };
  }

  it('each org sets "post their events automatically" for its own side only', async () => {
    const { a, b, id } = await allied();
    await a.agent.patch(`${a.base}/${id}`).send({ autoAcceptTheirEvents: true }).expect(200);
    expect((await overview(a)).allies[0].autoAcceptTheirEvents).toBe(true);
    expect((await overview(b)).allies[0].autoAcceptTheirEvents).toBe(false);
    const row = (await linkBetween(a, b))!;
    const aIsA = row.guildAId === a.guild.id;
    expect(aIsA ? row.autoAcceptA : row.autoAcceptB).toBe(true);
    expect(aIsA ? row.autoAcceptB : row.autoAcceptA).toBe(false);
    await a.agent.patch(`${a.base}/${id}`).send({ autoAcceptTheirEvents: 'on' }).expect(400);
  });

  it('either side can remove; an outsider cannot; both can ask again at once', async () => {
    const { a, b, id } = await allied();
    const c = await org('Charlie');
    await c.agent.delete(`${c.base}/${id}`).expect(404);
    await b.agent.delete(`${b.base}/${id}`).expect(200);
    expect((await overview(a)).allies).toEqual([]);
    expect(await linkBetween(a, b)).toBeNull();
    await ask(a, b).expect(201);
  });

  it('cannot change or remove a link that is only pending', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const id = (await overview(a)).outgoing[0].id;
    await a.agent.patch(`${a.base}/${id}`).send({ autoAcceptTheirEvents: true }).expect(409);
    await a.agent.delete(`${a.base}/${id}`).expect(409);
  });
});

describe('the old /alliances routes', () => {
  it('are gone', async () => {
    const a = await org('Alpha');
    for (const [method, path] of [['get', '/api/alliances'], ['get', '/api/alliances/guilds'], ['post', '/api/alliances'],
      ['patch', '/api/alliances/invitations/x/accept'], ['delete', '/api/alliances/x']] as const) {
      const res = await a.agent[method](path).send({ callerGuildId: a.guild.guildId, name: 'x' });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('Discord notices sent to the bot', () => {
  let server: http.Server;
  let received: { path: string; auth: string | undefined; body: Record<string, unknown> }[] = [];
  const prevUrl = process.env['BOT_INTERNAL_URL'];
  const prevSecret = process.env['BOT_INTERNAL_SECRET'];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', auth: req.headers['authorization'], body: data ? JSON.parse(data) : {} });
        res.writeHead(202).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env['BOT_INTERNAL_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env['BOT_INTERNAL_SECRET'] = 'shh';
  });
  afterAll(async () => {
    process.env['BOT_INTERNAL_URL'] = prevUrl;
    process.env['BOT_INTERNAL_SECRET'] = prevSecret;
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => { received = []; });

  /** Waits for the fire-and-forget POSTs to land. */
  const notices = async (n: number) => {
    for (let i = 0; i < 50 && received.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    return received;
  };
  /** The notice for `event` (on `linkId`, if given), waiting for it to land. Earlier notices may still be arriving. */
  const noticeFor = async (event: string, linkId?: string) => {
    const find = () => [...received].reverse().find((r) => r.body['event'] === event && (!linkId || r.body['linkId'] === linkId));
    for (let i = 0; i < 50 && !find(); i++) await new Promise((r) => setTimeout(r, 20));
    const hit = find();
    if (!hit) throw new Error(`no '${event}' notice; got ${received.map((r) => r.body['event']).join(', ')}`);
    return hit.body;
  };

  it('a request, then its answer, each tell the bot who acted and on whom', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    const [req] = await notices(1);
    const link = (await linkBetween(a, b))!;
    expect(req).toEqual({ path: '/trigger/ally', auth: 'Bearer shh', body: {
      event: 'requested', linkId: link.id, actorGuildId: a.guild.id, otherGuildId: b.guild.id,
      actorUserId: a.user.discordId, noticeChannelId: null, noticeMessageId: null } });

    // the bot recorded where it posted the request
    await prisma.guildAlly.update({ where: { id: link.id }, data: { noticeChannelId: 'chan-b', noticeMessageId: 'msg-1' } });
    received = [];
    await b.agent.post(`${b.base}/requests/${link.id}/accept`).expect(200);
    const [acc] = await notices(1);
    expect(acc!.body).toEqual({ event: 'accepted', linkId: link.id, actorGuildId: b.guild.id, otherGuildId: a.guild.id,
      actorUserId: b.user.discordId, noticeChannelId: 'chan-b', noticeMessageId: 'msg-1' });
  });

  it('reject, block, cancel and remove each send their event; cancel still carries the deleted message ids', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    const answer = async (action: 'reject' | 'block') => {
      await ask(a, b).expect(201);
      const id = (await linkBetween(a, b))!.id;
      await prisma.guildAlly.update({ where: { id }, data: { noticeChannelId: 'c', noticeMessageId: 'm' } });
      await b.agent.post(`${b.base}/requests/${id}/${action}`).expect(200);
      return noticeFor(action === 'reject' ? 'rejected' : 'blocked', id);
    };
    expect(await answer('reject')).toMatchObject({ event: 'rejected', actorGuildId: b.guild.id, noticeMessageId: 'm' });
    await prisma.guildAlly.deleteMany();
    expect(await answer('block')).toMatchObject({ event: 'blocked', actorGuildId: b.guild.id, noticeMessageId: 'm' });
    await prisma.guildAlly.deleteMany();

    await ask(a, b).expect(201);
    const id = (await linkBetween(a, b))!.id;
    await prisma.guildAlly.update({ where: { id }, data: { noticeChannelId: 'c2', noticeMessageId: 'm2' } });
    received = [];
    await a.agent.delete(`${a.base}/requests/${id}`).expect(200);
    expect(await noticeFor('cancelled', id)).toMatchObject({ event: 'cancelled', linkId: id, actorGuildId: a.guild.id, otherGuildId: b.guild.id, noticeChannelId: 'c2', noticeMessageId: 'm2' });

    await ask(a, b).expect(201);
    const id2 = (await linkBetween(a, b))!.id;
    await b.agent.post(`${b.base}/requests/${id2}/accept`).expect(200);
    received = [];
    await b.agent.delete(`${b.base}/${id2}`).expect(200);
    expect(await noticeFor('removed', id2)).toMatchObject({ event: 'removed', actorGuildId: b.guild.id, otherGuildId: a.guild.id });
  });

  it('a crossing request is reported as accepted; a re-sent request starts with no old message ids', async () => {
    const a = await org('Alpha', listed);
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    received = [];
    await ask(b, a).expect(201);
    expect(await noticeFor('accepted')).toMatchObject({ event: 'accepted', actorGuildId: b.guild.id, otherGuildId: a.guild.id });

    const c = await org('Charlie', listed);
    await ask(a, c).expect(201);
    const id = (await linkBetween(a, c))!.id;
    await c.agent.post(`${c.base}/requests/${id}/reject`).expect(200);
    await prisma.guildAlly.update({ where: { id }, data: { retryAfter: new Date(Date.now() - 1000), noticeChannelId: 'old', noticeMessageId: 'old' } });
    received = [];
    await ask(a, c).expect(201);
    expect(await noticeFor('requested', id)).toMatchObject({ event: 'requested', linkId: id, noticeChannelId: null, noticeMessageId: null });
    expect((await linkBetween(a, c))!.noticeMessageId).toBeNull();
  });

  it('nothing is sent when a request is refused', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo', listed);
    await ask(a, b).expect(201);
    await notices(1);
    received = [];
    await ask(a, b).expect(409);
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);
  });
});
