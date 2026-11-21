// Ship combat maths for Game Tools (v1.44.0): ships' guns and defences read
// from scdata (scunpacked), time to kill, what a fit can kill, and the best
// guns for a goal. Everything here is pure; the API reads the rows and the
// website runs the same code in the browser so changing a gun is instant.
//
// The model, kept deliberately simple and stated on every page that shows it:
// - a share of shots hit (`accuracy`, v1.60.0; the kill table defaults to
//   35%), at full power, and shields don't regenerate under fire;
// - each gun fires at its burst rate until it overheats (ballistic: the files'
//   TimeToOverheat) or empties its capacitor (energy: capacitor shots ÷ rate
//   of fire), then at its sustained rate (`burstSeconds`, v1.60.0);
// - a shield takes `absorption` of each damage type (less `resistance`), the
//   rest goes on towards the hull (ballistic: up to 55% passes through);
// - damage that reaches the hull is multiplied by the armour's multiplier,
//   and a projectile whose damage (per pellet) is at or below the armour's
//   `deflection` for that type does nothing to the hull. The files give the
//   deflection numbers but not the exact rule; this reading is to be checked
//   in game.
// - damage that gets past the shields wears down the armour's health first,
//   counted as one pool (v1.60.0; in game it's worn down section by section,
//   where the shots land), then the main body: the part named "body", else
//   the biggest part. The ship dies when the main body is gone.

import { shipComponentSlots, type ComponentSlot, type ShipComponent } from './components.js';
import { shipMissileRacks, type MissileItem, type MissileRack } from './missiles.js';
import { shipMiningHeads, type MiningHead, type MiningLaser, type MiningModule } from './mining.js';
import {
  shipFuelPodSlots,
  shipSalvageHeads,
  type FuelPod,
  type FuelPodSlot,
  type SalvageHeadMount,
  type SalvageModule,
} from './industry.js';

export type DamageType = 'physical' | 'energy';
export interface DamagePair {
  physical: number;
  energy: number;
}

export type GunKind = 'Ballistic' | 'Energy' | 'Distortion' | 'Mixed';

export interface CombatGun {
  uuid: string;
  className: string;
  name: string;
  maker: string | null;
  size: number;
  grade: number | null;
  kind: GunKind;
  burstDps: number;
  sustainedDps: number;
  /** Damage of one shot, all pellets together. */
  alpha: number;
  alphaSplit: DamagePair & { distortion: number };
  pellets: number;
  fireRate: number | null;
  /**
   * Seconds of burst fire before the gun drops to its sustained rate (v1.60.0):
   * time to overheat (ballistic) or capacitor shots ÷ rate of fire (energy).
   * Null when the files don't say: the burst rate is then used throughout.
   */
  burstSeconds?: number | null;
  range: number | null;
  speed: number | null;
  /** Other items with exactly these numbers (skins, variants), grouped under this one. */
  variants?: number;
  // v1.47.0: the rest of what the swap window shows (all from the game files).
  /** "Repeater", "Cannon", "Gatling", "Scattergun", "Mass Driver"… (null when the file doesn't say). */
  family?: string | null;
  /** Penetration distance of a shot (m). */
  pen?: number | null;
  /** Spread (degrees, the mode's maximum). */
  spread?: number | null;
  /** Power it draws (segments) and its EM signature. */
  powerDraw?: number | null;
  em?: number | null;
  /** Ballistic magazine (rounds); energy guns have a capacitor instead. */
  ammo?: number | null;
  capacitor?: number | null;
  hp?: number | null;
  /** The item's tags, and the tags a port (or the ship around it) must offer for it to fit: bespoke guns like the Wolf's. */
  tags: string[];
  requiredTags: string[];
}

export interface GunSlot {
  /** Stable id: the path of hardpoint names. */
  id: string;
  label: string;
  minSize: number;
  maxSize: number;
  /** In a crewed or remote turret rather than flown by the pilot. */
  turret: boolean;
  /** The mount the gun sits in (a gimbal), if any. */
  mount: string | null;
  stockGunUuid: string | null;
  /** Tags a gun must carry to go here (the port's RequiredTags). */
  requiredTags: string[];
  /** Tags this port and everything around it offer (PortTags of the port, its mount and the ship). */
  offeredTags: string[];
}

export interface CombatShip {
  uuid: string;
  className: string;
  name: string;
  maker: string | null;
  career: string | null;
  role: string | null;
  size: number | null;
  crew: number | null;
  shieldHp: number;
  shieldRegen: number;
  absorption: DamagePair;
  resistance: DamagePair;
  armourMult: DamagePair;
  deflection: DamagePair;
  /** Main body HP: what has to go for the ship to be destroyed. */
  hullHp: number;
  hullTotal: number;
  cargo: number | null;
  scm: number | null;
  maxSpeed: number | null;
  qtSpeed: number | null;
  qtSpool: number | null;
  insuranceClaimMin: number | null;
  gunSlots: GunSlot[];
  /** Shields, power plants, coolers, quantum drive and radar (v1.46.0). */
  componentSlots: ComponentSlot[];
  /** Quantum fuel tank, for the drive's range. */
  qtFuelCapacity: number | null;
  // v1.47.0: the panels and missiles on the ship page.
  missileRacks?: MissileRack[];
  flight?: ShipFlight | null;
  hull?: { parts: number; total: number } | null;
  armourHp?: number | null;
  /** Shield resistance and absorption of distortion damage. */
  distortion?: { resistance: number; absorption: number } | null;
  /** Decoys and noise (filled in by the API from the launchers' items). */
  countermeasures?: { decoy: number; noise: number } | null;
  /** Mining laser mounts (v1.50.0); left out on ships without any. */
  miningHeads?: MiningHead[];
  /** Salvage heads and fuel pod slots (v1.51.0); left out on ships without any. */
  salvageHeads?: SalvageHeadMount[];
  fuelPodSlots?: FuelPodSlot[];
}

export interface ShipFlight {
  scm: number | null;
  boostForward: number | null;
  boostBackward: number | null;
  max: number | null;
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
  /** Seconds from a standstill. */
  zeroToScm: number | null;
  zeroToMax: number | null;
  /** Hydrogen tank, SCU. */
  hydrogen: number | null;
}

// ── Reading scdata ────────────────────────────────────────────────────────────

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const tagList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : [];

const isPlaceholderName = (name: string | null) => !name || /PLACEHOLDER|<=|=>/.test(name);

/** Ship guns from `scdata.items` (type WeaponGun). Null when the record has no usable damage numbers. */
export function combatGunFromItem(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  size?: number | null;
  grade?: number | null;
  data: Json;
}): CombatGun | null {
  const std: Json = row.data?.stdItem ?? row.data ?? {};
  const w: Json = std.Weapon ?? {};
  const d: Json = w.Damage ?? {};
  const name = str(row.name) ?? str(std.Name) ?? str(row.data?.name);
  if (isPlaceholderName(name)) return null;
  const burst = num(d.Burst) ?? num(d.DpsTotal);
  const sustained = num(d.Sustained) ?? burst;
  const alpha = num(d.AlphaTotal);
  if (!burst || !alpha || !sustained) return null;
  const a: Json = d.Alpha ?? {};
  const split = { physical: num(a.Physical) ?? 0, energy: num(a.Energy) ?? 0, distortion: num(a.Distortion) ?? 0 };
  // Ignore token amounts (the Absolution has 720 distortion and 0.001 energy).
  const parts = (['physical', 'energy', 'distortion'] as const).filter((k) => split[k] > alpha * 0.01);
  const kind: GunKind =
    parts.length > 1
      ? 'Mixed'
      : parts[0] === 'physical'
        ? 'Ballistic'
        : parts[0] === 'distortion'
          ? 'Distortion'
          : 'Energy';
  const mode: Json = Array.isArray(w.Modes) && w.Modes.length ? w.Modes[0] : {};
  return {
    uuid: row.uuid,
    className: row.class_name ?? str(row.data?.className) ?? '',
    name: name as string,
    maker: str(row.manufacturer_name) ?? str(std.Manufacturer?.Name),
    size: num(row.size) ?? num(std.Size) ?? 0,
    grade: num(row.grade) ?? num(std.Grade),
    kind,
    burstDps: burst,
    sustainedDps: sustained,
    alpha,
    alphaSplit: split,
    pellets: Math.max(1, num(mode.PelletsPerShot) ?? 1),
    fireRate: num(w.RateOfFire) ?? num(mode.RoundsPerMinute),
    burstSeconds: gunBurstSeconds(w, num(w.RateOfFire) ?? num(mode.RoundsPerMinute)),
    range: num(w.EffectiveRange) ?? num(w.Range),
    speed: num(std.Ammunition?.Speed),
    family: gunFamily(str(std.DescriptionData?.['Item Type']) ?? (name as string)),
    pen: num(std.Ammunition?.Penetration?.BasePenetrationDistance),
    spread: num(mode.Spread?.Maximum),
    powerDraw: num(std.ResourceNetwork?.Usage?.Power?.Maximum),
    em: num(std.Emission?.Em?.Maximum),
    ammo: num(std.Ammunition?.Capacity) || null,
    capacitor: num(w.Capacitor?.MaxAmmoLoad) || null,
    hp: num(std.Durability?.Health),
    tags: tagList(row.data?.tags ?? std.Tags),
    requiredTags: tagList(std.RequiredTags),
  };
}

/** How long a gun keeps up its burst rate: time to overheat, or its capacitor's shots at its rate of fire. */
export function gunBurstSeconds(w: Json, roundsPerMinute: number | null): number | null {
  const overheat = num(w.Heat?.TimeToOverheat);
  if (overheat && overheat > 0) return overheat;
  const shots = num(w.Capacitor?.MaxAmmoLoad);
  if (shots && shots > 0 && roundsPerMinute && roundsPerMinute > 0)
    return Math.round((shots / (roundsPerMinute / 60)) * 100) / 100;
  return null;
}

const GUN_FAMILIES = [
  'Mass Driver',
  'Scattergun',
  'Repeater',
  'Cannon',
  'Gatling',
  'Railgun',
  'Neutron',
  'Tachyon',
  'Rocket Pod',
  'Laser Beam',
];
/** "Laser Repeater" → "Repeater"; "Distortion Scattergun" → "Scattergun". */
export function gunFamily(text: string): string | null {
  const t = text.toLowerCase();
  return GUN_FAMILIES.find((f) => t.includes(f.toLowerCase())) ?? null;
}

/** Guns with the same group key are the same gun for every purpose here (skins, paint). */
export function gunGroupKey(g: CombatGun): string {
  return [
    g.size,
    g.kind,
    Math.round(g.burstDps),
    Math.round(g.sustainedDps),
    Math.round(g.alpha),
    g.pellets,
    [...g.requiredTags].sort().join(','),
  ].join('|');
}

/**
 * Whether a gun can go in a slot: the right size, carrying every tag the port
 * asks for, and finding every tag it needs on the port, its mount or the ship.
 * Bespoke guns (the Wolf's L-21/L-22, the Vanguard's nose guns…) only fit
 * their own ships, and those ships' locked ports take only them. The stock
 * gun always fits its own slot.
 */
export function gunFitsSlot(g: CombatGun, slot: GunSlot): boolean {
  if (g.uuid === slot.stockGunUuid) return true;
  if (g.size < slot.minSize || g.size > slot.maxSize) return false;
  // Turret-only copies ("…_Turret", e.g. the Attrition-4 at 875 burst) aren't pilot guns (v1.47.0).
  if (!slot.turret && /_turret$/i.test(g.className)) return false;
  const have = new Set(g.tags.map((t) => t.toLowerCase()));
  if (!slot.requiredTags.every((t) => have.has(t.toLowerCase()))) return false;
  const offered = new Set(slot.offeredTags.map((t) => t.toLowerCase()));
  return g.requiredTags.every((t) => offered.has(t.toLowerCase()));
}

/**
 * Gun records in the game files that players can't get. Each entry is a
 * record that some other record already covers properly, so leaving it out
 * loses nothing; keep the reason next to it.
 */
export const UNAVAILABLE_GUNS: { name: string; when: (g: CombatGun) => boolean; why: string }[] = [
  // The real Slayer is the Tumbril Nova's cannon (requires TMBL_Nova). This
  // copy has no ship tag and no maker tag, isn't stock anywhere and isn't sold.
  {
    name: 'Slayer Cannon',
    when: (g) => g.requiredTags.length === 0,
    why: 'Untagged copy of the Nova tank\u2019s cannon; not obtainable.',
  },
];

export function isUnavailableGun(g: CombatGun): boolean {
  return UNAVAILABLE_GUNS.some((u) => u.name === g.name && u.when(g));
}

/** Same numbers, different paint: keep one per group, the plainest name, and count the rest. */
export function dedupeGuns(guns: CombatGun[]): CombatGun[] {
  const key = gunGroupKey;
  const groups = new Map<string, CombatGun[]>();
  for (const g of guns) {
    const k = key(g);
    const list = groups.get(k);
    if (list) list.push(g);
    else groups.set(k, [g]);
  }
  const out: CombatGun[] = [];
  for (const list of groups.values()) {
    const pick = [...list].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))[0]!;
    out.push({ ...pick, variants: list.length - 1 });
  }
  return out.sort((a, b) => b.sustainedDps - a.sustainedDps || a.name.localeCompare(b.name));
}

/** "hardpoint_weapon_gun_class1_left_wing" → "Left wing"; "hardpoint_gun_nose" → "Nose". */
export function humanHardpoint(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/(front|rear|top|bottom|upper|lower|nose|tail)(left|right|center|centre)/g, '$1 $2')
    .split(/[_\s]+/)
    .filter((w) => w && !/^(hardpoint|weapon|weapons|gun|guns|class\d*|s\d|size\d*|hp|mount|\d+)$/.test(w));
  const s = words.join(' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : 'Gun';
}

/** Every gun port on a ship (pilot and turrets), with the stock gun in it. */
export function shipGunSlots(ship: Json): GunSlot[] {
  const slots: GunSlot[] = [];
  const walk = (
    ports: Json[] | undefined,
    path: string[],
    inTurret: boolean,
    mount: Json | null,
    offered: string[],
  ) => {
    for (const p of ports ?? []) {
      const type = String(p.Type ?? '');
      const types: string[] = (p.CompatibleTypes ?? []).map((t: Json) => String(t.Type ?? ''));
      const here = [...path, String(p.HardpointName ?? '')];
      const turretHere =
        inTurret ||
        type.startsWith('TurretBase') ||
        (/turret/i.test(String(p.Name ?? '')) && !/gimbal/i.test(String(p.Name ?? '')));
      if (type.startsWith('WeaponGun') || (types.includes('WeaponGun') && !type.startsWith('Turret'))) {
        const label = humanHardpoint(String((mount ?? p).HardpointName ?? p.HardpointName ?? ''));
        slots.push({
          id: here.join('/'),
          label,
          minSize: num(p.MinSize) ?? num(p.MaxSize) ?? 0,
          maxSize: num(p.MaxSize) ?? 0,
          turret: turretHere,
          mount: mount ? str(mount.Name) : null,
          stockGunUuid: type.startsWith('WeaponGun') ? str(p.UUID) : null,
          requiredTags: tagList(p.RequiredTags),
          offeredTags: [...new Set([...offered, ...tagList(p.PortTags)])],
        });
        continue;
      }
      const isMount = type.startsWith('Turret.') && types.includes('WeaponGun');
      walk(p.Loadout, here, turretHere && !isMount ? true : turretHere, isMount ? p : mount, [
        ...offered,
        ...tagList(p.PortTags),
      ]);
    }
  };
  walk(ship.Loadout, [], false, null, tagList(ship.PortTags));
  return slots;
}

function shipFlight(s: Json): ShipFlight | null {
  const fc: Json = s.FlightCharacteristics ?? {};
  const ifcs: Json = fc.IFCS ?? {};
  const out: ShipFlight = {
    scm: num(fc.Speeds?.Scm) ?? num(ifcs.ScmSpeed),
    boostForward: num(fc.Speeds?.BoostForward) ?? num(ifcs.BoostSpeedForward),
    boostBackward: num(fc.Speeds?.BoostBackward) ?? num(ifcs.BoostSpeedBackward),
    max: num(fc.Speeds?.Max) ?? num(ifcs.MaxSpeed),
    pitch: num(ifcs.Pitch) ?? num(s.Agility?.Pitch),
    yaw: num(ifcs.Yaw) ?? num(s.Agility?.Yaw),
    roll: num(ifcs.Roll) ?? num(s.Agility?.Roll),
    zeroToScm: num(fc.Timing?.ZeroToScm),
    zeroToMax: num(fc.Timing?.ZeroToMax),
    hydrogen: num(s.Propulsion?.FuelCapacity) != null ? num(s.Propulsion?.FuelCapacity)! / 1000 : null,
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

/** Every damageable part of the hull: how many, and their HP added up (Erkul's "hull"). */
function hullParts(parts: unknown): { parts: number; total: number } | null {
  let count = 0;
  let total = 0;
  const walk = (p: Json) => {
    const hp = num(p.DamageMax);
    if (hp) {
      count++;
      total += hp;
    }
    for (const c of Array.isArray(p.Children) ? p.Children : []) walk(c);
  };
  for (const p of Array.isArray(parts) ? parts : parts && typeof parts === 'object' ? [parts] : []) walk(p as Json);
  return count ? { parts: count, total } : null;
}

/** A ship's defences and headline numbers from `scdata.ships` (ships.json record). */
export function combatShipFromRow(row: {
  uuid: string;
  class_name?: string | null;
  name?: string | null;
  manufacturer_name?: string | null;
  career?: string | null;
  role?: string | null;
  size?: number | null;
  crew?: number | null;
  data: Json;
}): CombatShip | null {
  const s = row.data ?? {};
  const sh: Json = s.ShieldsTotal ?? {};
  const ar: Json = s.Armor ?? {};
  const parts: Json[] = Array.isArray(s.DamageBeforeDestruction) ? s.DamageBeforeDestruction : [];
  const body =
    parts.find((p) => /^body$/i.test(String(p.Name ?? ''))) ??
    [...parts].sort((a, b) => (num(b.HP) ?? 0) - (num(a.HP) ?? 0))[0];
  const hullHp = num(body?.HP) ?? num(s.Health);
  const name = str(row.name) ?? str(s.Name);
  if (!name || !hullHp) return null;
  const pair = (o: Json | undefined, pick: (v: Json) => unknown, fallback: DamagePair): DamagePair => ({
    physical: num(o?.Physical !== undefined ? pick(o.Physical) : undefined) ?? fallback.physical,
    energy: num(o?.Energy !== undefined ? pick(o.Energy) : undefined) ?? fallback.energy,
  });
  const id = (v: unknown) => v;
  const max = (v: Json) => (typeof v === 'object' && v ? v.Maximum : v);
  return {
    uuid: row.uuid,
    className: row.class_name ?? str(s.ClassName) ?? '',
    name,
    maker: str(row.manufacturer_name) ?? str(s.Manufacturer?.Name),
    career: str(row.career) ?? str(s.Career),
    role: str(row.role) ?? str(s.Role),
    size: num(row.size) ?? num(s.Size),
    crew: num(row.crew) ?? num(s.Crew),
    shieldHp: num(sh.Hp) ?? 0,
    shieldRegen: num(sh.Regen) ?? 0,
    absorption: pair(sh.Absorption, max, { physical: 0.45, energy: 1 }),
    resistance: pair(sh.Resistance, max, { physical: 0.25, energy: 0 }),
    armourMult: pair(ar.DamageMultipliers, id, { physical: 1, energy: 1 }),
    deflection: pair(ar.Deflection, id, { physical: 0, energy: 0 }),
    hullHp,
    hullTotal: num(s.Health) ?? hullHp,
    cargo: num(s.Cargo?.CargoGrid) ?? num(s.Cargo?.Total) ?? (typeof s.Cargo === 'number' ? s.Cargo : null),
    scm: num(s.FlightCharacteristics?.IFCS?.ScmSpeed) ?? num(s.FlightCharacteristics?.ScmSpeed),
    maxSpeed: num(s.FlightCharacteristics?.IFCS?.MaxSpeed) ?? num(s.FlightCharacteristics?.MaxSpeed),
    qtSpeed: num(s.QuantumTravel?.Speed),
    qtSpool: num(s.QuantumTravel?.SpoolTime),
    insuranceClaimMin: num(s.Insurance?.StandardClaimTime),
    gunSlots: shipGunSlots(s),
    componentSlots: shipComponentSlots(s),
    qtFuelCapacity: num(s.QuantumTravel?.FuelCapacity),
    missileRacks: shipMissileRacks(s),
    flight: shipFlight(s),
    hull: hullParts(s.Parts),
    armourHp: num(ar.Health),
    distortion: {
      resistance: num(max(sh.Resistance?.Distortion ?? {})) ?? 0,
      absorption: num(max(sh.Absorption?.Distortion ?? {})) ?? 1,
    },
    countermeasures: null,
    ...(() => {
      const heads = shipMiningHeads(s);
      return heads.length ? { miningHeads: heads } : {};
    })(),
    ...(() => {
      const heads = shipSalvageHeads(s);
      return heads.length ? { salvageHeads: heads } : {};
    })(),
    ...(() => {
      const pods = shipFuelPodSlots(s);
      return pods.length ? { fuelPodSlots: pods } : {};
    })(),
  };
}

// ── Time to kill ─────────────────────────────────────────────────────────────

/**
 * burst: the burst rate throughout · sustained: the sustained rate throughout ·
 * real: the burst rate until each gun overheats or empties its capacitor, then
 * sustained (v1.60.0).
 */
export type FireMode = 'burst' | 'sustained' | 'real';

export interface KillOptions {
  /** Share of shots that hit, 0–1 (default 1: every shot). */
  accuracy?: number;
}

/** What the kill table assumes unless the viewer picks another (v1.60.0). */
export const DEFAULT_ACCURACY = 0.35;

export interface KillResult {
  /** Seconds to destroy the main body; Infinity when this fit can't. */
  seconds: number;
  /** Seconds to drop the shields (Infinity: never; may be more than `seconds` when ballistics kill through them). */
  shieldSeconds: number;
  /** Seconds until the armour's health is gone (0 when it has none; Infinity: never). v1.60.0. */
  armourSeconds: number;
  /** At the burst rate and the accuracy used. */
  shieldDps: number;
  /** Hull damage per second while the shields are up (what gets through them). */
  throughShieldDps: number;
  /** Hull damage per second once the shields are down. */
  hullDps: number;
  /** One volley of every gun: to the shields, to the hull through the shields, to the hull once they're down. */
  volleyShield: number;
  volleyThrough: number;
  volleyHull: number;
  /** Guns the target's armour stops completely (every pellet at or below its deflection). */
  stopped: string[];
  /** Seconds until the first gun drops to its sustained rate (real mode; null if none does). */
  firstSlowdown: number | null;
}

export function killTime(
  guns: CombatGun[],
  t: CombatShip,
  mode: FireMode = 'burst',
  opts: KillOptions = {},
): KillResult {
  const accuracy = Math.min(1, Math.max(0, opts.accuracy ?? 1));
  // Per gun, at its burst rate: damage per second to the shields, through them to the hull, and to the hull once they're down.
  const per: { sh: number; th: number; hu: number; slow: number; until: number }[] = [];
  let vS = 0,
    vT = 0,
    vH = 0;
  const stopped: string[] = [];
  for (const g of guns) {
    const rate = g.burstDps;
    let reaches = false;
    let sh = 0,
      th = 0,
      hu = 0;
    for (const k of ['physical', 'energy'] as DamageType[]) {
      const part = g.alphaSplit[k];
      if (part <= 0 || g.alpha <= 0) continue;
      const f = part / g.alpha;
      const perPellet = part / g.pellets;
      const abs = t.absorption[k],
        res = t.resistance[k],
        m = t.armourMult[k],
        defl = t.deflection[k];
      sh += rate * f * abs * (1 - res);
      vS += part * abs * (1 - res);
      if (perPellet * (1 - abs) > defl) {
        th += rate * f * (1 - abs) * m;
        vT += part * (1 - abs) * m;
      }
      if (perPellet > defl) {
        hu += rate * f * m;
        vH += part * m;
        reaches = true;
      }
    }
    if (!reaches && (g.alphaSplit.physical > 0 || g.alphaSplit.energy > 0)) stopped.push(g.name);
    // How the gun's rate scales: 1 at burst, sustained/burst after it slows down.
    const slow = g.burstDps > 0 ? g.sustainedDps / g.burstDps : 1;
    const until =
      mode === 'burst'
        ? Infinity
        : mode === 'sustained'
          ? 0
          : g.burstSeconds && g.burstSeconds > 0
            ? g.burstSeconds
            : Infinity;
    per.push({ sh, th, hu, slow, until });
  }
  const at = (time: number) => {
    let sh = 0,
      th = 0,
      hu = 0;
    for (const p of per) {
      const k = (time < p.until ? 1 : p.slow) * accuracy;
      sh += p.sh * k;
      th += p.th * k;
      hu += p.hu * k;
    }
    return { sh, th, hu };
  };
  const base = {
    shieldDps: per.reduce((a, p) => a + p.sh, 0) * accuracy,
    throughShieldDps: per.reduce((a, p) => a + p.th, 0) * accuracy,
    hullDps: per.reduce((a, p) => a + p.hu, 0) * accuracy,
    volleyShield: vS,
    volleyThrough: vT,
    volleyHull: vH,
    stopped,
    firstSlowdown: null as number | null,
  };
  if (mode === 'real') {
    const first = Math.min(...per.map((p) => p.until));
    base.firstSlowdown = isFinite(first) ? first : null;
  }

  // Walk the fight from one event to the next: a pool emptied or a gun slowing down.
  const switches = [...new Set(per.map((p) => p.until).filter((u) => u > 0 && isFinite(u)))].sort((a, b) => a - b);
  let time = 0;
  let shield = Math.max(0, t.shieldHp);
  let armour = Math.max(0, t.armourHp ?? 0);
  let body = t.hullHp;
  let shieldSeconds = shield <= 0 ? 0 : Infinity;
  let armourSeconds = armour <= 0 ? 0 : Infinity;
  for (let step = 0; step < 200 && body > 0; step++) {
    const r = at(time);
    const next = switches.find((u) => u > time) ?? Infinity;
    // Damage past the shields this phase, and to them.
    const toShield = shield > 0 ? r.sh : 0;
    const toHull = shield > 0 ? r.th : r.hu;
    const tShield = toShield > 0 ? shield / toShield : Infinity;
    const tPool = toHull > 0 ? (armour > 0 ? armour : body) / toHull : Infinity;
    const dt = Math.min(next - time, shield > 0 ? tShield : Infinity, tPool);
    if (!isFinite(dt)) break; // nothing more happens: it never dies
    time += dt;
    if (shield > 0) {
      shield = dt === tShield ? 0 : shield - toShield * dt;
      if (shield <= 1e-9) {
        shield = 0;
        shieldSeconds = time;
      }
    }
    if (armour > 0) {
      armour = dt === tPool ? 0 : armour - toHull * dt;
      if (armour <= 1e-9) {
        armour = 0;
        armourSeconds = time;
      }
    } else {
      body = dt === tPool ? 0 : body - toHull * dt;
      if (body <= 1e-9) body = 0;
    }
  }
  const seconds = body <= 0 ? time : Infinity;
  // Killed through the shields: say how long they'd have lasted.
  if (body <= 0 && shield > 0) {
    const r = at(time);
    shieldSeconds = r.sh > 0 ? time + shield / r.sh : Infinity;
  }
  return { ...base, seconds, shieldSeconds, armourSeconds };
}

export type KillVerdict = 'quick' | 'workable' | 'slow' | 'long' | 'no-hull' | 'never';

export function killVerdict(r: Pick<KillResult, 'seconds' | 'shieldSeconds'>): KillVerdict {
  if (!isFinite(r.seconds)) return isFinite(r.shieldSeconds) ? 'no-hull' : 'never';
  if (r.seconds <= 10) return 'quick';
  if (r.seconds <= 30) return 'workable';
  if (r.seconds <= 120) return 'slow';
  return 'long';
}

export const KILL_VERDICT_WORDS: Record<KillVerdict, string> = {
  quick: 'Quick kill',
  workable: 'Workable',
  slow: 'Slow',
  long: 'Not worth it',
  'no-hull': 'Can’t hurt hull',
  never: 'Can’t kill',
};

/** "4.2 s", "2 min 6 s", "never". */
export function formatKillTime(seconds: number): string {
  if (!isFinite(seconds)) return 'never';
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60),
    s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

// ── Best fits ────────────────────────────────────────────────────────────────

export type FitGoal = 'target' | 'sustained' | 'burst' | 'alpha';

export interface FitSlotInput {
  id: string;
  /** Guns that fit this slot. */
  candidates: CombatGun[];
  /** Keep this gun (the slot is locked). */
  locked?: CombatGun | null;
}

export interface FitResult {
  /** One gun per slot, in the order the slots were given. */
  guns: CombatGun[];
  burst: number;
  sustained: number;
  alpha: number;
  vsTarget: { burst: KillResult; sustained: KillResult } | null;
}

const totals = (guns: CombatGun[]) => ({
  burst: guns.reduce((s, g) => s + g.burstDps, 0),
  sustained: guns.reduce((s, g) => s + g.sustainedDps, 0),
  alpha: guns.reduce((s, g) => s + g.alpha, 0),
});

function compareFits(goal: FitGoal) {
  return (a: FitResult, b: FitResult): number => {
    if (goal === 'target' && a.vsTarget && b.vsTarget) {
      const ta = a.vsTarget.burst.seconds,
        tb = b.vsTarget.burst.seconds;
      if (ta !== tb) return (isFinite(ta) ? ta : 1e15) - (isFinite(tb) ? tb : 1e15);
      return (
        b.vsTarget.burst.volleyHull +
        b.vsTarget.burst.volleyThrough -
        (a.vsTarget.burst.volleyHull + a.vsTarget.burst.volleyThrough)
      );
    }
    const key = goal === 'alpha' ? 'alpha' : goal === 'burst' ? 'burst' : 'sustained';
    return b[key as 'alpha'] - a[key as 'alpha'] || b.sustained - a.sustained;
  };
}

/** k-multisets of `items` (combinations with repetition), as index lists. */
function multisets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

const choose = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

/**
 * The best guns for `goal` across the given slots. Slots that take the same
 * guns are filled as a group (order doesn't matter), and each group's choice
 * is narrowed to its strongest candidates so the search stays under
 * `maxEvaluations` fits.
 */
export function bestGunFits(
  slots: FitSlotInput[],
  goal: FitGoal,
  target: CombatShip | null,
  opts: { limit?: number; maxEvaluations?: number } = {},
): FitResult[] {
  const limit = opts.limit ?? 3;
  const maxEval = opts.maxEvaluations ?? 150_000;
  if (goal === 'target' && !target) throw new Error('bestGunFits: a target is needed for the "target" goal');

  const evaluate = (guns: CombatGun[]): FitResult => ({
    guns,
    ...totals(guns),
    vsTarget: target
      ? { burst: killTime(guns, target, 'burst'), sustained: killTime(guns, target, 'sustained') }
      : null,
  });

  // Group open slots by the guns they take.
  type Group = { slotIdx: number[]; cands: CombatGun[] };
  const groups = new Map<string, Group>();
  slots.forEach((s, i) => {
    if (s.locked) return;
    const key = s.candidates
      .map((c) => c.uuid)
      .sort()
      .join(',');
    const g = groups.get(key);
    if (g) g.slotIdx.push(i);
    else groups.set(key, { slotIdx: [i], cands: s.candidates });
  });
  const list = [...groups.values()].filter((g) => g.cands.length > 0);

  // Rank each group's candidates on their own, then keep the top K.
  const single = (g: CombatGun, n: number): number => {
    if (goal === 'target' && target) {
      const r = killTime(Array(n).fill(g), target, 'burst');
      return isFinite(r.seconds) ? r.seconds : 1e12 - (r.volleyHull + r.volleyThrough);
    }
    return -(goal === 'alpha' ? g.alpha : goal === 'burst' ? g.burstDps : g.sustainedDps);
  };
  const ranked = list.map((g) =>
    [...g.cands].sort((a, b) => single(a, g.slotIdx.length) - single(b, g.slotIdx.length)),
  );
  const ks = ranked.map((r) => Math.min(r.length, 14));
  const count = () => ks.reduce((p, k, i) => p * choose(k + list[i]!.slotIdx.length - 1, list[i]!.slotIdx.length), 1);
  while (count() > maxEval) {
    const i = ks.indexOf(Math.max(...ks));
    if (ks[i]! <= 2) break;
    ks[i]!--;
  }

  const options = list.map((g, i) => multisets(ks[i]!, g.slotIdx.length).map((idx) => idx.map((x) => ranked[i]![x]!)));
  const results: FitResult[] = [];
  const cmp = compareFits(goal);
  const base: (CombatGun | null)[] = slots.map((s) => s.locked ?? null);
  const rec = (gi: number, fill: (CombatGun | null)[]) => {
    if (gi === options.length) {
      if (fill.some((g) => !g)) return;
      const r = evaluate(fill as CombatGun[]);
      results.push(r);
      if (results.length > limit * 50) {
        results.sort(cmp);
        results.length = limit * 10;
      }
      return;
    }
    for (const choice of options[gi]!) {
      const next = [...fill];
      list[gi]!.slotIdx.forEach((slot, j) => {
        next[slot] = choice[j]!;
      });
      rec(gi + 1, next);
    }
  };
  rec(0, base);
  results.sort(cmp);
  // Drop fits that are the same guns in a different order of groups.
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    const key = r.guns
      .map((g) => g.uuid)
      .sort()
      .join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, limit);
}

/** "2× Predator Scattergun + Sledge III Mass Driver". */
export function describeGuns(guns: CombatGun[]): string {
  const counts = new Map<string, number>();
  for (const g of guns) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${c}× ${n}` : n)).join(' + ');
}

// ── What the website loads ───────────────────────────────────────────────────

export interface GameToolsShip extends CombatShip {
  imageUrl: string | null;
  thumbUrl: string | null;
}

/** GET /api/game-tools/data: every ship and ship gun of the current game build. Public. */
export interface GameToolsDataDto {
  build: string | null;
  commit: string | null;
  ships: GameToolsShip[];
  /** Ship guns, skins grouped (`variants`). Includes every stock gun, grouped or not. */
  guns: CombatGun[];
  /** Ship components players can fit, plus every stock one (v1.46.0). */
  components: ShipComponent[];
  /** Missiles, copies grouped (v1.47.0). */
  missiles?: MissileItem[];
  /** Mining lasers players can fit plus every stock one, and mining modules (v1.50.0). */
  miningLasers?: MiningLaser[];
  miningModules?: MiningModule[];
  /** Salvage modules and fuel pods (v1.51.0). */
  salvageModules?: SalvageModule[];
  fuelPods?: FuelPod[];
}

/** SQL for the rows `combatShipFromRow` reads: flying ships only. */
export const GAME_TOOLS_SHIPS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, career, role, size, crew, data
  FROM scdata.ships
  WHERE coalesce(is_spaceship, true) AND name IS NOT NULL AND name !~ 'PLACEHOLDER'
    AND class_name !~* '(_display|_showdown|_fw_[0-9]+|template|tutorial|_unmanned|_ai$|_ai_)'
`;

/** SQL for the rows `combatGunFromItem` reads. */
export const GAME_TOOLS_GUNS_SQL = `
  SELECT uuid, class_name, name, manufacturer_name, size, grade, data
  FROM scdata.items
  WHERE type = 'WeaponGun' AND NOT is_placeholder AND NOT is_fps
`;
