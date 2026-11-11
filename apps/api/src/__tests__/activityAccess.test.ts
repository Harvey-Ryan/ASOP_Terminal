// v1.21.1: Activity (RoleCall) routes check the person against the server they ask about.
// RoleCall isn't configured in tests, so "allowed" shows as 503 (passed the check, no service).
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

const app = createServer();
const prevToken = process.env['DISCORD_TOKEN'];
afterEach(() => { vi.unstubAllGlobals(); if (prevToken === undefined) delete process.env['DISCORD_TOKEN']; else process.env['DISCORD_TOKEN'] = prevToken; });

/** Discord says everyone holds these roles in the server. */
function discordRoles(roles: string[] = ['viewer']) {
  resetDiscordRest();
  process.env['DISCORD_TOKEN'] = 'test-token';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: 'x' }, roles }), { status: 200, headers: { 'content-type': 'application/json' } })));
}
const viewerRole = () => discordRoles();

/** Passed the access check: RoleCall itself isn't configured in tests. */
async function passes(r: Promise<request.Response>) {
  const res = await r;
  expect(res.status).toBe(503);
  expect(res.body.error).toBe('RoleCall service not configured');
}

async function login(managed: string[]) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: managed });
  return { id: user.discordId, agent };
}

async function setup(heatmapPublic = true) {
  const g = await createGuild({ guildId: String(Date.now()) + String(Math.floor(Math.random() * 1000)) });
  await createGuildSettings(g.id, { viewerRoles: JSON.stringify(['viewer']), activityHeatmapPublic: heatmapPublic });
  const other = await createGuild({ guildId: String(Date.now() + 1) + String(Math.floor(Math.random() * 1000)) });
  return { g: g.guildId, officer: await login([g.guildId]), member: await login([]), outsider: await login([other.guildId]) };
}

describe('Activity access', () => {
  it('officers reach everything; outsiders reach nothing', async () => {
    const { g, officer, outsider } = await setup();
    discordRoles([]);
    for (const path of ['stats', 'leaderboard', 'member', 'heatmap/guild', 'heatmap/user', 'config', 'role-change-log', 'left-members']) {
      await passes(officer.agent.get(`/api/rolecall/${path}?guildId=${g}&userId=1`));
      await outsider.agent.get(`/api/rolecall/${path}?guildId=${g}&userId=1`).expect(403);
    }
    await outsider.agent.patch(`/api/rolecall/config?guildId=${g}`).send({ x: 1 }).expect(403);
    await passes(officer.agent.patch(`/api/rolecall/config?guildId=${g}`).send({ x: 1 }));
    await outsider.agent.get(`/api/guilds/${g}/heatmap/events`).expect(403);
  });

  it('members: the server\'s numbers, their own details, heat maps only when allowed, no settings', async () => {
    const { g, member } = await setup();
    viewerRole();
    await passes(member.agent.get(`/api/rolecall/stats?guildId=${g}`));
    await passes(member.agent.get(`/api/rolecall/leaderboard?guildId=${g}`));
    await passes(member.agent.get(`/api/rolecall/member?guildId=${g}&userId=${member.id}`));
    await member.agent.get(`/api/rolecall/member?guildId=${g}&userId=someone-else`).expect(403);
    await member.agent.get(`/api/rolecall/heatmap/user?guildId=${g}&userId=someone-else`).expect(403);
    await passes(member.agent.get(`/api/rolecall/heatmap/guild?guildId=${g}`));
    await member.agent.get(`/api/guilds/${g}/heatmap/events`).expect(200);
    await member.agent.get(`/api/rolecall/config?guildId=${g}`).expect(403);
    await member.agent.patch(`/api/rolecall/config?guildId=${g}`).send({ x: 1 }).expect(403);
    await member.agent.get(`/api/rolecall/role-change-log?guildId=${g}`).expect(403);
  });

  it('heat maps hidden from members when the server says so', async () => {
    const { g, member } = await setup(false);
    viewerRole();
    await member.agent.get(`/api/rolecall/heatmap/guild?guildId=${g}`).expect(403);
    await member.agent.get(`/api/guilds/${g}/heatmap/events`).expect(403);
  });

  it('the server list, the open heat map and a missing guildId are gone', async () => {
    const { officer } = await setup();
    await officer.agent.get('/api/rolecall/guilds').expect(404);
    await request(app).get('/api/rolecall/public/heatmap?guildId=1').expect(404);
    await officer.agent.get('/api/rolecall/stats').expect(400);
  });
});
