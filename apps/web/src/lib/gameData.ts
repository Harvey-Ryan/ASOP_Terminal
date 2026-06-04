import blueprintsRaw  from '@gamedata/Blueprints.json'
import missionsRaw    from '@gamedata/Missions.json'
import resourcesRaw   from '@gamedata/Resources.json'
import fpsArmorRaw    from '@gamedata/FpsArmor.json'
import scRaw          from '@gamedata/ShipComponents.json'
import swRaw          from '@gamedata/ShipWeapons.json'
import fwRaw          from '@gamedata/FpsWeapons.json'
import fpsAttachRaw   from '@gamedata/FpsAttachments.json'
import consumablesRaw from '@gamedata/Consumables.json'
import backpacksRaw   from '@gamedata/Backpacks.json'
import fpsToolsRaw    from '@gamedata/FPSTools.json'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocalStatSegment {
  qMin: number; qMax: number; mStart: number; mEnd: number;
}

export interface LocalStat {
  key: string;
  label: string;
  qualityMin: number;
  qualityMax: number;
  multiplierAtMin: number;
  multiplierAtMax: number;
  curve: string;
  segments: LocalStatSegment[] | null;
  unitFormat: string | null;
}

export interface LocalMaterial {
  uuid: string;
  name: string;
  kind: 'resource' | 'item' | 'group';
  quantityScu: number | null;
  quantity: number | null;
  minQuality: number;
}

export interface LocalComponent {
  slot: string;
  material: LocalMaterial;
  stats: LocalStat[];
}

export interface LocalDismantleReturn {
  name: string;
  quantityScu: number | null;
  quantity: number | null;
}

export interface LocalDismantle {
  timeSecs: number;
  efficiency: number;
  returns: LocalDismantleReturn[];
}

export interface LocalBlueprint {
  uuid: string;
  key: string;
  name: string;
  itemUuid: string;
  type: string;
  subtype: string | null;
  grade: string | null;
  craftTimeSecs: number;
  components: LocalComponent[];
  dismantle: LocalDismantle | null;
  missions: string[];
  // Resolved from item file
  manufacturer: string | null;
  mass: number | null;
}

// ── Base-stat shapes returned by getBaseStats ─────────────────────────────────

export interface ArmorBaseStats {
  kind: 'armor';
  resistance: { physical: number; energy: number; distortion: number; thermal: number; biochemical: number; stun: number };
  temperature: { min: number; max: number } | null;
  radiation: { maxCapacity: number; dissipationRate: number } | null;
}
export interface ShieldBaseStats {
  kind: 'shield';
  maxHealth: number;
}
export interface WeaponBaseStats {
  kind: 'weapon';
  modes: Array<{ name: string; rpm: number; alpha: number; dps: number }>;
}
export interface PowerPlantBaseStats {
  kind: 'powerplant';
  powerOutput: number;
}
export interface QuantumDriveBaseStats {
  kind: 'quantumdrive';
  speedMs: number;
  fuelReq10GM: number;
  spoolTime: number;
  cooldownTime: number;
}
export interface GenericBaseStats {
  kind: 'generic';
  hp: number | null;
}

export type ItemBaseStats =
  | ArmorBaseStats
  | ShieldBaseStats
  | WeaponBaseStats
  | PowerPlantBaseStats
  | QuantumDriveBaseStats
  | GenericBaseStats;

// ── Internal raw-type helpers ─────────────────────────────────────────────────

type AnyItem = { UUID: string; Name: string; Manufacturer?: { Name?: string; Code?: string } | null };
type ArmorItem = typeof fpsArmorRaw[number];
type ScItem    = typeof scRaw[number];
type SwItem    = typeof swRaw[number];
type FwItem    = typeof fwRaw[number];

// ── Lookup maps ───────────────────────────────────────────────────────────────

const PLACEHOLDER    = '<= PLACEHOLDER =>';
const UNINITIALIZED  = '<= UNINITIALIZED =>';

const resMap = new Map(resourcesRaw.map(r => [r.UUID, r.Name]));

const allItems: AnyItem[] = [
  ...(fpsArmorRaw    as AnyItem[]),
  ...(scRaw          as AnyItem[]),
  ...(swRaw          as AnyItem[]),
  ...(fwRaw          as AnyItem[]),
  ...(fpsAttachRaw   as AnyItem[]),
  ...(consumablesRaw as AnyItem[]),
  ...(backpacksRaw   as AnyItem[]),
  ...(fpsToolsRaw    as AnyItem[]),
];

const itemMetaMap = new Map(
  allItems.map(i => [i.UUID, {
    name:         i.Name !== PLACEHOLDER ? i.Name : null,
    manufacturer: (i.Manufacturer?.Name && i.Manufacturer.Name !== PLACEHOLDER) ? i.Manufacturer.Name : null,
  }]),
);

// Full item maps for base-stat lookups
const armorMap = new Map(fpsArmorRaw.map(i => [i.UUID, i as ArmorItem]));
const scMap    = new Map(scRaw.map(i    => [i.UUID, i as ScItem]));
const fwMap    = new Map(fwRaw.map(i    => [i.UUID, i as FwItem]));
const swMap    = new Map(swRaw.map(i    => [i.UUID, i as SwItem]));

// ── Blueprint pre-processing ──────────────────────────────────────────────────

function resolveMaterialName(uuid: string | null, kind: string): string {
  if (!uuid) return 'Unknown';
  if (kind === 'resource') return resMap.get(uuid) ?? uuid;
  return itemMetaMap.get(uuid)?.name ?? uuid;
}

function processBlueprint(b: typeof blueprintsRaw[number]): LocalBlueprint {
  const meta = itemMetaMap.get(b.ItemUUID);
  const name = (b.Name && b.Name !== PLACEHOLDER) ? b.Name : (meta?.name ?? b.Type);

  const components: LocalComponent[] = b.Components.map(c => ({
    slot: c.Slot,
    material: {
      uuid:        c.Material.UUID ?? '',
      name:        c.Material.Name ?? resolveMaterialName(c.Material.UUID, c.Material.Kind),
      kind:        c.Material.Kind as 'resource' | 'item' | 'group',
      quantityScu: c.Material.QuantityScu ?? null,
      quantity:    c.Material.Quantity    ?? null,
      minQuality:  c.Material.MinQuality  ?? 0,
    },
    stats: c.Stats
      .filter(s => s.Key != null && s.MultiplierAtMin != null && s.MultiplierAtMax != null)
      .map(s => ({
        key:            s.Key!,
        label:          s.Label ?? s.Key!,
        qualityMin:     s.QualityMin  ?? 0,
        qualityMax:     s.QualityMax  ?? 1000,
        multiplierAtMin: s.MultiplierAtMin!,
        multiplierAtMax: s.MultiplierAtMax!,
        curve:          s.Curve ?? 'linear',
        segments:       s.Segments
          ? (s.Segments as unknown as Array<{ QMin: number; QMax: number; MStart: number; MEnd: number }>)
              .map(seg => ({ qMin: seg.QMin, qMax: seg.QMax, mStart: seg.MStart, mEnd: seg.MEnd }))
          : null,
        unitFormat: s.UnitFormat ?? null,
      })),
  }));

  const dismantle: LocalDismantle | null = (b.Dismantle && typeof b.Dismantle.TimeSeconds === 'number')
    ? {
        timeSecs:   b.Dismantle.TimeSeconds,
        efficiency: b.Dismantle.Efficiency ?? 0.5,
        returns: (b.Dismantle.Returns ?? []).map(r => ({
          name:        r.Name ?? resolveMaterialName(r.UUID, r.Kind),
          quantityScu: r.QuantityScu ?? null,
          quantity:    r.Quantity    ?? null,
        })),
      }
    : null;

  return {
    uuid:         b.UUID,
    key:          b.Key,
    name,
    itemUuid:     b.ItemUUID,
    type:         b.Type,
    subtype:      b.Subtype && b.Subtype !== 'UNDEFINED' ? b.Subtype : null,
    grade:        b.Grade   ?? null,
    craftTimeSecs: b.CraftTimeSeconds,
    components,
    dismantle,
    missions:     b.Sources?.Missions ?? [],
    manufacturer: meta?.manufacturer ?? null,
    mass:         null,
  };
}

export const BLUEPRINTS: LocalBlueprint[] = blueprintsRaw.map(processBlueprint);

// Inject mass from armor data (only armor has mass in our files)
for (const bp of BLUEPRINTS) {
  const armor = armorMap.get(bp.itemUuid);
  if (armor && 'Mass' in armor) {
    (bp as { mass: number | null }).mass = (armor as unknown as { Mass: number }).Mass ?? null;
  }
}

const _blueprintByUuid = new Map(BLUEPRINTS.map(b => [b.uuid, b]));

// ── Public API ────────────────────────────────────────────────────────────────

export function getBlueprintByUuid(uuid: string): LocalBlueprint | undefined {
  return _blueprintByUuid.get(uuid);
}

export const OBTAINABLE_BLUEPRINTS: LocalBlueprint[] = BLUEPRINTS.filter(b => b.missions.length > 0);

export const BLUEPRINT_TYPES: string[] = [...new Set(OBTAINABLE_BLUEPRINTS.map(b => b.type))].sort();

export function searchBlueprints(q: string, type?: string): LocalBlueprint[] {
  const query = q.trim().toLowerCase();
  return BLUEPRINTS.filter(b => {
    if (b.missions.length === 0) return false;
    const matchesType = !type || b.type === type;
    const matchesQ    = !query || b.name.toLowerCase().includes(query) || b.type.toLowerCase().includes(query);
    return matchesType && matchesQ;
  });
}

// ── Stat interpolation ────────────────────────────────────────────────────────

export function interpolateStat(stat: LocalStat, ql: number): number {
  if (stat.segments && stat.segments.length > 0) {
    const seg = stat.segments.find(s => ql >= s.qMin && ql <= s.qMax)
             ?? stat.segments[stat.segments.length - 1]!;
    const range = seg.qMax - seg.qMin;
    if (range <= 0) return seg.mStart;
    const t = Math.max(0, Math.min(1, (ql - seg.qMin) / range));
    return seg.mStart + t * (seg.mEnd - seg.mStart);
  }
  const range = stat.qualityMax - stat.qualityMin;
  if (range <= 0) return stat.multiplierAtMin;
  const t = Math.max(0, Math.min(1, (ql - stat.qualityMin) / range));
  return stat.multiplierAtMin + t * (stat.multiplierAtMax - stat.multiplierAtMin);
}

// Returns the combined multiplier for a stat key given an array of [ql] per component slot
export function combinedMultiplier(bp: LocalBlueprint, statKey: string, qls: number[]): number {
  let mult = 1;
  bp.components.forEach((comp, i) => {
    const ql = qls[i] ?? 500;
    for (const s of comp.stats) {
      if (s.key === statKey) mult *= interpolateStat(s, ql);
    }
  });
  return mult;
}

// ── Base stats lookup ─────────────────────────────────────────────────────────

export function getBaseStats(itemUuid: string, type: string): ItemBaseStats | null {
  // Armor
  if (type.startsWith('Char_Armor')) {
    const a = armorMap.get(itemUuid);
    if (!a) return null;
    const r = (a as unknown as { Resistance?: { Physical?: number; Energy?: number; Distortion?: number; Thermal?: number; Biochemical?: number; Stun?: number } }).Resistance;
    const t = (a as unknown as { Temperature?: { Min?: number; Max?: number } }).Temperature;
    const rad = (a as unknown as { Radiation?: { MaxCapacity?: number; DissipationRate?: number } }).Radiation;
    return {
      kind: 'armor',
      resistance: {
        physical:    r?.Physical    ?? 1,
        energy:      r?.Energy      ?? 1,
        distortion:  r?.Distortion  ?? 1,
        thermal:     r?.Thermal     ?? 1,
        biochemical: r?.Biochemical ?? 1,
        stun:        r?.Stun        ?? 1,
      },
      temperature: t ? { min: t.Min ?? 0, max: t.Max ?? 0 } : null,
      radiation:   rad ? { maxCapacity: rad.MaxCapacity ?? 0, dissipationRate: rad.DissipationRate ?? 0 } : null,
    };
  }

  // Shield
  if (type === 'Shield') {
    const s = scMap.get(itemUuid);
    if (!s) return null;
    const shield = (s as unknown as { Shield?: { MaxHealth?: number } }).Shield;
    return { kind: 'shield', maxHealth: shield?.MaxHealth ?? (s as unknown as { HP?: number }).HP ?? 0 };
  }

  // Power plant
  if (type === 'PowerPlant') {
    const p = scMap.get(itemUuid);
    if (!p) return null;
    return { kind: 'powerplant', powerOutput: (p as unknown as { PowerOutput?: number }).PowerOutput ?? 0 };
  }

  // Quantum drive
  if (type === 'QuantumDrive') {
    const q = scMap.get(itemUuid);
    if (!q) return null;
    const qd = (q as unknown as { QuantumDrive?: { StandardJump?: { SpeedMs?: number; SpoolUpTime?: number; CooldownTime?: number }; FuelRequirement10GM?: number } }).QuantumDrive;
    return {
      kind:         'quantumdrive',
      speedMs:      qd?.StandardJump?.SpeedMs     ?? 0,
      fuelReq10GM:  qd?.FuelRequirement10GM        ?? 0,
      spoolTime:    qd?.StandardJump?.SpoolUpTime  ?? 0,
      cooldownTime: qd?.StandardJump?.CooldownTime ?? 0,
    };
  }

  // FPS weapon
  if (type === 'WeaponPersonal') {
    const w = fwMap.get(itemUuid);
    if (!w) return null;
    const weapon = (w as unknown as { Weapon?: { Modes?: Array<{ Name?: string; RPM?: number; Alpha?: number; DPS?: number }> } }).Weapon;
    return {
      kind: 'weapon',
      modes: (weapon?.Modes ?? []).map(m => ({
        name:  m.Name  ?? 'Default',
        rpm:   m.RPM   ?? 0,
        alpha: m.Alpha ?? 0,
        dps:   m.DPS   ?? 0,
      })),
    };
  }

  // Ship weapon
  if (type === 'WeaponGun') {
    const w = swMap.get(itemUuid);
    if (!w) return null;
    const weapon = (w as unknown as { Weapon?: { Modes?: Array<{ Name?: string; RPM?: number; Alpha?: number; DPS?: number }> } }).Weapon;
    return {
      kind: 'weapon',
      modes: (weapon?.Modes ?? []).map(m => ({
        name:  m.Name  ?? 'Default',
        rpm:   m.RPM   ?? 0,
        alpha: m.Alpha ?? 0,
        dps:   m.DPS   ?? 0,
      })),
    };
  }

  // Fallback — show HP only
  const sc = scMap.get(itemUuid);
  if (sc) return { kind: 'generic', hp: (sc as unknown as { HP?: number }).HP ?? null };
  const fw = fwMap.get(itemUuid);
  if (fw) return { kind: 'generic', hp: null };
  return { kind: 'generic', hp: null };
}

// ── Mission contracts ─────────────────────────────────────────────────────────

export interface MissionBlueprintEntry {
  name: string;
  blueprintUuid: string;
}

export interface MissionPool {
  locations: string[];
  blueprints: MissionBlueprintEntry[];
}

export interface MissionContract {
  title: string;
  description: string;
  missionType: string | null;
  missionGiver: string | null;
  faction: string | null;
  locations: string[];
  pools: MissionPool[];
}

type RawMission = typeof missionsRaw[number];
type RawContent = { ItemName: string; ItemUUID: string; BlueprintUUID: string };

function buildMissionContracts(): MissionContract[] {
  const relevant = (missionsRaw as RawMission[]).filter(
    m => Array.isArray((m.BlueprintReward as { Contents?: RawContent[] } | null)?.Contents)
      && ((m.BlueprintReward as { Contents?: RawContent[] }).Contents!.length > 0),
  );

  const byTitle = new Map<string, RawMission[]>();
  for (const m of relevant) {
    const t = m.Title ?? 'Unknown';
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t)!.push(m);
  }

  const result: MissionContract[] = [];

  for (const [title, missions] of byTitle) {
    // Dedup pools by sorted blueprint-UUID fingerprint
    const poolsByFingerprint = new Map<string, { locations: Set<string>; blueprints: MissionBlueprintEntry[] }>();

    for (const m of missions) {
      const contents = ((m.BlueprintReward as { Contents?: RawContent[] }).Contents ?? []);
      const fingerprint = contents.map(c => c.BlueprintUUID).sort().join('|');
      if (!poolsByFingerprint.has(fingerprint)) {
        poolsByFingerprint.set(fingerprint, {
          locations: new Set(Array.isArray(m.Locations) ? m.Locations as string[] : []),
          blueprints: contents.map(c => ({ name: c.ItemName, blueprintUuid: c.BlueprintUUID })),
        });
      } else {
        const entry = poolsByFingerprint.get(fingerprint)!;
        for (const loc of (Array.isArray(m.Locations) ? m.Locations as string[] : [])) {
          entry.locations.add(loc);
        }
      }
    }

    const pools: MissionPool[] = [...poolsByFingerprint.values()].map(p => ({
      locations: [...p.locations].sort(),
      blueprints: p.blueprints,
    }));

    const first = missions[0];
    const rawFaction = first.Faction as string | null;

    result.push({
      title,
      description: (first.Description as string | null) ?? '',
      missionType: (first.MissionType as string | null) ?? null,
      missionGiver: (first.MissionGiver as string | null) ?? null,
      faction: rawFaction && rawFaction !== PLACEHOLDER && rawFaction !== UNINITIALIZED
        ? rawFaction : null,
      locations: [...new Set(pools.flatMap(p => p.locations))].sort(),
      pools,
    });
  }

  return result.sort((a, b) => a.title.localeCompare(b.title));
}

export const MISSION_CONTRACTS: MissionContract[] = buildMissionContracts();
