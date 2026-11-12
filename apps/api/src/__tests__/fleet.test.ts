// v1.32.0: personal fleets, the ship list, moving old fleets over, and a server's fleet.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import type { ShipCatalogEntry } from '@dem/shared';
import { createServer } from '../server/app.js';
import { refreshShipCatalog, forgetShipList } from '../lib/shipCatalog.js';
import { migrateOldFleets } from '../lib/fleetMigration.js';
import { resetDiscordRest } from '../lib/discordRest.js';
import { createUser, createGuild, createGuildSettings, createEvent } from './factories.js';

const app = createServer();
const prisma = new PrismaClient();

const ship = (id: number, name: string, manufacturer = 'Test Works', type = 'Combat'): ShipCatalogEntry => ({
  id: `rsi-${id}`, name, manufacturer, manufacturerCode: null, type, focus: null, size: 'Medium', minCrew: 1, maxCrew: 2, cargo: 0,
  status: 'flight-ready', imageUrl: `https://media.robertsspaceindustries.com/${id}/slideshow.jpg`, thumbUrl: null, storeUrl: null,
});
const LIST = [
  ship(9001, 'Carrack', 'Anvil Aerospace', 'Exploration'),
  ship(9002, 'Cutlass Black', 'Drake Interplanetary', 'Multi-Role'),
  ship(9003, 'Prospector', 'MISC', 'Industrial'),
  ...Array.from({ length: 60 }, (_, i) => ship(9100 + i, `Filler ${i}`)),
];

beforeAll(async () => {
  expect(await refreshShipCatalog(async () => LIST)).toEqual({ source: 'RSI', count: LIST.length });
});
afterEach(() => { vi.unstubAllGlobals(); resetDiscordRest(); });

async function person(managed: string[] = []) {
  const user = await createUser({ globalName: `Pilot ${Math.random().toString(36).slice(2, 6)}` });
  const agent = request.agent(app);
  await agent.post('/test/login').send({ userId: user.id, managedGuildIds: managed });
  return { user, agent, id: user.discordId };
}

describe('ship list', () => {
  it('a short or failed answer from RSI changes nothing; ships RSI drops are retired, not deleted', async () => {
    expect((await refreshShipCatalog(async () => LIST.slice(0, 10))).source).toBe('none');
    expect(await prisma.ship.count({ where: { id: { in: LIST.map((s) => s.id) }, retired: false } })).toBe(LIST.length);
    expect((await refreshShipCatalog(async () => { throw new Error('RSI down'); })).source).toBe('none');

    await refreshShipCatalog(async () => LIST.filter((s) => s.id !== 'rsi-9159'));
    expect((await prisma.ship.findUniqueOrThrow({ where: { id: 'rsi-9159' } })).retired).toBe(true);
    await refreshShipCatalog(async () => LIST);
    expect((await prisma.ship.findUniqueOrThrow({ where: { id: 'rsi-9159' } })).retired).toBe(false);
  });
});

describe('your fleet', () => {
  it('add, add again, edit, remove, check; everything marks it checked', async () => {
    const p = await person();
    const add = (body: object) => p.agent.post('/api/me/fleet/ships').send(body);
    await add({ shipId: 'nope' }).expect(400);
    let fleet = (await add({ shipId: 'rsi-9001' }).expect(200)).body.data;
    expect(fleet.ships).toHaveLength(1);
    expect(fleet.ships[0]).toMatchObject({ quantity: 1, source: 'PLEDGE', available: true, ship: { name: 'Carrack', imageUrl: expect.stringContaining('slideshow') } });
    expect(fleet.checkedAt).not.toBeNull();
    fleet = (await add({ shipId: 'rsi-9001', quantity: 2 }).expect(200)).body.data;
    expect(fleet.ships[0].quantity).toBe(3);
    fleet = (await add({ shipId: 'rsi-9002', nickname: 'Rust Bucket', source: 'INGAME' }).expect(200)).body.data;
    const cutlass = fleet.ships.find((s: { ship: { name: string } }) => s.ship.name === 'Cutlass Black');
    expect(cutlass).toMatchObject({ nickname: 'Rust Bucket', source: 'INGAME' });
    fleet = (await p.agent.patch(`/api/me/fleet/ships/${cutlass.id}`).send({ available: false, quantity: 2 }).expect(200)).body.data;
    expect(fleet.ships.find((s: { id: number }) => s.id === cutlass.id)).toMatchObject({ available: false, quantity: 2 });
    await p.agent.patch(`/api/me/fleet/ships/${cutlass.id}`).send({ quantity: 0 }).expect(400);

    // Someone else's ship is not yours to change.
    const other = await person();
    await other.agent.delete(`/api/me/fleet/ships/${cutlass.id}`).expect(404);
    await p.agent.delete(`/api/me/fleet/ships/${cutlass.id}`).expect(200);

    await prisma.fleetOwner.update({ where: { discordId: p.id }, data: { checkedAt: new Date('2026-01-01') } });
    fleet = (await p.agent.post('/api/me/fleet/confirm').expect(200)).body.data;
    expect(new Date(fleet.checkedAt).getFullYear()).toBeGreaterThan(2026 - 1);
    expect(Date.now() - new Date(fleet.checkedAt).getTime()).toBeLessThan(60_000);
  });

  it('import: preview matches, then adds or replaces; unplaced names are kept for fixing', async () => {
    const p = await person();
    await p.agent.post('/api/me/fleet/ships').send({ shipId: 'rsi-9003' }).expect(200);
    const preview = (await p.agent.post('/api/me/fleet/import/preview').send({ text: 'Anvil Carrack LTI\n2x Cutlass Black\nMystery Hauler' }).expect(200)).body.data;
    expect(preview.format).toBe('text');
    expect(preview.lines.map((l: { name: string; match: { status: string; ship?: { name: string } } }) => [l.name, l.match.status, l.match.ship?.name ?? null])).toEqual([
      ['Anvil Carrack LTI', 'matched', 'Carrack'], ['Cutlass Black', 'matched', 'Cutlass Black'], ['Mystery Hauler', 'none', null],
    ]);
    const lines = preview.lines.map((l: { name: string; quantity: number; match: { ship?: { id: string } } }) => ({ name: l.name, quantity: l.quantity, shipId: l.match.ship?.id ?? null }));

    let fleet = (await p.agent.post('/api/me/fleet/import').send({ lines }).expect(200)).body.data;
    expect(fleet.ships.map((s: { ship: { name: string } | null; customName: string | null; quantity: number }) => [s.ship?.name ?? s.customName, s.quantity]))
      .toEqual([['Carrack', 1], ['Cutlass Black', 2], ['Mystery Hauler', 1], ['Prospector', 1]]);

    // A whole-hangar import replaces the list (the Prospector wasn't in it).
    fleet = (await p.agent.post('/api/me/fleet/import').send({ lines, replace: true }).expect(200)).body.data;
    expect(fleet.ships.map((s: { ship: { name: string } | null; customName: string | null }) => s.ship?.name ?? s.customName)).toEqual(['Carrack', 'Cutlass Black', 'Mystery Hauler']);

    // Fixing the one it couldn't place.
    const mystery = fleet.ships.find((s: { customName: string | null }) => s.customName === 'Mystery Hauler');
    fleet = (await p.agent.patch(`/api/me/fleet/ships/${mystery.id}`).send({ shipId: 'rsi-9003' }).expect(200)).body.data;
    expect(fleet.ships.find((s: { id: number }) => s.id === mystery.id)).toMatchObject({ customName: null, ship: { name: 'Prospector' } });

    await p.agent.post('/api/me/fleet/import/preview').send({ text: '   ' }).expect(400);
  });
});

describe('old fleets move over', () => {
  it('per-server FleetYards entries become one personal fleet; tokens are deleted', async () => {
    const user = await createUser();
    const d = user.discordId;
    const [g1, g2] = [`g-${Date.now()}-a`, `g-${Date.now()}-b`];
    await prisma.fleetEntry.createMany({ data: [
      { guildId: g1, userId: d, username: 'Old Pilot', shipSlug: 'carrack', shipName: 'Carrack', manufacturer: 'Anvil Aerospace', quantity: 1, notes: 'Wanderer' },
      { guildId: g2, userId: d, username: 'Old Pilot', shipSlug: 'carrack', shipName: 'Carrack', manufacturer: 'Anvil Aerospace', quantity: 2, notes: 'Wanderer' },
      { guildId: g1, userId: d, username: 'Old Pilot', shipSlug: 'gone-ship', shipName: 'Retired Concept', manufacturer: 'Nobody', quantity: 1 },
    ] });
    await prisma.fleetyardsLink.create({ data: { userId: user.id, fyUserId: 'x', fyUsername: 'x', accessToken: 'SECRET' } });

    const r = await migrateOldFleets();
    expect(r.unmatched).toBeGreaterThanOrEqual(1);
    expect(await prisma.fleetEntry.count({ where: { userId: d } })).toBe(0);
    expect(await prisma.fleetyardsLink.count()).toBe(0);
    const ships = await prisma.fleetShip.findMany({ where: { discordId: d }, orderBy: { id: 'asc' } });
    expect(ships.map((s) => [s.shipId, s.customName, s.quantity, s.nickname])).toEqual([['rsi-9001', null, 2, 'Wanderer'], [null, 'Retired Concept', 1, null]]);
    expect((await prisma.fleetOwner.findUniqueOrThrow({ where: { discordId: d } })).username).toBe('Old Pilot');
    expect((await migrateOldFleets()).ships).toBe(0); // nothing left to move
  });
});

describe("a server's fleet", () => {
  it('members who share their fleet, available ships only, grouped by ship', async () => {
    const guild = await createGuild();
    await createGuildSettings(guild.id, { fleetEnabled: true });
    const officer = await person([guild.guildId]);
    const a = await person();
    const b = await person();
    const outsider = await person();
    const hider = await person();
    for (const p of [a, b, outsider, hider]) await p.agent.post('/api/me/fleet/ships').send({ shipId: 'rsi-9001' }).expect(200);
    await b.agent.post('/api/me/fleet/ships').send({ shipId: 'rsi-9003', quantity: 2 }).expect(200);
    const parked = (await a.agent.post('/api/me/fleet/ships').send({ shipId: 'rsi-9002' }).expect(200)).body.data.ships.find((s: { ship: { name: string } }) => s.ship.name === 'Cutlass Black');
    await a.agent.patch(`/api/me/fleet/ships/${parked.id}`).send({ available: false }).expect(200);
    await hider.agent.put('/api/me/fleet/hidden').send({ guildIds: [guild.guildId.replace(/\D/g, '') || '12345'] }).expect(200);
    await prisma.fleetOwner.update({ where: { discordId: hider.id }, data: { hiddenGuildIds: JSON.stringify([guild.guildId]) } });

    const inServer = [officer, a, b, hider].map((p) => ({ user: { id: p.id, username: p.user.username, global_name: p.user.globalName }, nick: p === b ? 'Bee' : null, roles: [] }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes(`/guilds/${guild.guildId}/members?`)) return new Response(JSON.stringify(inServer), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('{}', { status: 404 });
    }));
    forgetShipList();
    const res = await officer.agent.get(`/api/guilds/${guild.guildId}/fleet`).expect(200);
    const data = res.body.data;
    expect(data.ships.map((s: { ship: { name: string }; total: number; owners: unknown[] }) => [s.ship.name, s.total, s.owners.length])).toEqual([['Carrack', 2, 2], ['Prospector', 2, 1]]);
    expect(data.owners.map((o: { name: string }) => o.name)).toEqual([a.user.globalName, 'Bee'].sort());

    await outsider.agent.get(`/api/guilds/${guild.guildId}/fleet`).expect(403);
  });

  it('narrowed to one event: its sign-ups (allies too), not maybes, not hidden, no Discord call', async () => {
    const guild = await createGuild();
    const other = await createGuild();
    await createGuildSettings(guild.id, { fleetEnabled: true });
    const officer = await person([guild.guildId]);
    const [going, maybe, hider, notSigned] = [await person(), await person(), await person(), await person()];
    for (const p of [going, maybe, hider, notSigned]) await p.agent.post('/api/me/fleet/ships').send({ shipId: 'rsi-9003' }).expect(200);
    await prisma.fleetOwner.update({ where: { discordId: hider.id }, data: { hiddenGuildIds: JSON.stringify([guild.guildId]) } });
    const ev = await createEvent(guild.guildId, 'host');
    await prisma.eventRsvp.createMany({ data: [
      { eventId: ev.id, userId: going.id, username: 'Going Pilot', guildId: guild.guildId },
      { eventId: ev.id, userId: maybe.id, username: 'Maybe Pilot', guildId: guild.guildId, tentative: true },
      { eventId: ev.id, userId: hider.id, username: 'Hider', guildId: guild.guildId },
      { eventId: ev.id, userId: 'no-fleet', username: 'No Fleet' },
    ] });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no Discord call expected'); }));
    const data = (await officer.agent.get(`/api/guilds/${guild.guildId}/fleet?eventId=${ev.id}`).expect(200)).body.data;
    expect(data.event).toMatchObject({ id: ev.id, signedUp: 3 });
    expect(data.owners.map((o: { name: string }) => o.name)).toEqual(['Going Pilot']);
    expect(data.ships.map((s: { ship: { name: string }; total: number }) => [s.ship.name, s.total])).toEqual([['Prospector', 1]]);

    // Another server's event isn't visible from here.
    const elsewhere = await createEvent(other.guildId, 'host');
    await officer.agent.get(`/api/guilds/${guild.guildId}/fleet?eventId=${elsewhere.id}`).expect(404);
  });
});

