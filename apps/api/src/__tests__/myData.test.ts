// v1.31.0: download and delete your data.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent, createLootSession, createLootItem } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

/** A member with a bit of everything, plus a friend in the same events. */
async function world() {
  const guild = await createGuild({ name: 'ASOP' });
  const user = await createUser({ username: 'rook', email: 'rook@example.com', rsiHandle: 'Rook_SC', calendarToken: `tok${Date.now()}aaaaaaaaaaaaaaaaaaaaaaaaaaa`.slice(0, 32) });
  const friend = await createUser({ username: 'friend' });
  const d = user.discordId;
  await prisma.account.create({ data: { userId: user.id, provider: 'discord', providerAccountId: d, accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH' } });
  await prisma.guildMember.create({ data: { userId: user.id, guildId: guild.id, rsiHandle: 'Rook_SC' } });
  const roles = JSON.stringify([{ id: 'p', name: 'Pilot', count: 1 }]);
  const past = await createEvent(guild.guildId, d, { status: 'COMPLETED', startTime: new Date(Date.now() - 86_400_000), vcAttendees: JSON.stringify([d, friend.discordId]) });
  const coming = await createEvent(guild.guildId, 'host', { roles });
  await prisma.eventRsvp.createMany({ data: [
    { eventId: past.id, userId: d, username: 'Rook' },
    { eventId: coming.id, userId: d, username: 'Rook', role: 'p' },
    { eventId: coming.id, userId: friend.discordId, username: 'Friend' },
  ] });
  await prisma.eventWaitlist.create({ data: { eventId: coming.id, userId: friend.discordId, role: 'p', guildId: guild.guildId } });
  await prisma.eventComment.create({ data: { eventId: past.id, userId: d, username: 'Rook', body: 'Great op' } });
  const session = await createLootSession(past.id, guild.guildId, { draftOrder: JSON.stringify([d, friend.discordId]), participants: JSON.stringify([{ userId: d, username: 'Rook' }]) });
  const item = await createLootItem(session.id, { name: 'Gold' });
  await prisma.lootAssignment.create({ data: { itemId: item.id, userId: d, username: 'Rook' } });
  const bal = await prisma.dkpBalance.create({ data: { guildId: guild.guildId, userId: d, username: 'Rook', balance: 40 } });
  await prisma.dkpTransaction.create({ data: { balanceId: bal.id, guildId: guild.guildId, userId: d, username: 'Rook', amount: 40, reason: 'Attendance' } });
  await prisma.ship.upsert({ where: { id: 'rsi-test-carrack' }, create: { id: 'rsi-test-carrack', name: 'Carrack', manufacturer: 'Anvil Aerospace', source: 'RSI' }, update: {} });
  await prisma.fleetOwner.create({ data: { discordId: d, username: 'Rook', checkedAt: new Date() } });
  await prisma.fleetShip.create({ data: { discordId: d, shipId: 'rsi-test-carrack', nickname: 'Wanderer' } });
  await prisma.memberPin.create({ data: { guildId: guild.id, userId: user.id, lat: 30, lng: -97, municipality: 'Austin, Texas, United States' } });
  const listing = await prisma.inventoryEntry.create({ data: { guildId: guild.guildId, userId: d, username: 'Rook', itemType: 'COMMODITY', itemName: 'Quantainium', quantity: 10, forSale: true } });
  await prisma.inventoryEntry.create({ data: { guildId: guild.guildId, userId: d, username: 'Rook', itemType: 'COMMODITY', itemName: 'Laranite', quantity: 5 } });
  const trade = await prisma.trade.create({ data: { inventoryEntryId: listing.id, listingSnapshot: {}, buyerGuildId: guild.guildId, buyerId: friend.discordId, buyerUsername: 'Friend', quantityRequested: 2 } });
  await prisma.tradeMessage.createMany({ data: [
    { tradeId: trade.id, senderId: friend.discordId, senderUsername: 'Friend', body: 'Still have it?' },
    { tradeId: trade.id, senderId: d, senderUsername: 'Rook', body: 'Yes' },
  ] });
  const job = await prisma.job.create({ data: { guildId: guild.guildId, posterId: d, posterName: 'Rook', kind: 'HAULING', title: 'Need a hauler', slots: 1, visibility: 'SERVER', expiresAt: new Date(Date.now() + 86_400_000) } });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return { guild, user, friend, past, coming, session, listing, trade, job, agent };
}

describe('your data', () => {
  it('the download has your things and no secrets', async () => {
    const w = await world();
    const res = await w.agent.get('/api/me/data').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="asop-my-data-\d{4}-\d{2}-\d{2}\.json"/);
    const data = JSON.parse(res.text);
    expect(data.profile).toMatchObject({ username: 'rook', email: 'rook@example.com', rsiHandle: 'Rook_SC', calendarFeed: 'on' });
    expect(data.events.signUps).toHaveLength(2);
    expect(data.events.comments[0].body).toBe('Great op');
    expect(data.events.attended.map((e: { id: string }) => e.id)).toEqual([w.past.id]);
    expect(data.loot.won[0]).toMatchObject({ item: 'Gold' });
    expect(data.dkp.ledger[0]).toMatchObject({ amount: 40 });
    expect(data.fleet.ships[0]).toMatchObject({ ship: 'Carrack', nickname: 'Wanderer' });
    expect(data.memberMapPins[0].municipality).toMatch(/Austin/);
    expect(data.marketplace.conversations.map((m: { body: string }) => m.body)).toEqual(['Still have it?', 'Yes']);
    expect(data.jobs.posted[0].title).toBe('Need a hauler');
    expect(res.text).not.toMatch(/SECRET-ACCESS|SECRET-REFRESH/);
    expect(res.text).not.toContain(w.user.calendarToken!);
  });

  it('deleting removes what is yours, anonymises what others rely on, and signs you out', async () => {
    const w = await world();
    const d = w.user.discordId;
    expect((await w.agent.post('/api/me/delete').send({ confirm: 'someone-else' }).expect(400)).body.error).toMatch(/rook/);
    await w.agent.post('/api/me/delete').send({ confirm: ' Rook ' }).expect(200);
    await w.agent.get('/api/me/data').expect(401); // signed out

    // Nothing anywhere still carries their Discord id or our User id's links.
    const u = await prisma.user.findUniqueOrThrow({ where: { id: w.user.id } });
    expect(u).toMatchObject({ username: 'Deleted member', email: null, rsiHandle: null, calendarToken: null, avatar: null });
    expect(u.discordId).toMatch(/^deleted-/);
    const ghost = u.discordId;
    expect(await prisma.account.count({ where: { userId: w.user.id } })).toBe(0);
    expect(await prisma.guildMember.count({ where: { userId: w.user.id } })).toBe(0);
    expect(await prisma.memberPin.count({ where: { userId: w.user.id } })).toBe(0);
    expect(await prisma.fleetShip.count({ where: { discordId: d } })).toBe(0);
    expect(await prisma.fleetOwner.count({ where: { discordId: d } })).toBe(0);
    expect(await prisma.eventComment.count({ where: { userId: d } })).toBe(0);

    // The upcoming event: their slot went to the friend who was waiting.
    expect(await prisma.eventRsvp.findMany({ where: { eventId: w.coming.id }, select: { userId: true, role: true } })).toEqual([{ userId: w.friend.discordId, role: 'p' }]);
    // The past event: still counted, anonymised.
    expect(await prisma.eventRsvp.findMany({ where: { eventId: w.past.id }, select: { userId: true, username: true } })).toEqual([{ userId: ghost, username: 'Deleted member' }]);
    expect(JSON.parse((await prisma.event.findUniqueOrThrow({ where: { id: w.past.id } })).vcAttendees)).toEqual([ghost, w.friend.discordId]);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: w.past.id } })).createdById).toBe(ghost);

    // Loot, DKP, marketplace, jobs: kept for everyone else, without them.
    expect(await prisma.lootAssignment.findFirst({ where: { item: { sessionId: w.session.id } }, select: { userId: true, username: true } })).toEqual({ userId: ghost, username: 'Deleted member' });
    const s = await prisma.lootSession.findUniqueOrThrow({ where: { id: w.session.id } });
    expect(JSON.parse(s.draftOrder)).toEqual([ghost, w.friend.discordId]);
    expect(JSON.parse(s.participants)).toEqual([{ userId: ghost, username: 'Deleted member' }]);
    expect(await prisma.dkpTransaction.count({ where: { userId: ghost } })).toBe(1);
    expect(await prisma.inventoryEntry.findMany({ where: { OR: [{ userId: d }, { userId: ghost }] }, select: { itemName: true, forSale: true } })).toEqual([{ itemName: 'Quantainium', forSale: false }]);
    expect((await prisma.tradeMessage.findMany({ where: { tradeId: w.trade.id }, orderBy: { createdAt: 'asc' } })).map((m) => m.senderUsername)).toEqual(['Friend', 'Deleted member']);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: w.job.id } })).toMatchObject({ status: 'CANCELLED', posterId: ghost, posterName: 'Deleted member' });

    // Signing in again with the same Discord account is a fresh start.
    expect(await prisma.user.findUnique({ where: { discordId: d } })).toBeNull();
  });
});
