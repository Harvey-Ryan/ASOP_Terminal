import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';
import { createUser } from './factories.js';
import { prisma } from '../lib/prisma.js';
import { parseHeadRef, forgetLastCheckForTests } from '../lib/gameDataCheck.js';

// "Check now" for the game data (v1.38.0): asks GitHub whether there's newer
// data, downloads and writes nothing; platform admins only.

const app = createServer();
const ADMIN = '1135606224155586571'; // PLATFORM_ADMIN_DISCORD_IDS default
const HELD = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);

async function signedIn(discordId?: string) {
  const user = discordId
    ? (await prisma.user.findUnique({ where: { discordId } })) ?? (await createUser({ discordId }))
    : await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return agent;
}

const refs = (sha: string) =>
  `001e# service=git-upload-pack\n0000015b${'c'.repeat(40)} HEAD\u0000multi_ack thin-pack\n003f${sha} refs/heads/master\n0041${'d'.repeat(40)} refs/heads/master-old\n0000`;

beforeEach(() => forgetLastCheckForTests());
afterEach(() => vi.restoreAllMocks());

describe('game data: check now', () => {
  it('reads the branch commit from git\'s ref list, and only that branch', () => {
    expect(parseHeadRef(refs(NEWER), 'master')).toBe(NEWER);
    expect(() => parseHeadRef(refs(NEWER), 'main')).toThrow(/not found/);
  });

  it('is for platform admins only', async () => {
    await request(app).post('/api/game-data/check').expect(401);
    const a = await signedIn();
    await a.post('/api/game-data/check').expect(403);
    await a.delete('/api/game-data/sync').expect(403);
  });

  it('says up to date when GitHub has the commit we hold, without asking for details', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(refs(HELD)));
    vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce([{ commit: HELD, build: '4.10.2-LIVE.1', committed_at: new Date('2026-10-28T20:20:55Z') }] as never);
    const a = await signedIn(ADMIN);
    const res = await a.post('/api/game-data/check').expect(200);
    expect(res.body.data).toMatchObject({ upToDate: true, upstreamCommit: HELD, upstreamBuild: '4.10.2-LIVE.1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('names the new build when GitHub has moved on', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (String(url).includes('api.github.com')
      ? new Response(JSON.stringify({ commit: { message: '4.11.0-LIVE.2\n\nmore', committer: { date: '2026-11-13T18:00:00Z' } } }))
      : new Response(refs(NEWER))));
    vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce([{ commit: HELD, build: '4.10.2-LIVE.1', committed_at: null }] as never);
    const a = await signedIn(ADMIN);
    const res = await a.post('/api/game-data/check').expect(200);
    expect(res.body.data).toMatchObject({ upToDate: false, upstreamCommit: NEWER, upstreamBuild: '4.11.0-LIVE.2', upstreamCommittedAt: '2026-11-13T18:00:00Z' });
    // a second click within 30 s reuses the answer
    await a.post('/api/game-data/check').expect(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('says so when GitHub can\'t be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 503 }));
    vi.spyOn(prisma, '$queryRawUnsafe').mockResolvedValueOnce([{ commit: HELD, build: null, committed_at: null }] as never);
    const a = await signedIn(ADMIN);
    const res = await a.post('/api/game-data/check').expect(502);
    expect(res.body.error).toMatch(/GitHub/);
  });
});
