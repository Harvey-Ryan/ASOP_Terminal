// v1.20.0: server tags on shared events.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createGuildSettings, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

describe('joint ops: server tags', () => {
  it('a shared event carries each server\'s tag; sign-ups remember their server', async () => {
    const host = await createGuild({ name: 'ASOP' });
    const ally = await createGuild({ name: 'Northern Coalition' });
    await createGuildSettings(ally.id, { allianceTag: 'NC' });
    const ev = await createEvent(host.guildId, 'host', { roles: JSON.stringify([{ id: 'p', name: 'Pilot', count: 4 }]) });
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [host.guildId, ally.guildId] });

    // Not shared yet: no tags.
    expect((await agent.get(`/api/guilds/${host.guildId}/events/${ev.id}`).expect(200)).body.data.serverTags).toBeUndefined();

    await prisma.eventGuildShare.create({ data: { eventId: ev.id, guildId: ally.id, status: 'ACCEPTED', sourceType: 'DIRECT' } });
    const res = await agent.put(`/api/guilds/${ally.guildId}/events/${ev.id}/rsvp`).send({ role: 'p' }).expect(200);
    expect(res.body.data.serverTags).toEqual({ [host.guildId]: 'ASOP', [ally.guildId]: 'NC' });
    expect(res.body.data.rsvps).toEqual([expect.objectContaining({ userId: user.discordId, guildId: ally.guildId })]);
    const seen = (await agent.get(`/api/guilds/${host.guildId}/events/${ev.id}`).expect(200)).body.data;
    expect(seen.serverTags[ally.guildId]).toBe('NC');
  });
});
