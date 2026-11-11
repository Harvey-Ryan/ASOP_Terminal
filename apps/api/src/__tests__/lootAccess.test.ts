// v1.11.3: the server in a loot URL has to be the event's host (or, to view, a
// server that accepted the share), and items and awards have to belong to the
// URL's own event or session.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent, createLootSession, createLootItem } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

/** A signed-in officer of the given server. */
async function officer(guildDiscordId: string) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guildDiscordId] });
  return { user, agent };
}

/** A host server with an ended event, an open loot session and one item. */
async function hostWithLoot(overrides: Record<string, unknown> = {}) {
  const host = await createGuild({ name: 'Host' });
  const owner = await createUser();
  const event = await createEvent(host.guildId, owner.discordId, { status: 'ENDED', confirmedAttendees: JSON.stringify([owner.discordId]) });
  const session = await createLootSession(event.id, host.guildId, overrides);
  const item = await createLootItem(session.id, { name: 'Pulse Laser' });
  const loot = `/events/${event.id}/loot`;
  return { host, owner, event, session, item, loot };
}

describe('officers of another server', () => {
  it('can neither see nor change the loot', async () => {
    const { item, loot } = await hostWithLoot();
    const other = await createGuild({ name: 'Other' });
    const { agent } = await officer(other.guildId);
    const base = `/api/guilds/${other.guildId}${loot}`;

    await agent.get(base).expect(403);
    await agent.post(`${base}/items`).send({ name: 'Planted' }).expect(403);
    await agent.patch(`${base}/items/${item.id}`).send({ name: 'Renamed' }).expect(403);
    await agent.delete(`${base}/items/${item.id}`).expect(403);
    await agent.post(`${base}/items/${item.id}/roll`).expect(403);
    await agent.post(`${base}/complete`).send({}).expect(403);
    await agent.get(`${base}/auctions`).expect(403);

    const after = await prisma.lootItem.findUnique({ where: { id: item.id } });
    expect(after?.name).toBe('Pulse Laser');
    expect(await prisma.lootItem.count({ where: { name: 'Planted' } })).toBe(0);
  });
});

describe('an ally the event is shared with', () => {
  it('sees the loot, but its officers cannot run it', async () => {
    const { event, item, loot } = await hostWithLoot();
    const ally = await createGuild({ name: 'Ally' });
    await prisma.eventGuildShare.create({ data: { eventId: event.id, guildId: ally.id, sourceType: 'DIRECT', status: 'ACCEPTED' } });
    const { agent } = await officer(ally.guildId);
    const base = `/api/guilds/${ally.guildId}${loot}`;

    const res = await agent.get(base).expect(200);
    expect(res.body.data.items.map((i: { name: string }) => i.name)).toEqual(['Pulse Laser']);
    await agent.post(`${base}/items`).send({ name: 'Planted' }).expect(403);
    await agent.delete(`${base}/items/${item.id}`).expect(403);
    expect(await prisma.lootItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });

  it('a share that was declined gives no access', async () => {
    const { event, loot } = await hostWithLoot();
    const ally = await createGuild({ name: 'Declined' });
    await prisma.eventGuildShare.create({ data: { eventId: event.id, guildId: ally.id, sourceType: 'DIRECT', status: 'DECLINED' } });
    const { agent } = await officer(ally.guildId);
    await agent.get(`/api/guilds/${ally.guildId}${loot}`).expect(403);
  });
});

describe('the host', () => {
  it('still runs its own loot', async () => {
    const { host, item, loot } = await hostWithLoot();
    const { agent } = await officer(host.guildId);
    const base = `/api/guilds/${host.guildId}${loot}`;
    await agent.get(base).expect(200);
    await agent.post(`${base}/items`).send({ name: 'Ballistic Gatling' }).expect(201);
    await agent.patch(`${base}/items/${item.id}`).send({ name: 'Pulse Laser S2' }).expect(200);
    await agent.post(`${base}/items/${item.id}/assign`).send({ userId: 'd-1', username: 'Pilot' }).expect(200);
    await agent.patch(`${base}/items/${item.id}/assign/delivered`).expect(200);
    await agent.delete(`${base}/items/${item.id}/assign`).expect(200);
  });

  it('cannot reach items or awards of another session through its own URL', async () => {
    const mine = await hostWithLoot();
    const theirs = await hostWithLoot();
    await prisma.lootAssignment.create({ data: { itemId: theirs.item.id, userId: 'd-9', username: 'Winner' } });
    const { agent } = await officer(mine.host.guildId);
    const base = `/api/guilds/${mine.host.guildId}${mine.loot}`;

    await agent.patch(`${base}/items/${theirs.item.id}`).send({ name: 'Hijacked' }).expect(404);
    await agent.delete(`${base}/items/${theirs.item.id}`).expect(404);
    await agent.post(`${base}/items/${theirs.item.id}/assign`).send({ userId: 'd-1', username: 'Thief' }).expect(404);
    await agent.delete(`${base}/items/${theirs.item.id}/assign`).expect(404);
    await agent.patch(`${base}/items/${theirs.item.id}/assign/delivered`).expect(404);
    await agent.post(`${base}/items/${theirs.item.id}/auction/bid`).send({ maxBid: 5 }).expect(404);
    await agent.post(`${base}/items/${theirs.item.id}/auction/close`).expect(404);

    const awards = await prisma.lootAssignment.findMany({ where: { itemId: theirs.item.id } });
    expect(awards.map((a) => a.username)).toEqual(['Winner']);
    expect(awards[0]!.delivered).toBe(false);
    expect((await prisma.lootItem.findUnique({ where: { id: theirs.item.id } }))?.name).toBe('Pulse Laser');
  });
});

describe('the snake draft picker', () => {
  it('can pick from this draft, but not an item from another session', async () => {
    const picker = await createUser();
    const draft = { method: 'SNAKE_DRAFT', draftStarted: true, draftOrder: JSON.stringify([picker.discordId]) };
    const mine = await hostWithLoot(draft);
    const theirs = await hostWithLoot();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: picker.id, managedGuildIds: [] });
    const base = `/api/guilds/${mine.host.guildId}${mine.loot}`;

    await agent.post(`${base}/items/${theirs.item.id}/assign`).send({ userId: picker.discordId, username: 'Picker' }).expect(404);
    expect(await prisma.lootAssignment.count({ where: { itemId: theirs.item.id } })).toBe(0);
    await agent.post(`${base}/items/${mine.item.id}/assign`).send({ userId: picker.discordId, username: 'Picker' }).expect(200);
  });
});

describe('standalone sessions', () => {
  it('an award from another session cannot be marked delivered', async () => {
    const guild = await createGuild();
    const { agent } = await officer(guild.guildId);
    const a = await prisma.lootSession.create({ data: { guildId: guild.guildId, name: 'A' } });
    const other = await hostWithLoot();
    const award = await prisma.lootAssignment.create({ data: { itemId: other.item.id, userId: 'd-9', username: 'Winner' } });

    await agent.patch(`/api/guilds/${guild.guildId}/loot/sessions/${a.id}/assignments/${award.id}/delivered`).expect(404);
    await agent.delete(`/api/guilds/${guild.guildId}/loot/sessions/${a.id}/items/${other.item.id}/assign`).expect(404);
    expect((await prisma.lootAssignment.findUnique({ where: { id: award.id } }))?.delivered).toBe(false);
  });
});
