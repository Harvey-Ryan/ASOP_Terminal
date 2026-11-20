// v1.41.0: event templates with briefings — the Templates page, "Save as
// template", Repeat, and new events getting the template's briefing as a draft.
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
  return { discordId: user.discordId, agent };
}

async function setup() {
  const g = await createGuild();
  const officer = await login([g.guildId]);
  const stranger = await login([]);
  return { g, officer, stranger, base: `/api/guilds/${g.guildId}/event-templates` };
}

const briefing = {
  objective: 'Mine quantanium at Aberdeen.',
  sections: [
    {
      id: 'r',
      kind: 'roster',
      title: 'Teams',
      groups: [
        { id: 'g1', title: 'Ironclad crew', roleId: 'tr-ic', names: 'Extra' },
        { id: 'g2', title: 'Miners', roleId: 'tr-geo' },
      ],
    },
    { id: 't', kind: 'text', title: 'Comms', body: 'Channel 2' },
  ],
};
const templateRoles = [
  { id: 'tr-ic', name: 'Ironclad crew', count: 4 },
  { id: 'tr-geo', name: 'Geo miners', count: 6 },
];

describe('event templates', () => {
  it("only the server's event creators can see or change them", async () => {
    const { base, stranger } = await setup();
    await stranger.agent.get(`${base}/all`).expect(403);
    await stranger.agent.post(base).send({ name: 'x' }).expect(403);
  });

  it('can be made from scratch, edited, listed for the new-event form and removed', async () => {
    const { base, officer } = await setup();
    const made = (
      await officer.agent
        .post(base)
        .send({
          name: '  Mining op  ',
          description: 'Weekly',
          musterPoint: 'Port Tressler',
          imageUrl: '/uploads/x/a.webp',
          roles: [
            { name: 'Ironclad crew', count: 4 },
            { name: '  ', count: 3 },
            { name: 'Geo miners', count: 250 },
          ],
          vcNames: ['Ops', ' '],
          defaultDuration: 120,
        })
        .expect(201)
    ).body.data;
    expect(made).toMatchObject({
      name: 'Mining op',
      curated: true,
      hasBriefing: false,
      useCount: 0,
      musterPoint: 'Port Tressler',
      vcNames: ['Ops'],
      defaultDuration: 120,
    });
    expect(made.roles.map((r: { name: string; count: number }) => [r.name, r.count])).toEqual([
      ['Ironclad crew', 4],
      ['Geo miners', 99],
    ]);
    expect(made.roles.every((r: { id: string }) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);

    // a new curated template is offered in the form even before it's used
    expect((await officer.agent.get(base).expect(200)).body.data.map((t: { id: string }) => t.id)).toContain(made.id);

    await officer.agent.post(base).send({ name: 'Bad', imageUrl: 'javascript:alert(1)' }).expect(400);
    await officer.agent.post(base).send({ name: '' }).expect(400);

    const edited = (
      await officer.agent
        .put(`${base}/${made.id}`)
        .send({ ...made, name: 'Mining op (Sat)' })
        .expect(200)
    ).body.data;
    expect(edited.name).toBe('Mining op (Sat)');

    await officer.agent.delete(`${base}/${made.id}`).expect(200);
    await officer.agent.get(`${base}/${made.id}`).expect(404);
    expect((await officer.agent.get(`${base}/all`).expect(200)).body.data).toEqual([]);
  });

  it("a template's briefing goes into each new event as an unpublished draft, linked to the event's roles", async () => {
    const { g, base, officer } = await setup();
    const t = (await officer.agent.post(base).send({ name: 'Mining op', roles: templateRoles }).expect(201)).body.data;
    const saved = (await officer.agent.put(`${base}/${t.id}/briefing`).send({ content: briefing }).expect(200)).body
      .data;
    expect(saved.content.objective).toBe('Mine quantanium at Aberdeen.');
    expect(saved.template.hasBriefing).toBe(true);
    expect((await officer.agent.get(`${base}/${t.id}/briefing`).expect(200)).body.data.content.sections).toHaveLength(
      2,
    );

    // The form renamed a role and gave the other a new id: matched by name.
    const ev = (
      await officer.agent
        .post(`/api/guilds/${g.guildId}/events`)
        .send({
          name: 'Mining op #3',
          startTime: new Date(Date.now() + 86_400_000).toISOString(),
          repeatFromTemplateId: t.id,
          roles: [
            { id: 'tr-ic', name: 'Ironclad crew', count: 4 },
            { id: 'new-geo', name: 'GEO MINERS', count: 8 },
          ],
        })
        .expect(201)
    ).body.data;

    const row = await prisma.event.findUniqueOrThrow({ where: { id: ev.id }, include: { briefing: true } });
    expect(row.templateId).toBe(t.id);
    expect(row.briefingPublishedAt).toBeNull();
    expect(row.briefing?.publishedAt).toBeNull();
    const copied = JSON.parse(row.briefing!.content);
    expect(copied.objective).toBe('Mine quantanium at Aberdeen.');
    expect(copied.sections[0].groups.map((x: { roleId: string | null }) => x.roleId)).toEqual(['tr-ic', 'new-geo']);

    // the use is counted, and the curated template isn't changed by the event
    const after = (await officer.agent.get(`${base}/${t.id}`).expect(200)).body.data;
    expect(after.useCount).toBe(1);
    expect(after.roles).toEqual(templateRoles);
  });

  it('"Save as template" copies an event and its briefing, and Repeat then reuses that template', async () => {
    const { g, base, officer } = await setup();
    const ev = await createEvent(g.guildId, officer.discordId, {
      name: 'Bunker run',
      musterPoint: 'Orison',
      roles: JSON.stringify([{ id: 'e-med', name: 'Medic', count: 2 }]),
      endTime: new Date(Date.now() + 3 * 3600_000),
    });
    await prisma.eventBriefing.create({
      data: { eventId: ev.id, content: JSON.stringify({ objective: 'Clear the bunker' }), publishedAt: new Date() },
    });

    const t = (await officer.agent.post(base).send({ fromEventId: ev.id, name: 'Bunker run template' }).expect(201))
      .body.data;
    expect(t).toMatchObject({
      name: 'Bunker run template',
      musterPoint: 'Orison',
      curated: true,
      hasBriefing: true,
      defaultDuration: 120,
    });
    expect(t.roles).toEqual([{ id: 'e-med', name: 'Medic', count: 2 }]);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: ev.id } })).templateId).toBe(t.id);

    // Repeat on the event returns the curated template instead of making another
    const rep = (await officer.agent.post(`${base}/from-event`).send({ eventId: ev.id }).expect(200)).body.data;
    expect(rep.id).toBe(t.id);
    expect(await prisma.eventTemplate.count({ where: { guild: { guildId: g.guildId } } })).toBe(1);

    await officer.agent.post(base).send({ fromEventId: 'nope', name: 'x' }).expect(404);
  });

  it("Repeat's own templates still follow the latest event, until someone edits them", async () => {
    const { g, base, officer } = await setup();
    const ev = await createEvent(g.guildId, officer.discordId, { name: 'Salvage', description: 'v1' });
    const rep = (await officer.agent.post(`${base}/from-event`).send({ eventId: ev.id }).expect(200)).body.data;
    expect(rep.curated).toBe(false);

    await officer.agent
      .post(`/api/guilds/${g.guildId}/events`)
      .send({
        name: 'Salvage',
        description: 'v2',
        startTime: new Date(Date.now() + 86_400_000).toISOString(),
        repeatFromTemplateId: rep.id,
      })
      .expect(201);
    expect((await officer.agent.get(`${base}/${rep.id}`).expect(200)).body.data.description).toBe('v2');

    // editing it on the Templates page makes it curated: no more overwriting
    await officer.agent.put(`${base}/${rep.id}`).send({ name: 'Salvage', description: 'Curated' }).expect(200);
    await officer.agent
      .post(`/api/guilds/${g.guildId}/events`)
      .send({
        name: 'Salvage',
        description: 'v3',
        startTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        repeatFromTemplateId: rep.id,
      })
      .expect(201);
    expect((await officer.agent.get(`${base}/${rep.id}`).expect(200)).body.data).toMatchObject({
      description: 'Curated',
      curated: true,
      useCount: 2,
    });
  });

  it("an event's briefing can be saved to a template, re-linked to the template's roles", async () => {
    const { g, base, officer } = await setup();
    const t = (await officer.agent.post(base).send({ name: 'Mining op', roles: templateRoles }).expect(201)).body.data;
    const ev = await createEvent(g.guildId, officer.discordId, {
      roles: JSON.stringify([{ id: 'ev-geo', name: 'Geo miners', count: 6 }]),
    });
    const fromEvent = {
      objective: 'From the event',
      sections: [{ id: 'r', kind: 'roster', title: 'Teams', groups: [{ id: 'x', title: 'Miners', roleId: 'ev-geo' }] }],
    };
    const out = (
      await officer.agent.put(`${base}/${t.id}/briefing`).send({ content: fromEvent, fromEventId: ev.id }).expect(200)
    ).body.data;
    expect(out.content.sections[0].groups[0].roleId).toBe('tr-geo');

    await officer.agent.delete(`${base}/${t.id}/briefing`).expect(200);
    expect((await officer.agent.get(`${base}/${t.id}/briefing`).expect(200)).body.data).toMatchObject({
      content: null,
      template: { hasBriefing: false },
    });
  });
});
