// v1.21.0: job board.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createGuildSettings } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

async function person(guildDiscordId: string) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: [guildDiscordId] });
  return { id: user.discordId, agent };
}

async function world() {
  const home = await createGuild({ name: 'ASOP' });
  const ally = await createGuild({ name: 'Northern Coalition' });
  const stranger = await createGuild({ name: 'Elsewhere' });
  const [a, b] = [home.id, ally.id].sort();
  await prisma.guildAlly.create({ data: { guildAId: a!, guildBId: b!, status: 'ACCEPTED', requestedByGuildId: home.id } });
  return { home, ally, stranger, poster: await person(home.guildId), mate: await person(home.guildId), allyMember: await person(ally.guildId), outsider: await person(stranger.guildId) };
}

const job = { kind: 'HAULING', title: 'Need a hauler', reward: '60k aUEC', whenText: 'Tonight', slots: 2 };
const board = async (p: { agent: request.Agent }, guildId: string) =>
  ((await p.agent.get(`/api/guilds/${guildId}/jobs`).expect(200)).body.data as { title: string }[]).map((j) => j.title);

describe('job board', () => {
  it('members post jobs; who sees them depends on the job', async () => {
    const w = await world();
    const post = (title: string, visibility: string) => w.poster.agent.post(`/api/guilds/${w.home.guildId}/jobs`).send({ ...job, title, visibility }).expect(201);
    const created = (await post('Server job', 'SERVER')).body.data;
    expect(created).toMatchObject({ title: 'Server job', guildName: 'ASOP', status: 'OPEN', crew: [], posterId: w.poster.id });
    await post('Ally job', 'ALLIES');
    await post('Global job', 'GLOBAL');
    expect((await board(w.mate, w.home.guildId)).sort()).toEqual(['Ally job', 'Global job', 'Server job']);
    expect((await board(w.allyMember, w.ally.guildId)).sort()).toEqual(['Ally job', 'Global job']);
    expect(await board(w.outsider, w.stranger.guildId)).toEqual(['Global job']);
    await w.outsider.agent.post(`/api/guilds/${w.stranger.guildId}/jobs/${created.id}/take`).expect(404);
    await w.poster.agent.post(`/api/guilds/${w.home.guildId}/jobs`).send({ kind: 'NOPE', title: 'x' }).expect(400);
  });

  it('taking fills the crew, never past the slots; leave, remove, done', async () => {
    const w = await world();
    const j = (await w.poster.agent.post(`/api/guilds/${w.home.guildId}/jobs`).send({ ...job, visibility: 'GLOBAL', slots: 1 }).expect(201)).body.data;
    const url = (g: string) => `/api/guilds/${g}/jobs/${j.id}`;
    expect((await w.poster.agent.post(`${url(w.home.guildId)}/take`).expect(409)).body.error).toMatch(/own job/);
    const results = await Promise.all([w.mate.agent.post(`${url(w.home.guildId)}/take`), w.outsider.agent.post(`${url(w.stranger.guildId)}/take`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.jobCrew.count({ where: { jobId: j.id } })).toBe(1);
    const taker = results[0]!.status === 200 ? w.mate : w.outsider;
    const takerGuild = taker === w.mate ? w.home.guildId : w.stranger.guildId;
    await taker.agent.post(`${url(takerGuild)}/leave`).expect(200);
    await w.mate.agent.post(`${url(w.home.guildId)}/take`).expect(200);
    const removed = await w.poster.agent.delete(`${url(w.home.guildId)}/crew/${w.mate.id}`).expect(200);
    expect(removed.body.data.crew).toEqual([]);
    await w.mate.agent.post(`${url(w.home.guildId)}/close`).send({ status: 'DONE' }).expect(403);
    const done = await w.poster.agent.post(`${url(w.home.guildId)}/close`).send({ status: 'DONE' }).expect(200);
    expect(done.body.data.status).toBe('DONE');
    expect(await board(w.mate, w.home.guildId)).toEqual([]);
    await w.mate.agent.post(`${url(w.home.guildId)}/take`).expect(409);
    const mine = (await w.poster.agent.get(`/api/guilds/${w.home.guildId}/jobs?view=mine`).expect(200)).body.data;
    expect(mine.map((x: { status: string }) => x.status)).toEqual(['DONE']);
  });

  it('the poster edits; expired jobs leave the board; the job board can be switched off', async () => {
    const w = await world();
    const j = (await w.poster.agent.post(`/api/guilds/${w.home.guildId}/jobs`).send(job).expect(201)).body.data;
    const edited = await w.poster.agent.put(`/api/guilds/${w.home.guildId}/jobs/${j.id}`).send({ ...job, title: 'Need two haulers' }).expect(200);
    expect(edited.body.data.title).toBe('Need two haulers');
    await w.mate.agent.put(`/api/guilds/${w.home.guildId}/jobs/${j.id}`).send(job).expect(403);
    await prisma.job.update({ where: { id: j.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await board(w.mate, w.home.guildId)).toEqual([]);
    await w.mate.agent.post(`/api/guilds/${w.home.guildId}/jobs/${j.id}/take`).expect(409);
    await createGuildSettings(w.stranger.id, { jobsEnabled: false });
    await w.outsider.agent.get(`/api/guilds/${w.stranger.guildId}/jobs`).expect(404);
  });
});
