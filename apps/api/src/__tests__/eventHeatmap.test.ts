// v1.24.0: the event planning heat map follows the member-history rules.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { prisma } from '../lib/prisma.js';
import { createUser, createGuild, createEvent } from './factories.js';
import { localSlot } from '@dem/shared';

const app = createServer();

describe('event heat map', () => {
  it('averages recorded turnout per event in the viewer\'s time zone', async () => {
    const g = await createGuild();
    process.env['ACTIVITY_SERVER_IDS'] = g.guildId;
    const officer = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: officer.id, managedGuildIds: [g.guildId] });
    // Saturday 8 PM in Chicago, last week
    const sat = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 86_400_000);
    while (localSlot(sat, 'America/Chicago').day !== 6 || localSlot(sat, 'America/Chicago').hour !== 20) sat.setTime(sat.getTime() - 3_600_000);
    const recorded = await createEvent(g.guildId, 'host', { startTime: sat, status: 'COMPLETED', confirmedAttendees: JSON.stringify(['a', 'b', 'walk']) });
    await createEvent(g.guildId, 'host', { startTime: sat, status: 'COMPLETED' }); // nothing recorded
    await prisma.eventRsvp.createMany({ data: ['a', 'b', 'c', 'd'].map((userId) => ({ eventId: recorded.id, userId, username: userId, role: null })) });

    const d = (await agent.get(`/api/guilds/${g.guildId}/heatmap/events?days=30&timezone=America/Chicago`).expect(200)).body.data;
    expect(d.attendanceGrid[6][20]).toBe(3);
    expect(d.ratioGrid[6][20]).toBe(0.5);
    expect(d.eventCount).toBe(1);
    expect(d.notRecorded).toBe(1);
    await agent.get(`/api/guilds/${g.guildId}/heatmap/events?timezone=Mars/Olympus`).expect(400);
  });
});
