// v1.12.0: role slots are checked when signing up, so a role can't overfill.
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
  return { user, agent };
}

async function eventWithRoles(roles: unknown[]) {
  const guild = await createGuild();
  const ev = await createEvent(guild.guildId, 'host', { roles: JSON.stringify(roles) });
  return { guild, ev, url: `/api/guilds/${guild.guildId}/events/${ev.id}/rsvp` };
}

describe('role limits on sign-up', () => {
  it('the last slot goes to one person; the next is told it filled up', async () => {
    const { guild, url } = await eventWithRoles([{ id: 'r1', name: 'Pilot', count: 1 }]);
    const a = await member(guild.guildId);
    const b = await member(guild.guildId);
    await a.agent.put(url).send({ role: 'r1' }).expect(200);
    const res = await b.agent.put(url).send({ role: 'r1' }).expect(409);
    expect(res.body.error).toBe('That role just filled up. Pick another one.');
    // Someone already in the role can sign up for it again (nothing changes), and anyone can go Unassigned.
    await a.agent.put(url).send({ role: 'r1' }).expect(200);
    await b.agent.put(url).send({ role: null }).expect(200);
  });

  it('two people clicking the last slot at the same moment: exactly one gets it', async () => {
    const { guild, ev, url } = await eventWithRoles([{ id: 'r1', name: 'Pilot', count: 1 }]);
    const people = await Promise.all([1, 2, 3, 4].map(() => member(guild.guildId)));
    const results = await Promise.all(people.map((p) => p.agent.put(url).send({ role: 'r1' })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await prisma.eventRsvp.count({ where: { eventId: ev.id, role: 'r1' } })).toBe(1);
  });

  it('a role for another server\'s members, and a role that no longer exists, are refused', async () => {
    const { guild, url } = await eventWithRoles([{ id: 'r1', name: 'Pilot', count: 5, guildId: 'some-other-server' }]);
    const a = await member(guild.guildId);
    expect((await a.agent.put(url).send({ role: 'r1' }).expect(400)).body.error).toMatch(/another server/);
    expect((await a.agent.put(url).send({ role: 'gone' }).expect(400)).body.error).toMatch(/no longer on this event/);
  });
});
