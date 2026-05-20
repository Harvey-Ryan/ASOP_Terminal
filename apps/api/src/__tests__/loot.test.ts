/**
 * Loot API tests.
 *
 * Critical migration checks:
 *   - draftOrder JSON field (LootSession) round-trips through create → DB → read.
 *   - confirmedAttendees (Event) parsed correctly when rolling loot.
 *   - DKP award/deduction runs correctly on session complete.
 *   - GET /loot/recent returns grouped view of most-recent session.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { TestAgent } from 'supertest/agent.js';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent, createLootSession, createLootItem } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

async function makeManagerAgent(guildDiscordId: string): Promise<[TestAgent, string]> {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guildDiscordId] });
  return [agent, user.discordId];
}

// ── Session create ─────────────────────────────────────────────────────────

describe('POST /:guildId/events/:eventId/loot — create session', () => {
  it('creates a session with default method and draftOrder', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId, {
      status: 'ENDED',
      confirmedAttendees: JSON.stringify(['uid-1', 'uid-2']),
    });

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/loot`)
      .send({ method: 'RANDOM_ROLL', dkpAward: 0 });

    expect(res.status).toBe(201);
    expect(res.body.data.method).toBe('RANDOM_ROLL');
    // draftOrder JSON field: confirmedAttendees shuffled — must be an array
    expect(Array.isArray(res.body.data.draftOrder)).toBe(true);
    expect(res.body.data.draftOrder).toHaveLength(2);
    expect(res.body.data.items).toEqual([]);
  });

  it('returns 409 when session already exists', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    await createLootSession(event.id, guild.guildId);

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/loot`)
      .send({});
    expect(res.status).toBe(409);
  });
});

// ── Item management ────────────────────────────────────────────────────────

describe('Loot item CRUD', () => {
  it('adds an item to the session', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    await createLootSession(event.id, guild.guildId);

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/loot/items`)
      .send({ name: 'Sword of Testing', quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Sword of Testing');
    expect(res.body.data.assignments).toEqual([]);
  });

  it('returns 400 when item name is missing', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    await createLootSession(event.id, guild.guildId);

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/loot/items`)
      .send({ quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('deletes an item', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    const session = await createLootSession(event.id, guild.guildId);
    const item = await createLootItem(session.id, { name: 'Delete Me' });

    const res = await agent.delete(
      `/api/guilds/${guild.guildId}/events/${event.id}/loot/items/${item.id}`,
    );
    expect(res.status).toBe(200);
  });
});

// ── Roll ───────────────────────────────────────────────────────────────────

describe('POST /loot/items/:itemId/roll', () => {
  it('rolls and assigns a winner, result has correct shape', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    // Event with confirmed attendees — confirmedAttendees is a JSON string in SQLite
    const event = await createEvent(guild.guildId, user.discordId, {
      status: 'ENDED',
      confirmedAttendees: JSON.stringify(['player-1']),
    });
    // Add a matching rsvp so username resolves
    await prisma.eventRsvp.create({
      data: { eventId: event.id, userId: 'player-1', username: 'PlayerOne' },
    });

    const session = await createLootSession(event.id, guild.guildId);
    const item = await createLootItem(session.id);

    const res = await agent.post(
      `/api/guilds/${guild.guildId}/events/${event.id}/loot/items/${item.id}/roll`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.winner.userId).toBe('player-1');
    expect(res.body.data.winner.username).toBe('PlayerOne');
    expect(res.body.data.winner.rollValue).toBeGreaterThanOrEqual(1);
    expect(res.body.data.winner.rollValue).toBeLessThanOrEqual(100);
    expect(Array.isArray(res.body.data.rolls)).toBe(true);
  });

  it('returns 400 when no confirmed attendees are eligible', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId, {
      confirmedAttendees: JSON.stringify([]),
    });
    const session = await createLootSession(event.id, guild.guildId);
    const item = await createLootItem(session.id);

    const res = await agent.post(
      `/api/guilds/${guild.guildId}/events/${event.id}/loot/items/${item.id}/roll`,
    );
    expect(res.status).toBe(400);
  });
});

// ── Manual assign ──────────────────────────────────────────────────────────

describe('POST /loot/items/:itemId/assign', () => {
  it('assigns item to a user manually', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    const session = await createLootSession(event.id, guild.guildId);
    const item = await createLootItem(session.id);

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/loot/items/${item.id}/assign`)
      .send({ userId: 'user-abc', username: 'SomePlayer' });

    expect(res.status).toBe(200);
  });

  it('returns 400 when userId or username is missing', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    const session = await createLootSession(event.id, guild.guildId);
    const item = await createLootItem(session.id);

    const res = await agent
      .post(`/api/guilds/${guild.guildId}/events/${event.id}/loot/items/${item.id}/assign`)
      .send({ userId: 'user-abc' }); // missing username
    expect(res.status).toBe(400);
  });
});

// ── Session complete + DKP ─────────────────────────────────────────────────

describe('POST /loot/complete — DKP award', () => {
  it('awards DKP to all confirmed attendees on completion', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const attendees = ['att-1', 'att-2'];
    const event = await createEvent(guild.guildId, user.discordId, {
      status: 'ENDED',
      confirmedAttendees: JSON.stringify(attendees),
    });
    await prisma.eventRsvp.createMany({
      data: [
        { eventId: event.id, userId: 'att-1', username: 'Attendee1' },
        { eventId: event.id, userId: 'att-2', username: 'Attendee2' },
      ],
    });

    const session = await createLootSession(event.id, guild.guildId, { dkpAward: 10 });

    const res = await agent.post(
      `/api/guilds/${guild.guildId}/events/${event.id}/loot/complete`,
    );
    expect(res.status).toBe(200);

    // Verify DKP balances were created
    const balances = await prisma.dkpBalance.findMany({ where: { guildId: guild.guildId } });
    expect(balances).toHaveLength(2);
    expect(balances.every((b) => b.balance === 10)).toBe(true);
  });

  it('deducts DKP from winner on DKP method', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const event = await createEvent(guild.guildId, user.discordId, {
      status: 'ENDED',
      confirmedAttendees: JSON.stringify(['winner-1']),
    });
    await prisma.eventRsvp.create({
      data: { eventId: event.id, userId: 'winner-1', username: 'Winner' },
    });

    // Create initial DKP balance for the winner
    await prisma.dkpBalance.create({
      data: { guildId: guild.guildId, userId: 'winner-1', username: 'Winner', balance: 50 },
    });

    const session = await createLootSession(event.id, guild.guildId, {
      method: 'DKP',
      dkpAward: 10,
    });
    const item = await createLootItem(session.id, { name: 'Prize Item' });
    await prisma.lootAssignment.create({
      data: { itemId: item.id, userId: 'winner-1', username: 'Winner', dkpSpent: 20 },
    });

    const res = await agent.post(
      `/api/guilds/${guild.guildId}/events/${event.id}/loot/complete`,
    );
    expect(res.status).toBe(200);

    const bal = await prisma.dkpBalance.findUnique({
      where: { guildId_userId: { guildId: guild.guildId, userId: 'winner-1' } },
    });
    // +10 attendance, -20 item spend = net 40 (started at 50)
    expect(bal?.balance).toBe(40);
  });

  it('returns 409 when session is already completed', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    await createLootSession(event.id, guild.guildId, { status: 'COMPLETED' });

    const res = await agent.post(
      `/api/guilds/${guild.guildId}/events/${event.id}/loot/complete`,
    );
    expect(res.status).toBe(409);
  });
});

// ── GET recent loot ────────────────────────────────────────────────────────

describe('GET /:guildId/loot/recent', () => {
  it('returns null when no sessions with assignments exist', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);
    const event = await createEvent(guild.guildId, user.discordId);
    await createLootSession(event.id, guild.guildId); // no items or assignments

    const res = await agent.get(`/api/guilds/${guild.guildId}/loot/recent`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('returns most recent session with grouped items and winners', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const [agent] = await makeManagerAgent(guild.guildId);

    const event = await createEvent(guild.guildId, user.discordId, { name: 'Recent Raid' });
    const session = await createLootSession(event.id, guild.guildId);
    const item1 = await createLootItem(session.id, { name: 'Helm', sortOrder: 0 });
    const item2 = await createLootItem(session.id, { name: 'Sword', sortOrder: 1 });
    await prisma.lootAssignment.create({
      data: { itemId: item1.id, userId: 'u1', username: 'Alice', rollValue: 95 },
    });
    await prisma.lootAssignment.create({
      data: { itemId: item2.id, userId: 'u2', username: 'Bob', rollValue: 72 },
    });

    const res = await agent.get(`/api/guilds/${guild.guildId}/loot/recent`);
    expect(res.status).toBe(200);
    expect(res.body.data.eventName).toBe('Recent Raid');
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0].name).toBe('Helm');
    expect(res.body.data.items[0].winner.username).toBe('Alice');
    expect(res.body.data.items[1].name).toBe('Sword');
    expect(res.body.data.items[1].winner.username).toBe('Bob');
  });
});
