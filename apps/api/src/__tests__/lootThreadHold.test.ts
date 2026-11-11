// v1.22.0: completing loot records when (the event thread stays open 72 h or
// until delivered), tells the bot, and each winner of an item can be marked
// delivered on their own.
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { prisma } from '../lib/prisma.js';
import { createUser, createGuild, createEvent, createLootSession, createLootItem } from './factories.js';

const app = createServer();
const prevBot = process.env['BOT_INTERNAL_URL'];
afterEach(() => { vi.unstubAllGlobals(); if (prevBot === undefined) delete process.env['BOT_INTERNAL_URL']; else process.env['BOT_INTERNAL_URL'] = prevBot; });

/** Records what the API asks the bot to do. */
function botCalls() {
  process.env['BOT_INTERNAL_URL'] = 'http://bot.test';
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url).replace('http://bot.test', '')); return new Response(null, { status: 202 }); }));
  return calls;
}

async function setup() {
  const host = await createGuild({ name: 'Host' });
  const owner = await createUser();
  const event = await createEvent(host.guildId, owner.discordId, { status: 'ENDED', confirmedAttendees: JSON.stringify([owner.discordId]) });
  const session = await createLootSession(event.id, host.guildId);
  const item = await createLootItem(session.id, { name: 'Quantanium', quantity: 2 });
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [host.guildId] });
  return { base: `/api/guilds/${host.guildId}/events/${event.id}/loot`, session, item, agent };
}

describe('loot thread hold', () => {
  it('completing records the time and asks the bot to post results and DM winners', async () => {
    const { base, session, item, agent } = await setup();
    await prisma.lootAssignment.create({ data: { itemId: item.id, userId: 'd-1', username: 'A' } });
    const calls = botCalls();
    await agent.post(`${base}/complete`).send({}).expect(200);
    const s = await prisma.lootSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.status).toBe('COMPLETED');
    expect(s.completedAt).toBeInstanceOf(Date);
    expect(s.threadClosedAt).toBeNull();
    await vi.waitFor(() => expect(calls).toEqual(expect.arrayContaining([`/trigger/loot/${session.id}`, `/trigger/loot-complete/${session.id}`])));
  });

  it('each winner of an item can be marked delivered, and the bot hears about it', async () => {
    const { base, session, item, agent } = await setup();
    const a = await prisma.lootAssignment.create({ data: { itemId: item.id, userId: 'd-1', username: 'A' } });
    const b = await prisma.lootAssignment.create({ data: { itemId: item.id, userId: 'd-2', username: 'B' } });
    const calls = botCalls();
    await agent.patch(`${base}/items/${item.id}/assign/delivered?assignmentId=${b.id}`).expect(200);
    expect((await prisma.lootAssignment.findUniqueOrThrow({ where: { id: b.id } })).delivered).toBe(true);
    expect((await prisma.lootAssignment.findUniqueOrThrow({ where: { id: a.id } })).delivered).toBe(false);
    await agent.patch(`${base}/items/${item.id}/assign/delivered`).expect(200); // no id: the first winner, as before
    expect((await prisma.lootAssignment.findUniqueOrThrow({ where: { id: a.id } })).delivered).toBe(true);
    await vi.waitFor(() => expect(calls.filter((c) => c === `/trigger/loot-delivered/${session.id}`)).toHaveLength(2));
    // Someone else's assignment can't be named through this item.
    const other = await setup();
    const theirs = await prisma.lootAssignment.create({ data: { itemId: other.item.id, userId: 'd-3', username: 'C' } });
    await agent.patch(`${base}/items/${item.id}/assign/delivered?assignmentId=${theirs.id}`).expect(404);
  });
});
