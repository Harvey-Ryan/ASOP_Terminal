// Fleets (v1.32.0): one per person, shown in every ASOP server they're in
// (except ones they hide it from). Ships come from the ship list
// (lib/shipCatalog.ts); rules and parsing in packages/shared/src/ships.ts.
// The bot's /fleet commands write the same rows (apps/bot/src/commands/fleet.ts).

import { Router, type Request } from 'express';
import {
  isShipSource, parseFleetImport, shipIndex, matchShip, eventFleetPeople,
  type ApiResponse, type FleetShipDto, type MyFleetDto, type GuildFleetDto, type GuildFleetShipDto, type FleetImportPreviewLine, type ShipCatalogEntry, type ShipSource,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertModuleEnabled } from '../../lib/assertModuleEnabled.js';
import { assertEventViewer } from '../../lib/assertEventViewer.js';
import { getGuildMemberList } from '../../lib/discordRest.js';
import { listShips } from '../../lib/shipCatalog.js';

export const fleetRouter = Router();

const MAX_SHIPS = 500;
const MAX_IMPORT_CHARS = 2_000_000;

const fail = (res: import('express').Response, status: number, error: string) => {
  res.status(status).json({ success: false, error } satisfies ApiResponse);
};

async function me(req: Request) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { discordId: true, username: true, globalName: true } });
  return { discordId: u.discordId, name: u.globalName ?? u.username };
}

/** Their fleet row, made on first use; `touch` marks the fleet as just checked. */
async function ownerFor(person: { discordId: string; name: string }, touch: boolean) {
  return prisma.fleetOwner.upsert({
    where: { discordId: person.discordId },
    create: { discordId: person.discordId, username: person.name, checkedAt: touch ? new Date() : null },
    update: { username: person.name, ...(touch ? { checkedAt: new Date() } : {}) },
  });
}

async function shipMap(): Promise<Map<string, ShipCatalogEntry>> {
  // Retired ships too, so an owner still sees one RSI stopped listing.
  const rows = await prisma.ship.findMany();
  return new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, manufacturer: r.manufacturer, manufacturerCode: r.manufacturerCode, type: r.type, focus: r.focus, size: r.size,
    minCrew: r.minCrew, maxCrew: r.maxCrew, cargo: r.cargo, status: r.status, imageUrl: r.imageUrl, thumbUrl: r.thumbUrl, storeUrl: r.storeUrl,
  }]));
}

type Row = { id: number; shipId: string | null; customName: string | null; quantity: number; nickname: string | null; source: string; available: boolean };
const toDto = (r: Row, ships: Map<string, ShipCatalogEntry>): FleetShipDto => ({
  id: r.id, ship: r.shipId ? ships.get(r.shipId) ?? null : null, customName: r.customName, quantity: r.quantity,
  nickname: r.nickname, source: (isShipSource(r.source) ? r.source : 'PLEDGE') as ShipSource, available: r.available,
});

async function myFleet(discordId: string): Promise<MyFleetDto> {
  const [owner, rows, ships] = await Promise.all([
    prisma.fleetOwner.findUnique({ where: { discordId } }),
    prisma.fleetShip.findMany({ where: { discordId }, orderBy: { id: 'asc' } }),
    shipMap(),
  ]);
  const list = rows.map((r) => toDto(r, ships)).sort((a, b) => (a.ship?.name ?? a.customName ?? '').localeCompare(b.ship?.name ?? b.customName ?? ''));
  return {
    ships: list,
    checkedAt: owner?.checkedAt?.toISOString() ?? null,
    nudges: owner?.nudges ?? true,
    hiddenGuildIds: JSON.parse(owner?.hiddenGuildIds ?? '[]') as string[],
  };
}

const cleanText = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || null;
};
const cleanQty = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined;
};

// ── The ship list ────────────────────────────────────────────────────────────

fleetRouter.get('/ships', requireAuth, async (_req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.json({ success: true, data: await listShips() } satisfies ApiResponse<ShipCatalogEntry[]>);
});

// ── Your fleet ───────────────────────────────────────────────────────────────

fleetRouter.get('/me/fleet', requireAuth, async (req, res) => {
  const p = await me(req);
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

// Adds a ship (one more of it, if you already have one with the same nickname).
fleetRouter.post('/me/fleet/ships', requireAuth, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const shipId = typeof body.shipId === 'string' ? body.shipId : '';
  if (!(await prisma.ship.findUnique({ where: { id: shipId }, select: { id: true } }))) return fail(res, 400, 'Pick a ship from the list.');
  const quantity = cleanQty(body.quantity ?? 1);
  if (!quantity) return fail(res, 400, 'Quantity must be 1 to 99.');
  const nickname = cleanText(body.nickname, 60) ?? null;
  const source = isShipSource(body.source) ? body.source : 'PLEDGE';
  const p = await me(req);
  await ownerFor(p, true);
  const same = await prisma.fleetShip.findFirst({ where: { discordId: p.discordId, shipId, nickname } });
  if (same) await prisma.fleetShip.update({ where: { id: same.id }, data: { quantity: Math.min(99, same.quantity + quantity) } });
  else {
    if ((await prisma.fleetShip.count({ where: { discordId: p.discordId } })) >= MAX_SHIPS) return fail(res, 400, `A fleet can list up to ${MAX_SHIPS} ships.`);
    await prisma.fleetShip.create({ data: { discordId: p.discordId, shipId, quantity, nickname, source } });
  }
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

fleetRouter.patch('/me/fleet/ships/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const p = await me(req);
  const row = Number.isInteger(id) ? await prisma.fleetShip.findFirst({ where: { id, discordId: p.discordId } }) : null;
  if (!row) return fail(res, 404, 'Ship not found');
  const body = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (body.quantity !== undefined) { const q = cleanQty(body.quantity); if (!q) return fail(res, 400, 'Quantity must be 1 to 99.'); data.quantity = q; }
  if (body.nickname !== undefined) data.nickname = cleanText(body.nickname, 60) ?? null;
  if (body.source !== undefined) { if (!isShipSource(body.source)) return fail(res, 400, 'Unknown source'); data.source = body.source; }
  if (body.available !== undefined) { if (typeof body.available !== 'boolean') return fail(res, 400, 'available must be true or false'); data.available = body.available; }
  if (body.shipId !== undefined) {
    // Fixing a ship the import couldn't place.
    if (typeof body.shipId !== 'string' || !(await prisma.ship.findUnique({ where: { id: body.shipId }, select: { id: true } }))) return fail(res, 400, 'Pick a ship from the list.');
    data.shipId = body.shipId; data.customName = null;
    // Already listed (same ship, same nickname): one row with both counts.
    const same = await prisma.fleetShip.findFirst({ where: { discordId: p.discordId, shipId: body.shipId, nickname: (data.nickname as string | null | undefined) ?? row.nickname, id: { not: row.id } } });
    if (same) {
      await prisma.$transaction([
        prisma.fleetShip.update({ where: { id: same.id }, data: { quantity: Math.min(99, same.quantity + ((data.quantity as number | undefined) ?? row.quantity)) } }),
        prisma.fleetShip.delete({ where: { id: row.id } }),
      ]);
      await ownerFor(p, true);
      res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
      return;
    }
  }
  await prisma.fleetShip.update({ where: { id: row.id }, data });
  await ownerFor(p, true);
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

fleetRouter.delete('/me/fleet/ships/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const p = await me(req);
  const gone = Number.isInteger(id) ? await prisma.fleetShip.deleteMany({ where: { id, discordId: p.discordId } }) : { count: 0 };
  if (!gone.count) return fail(res, 404, 'Ship not found');
  await ownerFor(p, true);
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

// "Still correct": nothing changed, but it's been checked.
fleetRouter.post('/me/fleet/confirm', requireAuth, async (req, res) => {
  const p = await me(req);
  await ownerFor(p, true);
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

// Servers to hide your fleet from.
fleetRouter.put('/me/fleet/hidden', requireAuth, async (req, res) => {
  const ids = (req.body as { guildIds?: unknown }).guildIds;
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((g) => typeof g === 'string' && /^\d{5,25}$/.test(g))) return fail(res, 400, 'guildIds must be a list of server ids');
  const p = await me(req);
  await ownerFor(p, false);
  await prisma.fleetOwner.update({ where: { discordId: p.discordId }, data: { hiddenGuildIds: JSON.stringify([...new Set(ids)]) } });
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

// The quarterly "Still flying these?" DM, on or off.
fleetRouter.put('/me/fleet/nudges', requireAuth, async (req, res) => {
  const on = (req.body as { on?: unknown }).on;
  if (typeof on !== 'boolean') return fail(res, 400, 'on must be true or false');
  const p = await me(req);
  await ownerFor(p, false);
  await prisma.fleetOwner.update({ where: { discordId: p.discordId }, data: { nudges: on } });
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

// ── Import: preview, then apply ──────────────────────────────────────────────

fleetRouter.post('/me/fleet/import/preview', requireAuth, async (req, res) => {
  const text = (req.body as { text?: unknown }).text;
  if (typeof text !== 'string' || !text.trim()) return fail(res, 400, 'Paste a list of ships or choose a file.');
  if (text.length > MAX_IMPORT_CHARS) return fail(res, 400, 'That file is too big.');
  const parsed = parseFleetImport(text);
  if (!parsed.lines.length) return fail(res, 400, 'No ships found in that.');
  const index = shipIndex(await listShips());
  const lines: FleetImportPreviewLine[] = parsed.lines.slice(0, MAX_SHIPS).map((l) => {
    const m = matchShip(l.name, index, l.manufacturer);
    return { ...l, match: m.status === 'matched' ? m : { status: m.status, suggestions: m.suggestions } };
  });
  res.json({ success: true, data: { format: parsed.format, lines } } satisfies ApiResponse<{ format: string; lines: FleetImportPreviewLine[] }>);
});

// `replace`: the import is the whole fleet (a hangar export), so ships not in it go.
fleetRouter.post('/me/fleet/import', requireAuth, async (req, res) => {
  const body = req.body as { lines?: unknown; replace?: unknown };
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_SHIPS) return fail(res, 400, 'Nothing to import.');
  const known = new Set((await listShips()).map((s) => s.id));
  const lines: { shipId: string | null; customName: string | null; quantity: number; nickname: string | null }[] = [];
  for (const raw of body.lines as Record<string, unknown>[]) {
    const shipId = typeof raw?.shipId === 'string' && known.has(raw.shipId) ? raw.shipId : null;
    const name = cleanText(raw?.name, 100) ?? null;
    if (!shipId && !name) continue;
    lines.push({ shipId, customName: shipId ? null : name, quantity: cleanQty(raw?.quantity) ?? 1, nickname: cleanText(raw?.nickname, 60) ?? null });
  }
  if (!lines.length) return fail(res, 400, 'Nothing to import.');
  const p = await me(req);
  const have = body.replace === true ? 0 : await prisma.fleetShip.count({ where: { discordId: p.discordId } });
  if (have + lines.length > MAX_SHIPS) return fail(res, 400, `A fleet can list up to ${MAX_SHIPS} ships.`);
  await ownerFor(p, true);
  await prisma.$transaction(async (tx) => {
    if (body.replace === true) await tx.fleetShip.deleteMany({ where: { discordId: p.discordId } });
    for (const l of lines) {
      const same = await tx.fleetShip.findFirst({ where: { discordId: p.discordId, shipId: l.shipId, customName: l.customName, nickname: l.nickname } });
      if (same) await tx.fleetShip.update({ where: { id: same.id }, data: { quantity: body.replace === true ? l.quantity : Math.min(99, same.quantity + l.quantity) } });
      else await tx.fleetShip.create({ data: { discordId: p.discordId, ...l } });
    }
  }, { timeout: 30_000 });
  res.json({ success: true, data: await myFleet(p.discordId) } satisfies ApiResponse<MyFleetDto>);
});

// ── A server's fleet ─────────────────────────────────────────────────────────

fleetRouter.get('/guilds/:guildId/fleet', requireAuth, async (req, res) => {
  const { guildId } = req.params as { guildId: string };
  if (!(await assertModuleEnabled(guildId, 'fleetEnabled'))) return fail(res, 403, 'The Fleet module is switched off in this server.');
  if (!(await assertEventViewer(req, guildId))) return fail(res, 403, 'Forbidden');

  // Everyone in the server, or (v1.33.0) the people signed up for one of its
  // events, allies' members included.
  const eventId = typeof req.query.eventId === 'string' && req.query.eventId ? req.query.eventId : null;
  let names: Map<string, string>;
  let owners: Awaited<ReturnType<typeof prisma.fleetOwner.findMany>>;
  let event: GuildFleetDto['event'];
  if (eventId) {
    const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true } });
    const ev = guild && await prisma.event.findFirst({
      where: { id: eventId, OR: [{ guildId }, { guildShares: { some: { guildId: guild.id, status: 'ACCEPTED' } } }] },
      select: { id: true, name: true, startTime: true, guildId: true, rsvps: { select: { userId: true, username: true, guildId: true, tentative: true } } },
    });
    if (!ev) return fail(res, 404, 'Event not found');
    const signed = ev.rsvps.filter((r) => !r.tentative);
    const candidates = await prisma.fleetOwner.findMany({ where: { discordId: { in: signed.map((r) => r.userId) } } });
    names = eventFleetPeople(ev, ev.rsvps, candidates);
    owners = candidates.filter((o) => names.has(o.discordId));
    event = { id: ev.id, name: ev.name, startTime: ev.startTime.toISOString(), signedUp: signed.length };
  } else {
    const members = await getGuildMemberList(guildId);
    if (!members) return fail(res, 503, 'Discord is busy, so the server\'s members couldn\'t be loaded. Try again in a minute.');
    owners = (await prisma.fleetOwner.findMany({ where: { discordId: { in: [...members.keys()] } } }))
      .filter((o) => !(JSON.parse(o.hiddenGuildIds) as string[]).includes(guildId));
    names = members;
  }
  const ids = owners.map((o) => o.discordId);
  const [rows, ships] = await Promise.all([
    prisma.fleetShip.findMany({ where: { discordId: { in: ids }, available: true } }),
    shipMap(),
  ]);
  const byShip = new Map<string, GuildFleetShipDto>();
  let unmatched = 0;
  for (const r of rows) {
    const ship = r.shipId ? ships.get(r.shipId) : undefined;
    if (!ship) { unmatched++; continue; }
    const entry = byShip.get(ship.id) ?? { ship, owners: [], total: 0 };
    entry.owners.push({ discordId: r.discordId, quantity: r.quantity, nickname: r.nickname, source: (isShipSource(r.source) ? r.source : 'PLEDGE') as ShipSource });
    entry.total += r.quantity;
    byShip.set(ship.id, entry);
  }
  const data: GuildFleetDto = {
    ships: [...byShip.values()].sort((a, b) => b.total - a.total || a.ship.name.localeCompare(b.ship.name)),
    owners: owners
      .map((o) => ({ discordId: o.discordId, name: names.get(o.discordId) ?? o.username, checkedAt: o.checkedAt?.toISOString() ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    unmatched,
    ...(event ? { event } : {}),
  };
  res.json({ success: true, data } satisfies ApiResponse<GuildFleetDto>);
});
