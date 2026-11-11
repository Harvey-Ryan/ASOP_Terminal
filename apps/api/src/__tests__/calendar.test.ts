// v1.16.0: personal calendar feed of the events you signed up for.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

async function signedIn() {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return { user, agent };
}

const feedPath = (token: string) => `/api/calendar/${token}.ics`;
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('calendar feed', () => {
  it('gives each person one link, the same every time, until they reset it', async () => {
    const { agent } = await signedIn();
    const a = (await agent.get('/api/me/calendar').expect(200)).body.data.token as string;
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await agent.get('/api/me/calendar').expect(200)).body.data.token).toBe(a);
    const b = (await agent.post('/api/me/calendar/reset').expect(200)).body.data.token as string;
    expect(b).not.toBe(a);
    await request(app).get(feedPath(a)).expect(404);
    await request(app).get(feedPath(b)).expect(200);
    await request(app).get('/api/me/calendar').expect(401);
  });

  it('lists the events you signed up for, with your role and place in line', async () => {
    const { user, agent } = await signedIn();
    const token = (await agent.get('/api/me/calendar')).body.data.token as string;
    const g = await createGuild({ name: 'Northern Coalition' });
    const start = new Date('2030-01-05T20:00:00Z');
    const roles = JSON.stringify([{ id: 'p', name: 'Pilot', count: 1 }, { id: 'm', name: 'Miner', count: 4 }]);
    const mine = await createEvent(g.guildId, 'host', { name: 'Mining op, Aaron Halo', roles, startTime: start, musterPoint: 'Lorville', threadId: 't1', description: 'Bring a MOLE' });
    const waiting = await createEvent(g.guildId, 'host', { name: 'Escort run', roles, startTime: new Date('2030-01-06T20:00:00Z'), endTime: new Date('2030-01-06T23:00:00Z') });
    const notMine = await createEvent(g.guildId, 'host', { name: 'Not signed up', startTime: start });
    const cancelled = await createEvent(g.guildId, 'host', { name: 'Called off', startTime: start, status: 'CANCELLED' });
    const old = await createEvent(g.guildId, 'host', { name: 'Last year', startTime: new Date('2020-01-01T00:00:00Z'), status: 'COMPLETED' });
    await prisma.eventRsvp.createMany({ data: [
      { eventId: mine.id, userId: user.discordId, username: 'me', role: 'm' },
      { eventId: waiting.id, userId: user.discordId, username: 'me', role: null },
      { eventId: waiting.id, userId: 'someone', username: 'x', role: 'p' },
      { eventId: waiting.id, userId: 'ahead', username: 'y', role: null },
      { eventId: notMine.id, userId: 'someone', username: 'x', role: null },
      { eventId: cancelled.id, userId: user.discordId, username: 'me', role: null },
      { eventId: old.id, userId: user.discordId, username: 'me', role: null },
    ] });
    await prisma.eventWaitlist.createMany({ data: [
      { eventId: waiting.id, userId: 'ahead', role: 'p', guildId: g.guildId },
      { eventId: waiting.id, userId: user.discordId, role: 'p', guildId: g.guildId },
    ] });

    const res = await request(app).get(feedPath(token)).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    const ics = unfold(res.text);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('SUMMARY:Mining op\\, Aaron Halo');
    expect(ics).toContain('DTSTART:20300105T200000Z');
    expect(ics).toContain('DTEND:20300105T220000Z'); // no end time: two hours
    expect(ics).toContain('LOCATION:Lorville');
    expect(ics).toContain('Your role: Miner\\nServer: Northern Coalition\\n\\nBring a MOLE');
    expect(ics).toContain(`URL:https://discord.com/channels/${g.guildId}/t1`);
    expect(ics).toContain('DTEND:20300106T230000Z');
    expect(ics).toContain('Your role: Unassigned\\nWaiting for Pilot (#2 in line)');
    expect(ics).not.toContain('Not signed up');
    expect(ics).not.toContain('Called off');
    expect(ics).not.toContain('Last year');
  });

  it('a made-up or malformed link finds nothing', async () => {
    await request(app).get(feedPath('x'.repeat(32))).expect(404);
    await request(app).get(feedPath('short')).expect(404);
  });
});
