// Ship components for Game Tools (v1.46.0): shields, power plants, coolers,
// quantum drives and radars, with their base stats from the game files (what
// a crafted part has at quality 500). Read from scdata.items; the slots come
// from each ship's Loadout.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export type ComponentKind = 'shield' | 'power' | 'cooler' | 'quantum' | 'radar';

export const COMPONENT_KINDS: { kind: ComponentKind; type: string; label: string; plural: string }[] = [
  { kind: 'shield', type: 'Shield', label: 'Shield', plural: 'Shields' },
  { kind: 'power', type: 'PowerPlant', label: 'Power plant', plural: 'Power plants' },
  { kind: 'cooler', type: 'Cooler', label: 'Cooler', plural: 'Coolers' },
  { kind: 'quantum', type: 'QuantumDrive', label: 'Quantum drive', plural: 'Quantum drives' },
  { kind: 'radar', type: 'Radar', label: 'Radar', plural: 'Radars' },
];
const KIND_BY_TYPE = new Map(COMPONENT_KINDS.map((k) => [k.type, k.kind]));

/** Shields a ship keeps up at once (every ship's shield power pool is 2); the rest are spares. */
export const ACTIVE_SHIELDS = 2;

export interface ShipComponent {
  uuid: string;
  className: string;
  name: string;
  maker: string | null;
  kind: ComponentKind;
  size: number;
  /** A–D, or "Bespoke"; null when the file gives none. */
  grade: string | null;
  /** Military, Civilian, Industrial, Stealth, Competition. */
  cls: string | null;
  /** Players can buy or loot it (has a class and an A–D grade). Others only show where a ship comes with them. */
  available: boolean;
  /** Power it draws at full power (segments) and the signatures it gives off. */
  powerDraw: number | null;
  em: number | null;
  ir: number | null;
  health: number | null;
  // Shields
  shieldHp: number | null;
  shieldRegen: number | null;
  /** Seconds before regen restarts after a hit / after being knocked down. */
  damagedDelay: number | null;
  downedDelay: number | null;
  // Power plants and coolers: their rating.
  powerOut: number | null;
  coolOut: number | null;
  // Quantum drives
  qtSpeed: number | null;
  qtSpool: number | null;
  qtCooldown: number | null;
  /** Quantum fuel per Gm in mSCU (the files' "per 10 Gm" figure; Erkul shows the same). */
  qtFuelPerGm: number | null;
  // Radars
  aimAssist: number | null;
  /** Skins or copies with identical numbers, grouped into this one. */
  variants?: number;
}

export interface ComponentSlot {
  id: string;
  kind: ComponentKind;
  minSize: number;
  maxSize: number;
  stockUuid: string | null;
  /** The ship's maker fixed it (Editable: false): shown, not changeable. */
  locked: boolean;
}

/** One `scdata.items` row (type Shield, PowerPlant, Cooler, QuantumDrive or Radar) → its numbers. */
export function shipComponentFromItem(row: { uuid: string; class_name?: string | null; name?: string | null; manufacturer_name?: string | null; size?: number | null; data: Json }): ShipComponent | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const type = String(s.Type ?? '').split('.')[0] ?? '';
  const kind = KIND_BY_TYPE.get(type);
  const name = str(row.name) ?? str(s.Name);
  if (!kind || !name) return null;
  const dd: Json = s.DescriptionData ?? {};
  const grade = str(dd.Grade);
  const cls = str(dd.Class);
  const sh: Json = s.Shield ?? {};
  const qd: Json = s.QuantumDrive?.StandardJump ?? {};
  const gen: Json = s.ResourceNetwork?.Generation ?? {};
  return {
    uuid: row.uuid,
    className: row.class_name ?? str(s.ClassName) ?? '',
    name,
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    kind,
    size: num(row.size) ?? num(s.Size) ?? 0,
    grade,
    cls,
    available: !!cls && !!grade && /^[A-D]$/.test(grade),
    powerDraw: num(s.ResourceNetwork?.Usage?.Power?.Maximum),
    em: num(s.Emission?.Em?.Maximum),
    ir: num(s.Emission?.Ir) || null,
    health: num(s.Durability?.Health),
    shieldHp: kind === 'shield' ? num(sh.MaxShieldHealth) : null,
    shieldRegen: kind === 'shield' ? num(sh.MaxShieldRegen) : null,
    damagedDelay: kind === 'shield' ? num(sh.DamagedDelay) : null,
    downedDelay: kind === 'shield' ? num(sh.DownedDelay) : null,
    powerOut: kind === 'power' ? num(gen.Power) : null,
    coolOut: kind === 'cooler' ? num(gen.Coolant) : null,
    qtSpeed: kind === 'quantum' ? num(qd.DriveSpeed) : null,
    qtSpool: kind === 'quantum' ? num(qd.SpoolUpTime) : null,
    qtCooldown: kind === 'quantum' ? num(qd.CooldownTime) : null,
    qtFuelPerGm: kind === 'quantum' && num(s.QuantumDrive?.FuelRequirement10GM) ? num(s.QuantumDrive?.FuelRequirement10GM)! * 100 : null,
    aimAssist: kind === 'radar' ? num(s.Radar?.AimAssist?.DistanceMaxAssignment) : null,
  };
}

/** Components with the same name, size and numbers are one choice (skins, duplicate records). */
export function componentGroupKey(c: ShipComponent): string {
  return [c.kind, c.size, c.name, c.grade, c.cls, c.powerDraw, c.em, c.ir, c.shieldHp, c.shieldRegen, c.powerOut, c.coolOut, c.qtSpeed, c.qtSpool, c.qtFuelPerGm, c.aimAssist].join('|');
}

/** Groups identical components; the representative keeps a `variants` count. */
export function dedupeComponents(list: ShipComponent[]): ShipComponent[] {
  const by = new Map<string, ShipComponent>();
  for (const c of list) {
    const k = componentGroupKey(c);
    const had = by.get(k);
    if (!had) by.set(k, { ...c });
    else had.variants = (had.variants ?? 0) + 1;
  }
  return [...by.values()];
}

/** A ship's component slots, in loadout order (nested ones too, e.g. the Hull C's rear module). */
export function shipComponentSlots(ship: Json): ComponentSlot[] {
  const slots: ComponentSlot[] = [];
  const walk = (ports: Json[] | undefined, path: string[]) => {
    for (const p of ports ?? []) {
      const here = [...path, String(p.HardpointName ?? '')];
      const types: string[] = (p.CompatibleTypes ?? []).map((t: Json) => String(t.Type ?? ''));
      const kind = types.map((t) => KIND_BY_TYPE.get(t)).find(Boolean);
      if (kind) {
        const fitted = String(p.Type ?? '').split('.')[0];
        slots.push({
          id: here.join('/'),
          kind,
          minSize: num(p.MinSize) ?? num(p.MaxSize) ?? 0,
          maxSize: num(p.MaxSize) ?? 0,
          stockUuid: fitted && KIND_BY_TYPE.get(fitted) === kind ? str(p.UUID) : null,
          locked: p.Editable === false,
        });
        continue;
      }
      walk(p.Loadout, here);
    }
  };
  walk(ship.Loadout, []);
  const order = COMPONENT_KINDS.map((k) => k.kind);
  return slots.map((s, i) => ({ s, i })).sort((a, b) => order.indexOf(a.s.kind) - order.indexOf(b.s.kind) || a.i - b.i).map((x) => x.s);
}

/** Whether a component can go in a slot: same kind and size, and one players can get (the stock part always fits). */
export function componentFitsSlot(c: ShipComponent, slot: ComponentSlot): boolean {
  if (c.uuid === slot.stockUuid) return true;
  if (slot.locked || !c.available) return false;
  return c.kind === slot.kind && c.size >= slot.minSize && c.size <= slot.maxSize;
}

export interface ComponentTotals {
  /** The two strongest shields (only that many are up at once), at full power. */
  shieldHp: number;
  shieldRegen: number;
  activeShields: number;
  spareShields: number;
  coolOut: number;
  quantum: ShipComponent | null;
  /** Gm on a full tank (capacity is in mSCU), or null without a drive or fuel figures. */
  qtRangeGm: number | null;
}

export function componentTotals(fitted: (ShipComponent | null)[], qtFuelCapacity: number | null): ComponentTotals {
  const shields = fitted.filter((c): c is ShipComponent => c?.kind === 'shield').sort((a, b) => (b.shieldHp ?? 0) - (a.shieldHp ?? 0));
  const up = shields.slice(0, ACTIVE_SHIELDS);
  const quantum = fitted.find((c): c is ShipComponent => c?.kind === 'quantum') ?? null;
  return {
    shieldHp: up.reduce((t, c) => t + (c.shieldHp ?? 0), 0),
    shieldRegen: up.reduce((t, c) => t + (c.shieldRegen ?? 0), 0),
    activeShields: up.length,
    spareShields: shields.length - up.length,
    coolOut: fitted.reduce((t, c) => t + (c?.coolOut ?? 0), 0),
    quantum,
    qtRangeGm: quantum?.qtFuelPerGm && qtFuelCapacity ? qtFuelCapacity / quantum.qtFuelPerGm : null,
  };
}

/** SQL for the rows `shipComponentFromItem` reads. */
export const GAME_TOOLS_COMPONENTS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data
  FROM scdata.items
  WHERE type IN ('Shield', 'PowerPlant', 'Cooler', 'QuantumDrive', 'Radar') AND NOT is_placeholder
`;
