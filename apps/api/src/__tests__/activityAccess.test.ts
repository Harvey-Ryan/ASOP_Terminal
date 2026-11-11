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
  process.env['ACTIVITY_SERVER_IDS'] = g.guildId; // Activity only exists for the servers RoleCall tracks (v1.25.0)
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

describe('unused routes removed (v1.21.1)', () => {
  it('GET /api/guilds is gone; /api/guilds/:id routes still answer', async () => {
    const { officer, g } = await setup();
    await officer.agent.get('/api/guilds').expect(404);
    await officer.agent.get(`/api/guilds/${g}/settings`).expect((r) => expect(r.status).not.toBe(404));
  });
});

describe('Activity only exists for the servers RoleCall tracks (v1.25.0)', () => {
  it('elsewhere: off in permissions and settings, every Activity route 404, even for officers', async () => {
    const { g, officer } = await setup();
    delete process.env['ACTIVITY_SERVER_IDS']; // default: Fleet 919 only
    const perms = (await officer.agent.get(`/api/guilds/${g}/my-permissions`).expect(200)).body.data;
    expect(perms).toMatchObject({ activityEnabled: false, activityAvailable: false });
    expect((await officer.agent.get(`/api/guilds/${g}/settings`).expect(200)).body.data.activityAvailable).toBe(false);
    for (const path of ['stats', 'leaderboard', 'heatmap/guild', 'config']) {
      await officer.agent.get(`/api/rolecall/${path}?guildId=${g}`).expect(404);
    }
    await officer.agent.patch(`/api/rolecall/config?guildId=${g}`).send({ x: 1 }).expect(404);
    await officer.agent.get(`/api/guilds/${g}/heatmap/events`).expect(404);
  });

  it('the listed server: available, as before', async () => {
    const { g, officer } = await setup();
    const perms = (await officer.agent.get(`/api/guilds/${g}/my-permissions`).expect(200)).body.data;
    expect(perms).toMatchObject({ activityEnabled: true, activityAvailable: true });
    await passes(officer.agent.get(`/api/rolecall/stats?guildId=${g}`));
  });
});

