// v1.25.1: /auth/me and the manager check share one cached server list, so
// they don't run into Discord's per-person rate limit on /users/@me/guilds.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { prisma } from '../lib/prisma.js';
import { resetUserGuilds } from '../lib/userGuilds.js';
import { createUser, createGuild } from './factories.js';

const app = createServer();
const MANAGE = String(1 << 5);
beforeEach(() => resetUserGuilds());
afterEach(() => { vi.unstubAllGlobals(); });

/** Discord: /users/@me/guilds answers from `answers` in turn (then the last one); counts calls. */
function discord(answers: (() => Response)[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/users/@me/guilds')) { calls.push(u); return (answers[Math.min(calls.length - 1, answers.length - 1)]!)(); }
    return new Response('{}', { status: 404 });
  }));
  return calls;
}
const ok = (guilds: unknown[]) => () => new Response(JSON.stringify(guilds), { status: 200, headers: { 'content-type': 'application/json' } });
const limited = (seconds: number) => () => new Response('{"message":"You are being rate limited."}', { status: 429, headers: { 'Retry-After': String(seconds) } });

async function signIn() {
  const g = await createGuild({ name: 'Fleet' });
  const user = await createUser({ discordId: String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e9))) });
  await prisma.account.create({ data: { userId: user.id, provider: 'discord', providerAccountId: user.discordId, accessToken: 't', expiresAt: Math.floor(Date.now() / 1000) + 86_400 } });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: null }); // no list yet: the check has to ask
  await prisma.guildSettings.deleteMany({ where: { guild: { guildId: g.guildId } } });
  return { g, agent, server: { id: g.guildId, name: 'Fleet', icon: null, owner: false, permissions: MANAGE } };
}

describe('shared server list', () => {
  it('a page load (/auth/me plus manager checks at once) asks Discord once', async () => {
    const { g, agent, server } = await signIn();
    const calls = discord([ok([server])]);
    const [me, ...checks] = await Promise.all([
      agent.get('/api/auth/me'),
      agent.get(`/api/guilds/${g.guildId}/setup`),
      agent.get(`/api/guilds/${g.guildId}/my-permissions`),
    ]);
    expect(me.body.data.guilds.map((x: { id: string }) => x.id)).toEqual([g.guildId]);
    for (const c of checks) expect(c.status).toBe(200);
    expect(calls).toHaveLength(1);
    await agent.get('/api/auth/me').expect(200); // within 2 minutes: cached
    expect(calls).toHaveLength(1);
  });

  it('a short 429 is waited out and retried, and logged once', async () => {
    const { g, agent, server } = await signIn();
    const warn = vi.spyOn(console, 'warn');
    const calls = discord([limited(0.2), ok([server])]);
    const res = await Promise.all([1, 2, 3].map(() => agent.get(`/api/guilds/${g.guildId}/setup`)));
    for (const r of res) expect(r.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('rate limit'))).toHaveLength(0); // the retry worked
    warn.mockRestore();
  });

  it('a long 429 with nothing cached: "try again" (503), not "not a manager"; one log line', async () => {
    const { g, agent } = await signIn();
    const warn = vi.spyOn(console, 'warn');
    const calls = discord([limited(30)]);
    const res = await Promise.all([1, 2, 3].map(() => agent.get(`/api/guilds/${g.guildId}/settings`)));
    for (const r of res) expect(r.status).toBe(503); // was 403 "Forbidden" for a real manager
    expect(res[0]!.body.error).toMatch(/Discord is busy/);
    expect(calls).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[userGuilds] Discord rate limit'))).toHaveLength(1);
    // While limited, nobody asks again.
    await agent.get('/api/auth/me').expect(200);
    expect(calls).toHaveLength(1);
    warn.mockRestore();
  });
});
