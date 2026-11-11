// v1.12.0: after Discord login, people land on the page they were trying to open.
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../lib/discord-oauth.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/discord-oauth.js')>();
  return {
    ...real,
    exchangeCode: vi.fn(async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'Bearer', scope: 'identify' })),
    fetchDiscordUser: vi.fn(async () => ({ id: `d-${Math.random().toString(36).slice(2)}`, username: 'pilot', discriminator: '0', global_name: 'Pilot', avatar: null })),
  };
});

const { createServer } = await import('../server/app.js');
const app = createServer();
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';

async function signIn(next?: string) {
  const agent = request.agent(app);
  const start = await agent.get(`/api/auth/login${next !== undefined ? `?next=${encodeURIComponent(next)}` : ''}`).expect(302);
  const state = new URL(start.headers['location']!).searchParams.get('state')!;
  const done = await agent.get(`/api/auth/callback?code=c&state=${state}`).expect(302);
  return done.headers['location'];
}

describe('return to the page after login', () => {
  it('goes back to the dashboard page that was asked for', async () => {
    expect(await signIn('/dashboard/servers/111/events/e1/loot')).toBe(`${WEB}/dashboard/servers/111/events/e1/loot`);
    expect(await signIn('/dashboard/servers/111?tab=pending')).toBe(`${WEB}/dashboard/servers/111?tab=pending`);
  });

  it('without one, or with anything outside the dashboard, goes to the dashboard', async () => {
    expect(await signIn()).toBe(`${WEB}/dashboard`);
    for (const bad of ['https://evil.example/dashboard', '//evil.example', '/dashboard//evil.example', '/login']) {
      expect(await signIn(bad), bad).toBe(`${WEB}/dashboard`);
    }
  });
});
