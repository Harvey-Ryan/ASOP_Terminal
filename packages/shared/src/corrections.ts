// Community corrections (v1.53.0): members fix numbers the game files get
// wrong. A correction never changes the game data; it's a layer on top that
// people can switch off ("Corrected · Game files").
//
// Lifecycle (checks and balances):
//   PENDING   submitted with a screenshot; needs CONFIRMATIONS_NEEDED members
//             (not the submitter) to confirm they see it in game
//   REVIEW    confirmed; waits for a data reviewer who is neither the
//             submitter nor a confirmer
//   LIVE      approved: shown on the site (and the bot), credited
//   DISPUTED  someone challenged a live correction: still shown, flagged,
//             back with the reviewers (uphold → LIVE, revert → REVERTED)
//   RECHECK   a new game build changed the game value: not shown until a
//             reviewer looks again (approve → LIVE, revert → REVERTED)
//   RETIRED   the game files now say the same thing: CIG fixed it (credit kept)
//   REJECTED · REVERTED · WITHDRAWN · SUPERSEDED: closed
//
// The game value is always read by the server from our own data, never sent
// by the browser. Only the stats listed in CORRECTION_KINDS can be corrected.
// Gun mounts (v1.64.0): who fires a ship's turret or gun mount is a 'choice'
// stat, stored as a number (GUN_ROLE_CODES) like every other value.

import { slotRole, humanHardpoint, type GunRole, type GunSlot } from './combat.js';

export type CorrectionStatus =
  | 'PENDING'
  | 'REVIEW'
  | 'LIVE'
  | 'DISPUTED'
  | 'RECHECK'
  | 'RETIRED'
  | 'REJECTED'
  | 'REVERTED'
  | 'WITHDRAWN'
  | 'SUPERSEDED';

/** Shown on the site (the corrected value is used). */
export const APPLIED_STATUSES: readonly CorrectionStatus[] = ['LIVE', 'DISPUTED'];
/** Still being worked on. */
export const OPEN_STATUSES: readonly CorrectionStatus[] = ['PENDING', 'REVIEW', 'RECHECK'];
export const CLOSED_STATUSES: readonly CorrectionStatus[] = [
  'RETIRED',
  'REJECTED',
  'REVERTED',
  'WITHDRAWN',
  'SUPERSEDED',
];

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  PENDING: 'Needs confirming',
  REVIEW: 'Waiting for review',
  LIVE: 'Live',
  DISPUTED: 'Disputed',
  RECHECK: 'Needs a re-check',
  RETIRED: 'Fixed in the game files',
  REJECTED: 'Rejected',
  REVERTED: 'Reverted',
  WITHDRAWN: 'Withdrawn',
  SUPERSEDED: 'Replaced by a newer correction',
};

/** Members (other than the submitter) who must confirm before review. */
export const CONFIRMATIONS_NEEDED = 2;
/** Per person per day. */
export const SUBMITS_PER_DAY = 10;
export const CONFIRMS_PER_DAY = 50;
export const EVIDENCE_PER_DAY = 30;
/** A change bigger than this factor (either way) is flagged, and a reviewer must acknowledge it. */
export const BIG_CHANGE_FACTOR = 3;

export type CorrectionValueType = 'number' | 'integer' | 'choice';

export interface CorrectableField {
  label: string;
  type: CorrectionValueType;
  min?: number;
  max?: number;
  /** Shown after the value: "%", "m"… */
  unit?: string;
  /** For 'choice': the values it can take and their words. */
  choices?: { value: number; label: string }[];
}

/** Who fires a gun mount, as a correction value (v1.64.0). The numbers are stored: never renumber. */
export const GUN_ROLE_CODES: Record<GunRole, number> = { pilot: 0, takeover: 1, crew: 2, auto: 3 };
export const gunRoleFromCode = (code: number): GunRole | null =>
  (Object.entries(GUN_ROLE_CODES).find(([, v]) => v === code)?.[0] as GunRole | undefined) ?? null;
const GUN_ROLE_CHOICES = [
  { value: 0, label: 'Pilot' },
  { value: 1, label: 'Crew turret the pilot can take over' },
  { value: 2, label: 'Crew turret' },
  { value: 3, label: 'Automatic (point defence)' },
];

export interface CorrectionKind {
  /** "Mining laser" */
  label: string;
  /** Where people find it, for the review queue: "Mining → Lasers" */
  where: string;
  fields: Record<string, CorrectableField>;
}

const pct = (label: string): CorrectableField => ({ label, type: 'number', min: -100, max: 1000, unit: '%' });
const MINING_MODS = {
  'modifiers.Resistance': pct('Resistance'),
  'modifiers.Instability': pct('Instability'),
  'modifiers.OptimalChargeWindow': pct('Optimal charge window'),
  'modifiers.OptimalChargeRate': pct('Optimal charge rate'),
  'modifiers.InertMaterials': pct('Inert materials'),
  'modifiers.OverchargeRate': pct('Overcharge rate'),
  'modifiers.ShatterDamage': pct('Shatter damage'),
};

/** What can be corrected, by kind of record. Record keys: lasers/modules/gadgets by uuid, rocks by "rock|method". */
export const CORRECTION_KINDS: Record<string, CorrectionKind> = {
  'mining-laser': {
    label: 'Mining laser',
    where: 'Mining → Lasers',
    fields: {
      power: { label: 'Power', type: 'number', min: 0, max: 100_000 },
      minPower: { label: 'Min power', type: 'number', min: 0, max: 100_000 },
      extraction: { label: 'Extraction', type: 'number', min: 0, max: 100_000 },
      optimalRange: { label: 'Optimal range', type: 'number', min: 0, max: 10_000, unit: 'm' },
      maxRange: { label: 'Max range', type: 'number', min: 0, max: 10_000, unit: 'm' },
      moduleSlots: { label: 'Module slots', type: 'integer', min: 0, max: 6 },
      ...MINING_MODS,
    },
  },
  'mining-module': {
    label: 'Mining module',
    where: 'Mining → Modules',
    fields: {
      power: { label: 'Power multiplier', type: 'number', min: 0, max: 10, unit: '×' },
      charges: { label: 'Uses', type: 'integer', min: 0, max: 100 },
      lifetime: { label: 'Seconds per use', type: 'number', min: 0, max: 3600, unit: 's' },
      ...MINING_MODS,
    },
  },
  'mining-gadget': {
    label: 'Mining gadget',
    where: 'Mining → Gadgets',
    fields: {
      'modifiers.Resistance': pct('Resistance'),
      'modifiers.Instability': pct('Instability'),
      'modifiers.OptimalChargeWindow': pct('Optimal charge window'),
      'modifiers.OptimalChargeRate': pct('Optimal charge rate'),
      'modifiers.ClusterFactor': pct('Cluster'),
    },
  },
  'rock-signature': {
    label: 'Rock',
    where: 'Mining → Rock signatures',
    fields: {
      signature: { label: 'Signature (one rock)', type: 'integer', min: 1, max: 100_000 },
      maxCluster: { label: 'Most in a cluster', type: 'integer', min: 1, max: 100 },
    },
  },
  // v1.64.0: a ship's turret or gun mount. Record key "<ship class>|<mount>" (gunMountKey).
  'gun-mount': {
    label: 'Ship gun mount',
    where: 'Ships → Armament / Turrets',
    fields: {
      role: { label: 'Who fires it', type: 'choice', choices: GUN_ROLE_CHOICES },
    },
  },
};

/** The record key of a ship's turret or gun mount: "<ship class>|<mount hardpoint path>". */
export const gunMountKey = (shipClassName: string, group: string) => `${shipClassName.toLowerCase()}|${group}`;

/** A value as people read it: a choice's words, else the number and its unit. */
export function formatCorrectionValue(kind: string, field: string, value: number | null | undefined): string {
  if (value == null) return '—';
  const f = correctableField(kind, field);
  if (f?.type === 'choice') return f.choices?.find((c) => c.value === value)?.label ?? String(value);
  const text = Number.isInteger(value) ? value.toLocaleString('en-US') : String(Math.round(value * 100) / 100);
  return `${text}${f?.unit ?? ''}`;
}

export const correctableField = (kind: string, field: string): CorrectableField | null =>
  CORRECTION_KINDS[kind]?.fields[field] ?? null;

/** One key per stat of one record. */
export const correctionKey = (kind: string, recordKey: string, field: string) => `${kind}|${recordKey}|${field}`;

/** Reads "modifiers.Resistance" from a record. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** A copy of the record with one value changed (the original is left alone). */
export function withPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const base = (obj ?? {}) as Record<string, unknown>;
  if (!head) return obj;
  return { ...base, [head]: rest.length ? withPath(base[head], rest.join('.'), value) : value } as T;
}

/**
 * The game value of a stat as a number. A percent change the files don't list
 * is 0 (no change); anything else missing is null.
 */
export function gameNumber(record: unknown, field: string): number | null {
  const v = getPath(record, field);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v == null && field.startsWith('modifiers.')) return 0;
  return null;
}

export type ValueCheck = { ok: true; value: number; bigChange: boolean } | { ok: false; error: string };

/** Is this a value the stat can take, and is it a suspiciously big change from the game files? */
export function checkCorrectionValue(kind: string, field: string, gameValue: number | null, raw: unknown): ValueCheck {
  const f = correctableField(kind, field);
  if (!f) return { ok: false, error: 'That stat can’t be corrected.' };
  if (f.type === 'choice') {
    const v = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof v !== 'number' || !(f.choices ?? []).some((c) => c.value === v))
      return { ok: false, error: 'Pick one of the choices.' };
    if (gameValue != null && v === gameValue) return { ok: false, error: 'That’s what the game files already say.' };
    // Any other choice is a plain change: the big-change check is for numbers.
    return { ok: true, value: v, bigChange: false };
  }
  const value = typeof raw === 'string' ? Number(raw.replace(/[,\s%×]/g, '')) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'Enter a number.' };
  if (f.type === 'integer' && !Number.isInteger(value)) return { ok: false, error: 'Enter a whole number.' };
  if (f.min != null && value < f.min) return { ok: false, error: `${f.label} can’t be below ${f.min}.` };
  if (f.max != null && value > f.max) return { ok: false, error: `${f.label} can’t be above ${f.max}.` };
  if (gameValue != null && value === gameValue) return { ok: false, error: 'That’s what the game files already say.' };
  return { ok: true, value, bigChange: isBigChange(gameValue, value) };
}

export function isBigChange(gameValue: number | null, value: number): boolean {
  if (gameValue == null) return true;
  const a = Math.abs(gameValue),
    b = Math.abs(value);
  if (a === 0 || b === 0) return Math.abs(value - gameValue) > 10; // a percent stat going from nothing to more than ±10
  if (Math.sign(value) !== Math.sign(gameValue)) return true;
  return b / a > BIG_CHANGE_FACTOR || a / b > BIG_CHANGE_FACTOR;
}

// ── Who may do what ─────────────────────────────────────────────────────────

export type CorrectionAction = 'confirm' | 'approve' | 'reject' | 'dispute' | 'uphold' | 'revert' | 'withdraw';

export interface CorrectionActor {
  discordId: string;
  /** In at least one server that has ASOP */
  member: boolean;
  /** A data reviewer, or a platform admin */
  reviewer: boolean;
}

export interface CorrectionParties {
  status: CorrectionStatus;
  submittedBy: string;
  confirmedBy: readonly string[];
  disputedBy?: readonly string[];
}

/**
 * What one person may do with one correction. Separation of duties: nobody
 * confirms or approves their own correction, and a confirmer can't also be
 * the reviewer who approves it.
 */
export function correctionActions(c: CorrectionParties, who: CorrectionActor | null): CorrectionAction[] {
  if (!who) return [];
  const mine = who.discordId === c.submittedBy;
  const confirmed = c.confirmedBy.includes(who.discordId);
  const out: CorrectionAction[] = [];
  if (c.status === 'PENDING' && who.member && !mine && !confirmed) out.push('confirm');
  if ((c.status === 'REVIEW' || c.status === 'RECHECK') && who.reviewer && !mine && !confirmed) out.push('approve');
  if ((c.status === 'PENDING' || c.status === 'REVIEW') && who.reviewer && !mine) out.push('reject');
  if (c.status === 'LIVE' && who.member && !mine && !(c.disputedBy ?? []).includes(who.discordId)) out.push('dispute');
  if (c.status === 'DISPUTED' && who.reviewer && !mine) out.push('uphold');
  if ((c.status === 'LIVE' || c.status === 'DISPUTED' || c.status === 'RECHECK') && who.reviewer) out.push('revert');
  if ((c.status === 'PENDING' || c.status === 'REVIEW') && mine) out.push('withdraw');
  return out;
}

/** What a new game build means for an applied correction. */
export function recheckOnNewBuild(
  c: { gameValue: number | null; value: number },
  current: number | null,
): 'keep' | 'retire' | 'recheck' {
  if (current != null && current === c.value) return 'retire'; // CIG fixed it
  if (current === c.gameValue) return 'keep';
  return 'recheck'; // the game value moved somewhere else: look again
}

// ── What the website and the bot get ────────────────────────────────────────

/** An applied correction, as everyone gets it (GET /api/corrections/live). */
export interface LiveCorrectionDto {
  id: string;
  kind: string;
  recordKey: string;
  field: string;
  gameValue: number | null;
  value: number;
  /** "Ryan", or null for "an ASOP member" */
  credit: string | null;
  confirmations: number;
  disputed: boolean;
  /** Build it was seen on */
  build: string | null;
  approvedAt: string | null;
}

export interface LiveCorrectionsDto {
  build: string | null;
  corrections: LiveCorrectionDto[];
}

export interface CorrectionEventDto {
  action: string;
  actor: string | null;
  note: string | null;
  evidenceUrl: string | null;
  at: string;
}

/** One correction in the queue (GET /api/corrections). */
export interface CorrectionDto extends LiveCorrectionDto {
  status: CorrectionStatus;
  recordName: string;
  note: string;
  evidenceUrl: string;
  bigChange: boolean;
  submittedAt: string;
  reviewer: string | null;
  reviewNote: string | null;
  retiredBuild: string | null;
  /** What the signed-in person may do */
  actions: CorrectionAction[];
  mine: boolean;
  youConfirmed: boolean;
  /** Who confirmed: names for reviewers (to check they're independent), otherwise empty */
  confirmers: string[];
  history: CorrectionEventDto[];
}

export interface CorrectionRoleDto {
  signedIn: boolean;
  member: boolean;
  reviewer: boolean;
  platformAdmin: boolean;
}

export interface DataReviewerDto {
  discordId: string;
  username: string;
  addedBy: string | null;
  createdAt: string;
}

/** Live corrections by key, for applying them to records. */
export function correctionIndex(list: readonly LiveCorrectionDto[]): Map<string, LiveCorrectionDto> {
  return new Map(list.map((c) => [correctionKey(c.kind, c.recordKey, c.field), c]));
}

/** Records with their live corrections applied (a new array; untouched records are the same objects). */
export function applyCorrections<T>(
  records: readonly T[],
  kind: string,
  keyOf: (r: T) => string,
  index: ReadonlyMap<string, LiveCorrectionDto>,
): T[] {
  if (!index.size) return [...records];
  const fields = Object.keys(CORRECTION_KINDS[kind]?.fields ?? {});
  return records.map((r) => {
    let out = r;
    for (const f of fields) {
      const c = index.get(correctionKey(kind, keyOf(r), f));
      if (c) out = withPath(out, f, c.value);
    }
    return out;
  });
}

export const rockRecordKey = (r: { rock: string; method: string }) => `${r.rock}|${r.method}`;

// ── Gun mounts (v1.64.0) ────────────────────────────────────────────────────

interface ShipWithSlots {
  className: string;
  name: string;
  gunSlots: GunSlot[];
}

/** A ship's mount positions: one per group of gun slots, with who fires them per the game files. */
export function gunMounts(ship: ShipWithSlots): { group: string; name: string; role: GunRole }[] {
  const out: { group: string; name: string; role: GunRole }[] = [];
  for (const s of ship.gunSlots) {
    const group = s.group ?? s.id;
    if (out.some((m) => m.group === group)) continue;
    out.push({ group, name: s.groupName ?? humanHardpoint(group.split('/').pop() ?? group), role: slotRole(s) });
  }
  return out;
}

/** The game record of one mount, for the corrections system: its name and `{ role: code }`. */
export function gunMountRecord(
  ships: readonly ShipWithSlots[],
  recordKey: string,
): { name: string; record: { role: number } } | null {
  const bar = recordKey.indexOf('|');
  if (bar < 0) return null;
  const cls = recordKey.slice(0, bar);
  const group = recordKey.slice(bar + 1);
  const ship = ships.find((x) => x.className.toLowerCase() === cls);
  const m = ship ? gunMounts(ship).find((x) => x.group === group) : undefined;
  if (!ship || !m) return null;
  return { name: `${ship.name} · ${m.name}`, record: { role: GUN_ROLE_CODES[m.role] } };
}

/**
 * A ship with its live gun-mount corrections applied: each slot of a corrected
 * mount gets the corrected role and `roleCorrected`. Untouched ships come back
 * as the same object.
 */
export function applyGunMountCorrections<T extends ShipWithSlots>(
  ship: T,
  index: ReadonlyMap<string, LiveCorrectionDto>,
): T {
  if (!index.size) return ship;
  let changed = false;
  const gunSlots = ship.gunSlots.map((s) => {
    const c = index.get(correctionKey('gun-mount', gunMountKey(ship.className, s.group ?? s.id), 'role'));
    const role = c ? gunRoleFromCode(c.value) : null;
    if (!role) return s;
    changed = true;
    return { ...s, role, roleCorrected: true };
  });
  return changed ? { ...ship, gunSlots } : ship;
}

/** "Corrected by Ryan, confirmed by 2" */
export function correctionCredit(c: Pick<LiveCorrectionDto, 'credit' | 'confirmations'>): string {
  const who = c.credit ?? 'an ASOP member';
  return `Corrected by ${who}${c.confirmations ? `, confirmed by ${c.confirmations}` : ''}`;
}

// ── Build badge (v1.53.0) ───────────────────────────────────────────────────

/** GET /api/game-tools/build */
export interface GameBuildDto {
  /** "4.10.3-LIVE.13165946" */
  build: string | null;
  syncedAt: string | null;
  /** Newer game data is waiting to be synced; null when that couldn't be checked */
  newerAvailable: boolean | null;
}

/** "4.10.3-LIVE.13165946" → "4.10.3 LIVE" */
export function shortBuild(build: string | null | undefined): string | null {
  if (!build) return null;
  const m = /^(\d+(?:\.\d+)*)[-_ ]?(LIVE|PTU|EPTU|TECH-PREVIEW)?/i.exec(build.trim());
  if (!m) return build;
  return m[2] ? `${m[1]} ${m[2].toUpperCase()}` : m[1]!;
}
