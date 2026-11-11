// v1.12.0: Completed shows every past event, 50 at a time.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

describe('completed events, page by page', () => {
  it('pages through all of them newest first, without gaps or repeats, even with equal start times', async () => {
    const guild = await createGuild();
    const user = await createUser();
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guild.guildId] });
    // 63 past events; three share each start time, so ties cross page boundaries.
    const base = Date.now() - 365 * 86400_000;
    await prisma.event.createMany({ data: Array.from({ length: 63 }, (_, i) => ({
      guildId: guild.guildId, name: `Op ${i}`, startTime: new Date(base + Math.floor(i / 3) * 86400_000), createdById: 'u', status: 'COMPLETED',
    })) });
    await prisma.event.create({ data: { guildId: guild.guildId, name: 'Upcoming', startTime: new Date(Date.now() + 86400_000), createdById: 'u', status: 'PENDING' } });

    const url = `/api/guilds/${guild.guildId}/events?completed=true`;
    const p1 = (await agent.get(url).expect(200)).body.data as { id: string; name: string; startTime: string }[];
    expect(p1).toHaveLength(50);
    const p2 = (await agent.get(`${url}&after=${p1[49]!.id}`).expect(200)).body.data as typeof p1;
    expect(p2).toHaveLength(13);
    const all = [...p1, ...p2];
    expect(new Set(all.map((e) => e.id)).size).toBe(63);
    expect(all.some((e) => e.name === 'Upcoming')).toBe(false);
    const times = all.map((e) => Date.parse(e.startTime));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect((await agent.get(`${url}&after=${p2[12]!.id}`).expect(200)).body.data).toEqual([]);
  });
});
