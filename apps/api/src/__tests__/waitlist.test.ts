// v1.14.0: waitlists for full roles.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

async function member(guildDiscordId: string) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guildDiscordId] });
  return { id: user.discordId, agent };
}

async function setup(roles: unknown[], extra: Record<string, unknown> = {}) {
  const guild = await createGuild();
  const ev = await createEvent(guild.guildId, 'host', { roles: JSON.stringify(roles), ...extra });
  const base = `/api/guilds/${guild.guildId}/events/${ev.id}`;
  const people = await Promise.all([1, 2, 3, 4].map(() => member(guild.guildId)));
  return { guild, ev, base, people };
}

const roleOf = async (eventId: string, userId: string) =>
  (await prisma.eventRsvp.findUnique({ where: { eventId_userId: { eventId, userId } } }))?.role;
const line = async (eventId: string) =>
  (await prisma.eventWaitlist.findMany({ where: { eventId }, orderBy: { id: 'asc' } })).map((w) => `${w.userId}:${w.role}`);

const PILOT = { id: 'p', name: 'Pilot', count: 1 };
const MINER = { id: 'm', name: 'Miner', count: 2 };

describe('role waitlist', () => {
  it('joining a full role\'s line puts you on the roster and in line, in order', async () => {
    const { ev, base, people: [a, b, c] } = await setup([PILOT]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    const res = await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    expect(await roleOf(ev.id, b!.id)).toBeNull(); // on the roster, Unassigned
    await c!.agent.put(`${base}/waitlist`).send({ role: 'Pilot' }).expect(200); // old events use names
    expect(await line(ev.id)).toEqual([`${b!.id}:p`, `${c!.id}:p`]);
    expect(res.body.data.waitlist).toEqual([{ userId: b!.id, username: expect.any(String), role: 'p' }]);
    // Joining again changes nothing (keeps your place).
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    expect(await line(ev.id)).toEqual([`${b!.id}:p`, `${c!.id}:p`]);
  });

  it('refuses a role with a free slot, one you have, another server\'s and a missing one', async () => {
    const { base, people: [a, b] } = await setup([PILOT, MINER, { id: 'x', name: 'Medic', count: 0, guildId: 'other' }]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    expect((await b!.agent.put(`${base}/waitlist`).send({ role: 'm' }).expect(409)).body.error).toMatch(/free slot/);
    expect((await a!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(409)).body.error).toMatch(/already have/);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'x' }).expect(400);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'gone' }).expect(400);
    await b!.agent.put(`${base}/waitlist`).send({}).expect(400);
  });

  it('leaving a role moves the first in line in; their old role goes to the next line (chain)', async () => {
    const { ev, base, people: [a, b, c, d] } = await setup([PILOT, MINER]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/rsvp`).send({ role: 'm' }).expect(200);
    await c!.agent.put(`${base}/rsvp`).send({ role: 'm' }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200); // b keeps Miner while waiting
    await d!.agent.put(`${base}/waitlist`).send({ role: 'm' }).expect(200);
    expect(await roleOf(ev.id, b!.id)).toBe('m');

    const res = await a!.agent.put(`${base}/rsvp`).send({ role: null }).expect(200);
    expect(await roleOf(ev.id, b!.id)).toBe('p');
    expect(await roleOf(ev.id, d!.id)).toBe('m');
    expect(await line(ev.id)).toEqual([]);
    expect(res.body.data.waitlist).toEqual([]);
  });

  it('leaving the roster lets the next in; a person leaving the roster leaves the line too', async () => {
    const { ev, base, people: [a, b, c] } = await setup([PILOT]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await c!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await b!.agent.delete(`${base}/rsvp`).expect(200);
    expect(await line(ev.id)).toEqual([`${c!.id}:p`]);
    await a!.agent.delete(`${base}/rsvp`).expect(200);
    expect(await roleOf(ev.id, c!.id)).toBe('p');
  });

  it('two people leaving at once fill each slot once, in line order', async () => {
    const { ev, base, people: [a, b, c, d] } = await setup([MINER]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'm' }).expect(200);
    await b!.agent.put(`${base}/rsvp`).send({ role: 'm' }).expect(200);
    await c!.agent.put(`${base}/waitlist`).send({ role: 'm' }).expect(200);
    await d!.agent.put(`${base}/waitlist`).send({ role: 'm' }).expect(200);
    await Promise.all([a!.agent.delete(`${base}/rsvp`), b!.agent.put(`${base}/rsvp`).send({ role: null })]);
    expect(await prisma.eventRsvp.count({ where: { eventId: ev.id, role: 'm' } })).toBe(2);
    expect(await roleOf(ev.id, c!.id)).toBe('m');
    expect(await roleOf(ev.id, d!.id)).toBe('m');
  });

  it('waiting for another role moves you to the back of that line; leaving the line keeps your roster spot', async () => {
    const { ev, base, people: [a, b, c, d] } = await setup([PILOT, { ...MINER, count: 1 }]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/rsvp`).send({ role: 'm' }).expect(200);
    await c!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await d!.agent.put(`${base}/waitlist`).send({ role: 'm' }).expect(200);
    await c!.agent.put(`${base}/waitlist`).send({ role: 'm' }).expect(200);
    expect(await line(ev.id)).toEqual([`${d!.id}:m`, `${c!.id}:m`]);
    await d!.agent.delete(`${base}/waitlist`).expect(200);
    expect(await line(ev.id)).toEqual([`${c!.id}:m`]);
    expect(await roleOf(ev.id, d!.id)).toBeNull();
  });

  it('officers moving someone out, or adding slots, let people in; a removed role empties its line', async () => {
    const { guild, ev, base, people: [a, b, c] } = await setup([PILOT, MINER]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await c!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);

    await a!.agent.patch(`${base}/rsvp/${a!.id}`).send({ role: 'm' }).expect(200);
    expect(await roleOf(ev.id, b!.id)).toBe('p');

    await a!.agent.patch(base).send({ roles: [{ ...PILOT, count: 2 }, MINER] }).expect(200);
    expect(await roleOf(ev.id, c!.id)).toBe('p');

    // Removing a role: its people go to Unassigned (by id), and nobody waits for it any more.
    await prisma.eventWaitlist.create({ data: { eventId: ev.id, userId: a!.id, role: 'p', guildId: guild.guildId } });
    await a!.agent.patch(base).send({ roles: [MINER] }).expect(200);
    expect(await roleOf(ev.id, b!.id)).toBeNull();
    expect(await line(ev.id)).toEqual([]);
  });

  it('renamed roles keep their people; roles saved by name carry over to their new id', async () => {
    const { ev, base, people: [a, b] } = await setup([{ name: 'Pilot', count: 1 }]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'Pilot' }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'Pilot' }).expect(200);
    await a!.agent.patch(base).send({ roles: [{ id: 'p', name: 'Pilot', count: 1 }] }).expect(200);
    expect(await roleOf(ev.id, a!.id)).toBe('p');
    expect(await line(ev.id)).toEqual([`${b!.id}:p`]);
    await a!.agent.patch(base).send({ roles: [{ id: 'p', name: 'Lead pilot', count: 1 }] }).expect(200);
    expect(await roleOf(ev.id, a!.id)).toBe('p');
    expect(await line(ev.id)).toEqual([`${b!.id}:p`]);
  });

  it('a role limited to one server only takes its members from the line', async () => {
    const { guild, ev, base, people: [a, b] } = await setup([{ id: 'p', name: 'Pilot', count: 1, guildId: 'ally' }]);
    await prisma.eventRsvp.createMany({ data: [
      { eventId: ev.id, userId: a!.id, username: 'a', role: 'p' },
      { eventId: ev.id, userId: b!.id, username: 'b', role: null },
      { eventId: ev.id, userId: 'ally-1', username: 'ally', role: null },
    ] });
    await prisma.eventWaitlist.createMany({ data: [
      { eventId: ev.id, userId: b!.id, role: 'p', guildId: guild.guildId },
      { eventId: ev.id, userId: 'ally-1', role: 'p', guildId: 'ally' },
    ] });
    await a!.agent.delete(`${base}/rsvp`).expect(200);
    expect(await roleOf(ev.id, 'ally-1')).toBe('p');
    expect(await roleOf(ev.id, b!.id)).toBeNull();
  });

  it('nobody moves in once the event has ended', async () => {
    const { ev, base, people: [a, b] } = await setup([PILOT]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await prisma.event.update({ where: { id: ev.id }, data: { status: 'ENDED' } });
    await a!.agent.delete(`${base}/rsvp`).expect(200);
    expect(await roleOf(ev.id, b!.id)).toBeNull();
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(409);
  });

  it('officers can only change rosters of their own server\'s events', async () => {
    const { ev, people: [a] } = await setup([PILOT]);
    const other = await createGuild();
    const officer = await member(other.guildId);
    await prisma.eventRsvp.create({ data: { eventId: ev.id, userId: a!.id, username: 'a', role: 'p' } });
    await officer.agent.patch(`/api/guilds/${other.guildId}/events/${ev.id}/rsvp/${a!.id}`).send({ role: null }).expect(404);
    expect(await roleOf(ev.id, a!.id)).toBe('p');
  });
});
