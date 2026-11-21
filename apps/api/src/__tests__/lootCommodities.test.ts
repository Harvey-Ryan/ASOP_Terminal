/**
 * Event loot with gear and commodities together (v1.60.1).
 *
 * Commodity lines (with a QL) are handed out unit by unit by the commodity
 * roll; gear lines by the session's method. Neither touches the other.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent, createLootSession, createLootItem } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

const PEOPLE = [
  { userId: '1001', username: 'Destrokk' },
  { userId: '1002', username: 'ArcSolo3' },
  { userId: '1003', username: 'Mango' },
  { userId: '1004', username: 'Drath Pie' },
];

async function setup(sessionOverrides: Record<string, unknown> = {}) {
  const guild = await createGuild();
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
  const event = await createEvent(guild.guildId, user.discordId, {
    status: 'ENDED',
    confirmedAttendees: JSON.stringify(PEOPLE.map((p) => p.userId)),
  });
  const session = await createLootSession(event.id, guild.guildId, {
    participants: JSON.stringify(PEOPLE),
    ...sessionOverrides,
  });
  const base = `/api/guilds/${guild.guildId}/events/${event.id}/loot`;
  return { guild, event, session, agent, base };
}

const unitsOf = (itemId: string) => prisma.lootAssignment.findMany({ where: { itemId } });

describe('commodity roll on an event with gear and commodities', () => {
  it('hands out every commodity unit and leaves gear (and the snake draft) alone', async () => {
    const { session, agent, base } = await setup({
      method: 'SNAKE_DRAFT',
      draftOrder: JSON.stringify(PEOPLE.map((p) => p.userId)),
      draftStarted: false,
    });
    const gear = await createLootItem(session.id, { name: 'P4-AR Rifle' });
    const q800 = await createLootItem(session.id, { name: 'Quantainium', quantity: 5, qualityLevel: 800 });
    const q500 = await createLootItem(session.id, { name: 'Quantainium', quantity: 3, qualityLevel: 500 });
    const gold = await createLootItem(session.id, { name: 'Gold', quantity: 2, qualityLevel: 650 });
    await prisma.lootAssignment.create({
      data: { itemId: gear.id, userId: '1002', username: 'ArcSolo3', pickNumber: 0 },
    });

    const res = await agent.post(`${base}/commodity-roll`).send({});
    expect(res.status).toBe(200);

    expect(await unitsOf(q800.id)).toHaveLength(5);
    expect(await unitsOf(q500.id)).toHaveLength(3);
    expect(await unitsOf(gold.id)).toHaveLength(2);
    const ids = new Set(PEOPLE.map((p) => p.userId));
    for (const a of [...(await unitsOf(q800.id)), ...(await unitsOf(q500.id)), ...(await unitsOf(gold.id))]) {
      expect(ids.has(a.userId)).toBe(true);
      expect(a.username).toBe(PEOPLE.find((p) => p.userId === a.userId)!.username);
    }
    // Quantainium: 8 units over 4 people, two each (snake keeps one commodity even).
    const quan = [...(await unitsOf(q800.id)), ...(await unitsOf(q500.id))];
    for (const p of PEOPLE) expect(quan.filter((a) => a.userId === p.userId)).toHaveLength(2);

    // Gear untouched; a snake session isn't marked "draft started" by the roll.
    const gearRows = await unitsOf(gear.id);
    expect(gearRows).toHaveLength(1);
    expect(gearRows[0]!.userId).toBe('1002');
    const after = await prisma.lootSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.draftStarted).toBe(false);
    expect(after.status).toBe('OPEN');
  });

  it('re-rolling replaces the commodity units only', async () => {
    const { session, agent, base } = await setup({ method: 'RANDOM_ROLL' });
    const gear = await createLootItem(session.id, { name: 'Medical Pen' });
    const line = await createLootItem(session.id, { name: 'Taranite', quantity: 6, qualityLevel: 700 });
    await prisma.lootAssignment.create({ data: { itemId: gear.id, userId: '1003', username: 'Mango', rollValue: 88 } });

    expect((await agent.post(`${base}/commodity-roll`).send({})).status).toBe(200);
    const first = await unitsOf(line.id);
    await prisma.lootAssignment.update({ where: { id: first[0]!.id }, data: { delivered: true } });
    expect((await agent.post(`${base}/commodity-roll`).send({})).status).toBe(200);

    expect(await unitsOf(line.id)).toHaveLength(6);
    expect(await prisma.lootAssignment.findUnique({ where: { id: first[0]!.id } })).toBeNull();
    const gearRows = await unitsOf(gear.id);
    expect(gearRows).toHaveLength(1);
    expect(gearRows[0]!.rollValue).toBe(88);
  });

  it('a commodity draft session is marked rolled', async () => {
    const { session, agent, base } = await setup({ method: 'COMMODITY_DRAFT' });
    await createLootItem(session.id, { name: 'Gold', quantity: 3, qualityLevel: 500 });
    expect((await agent.post(`${base}/commodity-roll`).send({})).status).toBe(200);
    expect((await prisma.lootSession.findUniqueOrThrow({ where: { id: session.id } })).draftStarted).toBe(true);
  });

  it('refuses to roll without commodity lines or participants', async () => {
    const a = await setup();
    await createLootItem(a.session.id, { name: 'P4-AR Rifle' });
    expect((await a.agent.post(`${a.base}/commodity-roll`).send({})).status).toBe(400);

    const b = await setup({ participants: '[]' });
    await createLootItem(b.session.id, { name: 'Gold', quantity: 2, qualityLevel: 500 });
    expect((await b.agent.post(`${b.base}/commodity-roll`).send({})).status).toBe(400);
  });
});

describe('gear methods leave commodity lines alone', () => {
  it('a commodity line cannot be rolled for, assigned or queued as one item', async () => {
    const { session, agent, base } = await setup({
      method: 'SNAKE_DRAFT',
      draftOrder: JSON.stringify(PEOPLE.map((p) => p.userId)),
    });
    const line = await createLootItem(session.id, { name: 'Quantainium', quantity: 4, qualityLevel: 800 });

    expect((await agent.post(`${base}/items/${line.id}/roll`).send({})).status).toBe(400);
    expect(
      (await agent.post(`${base}/items/${line.id}/assign`).send({ userId: '1001', username: 'Destrokk' })).status,
    ).toBe(400);
    expect(await unitsOf(line.id)).toHaveLength(0);
  });

  it('finishing the gear draft keeps the session open while commodities wait for their roll', async () => {
    const { session, agent, base } = await setup({
      method: 'SNAKE_DRAFT',
      draftOrder: JSON.stringify(PEOPLE.map((p) => p.userId)),
      draftStarted: true,
    });
    const gear = await createLootItem(session.id, { name: 'P4-AR Rifle' });
    await createLootItem(session.id, { name: 'Quantainium', quantity: 4, qualityLevel: 800 });

    const res = await agent
      .post(`${base}/items/${gear.id}/assign`)
      .send({ userId: '1001', username: 'Destrokk', pickNumber: 0 });
    expect(res.status).toBe(200);
    expect((await prisma.lootSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('OPEN');
  });

  it('commodity units are marked delivered one at a time', async () => {
    const { session, agent, base } = await setup({ method: 'COMMODITY_DRAFT' });
    const line = await createLootItem(session.id, { name: 'Gold', quantity: 4, qualityLevel: 500 });
    expect((await agent.post(`${base}/commodity-roll`).send({})).status).toBe(200);
    const units = await unitsOf(line.id);
    const pick = units[2]!;

    const res = await agent.patch(`${base}/items/${line.id}/assign/delivered?assignmentId=${pick.id}`);
    expect(res.status).toBe(200);
    const after = await unitsOf(line.id);
    expect(after.filter((a) => a.delivered).map((a) => a.id)).toEqual([pick.id]);
  });
});
