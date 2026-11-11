// v1.21.1: the member map is only for people who can see the server's events.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { prisma } from '../lib/prisma.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

const app = createServer();
const prevToken = process.env['DISCORD_TOKEN'];
afterEach(() => { vi.unstubAllGlobals(); if (prevToken === undefined) delete process.env['DISCORD_TOKEN']; else process.env['DISCORD_TOKEN'] = prevToken; });

/** Discord says the person holds these roles; timeapi.io and Nominatim answer too. */
function stubFetch(roles: string[]) {
  resetDiscordRest();
  process.env['DISCORD_TOKEN'] = 'test-token';
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('timeapi.io')) return json({ timeZone: 'Europe/London' });
    if (String(url).includes('nominatim')) return json([{ display_name: 'Leeds, England', lat: '53.8', lon: '-1.5', name: 'Leeds', address: { city: 'Leeds', country: 'UK' } }]);
    return json({ user: { id: 'x' }, roles });
  }));
  return calls;
}

async function setup() {
  const g = await createGuild({ guildId: String(Date.now()) + String(Math.floor(Math.random() * 1000)) });
  await createGuildSettings(g.id, { viewerRoles: JSON.stringify(['viewer']) });
  const login = async () => {
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
    return agent;
  };
  return { g, member: await login(), outsider: await login() };
}

const pin = { lat: 53.8, lng: -1.5, municipality: 'Leeds, UK', showName: false };

describe('Member map access', () => {
  it('members can see and place pins; outsiders get 403 everywhere', async () => {
    const { g, member, outsider } = await setup();
    stubFetch(['viewer']);
    await member.put(`/api/guilds/${g.guildId}/member-pins`).send(pin).expect(200);
    const list = await member.get(`/api/guilds/${g.guildId}/member-pins`).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].timezone).toBe('Europe/London');
    await member.get(`/api/guilds/${g.guildId}/member-pins/mine`).expect(200);
    const found = await member.get(`/api/guilds/${g.guildId}/member-pins/search?q=leeds`).expect(200);
    expect(found.body.data[0].municipality).toBe('Leeds, UK');

    stubFetch([]);
    for (const path of ['member-pins', 'member-pins/mine', 'member-pins/search?q=leeds', 'member-pins/geocode?lat=1&lng=1']) {
      await outsider.get(`/api/guilds/${g.guildId}/${path}`).expect(403);
    }
    await outsider.put(`/api/guilds/${g.guildId}/member-pins`).send(pin).expect(403);
    await outsider.delete(`/api/guilds/${g.guildId}/member-pins`).expect(403);
    expect(await prisma.memberPin.count({ where: { guildId: g.id } })).toBe(1);
  });

  it('repeated searches are answered from the cache', async () => {
    const { g, member } = await setup();
    const calls = stubFetch(['viewer']);
    const q = `york${Date.now()}`;
    await member.get(`/api/guilds/${g.guildId}/member-pins/search?q=${q}`).expect(200);
    await member.get(`/api/guilds/${g.guildId}/member-pins/search?q=${q}`).expect(200);
    expect(calls.filter((u) => u.includes('nominatim'))).toHaveLength(1);
  });

  it('a failed timezone lookup is not retried on every load', async () => {
    const { g, member } = await setup();
    const user = await createUser();
    await prisma.memberPin.create({ data: { guildId: g.id, userId: user.id, lat: 1, lng: 1, municipality: 'X' } });
    resetDiscordRest();
    process.env['DISCORD_TOKEN'] = 'test-token';
    let tz = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('timeapi.io')) { tz++; return new Response('down', { status: 503 }); }
      return new Response(JSON.stringify({ user: { id: 'x' }, roles: ['viewer'] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await member.get(`/api/guilds/${g.guildId}/member-pins`).expect(200);
    await member.get(`/api/guilds/${g.guildId}/member-pins`).expect(200);
    expect(tz).toBe(1);
  });
});
