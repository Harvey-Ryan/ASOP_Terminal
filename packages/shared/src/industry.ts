// Salvage and refuelling loadouts on ship pages (v1.51.0): each salvage
// head's scraper and tractor modules, and the Starfarer's fuel pods. All
// from the game files (scdata.items, the ships' loadouts); nothing estimated.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && !v.startsWith('<=') ? v.trim() : null);

// ── Salvage ──────────────────────────────────────────────────────────────────

export interface SalvageModule {
  uuid: string;
  name: string;
  maker: string | null;
  /** Scraper modules strip hulls; the tractor module is the head's tractor beam. */
  kind: 'scraper' | 'tractor';
  /** Beam radius multiplier (the game shows it as metres: "Radius: 3.5m"). */
  radius: number | null;
  /** Extraction speed multiplier. */
  speed: number | null;
  /** Share of what's stripped that ends up as material (0–1). */
  efficiency: number | null;
}

export interface SalvageSlot {
  id: string;
  kind: 'scraper' | 'tractor';
  stockUuid: string | null;
}

/** One salvage head on a ship, with its module slots. */
export interface SalvageHeadMount {
  id: string;
  /** "Right arm", "Front turret"… */
  label: string;
  /** "Baler Salvage Head" */
  head: string | null;
  crewed: boolean;
  slots: SalvageSlot[];
}

const PLACE_WORDS: [RegExp, string][] = [
  [/front/i, 'Front'],
  [/left/i, 'Left'],
  [/right/i, 'Right'],
  [/rear|back/i, 'Rear'],
  [/top/i, 'Top'],
];

function placeLabel(hardpoint: string, what: string, i: number, count: number): string {
  const place = PLACE_WORDS.find(([re]) => re.test(hardpoint))?.[1];
  if (place) return `${place} ${what}`;
  return count > 1 ? `${what[0]!.toUpperCase()}${what.slice(1)} ${i + 1}` : `${what[0]!.toUpperCase()}${what.slice(1)}`;
}

const typeOf = (p: Json) => String(p.Type ?? '');
const takes = (p: Json, t: string) =>
  typeOf(p).startsWith(t) || ((p.CompatibleTypes ?? []) as Json[]).some((c) => c.Type === t);

/**
 * Every salvage head on a ship and its module slots. A slot holding the
 * tractor module (or typed for one) is the tractor slot; the rest take
 * scraper modules. Heads stay as the ship comes with them: the two heads in
 * the game differ in how many modules they hold.
 */
export function shipSalvageHeads(ship: Json): SalvageHeadMount[] {
  const out: (SalvageHeadMount & { root: string })[] = [];
  const walk = (ports: Json[] | undefined, path: Json[]) => {
    for (const p of ports ?? []) {
      const here = [...path, p];
      if (typeOf(p).startsWith('SalvageHead') && /salvage/i.test(String(p.Name ?? '') + typeOf(p))) {
        const root = here[0]!;
        const slots: SalvageSlot[] = ((p.Loadout ?? []) as Json[])
          .filter((q) => takes(q, 'SalvageModifier'))
          .map((q) => ({
            id: String(q.HardpointName ?? ''),
            kind: /TractorBeam/i.test(typeOf(q)) ? 'tractor' : 'scraper',
            stockUuid: typeOf(q).startsWith('SalvageModifier') ? str(q.UUID) : null,
          }));
        out.push({
          id: here.map((x) => String(x.HardpointName ?? '')).join('/'),
          label: '',
          root: String(root.HardpointName ?? ''),
          head: str(p.Name),
          crewed: /turret|cab/i.test(String(root.HardpointName ?? '')),
          slots,
        });
        continue;
      }
      walk(p.Loadout, here);
    }
  };
  walk(ship.Loadout, []);
  return out.map(({ root, ...h }, i) => ({
    ...h,
    label: placeLabel(root, /turret|cab/i.test(root) ? 'turret' : 'arm', i, out.length),
  }));
}

export function salvageModuleFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  data: Json;
}): SalvageModule | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const m: Json = s.SalvageModifier ?? s.WeaponModifier?.WeaponStats?.Salvage ?? {};
  const name = str(row.name) ?? str(s.Name);
  if (!name || /template/i.test(row.class_name ?? '')) return null;
  const tractor = /tractor/i.test(`${row.class_name ?? ''} ${s.Type ?? ''}`);
  const maker = str(row.manufacturer_name) ?? str(s.Manufacturer?.Name);
  return {
    uuid: row.uuid,
    name,
    maker: maker === 'Unknown Manufacturer' ? null : maker,
    kind: tractor ? 'tractor' : 'scraper',
    radius: num(m.RadiusMultiplier),
    speed: num(m.SalvageSpeedMultiplier),
    efficiency: num(m.ExtractionEfficiency),
  };
}

/** A module can go in a slot of its own kind (the stock one always fits). Tractor modules don't swap. */
export function salvageModuleFitsSlot(m: SalvageModule, slot: SalvageSlot): boolean {
  if (m.uuid === slot.stockUuid) return true;
  return slot.kind === 'scraper' && m.kind === 'scraper';
}

export const SALVAGE_MODULES_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE type = 'SalvageModifier' AND NOT is_placeholder
`;

// ── Fuel pods (refuelling) ───────────────────────────────────────────────────

export interface FuelPod {
  uuid: string;
  name: string;
  maker: string | null;
  size: number;
  /** SCU, as the pod's own description gives it. */
  capacity: number | null;
  /** Hydrogen and quantum flow modifiers (how fast fuel moves through it). */
  hydrogenFlow: number | null;
  quantumFlow: number | null;
  integrity: number | null;
}

export interface FuelPodSlot {
  id: string;
  label: string;
  minSize: number;
  maxSize: number;
  stockUuid: string | null;
}

export function shipFuelPodSlots(ship: Json): FuelPodSlot[] {
  const out: FuelPodSlot[] = [];
  const walk = (ports: Json[] | undefined) => {
    for (const p of ports ?? []) {
      if (takes(p, 'ExternalFuelTank')) {
        const hp = String(p.HardpointName ?? '');
        const m = /_([LR])(\d+)$/i.exec(hp);
        const label = m
          ? `${m[1]!.toUpperCase() === 'L' ? 'Left' : 'Right'} ${m[2]}`
          : (PLACE_WORDS.find(([re]) => re.test(hp))?.[1] ?? `Pod ${out.length + 1}`);
        out.push({
          id: hp,
          label,
          minSize: num(p.MinSize) ?? num(p.MaxSize) ?? 0,
          maxSize: num(p.MaxSize) ?? 0,
          stockUuid: typeOf(p).startsWith('ExternalFuelTank') ? str(p.UUID) : null,
        });
        continue;
      }
      walk(p.Loadout);
    }
  };
  walk(ship.Loadout);
  return out;
}

const descNum = (text: string, label: string): number | null => {
  const m = new RegExp(`${label}:\\s*([\\d.]+)`, 'i').exec(text);
  return m ? Number(m[1]) : null;
};

/**
 * Fuel pods players can fit: one per pod (the hydrogen- and quantum-filled
 * copies are the same pod). Capacity, flow and integrity are read from the
 * pod's description, which is what the game shows; the files' container
 * size disagrees with it for every pod.
 */
export function fuelPodFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  size?: number | null;
  data: Json;
}): FuelPod | null {
  const s: Json = row.data?.stdItem ?? row.data ?? {};
  const cls = row.class_name ?? '';
  const name = str(row.name) ?? str(s.Name);
  if (!name || !/^FuelPod_/i.test(cls) || /template|_AI_|prefilled/i.test(cls)) return null;
  const text = String(s.Description ?? '');
  return {
    uuid: row.uuid,
    name,
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    size: num(row.size) ?? num(s.Size) ?? 0,
    capacity: descNum(text, 'Capacity'),
    hydrogenFlow: descNum(text, 'Hydrogen Flow Modifier'),
    quantumFlow: descNum(text, 'Quantum Flow Modifier'),
    integrity: descNum(text, 'Max\\. Integrity'),
  };
}

/** The pod a ship's slot holds may be a filled copy: the plain pod with the same name stands for it. */
export function fuelPodFitsSlot(p: FuelPod, slot: FuelPodSlot): boolean {
  return p.size >= slot.minSize && p.size <= slot.maxSize;
}

export const FUEL_PODS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, data FROM scdata.items
  WHERE type = 'ExternalFuelTank' AND NOT is_placeholder
`;
