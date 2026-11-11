// v1.18.0: member history.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent } from './factories.js';
import { resetDiscordRest } from '../lib/discordRest.js';

const app = createServer();
const prisma = new PrismaClient();

async function login(managed: string[]) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: managed });
  return { user, agent };
}

async function seed() {
  const g = await createGuild();
  const officer = await login([g.guildId]);
  const member = await login([]);
  const m = member.user.discordId;
  const roles = JSON.stringify([{ id: 'p', name: 'Pilot', count: 4 }]);
  const day = (n: number) => new Date(Date.UTC(2026, 9, n, 20));
  const e1 = await createEvent(g.guildId, 'host', { name: 'Op one', roles, startTime: day(1), status: 'COMPLETED', confirmedAttendees: JSON.stringify([m, 'walkin']) });
  const e2 = await createEvent(g.guildId, 'host', { name: 'Op two', roles, startTime: day(8), status: 'ENDED', vcAttendees: JSON.stringify(['other']) });
  const e3 = await createEvent(g.guildId, 'host', { name: 'Op three', roles, startTime: day(15), status: 'ENDED' }); // nobody in voice: not recorded
  const e4 = await createEvent(g.guildId, 'host', { name: 'Called off', roles, startTime: day(20), status: 'CANCELLED' });
  const other = await createGuild();
  const elsewhere = await createEvent(other.guildId, 'host', { name: 'Other server', startTime: day(2), status: 'COMPLETED', confirmedAttendees: JSON.stringify([m]) });
  await prisma.eventRsvp.createMany({ data: [
    { eventId: e1.id, userId: m, username: 'Kade', role: 'p' },
    { eventId: e2.id, userId: m, username: 'Kade', role: null },
    { eventId: e2.id, userId: 'other', username: 'Vex', role: 'p' },
    { eventId: e3.id, userId: m, username: 'Kade', role: 'p' },
    { eventId: e4.id, userId: m, username: 'Kade', role: 'p' },
    { eventId: elsewhere.id, userId: m, username: 'Kade', role: null },
  ] });
  const session = await prisma.lootSession.create({ data: { guildId: g.guildId, eventId: e1.id, status: 'COMPLETED' } });
  const item = await prisma.lootItem.create({ data: { sessionId: session.id, name: 'Quantanium', quantity: 24 } });
  await prisma.lootAssignment.create({ data: { itemId: item.id, userId: m, username: 'Kade' } });
  const bal = await prisma.dkpBalance.create({ data: { guildId: g.guildId, userId: m, username: 'Kade', balance: 340 } });
  await prisma.dkpTransaction.create({ data: { balanceId: bal.id, guildId: g.guildId, userId: m, username: 'Kade', amount: 40, reason: 'Op one' } });
  const t = await prisma.tournament.create({ data: { guildId: g.guildId, name: 'Duel night', status: 'COMPLETED', createdById: 'host' } });
  await prisma.tournamentParticipant.create({ data: { tournamentId: t.id, displayName: 'Kade', discordId: m, status: 'WINNER', placement: 1 } });
  return { g, officer, member, m };
}

const prevToken = process.env['DISCORD_TOKEN'];
afterEach(() => { vi.unstubAllGlobals(); if (prevToken === undefined) delete process.env['DISCORD_TOKEN']; else process.env['DISCORD_TOKEN'] = prevToken; });

describe('member history', () => {
  it('officers see everyone who signed up or attended, with their numbers', async () => {
    const { g, officer, m } = await seed();
    const list = (await officer.agent.get(`/api/guilds/${g.guildId}/members`).expect(200)).body.data as { userId: string; name: string; attended: number; noShows: number; showRate: number | null }[];
    const kade = list.find((x) => x.userId === m)!;
    expect(kade).toMatchObject({ name: 'Kade', attended: 1, noShows: 1, showRate: 50 });
    expect(list.find((x) => x.userId === 'walkin')).toMatchObject({ attended: 1, showRate: null });
    expect(list.find((x) => x.userId === 'other')).toMatchObject({ name: 'Vex', attended: 1, noShows: 0, showRate: 100 });
  });

  it('a member\'s page: events with outcomes, roles, loot, DKP and tournaments, for this server only', async () => {
    const { g, officer, m } = await seed();
    const h = (await officer.agent.get(`/api/guilds/${g.guildId}/members/${m}`).expect(200)).body.data;
    expect(h.name).toBe('Kade');
    expect(h.stats).toMatchObject({ attended: 1, signedUp: 2, noShows: 1, showRate: 50 });
    expect(h.events.map((e: { name: string; outcome: string; role: string }) => `${e.name}:${e.outcome}:${e.role}`))
      .toEqual(['Op three:not-recorded:Pilot', 'Op two:no-show:Unassigned', 'Op one:attended:Pilot']);
    expect(h.rolesPlayed).toEqual([{ role: 'Pilot', count: 1 }]);
    expect(h.loot).toMatchObject({ total: 1, recent: [{ name: 'Quantanium', quantity: 24, session: 'Op one' }] });
    expect(h.dkp).toMatchObject({ balance: 340, recent: [{ amount: 40, reason: 'Op one' }] });
    expect(h.tournaments).toEqual([expect.objectContaining({ name: 'Duel night', result: 'Winner' })]);
  });

  it('members can see their own history, not others\' or the list', async () => {
    const { g, member, m } = await seed();
    // The member holds the server's viewer role (Discord stubbed).
    await prisma.guildSettings.create({ data: { guildId: g.id, viewerRoles: JSON.stringify(['viewer']) } });
    resetDiscordRest();
    process.env['DISCORD_TOKEN'] = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: m }, roles: ['viewer'] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const own = (await member.agent.get(`/api/guilds/${g.guildId}/members/me`).expect(200)).body.data;
    expect(own.userId).toBe(m);
    await member.agent.get(`/api/guilds/${g.guildId}/members/other`).expect(403);
    await member.agent.get(`/api/guilds/${g.guildId}/members`).expect(403);
  });
});

describe('date range (v1.23.0)', () => {
  it('only counts events, loot, DKP changes and tournaments inside the range', async () => {
    const { g, officer, m } = await seed();
    const base = `/api/guilds/${g.guildId}/members`;
    // Op two (Oct 8) only: Kade signed up without a role and wasn't in voice = a no-show.
    const q = `from=${encodeURIComponent('2026-10-05T00:00:00.000Z')}&to=${encodeURIComponent('2026-10-10T23:59:59.999Z')}`;
    const list = (await officer.agent.get(`${base}?${q}`).expect(200)).body.data as { userId: string; attended: number; noShows: number }[];
    expect(list.find((x) => x.userId === m)).toMatchObject({ attended: 0, noShows: 1 });
    expect(list.find((x) => x.userId === 'walkin')).toBeUndefined(); // only at Op one
    const h = (await officer.agent.get(`${base}/${m}?${q}`).expect(200)).body.data;
    expect(h.events.map((e: { name: string }) => e.name)).toEqual(['Op two']);
    expect(h.loot.total).toBe(0);
    expect(h.dkp.balance).toBe(340); // today's balance either way
    expect(h.tournaments).toEqual([]);

    // Open-ended from a date
    const since = (await officer.agent.get(`${base}/${m}?from=${encodeURIComponent('2026-10-14T00:00:00.000Z')}`).expect(200)).body.data;
    expect(since.events.map((e: { name: string }) => e.name)).toEqual(['Op three']);

    // No range: everything, as before
    const all = (await officer.agent.get(`${base}/${m}`).expect(200)).body.data;
    expect(all.events).toHaveLength(3);
    expect(all.loot.total).toBe(1);
  });

  it('a bad or backwards range is a 400', async () => {
    const { g, officer } = await seed();
    await officer.agent.get(`/api/guilds/${g.guildId}/members?from=yesterday`).expect(400);
    await officer.agent.get(`/api/guilds/${g.guildId}/members/me?from=2026-10-10T00:00:00Z&to=2026-10-01T00:00:00Z`).expect(400);
  });
});

