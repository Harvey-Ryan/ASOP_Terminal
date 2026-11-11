// v1.15.0: the setup checklist for officers, with the bot's Discord permissions.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { createUser, createGuild, createGuildSettings, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();
const prevToken = process.env['DISCORD_TOKEN'];

/** Discord as the bot sees one server: a forum it can post in, a category it can't manage. */
function fakeDiscord(guildId: string, opts: { down?: boolean } = {}) {
  const VIEW_SEND = String((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n) | (1n << 38n) | (1n << 33n));
  const answers: Record<string, unknown> = {
    '/users/@me': { id: 'bot' },
    [`/guilds/${guildId}/channels`]: [
      { id: 'forum', name: 'operations', type: 15, permission_overwrites: [] },
      { id: 'cat', name: 'Ops voice', type: 4, permission_overwrites: [] },
    ],
    [`/guilds/${guildId}/roles`]: [{ id: guildId, permissions: '0' }, { id: 'bot-role', permissions: VIEW_SEND }],
    [`/guilds/${guildId}/members/bot`]: { roles: ['bot-role'] },
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace('https://discord.com/api/v10', '');
    if (opts.down) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(answers[path] ?? {}), { status: path in answers ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
}

async function officer(guildDiscordId: string, manager = true) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: manager ? [guildDiscordId] : [] });
  return agent;
}

beforeEach(() => { resetDiscordRest(); process.env['DISCORD_TOKEN'] = 'test-token'; });
afterEach(() => { vi.unstubAllGlobals(); if (prevToken === undefined) delete process.env['DISCORD_TOKEN']; else process.env['DISCORD_TOKEN'] = prevToken; });

describe('setup checklist', () => {
  it('shows what\'s done, what\'s missing, and what the bot can\'t do', async () => {
    const g = await createGuild();
    await createGuildSettings(g.id, { timezone: 'America/Chicago', forumChannelId: 'forum', voiceCategoryId: 'cat', lootEnabled: false, dkpEnabled: false, tournamentsEnabled: false });
    fakeDiscord(g.guildId);
    const agent = await officer(g.guildId);
    const data = (await agent.get(`/api/guilds/${g.guildId}/setup`).expect(200)).body.data;
    const step = (k: string) => data.steps.find((s: { key: string }) => s.key === k);
    expect(data.discordChecked).toBe(true);
    expect(data.hidden).toBe(false);
    expect(step('timezone').done).toBe(true);
    expect(step('forum')).toMatchObject({ done: true, detail: '#operations' });
    expect(step('voice')).toMatchObject({ done: false, detail: 'The bot is missing Manage Channels in Ops voice.' });
    expect(step('first-event').done).toBe(false);
    await createEvent(g.guildId, 'host');
    const again = (await agent.get(`/api/guilds/${g.guildId}/setup`).expect(200)).body.data;
    expect(again.steps.find((s: { key: string }) => s.key === 'first-event').done).toBe(true);
  });

  it('still answers when Discord is down, without the Discord checks', async () => {
    const g = await createGuild();
    fakeDiscord(g.guildId, { down: true });
    const agent = await officer(g.guildId);
    const data = (await agent.get(`/api/guilds/${g.guildId}/setup`).expect(200)).body.data;
    expect(data.discordChecked).toBe(false);
    expect(data.steps[0]).toMatchObject({ key: 'timezone', done: false });
  });

  it('officers can hide the card for everyone; members get nothing', async () => {
    const g = await createGuild();
    fakeDiscord(g.guildId);
    const agent = await officer(g.guildId);
    await agent.put(`/api/guilds/${g.guildId}/setup/hidden`).send({ hidden: true }).expect(200);
    expect((await agent.get(`/api/guilds/${g.guildId}/setup`).expect(200)).body.data.hidden).toBe(true);
    await agent.put(`/api/guilds/${g.guildId}/setup/hidden`).send({ hidden: 'yes' }).expect(400);
    await agent.put(`/api/guilds/${g.guildId}/setup/hidden`).send({ hidden: false }).expect(200);
    expect((await prisma.guildSettings.findUnique({ where: { guildId: g.id } }))?.setupHidden).toBe(false);

    const member = await officer(g.guildId, false);
    expect((await member.get(`/api/guilds/${g.guildId}/setup`).expect(200)).body.data).toBeNull();
    await member.put(`/api/guilds/${g.guildId}/setup/hidden`).send({ hidden: true }).expect(403);
  });
});
