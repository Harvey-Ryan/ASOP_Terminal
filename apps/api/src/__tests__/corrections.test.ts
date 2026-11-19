// v1.53.0: community corrections and their checks and balances.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import type { MiningDataDto } from '@dem/shared';
import { createUser, createGuild } from './factories.js';

const prisma = new PrismaClient();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asop-corrections-'));
let app: Express;
let mod: {
  useMiningDataForTests: (d: MiningDataDto | null) => void;
  resetCorrectionsRoutes: () => void;
  resetCorrectionsForTests: () => void;
};

const mining = (build: string, power = 2340): MiningDataDto => ({
  build,
  ores: [],
  spots: [],
  signatures: [{ rock: 'Laranite (Raw)', ore: 'laranite', method: 'ship', signature: 3825, maxCluster: 5, places: ['Wala'] }],
  lasers: [{ uuid: 'arbor', name: 'Arbor MH1 Mining Laser', maker: 'Greycat', size: 1, power, minPower: 117, extraction: 1850, optimalRange: 60, maxRange: 180, moduleSlots: 1, bespokeFor: null, modifiers: { Resistance: 25 } }],
  modules: [],
  gadgets: [],
} as unknown as MiningDataDto);

beforeAll(async () => {
  process.env['UPLOADS_DIR'] = dir;
  app = (await import('../server/app.js')).createServer();
  const gt = await import('../server/routes/gameTools.js');
  const routes = await import('../server/routes/corrections.js');
  const lib = await import('../lib/corrections.js');
  mod = { useMiningDataForTests: gt.useMiningDataForTests, resetCorrectionsRoutes: routes.resetCorrectionsRoutes, resetCorrectionsForTests: lib.resetCorrectionsForTests };
});
afterAll(() => { mod.useMiningDataForTests(null); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => {
  mod.useMiningDataForTests(mining('4.10.3-LIVE.1'));
  mod.resetCorrectionsRoutes();
  mod.resetCorrectionsForTests();
});

/** A signed-in person; members are in a server that has ASOP. */
async function person(name: string, opts: { member?: boolean; reviewer?: boolean } = {}) {
  const user = await createUser({ username: name, globalName: name.toUpperCase() });
  if (opts.member !== false) {
    const g = await createGuild();
    await prisma.guildMember.create({ data: { userId: user.id, guildId: g.id } });
  }
  if (opts.reviewer) await prisma.dataReviewer.create({ data: { discordId: user.discordId, username: name } });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [] });
  return { user, agent };
}

const EVIDENCE = '/uploads/corrections/123-abc.webp';
const submit = (agent: request.Agent, body: Record<string, unknown> = {}) =>
  agent.post('/api/corrections').send({ kind: 'mining-laser', recordKey: 'arbor', field: 'power', value: 2400, note: 'Checked at Lorville shop', evidenceUrl: EVIDENCE, ...body });

describe('corrections', () => {
  it('only members can submit, with a screenshot, an allowed stat and a sensible value; the game value comes from our data', async () => {
    const outsider = await person('outsider', { member: false });
    expect((await submit(outsider.agent).expect(403)).body.error).toMatch(/members/);
    await request(app).post('/api/corrections').send({}).expect(401);

    const rook = await person('rook');
    expect((await submit(rook.agent, { evidenceUrl: 'https://evil.example/x.png' }).expect(400)).body.error).toMatch(/screenshot/);
    expect((await submit(rook.agent, { field: 'name' }).expect(400)).body.error).toMatch(/can’t be corrected/);
    expect((await submit(rook.agent, { value: 2340 }).expect(400)).body.error).toMatch(/already say/);
    expect((await submit(rook.agent, { field: 'moduleSlots', value: 1.5 }).expect(400)).body.error).toMatch(/whole number/);
    await submit(rook.agent, { recordKey: 'nope' }).expect(404);

    const res = await submit(rook.agent, { gameValue: 1 }).expect(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', gameValue: 2340, value: 2400, credit: 'ROOK', recordName: 'Arbor MH1 Mining Laser', bigChange: false, mine: true });
    expect(res.body.data.actions).toEqual(['withdraw']);
    expect((await submit(rook.agent).expect(409)).body.error).toMatch(/already sent/);
  });

  it('needs two other members to confirm and an independent reviewer to approve; then it is live and credited', async () => {
    const rook = await person('rook');
    const a = await person('alpha');
    const b = await person('bravo', { reviewer: true });
    const rev = await person('rev', { reviewer: true });
    const id = (await submit(rook.agent).expect(201)).body.data.id;

    expect((await rook.agent.post(`/api/corrections/${id}/confirm`).expect(403)).body.error).toMatch(/your own/);
    await rev.agent.post(`/api/corrections/${id}/approve`).expect(403); // not confirmed yet
    await a.agent.post(`/api/corrections/${id}/confirm`).send({}).expect(200);
    await a.agent.post(`/api/corrections/${id}/confirm`).expect(403); // only once
    const ready = await b.agent.post(`/api/corrections/${id}/confirm`).send({ evidenceUrl: EVIDENCE }).expect(200);
    expect(ready.body.data.status).toBe('REVIEW');
    expect(await prisma.adminLog.count({ where: { kind: 'corrections.ready' } })).toBe(1);

    // A reviewer who confirmed it can't also approve it; the submitter can't either.
    expect((await b.agent.post(`/api/corrections/${id}/approve`).expect(403)).body.error).toMatch(/didn’t confirm/);
    const live = await rev.agent.post(`/api/corrections/${id}/approve`).send({ note: 'Screenshots match' }).expect(200);
    expect(live.body.data).toMatchObject({ status: 'LIVE', reviewer: 'rev', confirmations: 2 });
    expect(live.body.data.confirmers).toEqual(['alpha', 'bravo']); // reviewers see who confirmed

    const pub = await request(app).get('/api/corrections/live').expect(200);
    expect(pub.body.data.corrections).toEqual([expect.objectContaining({ kind: 'mining-laser', recordKey: 'arbor', field: 'power', gameValue: 2340, value: 2400, credit: 'ROOK', confirmations: 2, disputed: false })]);
    // Members who aren't reviewers see a count, not names.
    expect((await a.agent.get(`/api/corrections/${id}`).expect(200)).body.data.confirmers).toEqual([]);
  });

  it('credit can be declined', async () => {
    const rook = await person('rook');
    expect((await submit(rook.agent, { credit: false }).expect(201)).body.data.credit).toBeNull();
  });

  it('a big change must be acknowledged by the reviewer', async () => {
    const rook = await person('rook');
    const [a, b, rev] = [await person('a'), await person('b'), await person('rev', { reviewer: true })];
    const id = (await submit(rook.agent, { value: 9000 }).expect(201)).body.data.id;
    for (const p of [a, b]) await p.agent.post(`/api/corrections/${id}/confirm`).expect(200);
    expect((await rev.agent.post(`/api/corrections/${id}/approve`).expect(400)).body.error).toMatch(/big change/);
    await rev.agent.post(`/api/corrections/${id}/approve`).send({ acknowledgeBigChange: true }).expect(200);
  });

  it('a dispute keeps it shown but flagged; a reviewer reverts it with a reason', async () => {
    const rook = await person('rook');
    const [a, b, rev, critic] = [await person('a'), await person('b'), await person('rev', { reviewer: true }), await person('critic')];
    const id = (await submit(rook.agent).expect(201)).body.data.id;
    for (const p of [a, b]) await p.agent.post(`/api/corrections/${id}/confirm`).expect(200);
    await rev.agent.post(`/api/corrections/${id}/approve`).expect(200);

    await critic.agent.post(`/api/corrections/${id}/dispute`).send({}).expect(400); // needs a reason
    await critic.agent.post(`/api/corrections/${id}/dispute`).send({ note: 'Shop says 2340 after the hotfix' }).expect(200);
    await mod.resetCorrectionsRoutes();
    expect((await request(app).get('/api/corrections/live')).body.data.corrections[0].disputed).toBe(true);

    await critic.agent.post(`/api/corrections/${id}/revert`).send({ note: 'x' }).expect(403); // not a reviewer
    await rev.agent.post(`/api/corrections/${id}/revert`).send({ note: 'Hotfix confirmed' }).expect(200);
    expect((await request(app).get('/api/corrections/live')).body.data.corrections).toEqual([]);
    const history = (await rook.agent.get(`/api/corrections/${id}`)).body.data.history.map((h: { action: string }) => h.action);
    expect(history).toEqual(['submitted', 'confirmed', 'confirmed', 'approved', 'disputed', 'reverted']);
  });

  it('a new game build retires corrections CIG fixed and sends moved values back for a re-check', async () => {
    const rook = await person('rook');
    const [a, b, rev] = [await person('a'), await person('b'), await person('rev', { reviewer: true })];
    const ids: string[] = [];
    ids.push((await submit(rook.agent).expect(201)).body.data.id);
    ids.push((await submit(rook.agent, { field: 'extraction', value: 1900 }).expect(201)).body.data.id);
    for (const id of ids) {
      for (const p of [a, b]) await p.agent.post(`/api/corrections/${id}/confirm`).expect(200);
      await rev.agent.post(`/api/corrections/${id}/approve`).expect(200);
    }
    // 4.11: power fixed to 2400 (what was submitted); extraction moved to 2000.
    const next = mining('4.11.0-LIVE.2', 2400);
    (next.lasers[0] as { extraction: number }).extraction = 2000;
    mod.useMiningDataForTests(next);
    mod.resetCorrectionsRoutes();
    expect((await request(app).get('/api/corrections/live')).body.data.corrections).toEqual([]);
    const [power, extraction] = await Promise.all(ids.map((id) => prisma.dataCorrection.findUniqueOrThrow({ where: { id } })));
    expect(power).toMatchObject({ status: 'RETIRED', retiredBuild: '4.11.0-LIVE.2', creditName: 'ROOK' });
    expect(extraction!.status).toBe('RECHECK');
    // Approving the re-check makes the new game value the baseline.
    await rev.agent.post(`/api/corrections/${ids[1]}/approve`).expect(200);
    expect((await prisma.dataCorrection.findUniqueOrThrow({ where: { id: ids[1]! } })).gameValue).toBe(2000);
  });

  it('screenshots are re-encoded and stored under /uploads/corrections', async () => {
    const rook = await person('rook');
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#335577' } }).png().toBuffer();
    const res = await rook.agent.post('/api/corrections/evidence').attach('image', png, 'shot.png').expect(200);
    expect(res.body.data.url).toMatch(/^\/uploads\/corrections\/[\w-]+\.webp$/);
    expect(fs.existsSync(path.join(dir, 'corrections', path.basename(res.body.data.url)))).toBe(true);
    const outsider = await person('outsider', { member: false });
    await outsider.agent.post('/api/corrections/evidence').attach('image', png, 'shot.png').expect(403);
  });

  it('platform admins manage data reviewers', async () => {
    const admin = await createUser({ discordId: '1135606224155586571', username: 'boss' });
    const agent = request.agent(app);
    await agent.post('/test/login').send({ userId: admin.id, managedGuildIds: [] });
    const helper = await createUser({ username: 'helper' });
    const res = await agent.post('/api/admin/reviewers').send({ who: '@Helper' }).expect(200);
    expect(res.body.data).toEqual([expect.objectContaining({ discordId: helper.discordId, username: 'helper', addedBy: 'boss' })]);
    const role = await (async () => { const p = request.agent(app); await p.post('/test/login').send({ userId: helper.id, managedGuildIds: [] }); return (await p.get('/api/corrections/role')).body.data; })();
    expect(role).toMatchObject({ signedIn: true, reviewer: true, member: true });
    await agent.delete(`/api/admin/reviewers/${helper.discordId}`).expect(200);
    expect(await prisma.dataReviewer.count()).toBe(0);
  });
});
