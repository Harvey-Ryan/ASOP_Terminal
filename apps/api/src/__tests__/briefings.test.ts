// v1.36.0: mission briefings — drafts for editors, published for viewers,
// allies and people on the roster; the roster summary follows the objective.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../server/app.js';
import { createUser, createGuild, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

async function login(managed: string[]) {
  const user = await createUser();
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: managed });
  return { id: user.discordId, agent };
}

async function setup() {
  const g = await createGuild();
  await prisma.guildSettings.create({ data: { guildId: g.id, logoUrl: '/uploads/g/logo.png' } });
  const officer = await login([g.guildId]);
  const onRoster = await login([]);
  const stranger = await login([]);
  const ev = await createEvent(g.guildId, 'host');
  await prisma.eventRsvp.create({ data: { eventId: ev.id, userId: onRoster.id, username: 'Kade', role: null } });
  return { g, ev, base: `/api/guilds/${g.guildId}/events/${ev.id}/briefing`, officer, onRoster, stranger };
}

const content = {
  objective: '  Retake the hangars.  ',
  facts: [{ label: 'Form up', value: 'Ruin Station' }],
  sections: [
    { id: 'a', kind: 'text', title: 'Situation', body: '- Two Hulls\n- One gunship', imageUrl: 'https://x/y.png' },
    { id: 'b', kind: 'image', title: 'Map', body: '', imageUrl: 'javascript:alert(1)' },
    { id: 'a', kind: 'weird', title: 'Dup', body: 'x' },
  ],
  appearance: { watermark: 'TILED', watermarkStrength: 99, banner: 'ORG ONLY', logoUrl: '/uploads/g/other.png', extra: 1 },
  injected: true,
};

describe('briefings', () => {
  it('a draft is the editors\' alone; publishing shows it to the roster and puts it on Discord', async () => {
    const { ev, base, officer, onRoster, stranger } = await setup();
    const empty = (await officer.agent.get(base).expect(200)).body.data;
    expect(empty).toMatchObject({ briefing: null, canEdit: true, logos: [expect.objectContaining({ logoUrl: '/uploads/g/logo.png' })] });

    const saved = (await officer.agent.put(base).send({ content }).expect(200)).body.data;
    expect(saved.publishedAt).toBeNull();
    expect(saved.content.objective).toBe('Retake the hangars.');
    expect(saved.content.sections.map((s: { id: string; kind: string; imageUrl: string | null }) => [s.kind, s.imageUrl])).toEqual([['text', null], ['image', null], ['text', null]]);
    expect(new Set(saved.content.sections.map((s: { id: string }) => s.id)).size).toBe(3);
    expect(saved.content.appearance).toMatchObject({ watermark: 'TILED', watermarkStrength: 30, banner: 'ORG ONLY', logoUrl: '/uploads/g/other.png' });
    expect(saved.content.appearance.extra).toBeUndefined();

    // Draft: on the roster but not an editor → nothing yet; a stranger → 403.
    expect((await onRoster.agent.get(base).expect(200)).body.data).toMatchObject({ briefing: null, canEdit: false });
    await stranger.agent.get(base).expect(403);
    await onRoster.agent.put(base).send({ content }).expect(403);
    await onRoster.agent.post(`${base}/publish`).send({ published: true }).expect(403);

    const pub = (await officer.agent.post(`${base}/publish`).send({ published: true }).expect(200)).body.data;
    expect(pub.publishedAt).toBeTruthy();
    expect((await onRoster.agent.get(base).expect(200)).body.data.briefing.content.objective).toBe('Retake the hangars.');
    let row = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(row.briefingPublishedAt).toBeTruthy();
    expect(row.briefingSummary).toBe('Retake the hangars.');

    // Editing the objective of a published briefing updates the roster summary.
    await officer.agent.put(base).send({ content: { ...content, objective: 'Hold the hangars.' } }).expect(200);
    row = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(row.briefingSummary).toBe('Hold the hangars.');

    await officer.agent.post(`${base}/publish`).send({ published: false }).expect(200);
    row = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect([row.briefingPublishedAt, row.briefingSummary]).toEqual([null, null]);
    expect((await onRoster.agent.get(base).expect(200)).body.data.briefing).toBeNull();
  });

  it('allies who accepted the share can read it (their logo too) but not edit; past briefings can be copied', async () => {
    const { g, ev, base, officer } = await setup();
    const ally = await createGuild();
    await prisma.guildSettings.create({ data: { guildId: ally.id, allianceTag: 'VNGD', logoUrl: 'https://cdn.example/vngd.png' } });
    await prisma.eventGuildShare.create({ data: { eventId: ev.id, guildId: ally.id, sourceType: 'DIRECT', status: 'ACCEPTED' } });
    await officer.agent.put(base).send({ content }).expect(200);
    await officer.agent.post(`${base}/publish`).send({ published: true }).expect(200);

    const allyOfficer = await login([ally.guildId]);
    const allyBase = `/api/guilds/${ally.guildId}/events/${ev.id}/briefing`;
    const seen = (await allyOfficer.agent.get(allyBase).expect(200)).body.data;
    expect(seen.canEdit).toBe(false);
    expect(seen.logos.map((l: { tag: string | null; logoUrl: string | null }) => l.logoUrl)).toEqual(['/uploads/g/logo.png', 'https://cdn.example/vngd.png']);
    await allyOfficer.agent.put(allyBase).send({ content }).expect(403);

    // Another server's officers can't reach it through their own server.
    const other = await createGuild();
    const otherOfficer = await login([other.guildId]);
    await otherOfficer.agent.get(`/api/guilds/${other.guildId}/events/${ev.id}/briefing`).expect(403);

    const past = (await officer.agent.get(`/api/guilds/${g.guildId}/briefings`).expect(200)).body.data;
    expect(past).toEqual([expect.objectContaining({ eventId: ev.id, eventName: expect.any(String) })]);
    await allyOfficer.agent.get(`/api/guilds/${g.guildId}/briefings`).expect(403);
  });

  it('publishing needs a saved briefing; deleting clears the roster', async () => {
    const { ev, base, officer } = await setup();
    await officer.agent.post(`${base}/publish`).send({ published: true }).expect(404);
    await officer.agent.post(`${base}/publish`).send({}).expect(400);
    await officer.agent.put(base).send({}).expect(400);
    await officer.agent.put(base).send({ content }).expect(200);
    await officer.agent.post(`${base}/publish`).send({ published: true }).expect(200);
    await officer.agent.delete(base).expect(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(row.briefingPublishedAt).toBeNull();
    expect(await prisma.eventBriefing.count({ where: { eventId: ev.id } })).toBe(0);
  });
});
