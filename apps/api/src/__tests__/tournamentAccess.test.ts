// v1.21.1: a server's tournaments are for people who can see its events.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { prisma } from '../lib/prisma.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

const app = createServer();
const prevToken = process.env['DISCORD_TOKEN'];
afterEach(() => { vi.unstubAllGlobals(); if (prevToken === undefined) delete process.env['DISCORD_TOKEN']; else process.env['DISCORD_TOKEN'] = prevToken; });

function discordRoles(roles: string[]) {
  resetDiscordRest();
  process.env['DISCORD_TOKEN'] = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: 'x' }, roles }), { status: 200, headers: { 'content-type': 'application/json' } })));
}

async function setup(enabled = true) {
  const g = await createGuild({ guildId: String(Date.now()) + String(Math.floor(Math.random() * 1000)) });
  await createGuildSettings(g.id, { viewerRoles: JSON.stringify(['viewer']), tournamentsEnabled: enabled });
  const login = async (managed: string[]) => {
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: managed });
    return agent;
  };
  const t = await prisma.tournament.create({ data: { guildId: g.guildId, name: 'Cup', status: 'REGISTRATION', size: 8, createdById: 'x' } });
  return { g: g.guildId, t: t.id, officer: await login([g.guildId]), member: await login([]) };
}

const reads = (g: string, t: string) => [
  `tournaments`, `tournaments/rankings`, `tournaments/seasons`, `tournaments/players/1/history`,
  `tournaments/${t}`, `tournaments/${t}/elo-summary`,
].map((p) => `/api/guilds/${g}/${p}`);

describe('Tournament access', () => {
  it('members of the server can read and sign up; outsiders cannot', async () => {
    const { g, t, member } = await setup();
    discordRoles([]);
    for (const url of reads(g, t)) await member.get(url).expect(403);
    await member.post(`/api/guilds/${g}/tournaments/${t}/register`).send({}).expect(403);
    await member.delete(`/api/guilds/${g}/tournaments/${t}/register`).expect(403);
    expect(await prisma.tournamentParticipant.count({ where: { tournamentId: t } })).toBe(0);

    discordRoles(['viewer']);
    for (const url of reads(g, t)) {
      const res = await member.get(url);
      expect([200, 404], url).toContain(res.status); // 404: no such player / rating yet
    }
    await member.get(`/api/guilds/${g}/tournaments`).expect(200);
    await member.get(`/api/guilds/${g}/tournaments/${t}`).expect(200);
  });

  it('switched off: hidden from members, still there for managers', async () => {
    const { g, officer, member } = await setup(false);
    discordRoles(['viewer']);
    await member.get(`/api/guilds/${g}/tournaments`).expect(404);
    await officer.get(`/api/guilds/${g}/tournaments`).expect(200);
  });

  it('signed out: 401; the demo routes are gone', async () => {
    const { g, t, officer } = await setup();
    await request(app).get(`/api/guilds/${g}/tournaments`).expect(401);
    await officer.post(`/api/guilds/${g}/tournaments/demo`).send({}).expect(404);
    await officer.post(`/api/guilds/${g}/tournaments/${t}/demo/participants`).send({}).expect(404);
  });
});
