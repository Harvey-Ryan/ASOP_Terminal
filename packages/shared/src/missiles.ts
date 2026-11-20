// Missiles for Game Tools (v1.47.0): every missile in the game files and
// each ship's missile racks. Racks stay as the ship comes with them (rack
// names are reused across racks that hold different missiles); the missiles
// in a rack can be swapped for any missile of the rack's size.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export type MissileSeeker = 'EM' | 'IR' | 'CS' | 'None';

export interface MissileItem {
  uuid: string;
  className: string;
  name: string;
  maker: string | null;
  size: number;
  damage: number;
  /** The damage type that makes up most of it. */
  damageType: 'Physical' | 'Energy' | 'Distortion';
  seeker: MissileSeeker;
  lockTime: number | null;
  /** Lock cone (degrees) and lock range (m). */
  lockAngle: number | null;
  lockRangeMin: number | null;
  lockRangeMax: number | null;
  speed: number | null;
  armTime: number | null;
  cluster: boolean;
  variants?: number;
}

export interface MissileRack {
  id: string;
  /** "MSD-423 Missile Rack" */
  name: string;
  /** The port's size (the rack's own size). */
  size: number;
  missileSize: number;
  count: number;
  stockMissileUuid: string | null;
}

const SEEKERS: Record<string, MissileSeeker> = { electromagnetic: 'EM', infrared: 'IR', crosssection: 'CS' };

/** One `scdata.items` row of type Missile → its numbers (null for dummies and placeholders). */
export function missileFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  size?: number | null;
  data: Json;
}): MissileItem | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const m: Json = s.Missile ?? {};
  const name = str(row.name) ?? str(s.Name);
  const damage = num(m.DamageTotal);
  if (!name || /placeholder/i.test(name) || !damage) return null;
  const d: Json = m.Damage ?? {};
  const types = (['Physical', 'Energy', 'Distortion'] as const)
    .map((t) => [t, num(d[t]) ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const t: Json = m.Targeting ?? {};
  const signal = String(t.TrackingSignalType ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return {
    uuid: row.uuid,
    className: row.class_name ?? str(s.ClassName) ?? '',
    name: name.replace(/ Missile$/, ''),
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    size: num(row.size) ?? num(s.Size) ?? 0,
    damage,
    damageType: types[0]![0],
    seeker: m.GCS?.IsDumbMissile ? 'None' : (SEEKERS[signal] ?? 'None'),
    lockTime: num(t.LockTime),
    lockAngle: num(t.LockingAngle),
    lockRangeMin: num(t.LockRangeMin),
    lockRangeMax: num(t.LockRangeMax),
    speed: num(m.GCS?.LinearSpeed),
    armTime: num(m.ArmTime),
    cluster: m.IsCluster === true,
  };
}

/** Missiles with the same key are one choice (skins, copies made for one ship). */
export function missileGroupKey(m: MissileItem): string {
  return [
    m.name,
    m.size,
    m.damage,
    m.damageType,
    m.seeker,
    m.lockTime,
    m.lockAngle,
    m.lockRangeMin,
    m.lockRangeMax,
    m.speed,
  ].join('|');
}

export function dedupeMissiles(list: MissileItem[]): MissileItem[] {
  const by = new Map<string, MissileItem>();
  for (const m of list) {
    const k = missileGroupKey(m);
    const had = by.get(k);
    if (!had) by.set(k, { ...m });
    else had.variants = (had.variants ?? 0) + 1;
  }
  return [...by.values()];
}

/** A ship's missile racks, from its Loadout: the rack, and the missiles it comes with. */
export function shipMissileRacks(ship: Json): MissileRack[] {
  const racks: MissileRack[] = [];
  const walk = (ports: Json[] | undefined, path: string[]) => {
    for (const p of ports ?? []) {
      const here = [...path, String(p.HardpointName ?? '')];
      if (String(p.Type ?? '').startsWith('MissileLauncher')) {
        const loaded: Json[] = (p.Loadout ?? []).filter((c: Json) => String(c.Type ?? '').startsWith('Missile.'));
        const sizes = (p.Loadout ?? [])
          .map((c: Json) => num(c.MaxSize))
          .filter((x: number | null): x is number => x != null);
        racks.push({
          id: here.join('/'),
          name: str(p.Name) ?? 'Missile rack',
          size: num(p.MaxSize) ?? 0,
          missileSize: sizes[0] ?? num(loaded[0]?.MaxSize) ?? 0,
          count: (p.Loadout ?? []).length || loaded.length,
          stockMissileUuid: str(loaded[0]?.UUID),
        });
        continue;
      }
      walk(p.Loadout, here);
    }
  };
  walk(ship.Loadout, []);
  return racks.filter((r) => r.count > 0 && r.missileSize > 0);
}

/** Whether a missile can go in a rack: the rack's missile size (the stock missile always can). */
export function missileFitsRack(m: MissileItem, rack: MissileRack): boolean {
  return m.uuid === rack.stockMissileUuid || m.size === rack.missileSize;
}

/** SQL for the rows `missileFromItem` reads. */
export const GAME_TOOLS_MISSILES_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data
  FROM scdata.items
  WHERE type = 'Missile' AND NOT is_placeholder
`;
