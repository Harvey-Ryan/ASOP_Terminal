/**
 * Settings API tests — the most critical file for the Postgres migration.
 *
 * The three role fields (eventCreatorRoles, moduleEditorRoles, viewerRoles) are
 * currently stored as JSON strings in SQLite and accessed via $queryRaw / $executeRaw.
 * On Postgres these become native String[] columns accessed via normal Prisma queries.
 *
 * Every test here documents the expected behavior contract so that after the migration
 * we can run this suite and confirm nothing broke.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import type { TestAgent } from 'supertest/agent.js';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeManagerAgent(guildDiscordId: string): Promise<[TestAgent, string]> {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guildDiscordId] });
  return [agent, user.id];
}

// ── Raw SQL JSON field round-trips ─────────────────────────────────────────
// These tests directly verify the $queryRaw / $executeRaw paths that will be
// replaced by normal Prisma queries when we switch to Postgres.

describe('GuildSettings JSON role fields — raw SQL paths', () => {
  it('eventCreatorRoles defaults to an empty array', async () => {
    const guild = await createGuild();
    const settings = await createGuildSettings(guild.id);

    const rows = await prisma.$queryRaw<{ eventCreatorRoles: string }[]>`
      SELECT eventCreatorRoles FROM GuildSettings WHERE id = ${settings.id}
    `;
    expect(JSON.parse(rows[0]!.eventCreatorRoles)).toEqual([]);
  });

  it('eventCreatorRoles round-trips via $executeRaw / $queryRaw', async () => {
    const guild = await createGuild();
    const settings = await createGuildSettings(guild.id);
    const roles = ['111111111111111111', '222222222222222222'];

    await prisma.$executeRaw`
      UPDATE GuildSettings SET eventCreatorRoles = ${JSON.stringify(roles)} WHERE id = ${settings.id}
    `;

    const rows = await prisma.$queryRaw<{ eventCreatorRoles: string }[]>`
      SELECT eventCreatorRoles FROM GuildSettings WHERE id = ${settings.id}
    `;
    expect(JSON.parse(rows[0]!.eventCreatorRoles)).toEqual(roles);
  });

  it('moduleEditorRoles round-trips via $executeRaw / $queryRaw', async () => {
    const guild = await createGuild();
    const settings = await createGuildSettings(guild.id);
    const roles = ['333333333333333333'];

    await prisma.$executeRaw`
      UPDATE GuildSettings SET moduleEditorRoles = ${JSON.stringify(roles)} WHERE id = ${settings.id}
    `;

    const rows = await prisma.$queryRaw<{ moduleEditorRoles: string }[]>`
      SELECT moduleEditorRoles FROM GuildSettings WHERE id = ${settings.id}
    `;
    expect(JSON.parse(rows[0]!.moduleEditorRoles)).toEqual(roles);
  });

  it('viewerRoles round-trips via $executeRaw / $queryRaw', async () => {
    const guild = await createGuild();
    const settings = await createGuildSettings(guild.id);
    const roles = ['444444444444444444', '555555555555555555', '666666666666666666'];

    await prisma.$executeRaw`
      UPDATE GuildSettings SET viewerRoles = ${JSON.stringify(roles)} WHERE id = ${settings.id}
    `;

    const rows = await prisma.$queryRaw<{ viewerRoles: string }[]>`
      SELECT viewerRoles FROM GuildSettings WHERE id = ${settings.id}
    `;
    expect(JSON.parse(rows[0]!.viewerRoles)).toEqual(roles);
  });

  it('all three role fields are independent — writing one does not corrupt others', async () => {
    const guild = await createGuild();
    const settings = await createGuildSettings(guild.id);

    await prisma.$executeRaw`UPDATE GuildSettings SET eventCreatorRoles  = ${JSON.stringify(['r1'])} WHERE id = ${settings.id}`;
    await prisma.$executeRaw`UPDATE GuildSettings SET moduleEditorRoles  = ${JSON.stringify(['r2'])} WHERE id = ${settings.id}`;
    await prisma.$executeRaw`UPDATE GuildSettings SET viewerRoles        = ${JSON.stringify(['r3'])} WHERE id = ${settings.id}`;

    const rows = await prisma.$queryRaw<{
      eventCreatorRoles: string;
      moduleEditorRoles: string;
      viewerRoles: string;
    }[]>`SELECT eventCreatorRoles, moduleEditorRoles, viewerRoles FROM GuildSettings WHERE id = ${settings.id}`;

    expect(JSON.parse(rows[0]!.eventCreatorRoles)).toEqual(['r1']);
    expect(JSON.parse(rows[0]!.moduleEditorRoles)).toEqual(['r2']);
    expect(JSON.parse(rows[0]!.viewerRoles)).toEqual(['r3']);
  });
});

// ── GET /api/guilds/:guildId/settings ──────────────────────────────────────

describe('GET /:guildId/settings', () => {
  it('returns 401 without session', async () => {
    const res = await request(app).get('/api/guilds/any/settings');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a guild manager', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });

    const res = await agent.get(`/api/guilds/${guild.guildId}/settings`);
    expect(res.status).toBe(403);
  });

  it('returns default empty role arrays for a fresh guild (no settings row yet)', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent.get(`/api/guilds/${guild.guildId}/settings`);
    expect(res.status).toBe(200);
    expect(res.body.data.eventCreatorRoles).toEqual([]);
    expect(res.body.data.moduleEditorRoles).toEqual([]);
    expect(res.body.data.viewerRoles).toEqual([]);
    expect(res.body.data.forumChannelId).toBeNull();
    expect(res.body.data.voiceCategoryId).toBeNull();
  });

  it('returns stored role arrays correctly', async () => {
    const guild = await createGuild();
    const settings = await createGuildSettings(guild.id);
    await prisma.$executeRaw`UPDATE GuildSettings SET eventCreatorRoles = ${JSON.stringify(['ec-1'])} WHERE id = ${settings.id}`;
    await prisma.$executeRaw`UPDATE GuildSettings SET viewerRoles       = ${JSON.stringify(['vr-1', 'vr-2'])} WHERE id = ${settings.id}`;

    const [agent] = await makeManagerAgent(guild.guildId);
    const res = await agent.get(`/api/guilds/${guild.guildId}/settings`);

    expect(res.status).toBe(200);
    expect(res.body.data.eventCreatorRoles).toEqual(['ec-1']);
    expect(res.body.data.viewerRoles).toEqual(['vr-1', 'vr-2']);
  });
});

// ── PATCH /api/guilds/:guildId/settings ────────────────────────────────────

describe('PATCH /:guildId/settings', () => {
  it('writes and reads back eventCreatorRoles', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);
    const roles = ['role-a', 'role-b'];

    const res = await agent
      .patch(`/api/guilds/${guild.guildId}/settings`)
      .send({ eventCreatorRoles: roles });

    expect(res.status).toBe(200);
    expect(res.body.data.eventCreatorRoles).toEqual(roles);

    // Verify persisted via GET
    const get = await agent.get(`/api/guilds/${guild.guildId}/settings`);
    expect(get.body.data.eventCreatorRoles).toEqual(roles);
  });

  it('writes and reads back moduleEditorRoles', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);
    const roles = ['mod-role-1'];

    const res = await agent
      .patch(`/api/guilds/${guild.guildId}/settings`)
      .send({ moduleEditorRoles: roles });

    expect(res.status).toBe(200);
    expect(res.body.data.moduleEditorRoles).toEqual(roles);
  });

  it('writes and reads back viewerRoles', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);
    const roles = ['viewer-role-1', 'viewer-role-2', 'viewer-role-3'];

    const res = await agent
      .patch(`/api/guilds/${guild.guildId}/settings`)
      .send({ viewerRoles: roles });

    expect(res.status).toBe(200);
    expect(res.body.data.viewerRoles).toEqual(roles);
  });

  it('writes and reads back forumChannelId and voiceCategoryId', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent
      .patch(`/api/guilds/${guild.guildId}/settings`)
      .send({ forumChannelId: '100000000000000001', voiceCategoryId: '100000000000000002' });

    expect(res.status).toBe(200);
    expect(res.body.data.forumChannelId).toBe('100000000000000001');
    expect(res.body.data.voiceCategoryId).toBe('100000000000000002');
  });

  it('patches all five fields in a single request — all round-trip correctly', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const payload = {
      forumChannelId: '900000000000000001',
      voiceCategoryId: '900000000000000002',
      eventCreatorRoles: ['ec-role-1', 'ec-role-2'],
      moduleEditorRoles: ['me-role-1'],
      viewerRoles: ['vr-role-1', 'vr-role-2', 'vr-role-3'],
    };

    const res = await agent.patch(`/api/guilds/${guild.guildId}/settings`).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject(payload);

    // Verify all persisted values survive a re-read
    const get = await agent.get(`/api/guilds/${guild.guildId}/settings`);
    expect(get.body.data).toMatchObject(payload);
  });

  it('overwrites roles with empty array (clearing them)', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    await agent.patch(`/api/guilds/${guild.guildId}/settings`).send({
      eventCreatorRoles: ['role-to-clear'],
    });
    const res = await agent.patch(`/api/guilds/${guild.guildId}/settings`).send({
      eventCreatorRoles: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.eventCreatorRoles).toEqual([]);
  });

  it('returns 403 when non-manager tries to set moduleEditorRoles', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });

    const res = await agent
      .patch(`/api/guilds/${guild.guildId}/settings`)
      .send({ moduleEditorRoles: ['some-role'] });

    expect(res.status).toBe(403);
  });

  it('returns 403 when non-manager tries to set viewerRoles', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });

    const res = await agent
      .patch(`/api/guilds/${guild.guildId}/settings`)
      .send({ viewerRoles: ['some-role'] });

    expect(res.status).toBe(403);
  });
});

// ── Permission checks using role-based access ──────────────────────────────
// These tests verify the assertEventViewer path that reads viewerRoles + eventCreatorRoles
// via $queryRaw and then checks a Discord member's roles via fetch.

describe('Role-based event access (assertEventViewer)', () => {
  it('allows a user with a configured viewerRole to list events', async () => {
    const guild = await createGuild();
    const user = await createUser();
    // Set up settings with a viewerRole
    const settings = await createGuildSettings(guild.id);
    const viewerRoleId = 'viewer-snowflake-999';
    await prisma.$executeRaw`UPDATE GuildSettings SET viewerRoles = ${JSON.stringify([viewerRoleId])} WHERE id = ${settings.id}`;

    // Mock Discord members endpoint to return the viewer role
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ roles: [viewerRoleId] }),
    }));

    const agent = request.agent(app);
    // NOT a manager — managedGuildIds is empty
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });

    const res = await agent.get(`/api/guilds/${guild.guildId}/events`);
    expect(res.status).toBe(200);
  });

  it('blocks a user whose roles do not match any configured role', async () => {
    const guild = await createGuild();
    const user = await createUser();
    await createGuildSettings(guild.id);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ roles: ['unrelated-role-id'] }),
    }));

    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });

    const res = await agent.get(`/api/guilds/${guild.guildId}/events`);
    // No viewer/creator roles configured → only managers can access
    expect(res.status).toBe(403);
  });
});
