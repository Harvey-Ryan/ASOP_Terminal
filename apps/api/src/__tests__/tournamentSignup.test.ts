// v1.59.1: website tournament sign-ups are stored by Discord id (they used to
// store the internal User.id), and older rows are moved over at start-up.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { prisma } from '../lib/prisma.js';
import { repairTournamentSignups } from '../lib/tournamentRepair.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

const app = createServer();
afterEach(() => vi.unstubAllGlobals());

let n = 0;
const snowflake = () => `${Date.now()}${String(++n).padStart(4, '0')}`;

/** Discord answers "a member with the server's viewer role". */
function discordMember() {
  resetDiscordRest();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { id: 'x' }, roles: ['viewer'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

async function setup() {
  const g = await createGuild({ guildId: snowflake() });
  await createGuildSettings(g.id, { viewerRoles: JSON.stringify(['viewer']), tournamentsEnabled: true });
  const user = await createUser({ discordId: snowflake() });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  const t = await prisma.tournament.create({
    data: { guildId: g.guildId, name: 'Cup', status: 'REGISTRATION', size: 8, createdById: 'x' },
  });
  return { g: g.guildId, t: t.id, user, agent };
}

describe('Tournament sign-ups from the website', () => {
  it('a member signs up and leaves by their Discord id', async () => {
    const { g, t, user, agent } = await setup();
    discordMember();

    await agent.post(`/api/guilds/${g}/tournaments/${t}/register`).send({}).expect(200);
    const rows = await prisma.tournamentParticipant.findMany({ where: { tournamentId: t } });
    expect(rows.map((r) => r.discordId)).toEqual([user.discordId]);

    // Signing up twice is refused, whichever way the first one came in.
    await agent.post(`/api/guilds/${g}/tournaments/${t}/register`).send({}).expect(400);

    await agent.delete(`/api/guilds/${g}/tournaments/${t}/register`).expect(200);
    expect(await prisma.tournamentParticipant.count({ where: { tournamentId: t } })).toBe(0);
  });

  it('someone who joined from Discord can leave on the website', async () => {
    const { g, t, user, agent } = await setup();
    discordMember();
    await prisma.tournamentParticipant.create({
      data: { tournamentId: t, discordId: user.discordId, displayName: 'Pilot' },
    });
    await agent.delete(`/api/guilds/${g}/tournaments/${t}/register`).expect(200);
    expect(await prisma.tournamentParticipant.count({ where: { tournamentId: t } })).toBe(0);
  });
});

describe('repairTournamentSignups', () => {
  it('moves rows stored under User.id to the Discord id, and leaves duplicates alone', async () => {
    const { g, t, user } = await setup();
    const other = await prisma.tournament.create({
      data: { guildId: g, name: 'Cup 2', status: 'REGISTRATION', size: 8, createdById: user.id },
    });
    // Old website sign-up in t; in `other` the person is in twice (website + Discord).
    const old = await prisma.tournamentParticipant.create({
      data: { tournamentId: t, discordId: user.id, displayName: 'Pilot' },
    });
    const dupOld = await prisma.tournamentParticipant.create({
      data: { tournamentId: other.id, discordId: user.id, displayName: 'Pilot' },
    });
    await prisma.tournamentParticipant.create({
      data: { tournamentId: other.id, discordId: user.discordId, displayName: 'Pilot' },
    });
    const rating = await prisma.tournamentPlayerRating.create({
      data: { guildId: g, discordId: user.id, displayName: 'Pilot' },
    });

    const r = await repairTournamentSignups();
    expect(r.participants).toBeGreaterThanOrEqual(1);
    expect(r.conflicts).toBeGreaterThanOrEqual(1);

    expect((await prisma.tournamentParticipant.findUniqueOrThrow({ where: { id: old.id } })).discordId).toBe(
      user.discordId,
    );
    expect((await prisma.tournamentParticipant.findUniqueOrThrow({ where: { id: dupOld.id } })).discordId).toBe(
      user.id,
    );
    expect((await prisma.tournamentPlayerRating.findUniqueOrThrow({ where: { id: rating.id } })).discordId).toBe(
      user.discordId,
    );
    expect((await prisma.tournament.findUniqueOrThrow({ where: { id: other.id } })).createdById).toBe(user.discordId);

    // Running it again changes nothing more.
    const again = await repairTournamentSignups();
    expect(again.participants + again.creators + again.ratings + again.standings).toBe(0);
  });
});
