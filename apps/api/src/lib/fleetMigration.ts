// v1.32.0: fleets moved from one list per server (FleetEntry, FleetYards
// slugs) to one per person (FleetOwner / FleetShip). Run at start-up after the
// ship list is in: converts whatever FleetEntry rows are left (then deletes
// them) and deletes the FleetYards tokens, which nothing uses any more. Safe to
// run again. Drop FleetEntry and FleetyardsLink one release later.

import { shipIndex, matchShip } from '@dem/shared';
import { prisma } from './prisma.js';
import { listShips } from './shipCatalog.js';

export async function migrateOldFleets(): Promise<{ owners: number; ships: number; unmatched: number }> {
  const result = { owners: 0, ships: 0, unmatched: 0 };
  const dropped = await prisma.fleetyardsLink.deleteMany({});
  if (dropped.count) console.log(`[fleet] removed ${dropped.count} FleetYards link(s); hangar linking was retired in v1.32.0`);

  const entries = await prisma.fleetEntry.findMany({ orderBy: { updatedAt: 'asc' } });
  if (!entries.length) return result;
  const ships = await listShips();
  if (!ships.length) return result; // wait for a ship list, so names can be matched
  const index = shipIndex(ships);

  // The same ship registered in several servers is one ship: keep the largest count.
  const byPerson = new Map<string, { username: string; last: Date; ships: Map<string, { shipId: string | null; name: string; quantity: number; nickname: string | null }> }>();
  for (const e of entries) {
    const person = byPerson.get(e.userId) ?? { username: e.username, last: e.updatedAt, ships: new Map() };
    person.username = e.username;
    if (e.updatedAt > person.last) person.last = e.updatedAt;
    const m = matchShip(e.shipName, index, e.manufacturer);
    const shipId = m.status === 'matched' ? m.ship.id : null;
    const nickname = e.notes && e.notes.trim().length <= 40 ? e.notes.trim() : null;
    const key = shipId ?? `name:${e.shipName.toLowerCase()}`;
    const prev = person.ships.get(key);
    if (prev) prev.quantity = Math.max(prev.quantity, e.quantity);
    else person.ships.set(key, { shipId, name: e.shipName, quantity: Math.max(1, e.quantity), nickname });
    byPerson.set(e.userId, person);
  }

  await prisma.$transaction(async (tx) => {
    for (const [discordId, p] of byPerson) {
      const existing = await tx.fleetOwner.findUnique({ where: { discordId }, select: { discordId: true } });
      if (!existing) {
        await tx.fleetOwner.create({ data: { discordId, username: p.username, checkedAt: p.last } });
        result.owners++;
      }
      for (const s of p.ships.values()) {
        // Someone who already added it the new way keeps their entry.
        if (s.shipId && await tx.fleetShip.findFirst({ where: { discordId, shipId: s.shipId }, select: { id: true } })) continue;
        await tx.fleetShip.create({ data: { discordId, shipId: s.shipId, customName: s.shipId ? null : s.name, quantity: s.quantity, nickname: s.nickname } });
        result.ships++;
        if (!s.shipId) result.unmatched++;
      }
    }
    await tx.fleetEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  }, { timeout: 120_000 });
  console.log(`[fleet] moved ${result.ships} ship(s) of ${byPerson.size} member(s) to personal fleets; ${result.unmatched} couldn't be matched and are flagged for their owners`);
  return result;
}
