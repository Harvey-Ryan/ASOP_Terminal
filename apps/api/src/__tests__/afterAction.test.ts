// v1.19.0: after-action notes and attendee comments.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { createUser, createGuild, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();
const prevToken = process.env['DISCORD_TOKEN'];
afterEach(() => { vi.unstubAllGlobals(); if (prevToken === undefined) delete process.env['DISCORD_TOKEN']; else process.env['DISCORD_TOKEN'] = prevToken; });

async function login(managed: string[]) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: managed });
  return { id: user.discordId, agent };
}

/** Members hold the server's viewer role (Discord stubbed). */
function viewerRole() {
  resetDiscordRest();
  process.env['DISCORD_TOKEN'] = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: 'x' }, roles: ['viewer'] }), { status: 200, headers: { 'content-type': 'application/json' } })));
}

async function setup(status = 'COMPLETED') {
  const g = await createGuild();
  await prisma.guildSettings.create({ data: { guildId: g.id, viewerRoles: JSON.stringify(['viewer']) } });
  const officer = await login([g.guildId]);
  const came = await login([]);
  const absent = await login([]);
  const ev = await createEvent(g.guildId, 'host', { status, confirmedAttendees: JSON.stringify([came.id]) });
  await prisma.eventRsvp.createMany({ data: [
    { eventId: ev.id, userId: came.id, username: 'Kade', role: null },
    { eventId: ev.id, userId: absent.id, username: 'Bo', role: null },
  ] });
  return { g, ev, base: `/api/guilds/${g.guildId}/events/${ev.id}`, officer, came, absent };
}

describe('after-action notes', () => {
  it('officers write, edit and clear them once the event is over', async () => {
    const { base, officer } = await setup();
    const res = await officer.agent.put(`${base}/after-action`).send({ outcome: 'SUCCESS', notes: '  Cleared both bunkers.  ' }).expect(200);
    expect(res.body.data.afterAction).toMatchObject({ outcome: 'SUCCESS', notes: 'Cleared both bunkers.', byName: expect.any(String) });
    await officer.agent.put(`${base}/after-action`).send({ outcome: 'PARTIAL', notes: 'Lost the hauler.' }).expect(200);
    await officer.agent.put(`${base}/after-action`).send({ outcome: 'MAYBE' }).expect(400);
    await officer.agent.put(`${base}/after-action`).send({ notes: 'x'.repeat(2001) }).expect(400);
    const cleared = await officer.agent.put(`${base}/after-action`).send({ outcome: null, notes: '' }).expect(200);
    expect(cleared.body.data.afterAction).toBeNull();
  });

  it('can be written when completing the event; not before it has ended; not by members', async () => {
    const { g, base, officer, came } = await setup('ENDED');
    await officer.agent.post(`${base}/complete`).send({ hadLoot: false, afterAction: { outcome: 'FAILED', notes: 'Wiped at the gate.' } }).expect(200);
    const ev = await officer.agent.get(base).expect(200);
    expect(ev.body.data.afterAction).toMatchObject({ outcome: 'FAILED', notes: 'Wiped at the gate.' });
    const pending = await createEvent(g.guildId, 'host');
    await officer.agent.put(`/api/guilds/${g.guildId}/events/${pending.id}/after-action`).send({ notes: 'too early' }).expect(409);
    await came.agent.put(`${base}/after-action`).send({ notes: 'me' }).expect(403);
  });
});

describe('comments', () => {
  it('people who attended can leave one comment, edit and remove it; others can\'t', async () => {
    const { ev, base, came, absent } = await setup();
    viewerRole();
    const res = await came.agent.put(`${base}/comment`).send({ body: 'Great op!' }).expect(200);
    expect(res.body.data.comments).toEqual([expect.objectContaining({ userId: came.id, body: 'Great op!' })]);
    await came.agent.put(`${base}/comment`).send({ body: 'Great op, thanks all.' }).expect(200);
    expect(await prisma.eventComment.count({ where: { eventId: ev.id } })).toBe(1);
    await came.agent.put(`${base}/comment`).send({ body: 'x'.repeat(501) }).expect(400);
    // Signed up but attendance shows they weren't there.
    await absent.agent.put(`${base}/comment`).send({ body: 'I was there!' }).expect(403);
    await came.agent.put(`${base}/comment`).send({ body: '' }).expect(200);
    expect(await prisma.eventComment.count({ where: { eventId: ev.id } })).toBe(0);
  });

  it('officers can remove a comment', async () => {
    const { ev, base, officer, came } = await setup();
    await prisma.eventComment.create({ data: { eventId: ev.id, userId: came.id, username: 'Kade', body: 'spam' } });
    const res = await officer.agent.delete(`${base}/comments/${came.id}`).expect(200);
    expect(res.body.data.comments).toEqual([]);
    await came.agent.delete(`${base}/comments/${came.id}`).expect(403);
  });
});
