// v1.59.0: download button clicks (RockCrawler), counted per day and page,
// shown to platform admins on Admin → Overview.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { utcDay } from '@dem/shared';
import { createServer } from '../server/app.js';
import { forgetDownloadClicks } from '../server/routes/gameTools.js';
import { createUser } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();
const ADMIN_DISCORD_ID = '1135606224155586571'; // PLATFORM_ADMIN_DISCORD_IDS in vitest.config.ts

let n = 0;
async function signedIn(discordId?: string) {
  const user = await createUser({ discordId: discordId ?? `6100000000000000${String(++n).padStart(2, '0')}` });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id });
  return agent;
}
const click = (source: unknown, item = 'rockcrawler') =>
  request(app).post(`/api/game-tools/downloads/${item}`).send({ source });

beforeEach(() => forgetDownloadClicks());

describe('counting clicks', () => {
  it('anyone can count one, signed out included; nothing about them is stored', async () => {
    await click('tools').expect(204);
    const rows = await prisma.downloadClick.findMany();
    expect(rows).toEqual([{ item: 'rockcrawler', day: utcDay(new Date()), source: 'tools', count: 1 }]);
  });

  it('the same visitor clicking again soon is counted once', async () => {
    await click('tools').expect(204);
    await click('tools').expect(204);
    await click('dashboard').expect(204);
    const rows = await prisma.downloadClick.findMany();
    expect(rows.reduce((t, r) => t + r.count, 0)).toBe(1);
  });

  it('different visitors each count, per page', async () => {
    // Tests run without `trust proxy`, so every request has the same address:
    // forget between clicks to stand in for different visitors.
    await click('tools').expect(204);
    forgetDownloadClicks();
    await click('tools').expect(204);
    forgetDownloadClicks();
    await click('dashboard').expect(204);
    const rows = await prisma.downloadClick.findMany({ orderBy: { source: 'asc' } });
    expect(rows.map((r) => [r.source, r.count])).toEqual([
      ['dashboard', 1],
      ['tools', 2],
    ]);
  });

  it('unknown items and pages are refused and not counted', async () => {
    await click('tools', 'not-a-thing').expect(400);
    await click('elsewhere').expect(400);
    await click(undefined).expect(400);
    expect(await prisma.downloadClick.count()).toBe(0);
  });
});

describe('the admin summary', () => {
  it('platform admins only (404 for others, 401 signed out)', async () => {
    await request(app).get('/api/admin/downloads/rockcrawler').expect(401);
    const other = await signedIn();
    await other.get('/api/admin/downloads/rockcrawler').expect(404);
  });

  it('adds up today, the last 7 and 30 days and all time, by page', async () => {
    const day = (ago: number) => utcDay(new Date(Date.now() - ago * 86_400_000));
    await prisma.downloadClick.createMany({
      data: [
        { item: 'rockcrawler', day: day(0), source: 'tools', count: 3 },
        { item: 'rockcrawler', day: day(0), source: 'dashboard', count: 1 },
        { item: 'rockcrawler', day: day(10), source: 'tools', count: 5 },
        { item: 'rockcrawler', day: day(45), source: 'dashboard', count: 2 },
      ],
    });
    const admin = await signedIn(ADMIN_DISCORD_ID);
    const res = await admin.get('/api/admin/downloads/rockcrawler').expect(200);
    const s = res.body.data;
    expect([s.today, s.last7d, s.last30d, s.allTime]).toEqual([4, 4, 9, 11]);
    expect(s.bySource).toEqual({ tools: 8, dashboard: 3 });
    expect(s.since).toBe(day(45));
    expect(s.days).toHaveLength(30);
    expect(s.days.at(-1)).toEqual({ day: day(0), total: 4, tools: 3, dashboard: 1 });
    await admin.get('/api/admin/downloads/not-a-thing').expect(404);
  });
});
