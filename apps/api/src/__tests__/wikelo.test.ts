// v1.34.0: Wikelo's missions and each person's own turn-in checklist.
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { useWikeloDataForTests } from '../server/routes/wikelo.js';
import { createUser } from './factories.js';
import type { WikeloDataDto, WikeloMission } from '@dem/shared';

const app = createServer();
const prisma = new PrismaClient();
const hasScData = process.env['DATABASE_URL']?.includes('asop_sc');

const f7: WikeloMission = {
  id: 'test-f7', title: 'Wikelo Navy F7', category: 'ships', rewards: [[{ name: 'Anvil F7 Hornet Mk Wikelo', amount: 1 }]],
  turnIn: [
    { key: 'favor', name: 'Wikelo Favor', amount: 16, scu: null },
    { key: 'board', name: 'DCHS-05 Orbital Positioning Comp-Board', amount: 3, scu: null },
  ],
  favors: 16, description: 'Bring me things.', stations: ['Kinga Station'], onceOnly: false, shareable: false,
};
const fake: WikeloDataDto = { build: 'test', missions: [f7] };

async function signedIn() {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return { user, agent };
}

describe('Wikelo checklist', () => {
  afterAll(() => useWikeloDataForTests(null));

  it('needs a signed-in person', async () => {
    useWikeloDataForTests(fake);
    await request(app).get('/api/wikelo').expect(401);
    await request(app).get('/api/me/wikelo').expect(401);
  });

  it('ticks are saved per person and never show to anyone else', async () => {
    useWikeloDataForTests(fake);
    const a = await signedIn();
    const b = await signedIn();
    const missions = (await a.agent.get('/api/wikelo').expect(200)).body.data.missions;
    expect(missions).toHaveLength(1);

    // Unknown keys are dropped; a ticked item is kept.
    const saved = (await a.agent.put('/api/me/wikelo/test-f7').send({ ticked: ['favor', 'nope', 'favor'], completed: false }).expect(200)).body.data;
    expect(saved).toEqual({ missionId: 'test-f7', ticked: ['favor'], completedAt: null });
    expect((await a.agent.get('/api/me/wikelo').expect(200)).body.data).toEqual([saved]);
    expect((await b.agent.get('/api/me/wikelo').expect(200)).body.data).toEqual([]);
    // Someone else's ticks don't change the mission everyone sees.
    expect((await b.agent.get('/api/wikelo').expect(200)).body.data.missions[0]).toEqual(missions[0]);
  });

  it('complete keeps its first time; clearing everything forgets the mission', async () => {
    useWikeloDataForTests(fake);
    const a = await signedIn();
    const done = (await a.agent.put('/api/me/wikelo/test-f7').send({ ticked: ['favor', 'board'], completed: true }).expect(200)).body.data;
    expect(done.completedAt).toBeTruthy();
    const again = (await a.agent.put('/api/me/wikelo/test-f7').send({ ticked: ['favor'], completed: true }).expect(200)).body.data;
    expect(again.completedAt).toBe(done.completedAt);
    await a.agent.put('/api/me/wikelo/test-f7').send({ ticked: [], completed: false }).expect(200);
    expect(await prisma.wikeloProgress.count({ where: { discordId: a.user.discordId } })).toBe(0);
  });

  it('refuses unknown missions and bad bodies', async () => {
    useWikeloDataForTests(fake);
    const a = await signedIn();
    await a.agent.put('/api/me/wikelo/not-a-mission').send({ ticked: [], completed: true }).expect(404);
    await a.agent.put('/api/me/wikelo/test-f7').send({ ticked: 'favor', completed: true }).expect(400);
    await a.agent.put('/api/me/wikelo/test-f7').send({ ticked: [] }).expect(400);
  });
});

describe.skipIf(!hasScData)('Wikelo missions from sc-data', () => {
  it('every released mission, with what to turn in', async () => {
    useWikeloDataForTests(null);
    const a = await signedIn();
    const d = (await a.agent.get('/api/wikelo').expect(200)).body.data as WikeloDataDto;
    expect(d.missions.length).toBeGreaterThan(50);
    const f = d.missions.find((m) => m.title === 'Wikelo Navy F7')!;
    expect(f.turnIn.find((t) => t.name === 'Wikelo Favor')?.amount).toBe(16);
    expect(f.stations).toContain('Kinga Station');
    const atls = d.missions.find((m) => m.title === 'ATLS Orange Line')!;
    expect(atls.turnIn.find((t) => t.name === 'Quantainium')).toMatchObject({ scu: 36, amount: null });
    expect(d.missions.every((m) => m.turnIn.length > 0)).toBe(true);
  });
});
