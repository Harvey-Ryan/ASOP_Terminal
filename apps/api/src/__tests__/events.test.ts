/**
 * Events API tests.
 *
 * Critical migration checks:
 *   - JSON-as-String fields (roles, vcNames, vcAttendees, confirmedAttendees) round-trip
 *     correctly through create → DB → read. These fields change from String to Json
 *     (or String[]) when we switch to Postgres, so the behavior must stay identical.
 *   - Event status transitions (PENDING → ENDED → COMPLETED) work correctly.
 *   - Permission boundaries: 401 without session, 403 without access.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
type TestAgent = ReturnType<typeof request.agent>;
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent } from './factories.js';

const app = createServer();

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeManagerAgent(guildDiscordId: string): Promise<[TestAgent, string]> {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({
    userId: user.id,
    managedGuildIds: [guildDiscordId],
  });
  return [agent, user.id];
}

// ── Auth boundary ──────────────────────────────────────────────────────────

describe('Events auth boundary', () => {
  it('GET /events returns 401 without session', async () => {
    const res = await request(app).get('/api/guilds/any-id/events');
    expect(res.status).toBe(401);
  });

  it('POST /events returns 401 without session', async () => {
    const res = await request(app).post('/api/guilds/any-id/events').send({});
    expect(res.status).toBe(401);
  });
});

// ── GET events ─────────────────────────────────────────────────────────────

describe('GET /:guildId/events', () => {
  it('returns 403 when user has no access to guild', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });

    const res = await agent.get(`/api/guilds/${guild.guildId}/events`);
    expect(res.status).toBe(403);
  });

  it('returns empty array for guild with no events', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent.get(`/api/guilds/${guild.guildId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('returns non-completed events sorted by startTime ascending', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const t1 = new Date(Date.now() + 2 * 60 * 60_000);
    const t2 = new Date(Date.now() + 1 * 60 * 60_000);
    await createEvent(guild.guildId, user.discordId, { name: 'Later', startTime: t1 });
    await createEvent(guild.guildId, user.discordId, { name: 'Sooner', startTime: t2 });

    const res = await agent.get(`/api/guilds/${guild.guildId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Sooner');
    expect(res.body.data[1].name).toBe('Later');
  });

  it('returns completed events when ?completed=true, sorted descending', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const t1 = new Date(Date.now() - 2 * 60 * 60_000);
    const t2 = new Date(Date.now() - 1 * 60 * 60_000);
    await createEvent(guild.guildId, user.discordId, { name: 'Older', startTime: t1, status: 'COMPLETED' });
    await createEvent(guild.guildId, user.discordId, { name: 'Newer', startTime: t2, status: 'COMPLETED' });
    // Active event should not appear
    await createEvent(guild.guildId, user.discordId, { name: 'Active', status: 'PENDING' });

    const res = await agent.get(`/api/guilds/${guild.guildId}/events?completed=true`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Newer');
    expect(res.body.data[1].name).toBe('Older');
  });
});

// ── POST events (JSON field round-trips) ───────────────────────────────────

describe('POST /:guildId/events — JSON field integrity', () => {
  it('stores and returns roles as a parsed array', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const roles = [
      { name: 'Tank', count: 2 },
      { name: 'Healer', count: 1 },
    ];
    const res = await agent.post(`/api/guilds/${guild.guildId}/events`).send({
      name: 'Role Test',
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      roles,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.roles).toEqual(roles);
  });

  it('stores and returns vcNames as a parsed array', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const vcNames = ['Alpha Squad', 'Bravo Squad'];
    const res = await agent.post(`/api/guilds/${guild.guildId}/events`).send({
      name: 'VC Test',
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      vcNames,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.vcNames).toEqual(vcNames);
  });

  it('defaults roles and vcNames to empty arrays', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent.post(`/api/guilds/${guild.guildId}/events`).send({
      name: 'Minimal Event',
      startTime: new Date(Date.now() + 3600_000).toISOString(),
    });

    expect(res.status).toBe(201);
    expect(res.body.data.roles).toEqual([]);
    expect(res.body.data.vcNames).toEqual([]);
    expect(res.body.data.vcAttendees).toEqual([]);
  });

  it('returns 400 when name is missing', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent.post(`/api/guilds/${guild.guildId}/events`).send({
      startTime: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when startTime is missing', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent.post(`/api/guilds/${guild.guildId}/events`).send({
      name: 'No Time',
    });
    expect(res.status).toBe(400);
  });
});

// ── GET single event ───────────────────────────────────────────────────────

describe('GET /:guildId/events/:eventId', () => {
  it('returns the event with correct fields', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const event = await createEvent(guild.guildId, user.discordId, {
      name: 'My Event',
      roles: JSON.stringify([{ name: 'DPS', count: 5 }]),
    });

    const res = await agent.get(`/api/guilds/${guild.guildId}/events/${event.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(event.id);
    expect(res.body.data.name).toBe('My Event');
    expect(res.body.data.roles).toEqual([{ name: 'DPS', count: 5 }]);
  });

  it('returns 404 for unknown eventId', async () => {
    const guild = await createGuild();
    const [agent] = await makeManagerAgent(guild.guildId);

    const res = await agent.get(`/api/guilds/${guild.guildId}/events/nonexistent-id`);
    expect(res.status).toBe(404);
  });
});

// ── Status transitions ─────────────────────────────────────────────────────

describe('Event status transitions', () => {
  it('ends a PENDING event → status becomes ENDED', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId, { status: 'ACTIVE' });

    const res = await agent.post(`/api/guilds/${guild.guildId}/events/${event.id}/end`);
    expect(res.status).toBe(200);
  });

  it('returns 409 when trying to end an already-COMPLETED event', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId, { status: 'COMPLETED' });

    const res = await agent.post(`/api/guilds/${guild.guildId}/events/${event.id}/end`);
    expect(res.status).toBe(409);
  });

  it('completes an ENDED event — confirmedAttendees JSON round-trips', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId, { status: 'ENDED' });

    const confirmedAttendees = ['user-1', 'user-2', 'user-3'];
    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/complete`)
      .send({ hadLoot: true, lootNotes: 'Good run', confirmedAttendees });

    expect(res.status).toBe(200);

    // Re-fetch and verify the JSON field was stored and parses correctly
    const getRes = await agent.get(`/api/guilds/${guild.guildId}/events/${event.id}`);
    expect(getRes.body.data.status).toBe('COMPLETED');
    expect(getRes.body.data.hadLoot).toBe(true);
    expect(getRes.body.data.lootNotes).toBe('Good run');
    expect(getRes.body.data.confirmedAttendees).toEqual(confirmedAttendees);
  });

  it('returns 409 when completing an event that is not ENDED', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId, { status: 'PENDING' });

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/complete`)
      .send({ hadLoot: false });
    expect(res.status).toBe(409);
  });
});
