// v1.11.3: an error in a route answers 500 instead of stopping the API (and the bot with it).
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createGuildSettings, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

describe('errors in routes', () => {
  it('an async route that fails answers 500 with JSON, and the API keeps answering', async () => {
    const guild = await createGuild();
    await createGuildSettings(guild.id);
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
    // The signed-in user disappears, so the route's findUniqueOrThrow rejects.
    await prisma.user.delete({ where: { id: user.id } });

    const ev = await createEvent(guild.guildId, 'someone');
    // RSVP has no try/catch of its own: before v1.11.3 this stopped the process.
    const res = await agent.put(`/api/guilds/${guild.guildId}/events/${ev.id}/rsvp`).send({ role: null });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Something went wrong. Please try again.' });

    await request(app).get('/api/health').expect(200);
  });

  it('a malformed JSON body is a 400 with the reason, not an HTML page', async () => {
    const res = await request(app).post('/api/auth/logout').set('Content-Type', 'application/json').send('{"oops"');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(false);
  });

  it('unknown API paths are still a 404', async () => {
    await request(app).get('/api/nope').expect(404);
  });
});
