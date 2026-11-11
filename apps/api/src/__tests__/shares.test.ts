import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

// Sharing events with allies (v1.11.0): allies only, each ally's "Their events"
// setting, withdrawing invitations when an alliance ends, and the notices the
// bot is told about.

const app = createServer();
const prisma = new PrismaClient();

async function org(name: string) {
  const guild = await createGuild({ name });
  await createGuildSettings(guild.id, {});
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
  return { guild, user, agent, events: `/api/guilds/${guild.guildId}/events`, allies: `/api/guilds/${guild.guildId}/allies` };
}
type Org = Awaited<ReturnType<typeof org>>;

/** Makes x and y allies. `autoX`: x posts y's events automatically (and the reverse for autoY). */
async function ally(x: Org, y: Org, opts: { autoX?: boolean; autoY?: boolean; status?: 'ACCEPTED' | 'PENDING' | 'REJECTED' } = {}) {
  const xFirst = x.guild.id < y.guild.id;
  const [a, b] = xFirst ? [x, y] : [y, x];
  return prisma.guildAlly.create({
    data: {
      guildAId: a.guild.id, guildBId: b.guild.id, requestedByGuildId: x.guild.id, status: opts.status ?? 'ACCEPTED',
      autoAcceptA: xFirst ? !!opts.autoX : !!opts.autoY,
      autoAcceptB: xFirst ? !!opts.autoY : !!opts.autoX,
    },
  });
}

const soon = () => new Date(Date.now() + 3600_000).toISOString();
const newEvent = (host: Org, extra: Record<string, unknown> = {}) =>
  host.agent.post(host.events).send({ name: 'Mining op', startTime: soon(), ...extra });
const shareOf = (eventId: string, o: Org) =>
  prisma.eventGuildShare.findUnique({ where: { eventId_guildId: { eventId, guildId: o.guild.id } } });

// ── A fake bot that records what the API tells it ──────────────────────────────

let server: http.Server;
let received: { path: string; body: Record<string, unknown> }[] = [];
const prevUrl = process.env['BOT_INTERNAL_URL'];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', body: data ? JSON.parse(data) : {} });
      res.writeHead(202).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env['BOT_INTERNAL_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  process.env['BOT_INTERNAL_URL'] = prevUrl;
  await new Promise((r) => server.close(r));
});
beforeEach(async () => {
  received = [];
  await prisma.guildAlly.deleteMany();
});

/** The share notice for `event` on `shareId`, waiting for the fire-and-forget POST. */
async function noticeFor(event: string, shareId: string) {
  const find = () => [...received].reverse().find((r) => r.path === '/trigger/share-notice' && r.body['event'] === event && r.body['shareId'] === shareId);
  for (let i = 0; i < 50 && !find(); i++) await new Promise((r) => setTimeout(r, 20));
  const hit = find();
  if (!hit) throw new Error(`no '${event}' notice for ${shareId}; got ${received.map((r) => `${r.path} ${r.body['event'] ?? ''}`).join(', ')}`);
  return hit.body;
}
async function triggered(path: string) {
  for (let i = 0; i < 50 && !received.some((r) => r.path === path); i++) await new Promise((r) => setTimeout(r, 20));
  return received.some((r) => r.path === path);
}
const settle = () => new Promise((r) => setTimeout(r, 150));

// ── Creating an event ──────────────────────────────────────────────────────────

describe('creating an event shared with allies', () => {
  it('refuses servers that are not allies, by name, and creates nothing', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const c = await org('Charlie');
    await ally(a, b);
    await ally(a, c, { status: 'PENDING' });
    const res = await newEvent(a, { directGuildIds: [b.guild.guildId, c.guild.guildId] }).expect(403);
    expect(res.body.error).toBe("You can only share events with your allies, and Charlie isn't one yet. Add them on the Allies page first.");
    expect(await prisma.event.count({ where: { guildId: a.guild.guildId } })).toBe(0);
  });

  it('refuses a server the bot does not know', async () => {
    const a = await org('Alpha');
    const res = await newEvent(a, { directGuildIds: ['nope-123'] }).expect(403);
    expect(res.body.error).toContain('an unknown server');
  });

  it('an ally that approves each event gets an invitation and an Accept / Decline notice', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b);
    const ev = (await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(201)).body.data;
    const share = await shareOf(ev.id, b);
    expect(share).toMatchObject({ status: 'PENDING', autoAccepted: false, sourceType: 'DIRECT' });
    expect(await noticeFor('pending', share!.id)).toMatchObject({ eventId: ev.id, hostGuildId: a.guild.id, receiverGuildId: b.guild.id, actorUserId: null });
    expect(received.some((r) => r.path === `/trigger/share-accepted/${share!.id}`)).toBe(false);
  });

  it('an ally that posts automatically gets the event straight away', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b, { autoY: true }); // Bravo posts Alpha's events automatically
    const ev = (await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(201)).body.data;
    const share = await shareOf(ev.id, b);
    expect(share).toMatchObject({ status: 'ACCEPTED', autoAccepted: true });
    expect(share!.respondedAt).not.toBeNull();
    expect(await triggered(`/trigger/share-accepted/${share!.id}`)).toBe(true);
    await settle();
    expect(received.some((r) => r.path === '/trigger/share-notice')).toBe(false);
  });

  it('only the receiving side\'s setting counts', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b, { autoX: true }); // Alpha posts Bravo's events automatically, not the other way
    const ev = (await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(201)).body.data;
    expect((await shareOf(ev.id, b))!.status).toBe('PENDING');
    const ev2 = (await newEvent(b, { directGuildIds: [a.guild.guildId] }).expect(201)).body.data;
    expect((await shareOf(ev2.id, a))!.status).toBe('ACCEPTED');
  });

  it('several allies at once, each by its own setting; the event shows its shares', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const c = await org('Charlie');
    await ally(a, b, { autoY: true });
    await ally(a, c);
    const ev = (await newEvent(a, { directGuildIds: [b.guild.guildId, c.guild.guildId, b.guild.guildId] }).expect(201)).body.data;
    const shares = (await a.agent.get(`${a.events}/${ev.id}`).expect(200)).body.data.shares;
    expect(shares.map((s: { guildName: string; status: string; autoAccepted: boolean }) => [s.guildName, s.status, s.autoAccepted]).sort())
      .toEqual([['Bravo', 'ACCEPTED', true], ['Charlie', 'PENDING', false]]);
  });

  it('no allies picked: no shares, nothing sent', async () => {
    const a = await org('Alpha');
    const ev = (await newEvent(a).expect(201)).body.data;
    expect(await prisma.eventGuildShare.count({ where: { eventId: ev.id } })).toBe(0);
  });

  it('old alliances are retired on create and edit', async () => {
    const a = await org('Alpha');
    const res = await newEvent(a, { allianceId: 'some-alliance' }).expect(410);
    expect(res.body.error).toMatch(/Allies/);
    const ev = (await newEvent(a).expect(201)).body.data;
    await a.agent.patch(`${a.events}/${ev.id}`).send({ allianceId: 'some-alliance' }).expect(410);
    await a.agent.patch(`${a.events}/${ev.id}`).send({ allianceId: null, name: 'Renamed' }).expect(200);
    await a.agent.post(`${a.events}/${ev.id}/shares/alliance`).send({ allianceId: 'x' }).expect(410);
  });
});

// ── Sharing an existing event ─────────────────────────────────────────────────

describe('sharing an existing event', () => {
  it('allies only', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const ev = (await newEvent(a).expect(201)).body.data;
    const url = `${a.events}/${ev.id}/shares/direct`;
    expect((await a.agent.post(url).send({ targetDiscordGuildId: b.guild.guildId }).expect(403)).body.error).toContain('Bravo');
    await ally(a, b);
    const share = (await a.agent.post(url).send({ targetDiscordGuildId: b.guild.guildId }).expect(201)).body.data;
    expect(share).toMatchObject({ guildName: 'Bravo', status: 'PENDING', autoAccepted: false });
    await noticeFor('pending', share.id);
    await a.agent.post(url).send({ targetDiscordGuildId: b.guild.guildId }).expect(409);
    await a.agent.post(url).send({ targetDiscordGuildId: a.guild.guildId }).expect(400);
    await a.agent.post(url).send({}).expect(400);
  });

  it('an ally that posts automatically gets it straight away', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b, { autoY: true });
    const ev = (await newEvent(a).expect(201)).body.data;
    const share = (await a.agent.post(`${a.events}/${ev.id}/shares/direct`).send({ targetDiscordGuildId: b.guild.guildId }).expect(201)).body.data;
    expect(share).toMatchObject({ status: 'ACCEPTED', autoAccepted: true });
    expect(await triggered(`/trigger/share-accepted/${share.id}`)).toBe(true);
  });

  it('asking again after a decline waits for approval, even for an ally that posts automatically', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b, { autoY: true });
    const ev = (await newEvent(a).expect(201)).body.data;
    const row = await prisma.eventGuildShare.create({ data: { eventId: ev.id, guildId: b.guild.id, sourceType: 'DIRECT', status: 'DECLINED', respondedBy: 'u-old', noticeChannelId: 'c-old', noticeMessageId: 'm-old' } });
    const share = (await a.agent.post(`${a.events}/${ev.id}/shares/direct`).send({ targetDiscordGuildId: b.guild.guildId }).expect(201)).body.data;
    expect(share).toMatchObject({ id: row.id, status: 'PENDING', autoAccepted: false });
    const after = await prisma.eventGuildShare.findUniqueOrThrow({ where: { id: row.id } });
    expect([after.respondedBy, after.noticeChannelId, after.noticeMessageId]).toEqual([null, null, null]);
    expect(await noticeFor('pending', row.id)).toMatchObject({ noticeChannelId: null, noticeMessageId: null });
  });

  it('re-invite needs the org to still be an ally', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const link = await ally(a, b);
    const ev = (await newEvent(a).expect(201)).body.data;
    const row = await prisma.eventGuildShare.create({ data: { eventId: ev.id, guildId: b.guild.id, sourceType: 'DIRECT', status: 'DECLINED' } });
    await prisma.guildAlly.delete({ where: { id: link.id } });
    await a.agent.patch(`${a.events}/${ev.id}/shares/${row.id}/reinvite`).expect(403);
    await ally(a, b);
    const share = (await a.agent.patch(`${a.events}/${ev.id}/shares/${row.id}/reinvite`).expect(200)).body.data;
    expect(share.status).toBe('PENDING');
    await noticeFor('pending', row.id);
  });

  it('only the host\'s event creators can share', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b);
    const ev = (await newEvent(a).expect(201)).body.data;
    await b.agent.post(`${a.events}/${ev.id}/shares/direct`).send({ targetDiscordGuildId: b.guild.guildId }).expect(403);
  });
});

// ── Answering and withdrawing ──────────────────────────────────────────────────

describe('answering an invitation', () => {
  async function invited() {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await ally(a, b);
    const ev = (await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(201)).body.data;
    const share = await prisma.eventGuildShare.update({
      where: { eventId_guildId: { eventId: ev.id, guildId: b.guild.id } },
      data: { noticeChannelId: 'chan-b', noticeMessageId: 'msg-1' }, // as if the bot had posted it
    });
    return { a, b, ev, share, respond: (action: string) => b.agent.patch(`${b.events}/${ev.id}/shares/respond`).send({ action }) };
  }

  it('accept: recorded with who answered; the bot posts the event and updates the notice', async () => {
    const { b, share, respond } = await invited();
    const res = await respond('accept').expect(200);
    expect(res.body.data).toMatchObject({ status: 'ACCEPTED', autoAccepted: false });
    const row = await prisma.eventGuildShare.findUniqueOrThrow({ where: { id: share.id } });
    expect(row.respondedBy).toBe(b.user.discordId);
    expect(await triggered(`/trigger/share-accepted/${share.id}`)).toBe(true);
    expect(await noticeFor('accepted', share.id)).toMatchObject({ actorUserId: b.user.discordId, noticeChannelId: 'chan-b', noticeMessageId: 'msg-1' });
    await respond('accept').expect(409);
  });

  it('decline: the notice is updated; nothing is posted', async () => {
    const { b, share, respond } = await invited();
    await respond('decline').expect(200);
    expect(await noticeFor('declined', share.id)).toMatchObject({ actorUserId: b.user.discordId, noticeMessageId: 'msg-1' });
    await settle();
    expect(received.some((r) => r.path === `/trigger/share-accepted/${share.id}`)).toBe(false);
  });

  it('only the invited server\'s managers can answer', async () => {
    const { a, ev } = await invited();
    await a.agent.patch(`/api/guilds/${a.guild.guildId}/events/${ev.id}/shares/respond`).send({ action: 'accept' }).expect(404);
    const stranger = await org('Stranger');
    await stranger.agent.patch(`/api/guilds/${(await prisma.guild.findFirstOrThrow({ where: { name: 'Bravo' } })).guildId}/events/${ev.id}/shares/respond`).send({ action: 'accept' }).expect(403);
  });

  it('the host cancelling a waiting invitation withdraws the notice', async () => {
    const { a, ev, share } = await invited();
    await a.agent.delete(`${a.events}/${ev.id}/shares/${share.id}`).expect(200);
    expect(await prisma.eventGuildShare.findUnique({ where: { id: share.id } })).toBeNull();
    expect(await noticeFor('withdrawn', share.id)).toMatchObject({ actorUserId: a.user.discordId, noticeChannelId: 'chan-b', noticeMessageId: 'msg-1', hostGuildId: a.guild.id });
  });

  it('the receiving side sees who is inviting it', async () => {
    const { b, ev } = await invited();
    const list = (await b.agent.get(`${b.events}/pending-shares`).expect(200)).body.data;
    expect(list.map((e: { id: string; hostGuildName: string }) => [e.id, e.hostGuildName])).toEqual([[ev.id, 'Alpha']]);
  });
});

describe('ending an alliance', () => {
  it('withdraws waiting invitations both ways; accepted and declined shares stay', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const c = await org('Charlie');
    const ab = await ally(a, b);
    await ally(a, c);
    const e1 = (await newEvent(a, { directGuildIds: [b.guild.guildId, c.guild.guildId] }).expect(201)).body.data; // a → b pending, a → c pending
    const e2 = (await newEvent(b, { directGuildIds: [a.guild.guildId] }).expect(201)).body.data;                  // b → a pending
    const e3 = (await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(201)).body.data;                  // a → b, accepted below
    const e4 = (await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(201)).body.data;                  // a → b, declined below
    await b.agent.patch(`${b.events}/${e3.id}/shares/respond`).send({ action: 'accept' }).expect(200);
    await b.agent.patch(`${b.events}/${e4.id}/shares/respond`).send({ action: 'decline' }).expect(200);
    const gone1 = (await shareOf(e1.id, b))!;
    const gone2 = (await shareOf(e2.id, a))!;

    await a.agent.delete(`${a.allies}/${ab.id}`).expect(200);

    expect(await shareOf(e1.id, b)).toBeNull();
    expect(await shareOf(e2.id, a)).toBeNull();
    expect((await shareOf(e1.id, c))!.status).toBe('PENDING');   // Charlie is still an ally
    expect((await shareOf(e3.id, b))!.status).toBe('ACCEPTED');  // stays until the event ends
    expect((await shareOf(e4.id, b))!.status).toBe('DECLINED');
    expect(await noticeFor('withdrawn', gone1.id)).toMatchObject({ hostGuildId: a.guild.id, receiverGuildId: b.guild.id, actorUserId: a.user.discordId });
    expect(await noticeFor('withdrawn', gone2.id)).toMatchObject({ hostGuildId: b.guild.id, receiverGuildId: a.guild.id });
  });

  it('after that, the old ally can no longer be invited', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const ab = await ally(a, b);
    await a.agent.delete(`${a.allies}/${ab.id}`).expect(200);
    await newEvent(a, { directGuildIds: [b.guild.guildId] }).expect(403);
  });
});

// ── The picker ─────────────────────────────────────────────────────────────────

describe('the ally picker', () => {
  it('lists accepted allies by name, with whether each posts automatically', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    const c = await org('Charlie');
    const d = await org('Delta');
    await ally(a, c, { autoY: true });
    await ally(a, b, { autoX: true }); // Alpha's own setting doesn't matter here
    await ally(a, d, { status: 'PENDING' });
    const data = (await a.agent.get(`${a.allies}/shareable`).expect(200)).body.data;
    expect(data.host.name).toBe('Alpha');
    expect(data.allies.map((x: { guild: { name: string }; postsAutomatically: boolean }) => [x.guild.name, x.postsAutomatically]))
      .toEqual([['Bravo', false], ['Charlie', true]]);
  });

  it('is for that server\'s event organisers', async () => {
    const a = await org('Alpha');
    const b = await org('Bravo');
    await b.agent.get(`${a.allies}/shareable`).expect(403);
    await request(app).get(`${a.allies}/shareable`).expect(401);
  });
});
