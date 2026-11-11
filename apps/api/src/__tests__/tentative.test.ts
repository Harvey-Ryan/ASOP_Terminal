// v1.17.0: "Maybe" sign-ups.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

async function setup() {
  const guild = await createGuild();
  const ev = await createEvent(guild.guildId, 'host', { roles: JSON.stringify([{ id: 'p', name: 'Pilot', count: 1 }]) });
  const base = `/api/guilds/${guild.guildId}/events/${ev.id}`;
  const people = await Promise.all([1, 2, 3].map(async () => {
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
    return { id: user.discordId, agent };
  }));
  return { ev, base, people };
}

const row = (eventId: string, userId: string) => prisma.eventRsvp.findUnique({ where: { eventId_userId: { eventId, userId } } });

describe('maybe sign-ups', () => {
  it('a maybe is on the roster without a role; picking a role or Unassigned makes it a yes', async () => {
    const { ev, base, people: [a] } = await setup();
    const res = await a!.agent.put(`${base}/rsvp`).send({ role: null, tentative: true }).expect(200);
    expect(res.body.data.rsvps).toEqual([expect.objectContaining({ userId: a!.id, role: null, tentative: true })]);
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    expect(await row(ev.id, a!.id)).toMatchObject({ role: 'p', tentative: false });
    await a!.agent.put(`${base}/rsvp`).send({ role: null, tentative: true }).expect(200);
    await a!.agent.put(`${base}/rsvp`).send({ role: null }).expect(200);
    expect(await row(ev.id, a!.id)).toMatchObject({ role: null, tentative: false });
    // A role and "maybe" together is a role: maybes never hold a slot.
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p', tentative: true }).expect(200);
    expect(await row(ev.id, a!.id)).toMatchObject({ role: 'p', tentative: false });
  });

  it('going from a role to maybe frees the slot for the waitlist; a maybe leaves any line', async () => {
    const { ev, base, people: [a, b, c] } = await setup();
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await c!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    await c!.agent.put(`${base}/rsvp`).send({ role: null, tentative: true }).expect(200);
    expect(await prisma.eventWaitlist.count({ where: { eventId: ev.id, userId: c!.id } })).toBe(0);
    await a!.agent.put(`${base}/rsvp`).send({ role: null, tentative: true }).expect(200);
    expect(await row(ev.id, b!.id)).toMatchObject({ role: 'p', tentative: false });
    expect(await row(ev.id, a!.id)).toMatchObject({ role: null, tentative: true });
  });

  it('joining a waitlist turns a maybe into a yes', async () => {
    const { ev, base, people: [a, b] } = await setup();
    await a!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await b!.agent.put(`${base}/rsvp`).send({ role: null, tentative: true }).expect(200);
    await b!.agent.put(`${base}/waitlist`).send({ role: 'p' }).expect(200);
    expect(await row(ev.id, b!.id)).toMatchObject({ role: null, tentative: false });
  });

  it('officers can move people to and from Maybe', async () => {
    const { ev, base, people: [a, b] } = await setup();
    await b!.agent.put(`${base}/rsvp`).send({ role: 'p' }).expect(200);
    await a!.agent.patch(`${base}/rsvp/${b!.id}`).send({ role: null, tentative: true }).expect(200);
    expect(await row(ev.id, b!.id)).toMatchObject({ role: null, tentative: true });
    await a!.agent.patch(`${base}/rsvp/${b!.id}`).send({ role: 'p' }).expect(200);
    expect(await row(ev.id, b!.id)).toMatchObject({ role: 'p', tentative: false });
  });

  it('the calendar shows a maybe as tentative', async () => {
    const { ev, base, people: [a] } = await setup();
    await a!.agent.put(`${base}/rsvp`).send({ role: null, tentative: true }).expect(200);
    const token = (await a!.agent.get('/api/me/calendar')).body.data.token as string;
    const ics = (await request(app).get(`/api/calendar/${token}.ics`).expect(200)).text.replace(/\r\n /g, '');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('DESCRIPTION:You said maybe');
    expect(ev.id).toBeTruthy();
  });
});
