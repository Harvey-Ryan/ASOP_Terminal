// Wikelo's missions (v1.34.0): what each one rewards and what you turn in for
// it, from our sc-data copy (scdata.contracts, mission giver "Wikelo"). Read by
// the website's Wikelo page (GET /api/wikelo) and the bot's /wikelo.
//
// Everyone sees every mission. A person's own checklist (WikeloProgress) is
// kept apart and never changes what the list shows.

import { fillMissionTokens, type ScContractJson } from './crafting.js';

export interface WikeloContractJson extends ScContractJson {
  HaulingOrders?: {
    Kind?: string;
    Name?: string;
    UUID?: string;
    MinAmount?: number;
    MaxAmount?: number;
    MinScu?: number;
    MaxScu?: number;
  }[] | null;
  RewardItems?: { Items?: { Name?: string; UUID?: string; Amount?: number }[] }[] | null;
}

/** Wikelo's missions that are in the game. */
export const WIKELO_CONTRACTS_SQL = `
  SELECT uuid, data FROM scdata.contracts
  WHERE mission_giver = 'Wikelo' AND coalesce(not_for_release, false) = false AND coalesce(work_in_progress, false) = false`;

export type WikeloCategory = 'ships' | 'gear' | 'favors' | 'other';

export const WIKELO_CATEGORIES: { key: WikeloCategory; label: string }[] = [
  { key: 'ships', label: 'Ships & vehicles' },
  { key: 'gear', label: 'Gear' },
  { key: 'favors', label: 'Favors' },
  { key: 'other', label: 'Other' },
];

export const WIKELO_FAVOR = 'Wikelo Favor';

export interface WikeloTurnIn {
  /** Stable key for the checklist: the item's uuid (or its name if it has none) */
  key: string;
  name: string;
  /** How many (items), or null when it's measured in SCU */
  amount: number | null;
  /** How much cargo (resources), or null */
  scu: number | null;
}

export interface WikeloRewardItem { name: string; amount: number }

export interface WikeloMission {
  /** scdata.contracts uuid */
  id: string;
  title: string;
  category: WikeloCategory;
  /**
   * What you get: usually one set of items. A few missions (the arrival and
   * food ones) list several sets; the files don't say how the game picks.
   */
  rewards: WikeloRewardItem[][];
  turnIn: WikeloTurnIn[];
  /** Wikelo Favors in the turn-in (0 if none) */
  favors: number;
  /** The mission's own text, tags removed */
  description: string;
  /** Where to turn in ("Kinga Station") */
  stations: string[];
  onceOnly: boolean;
  shareable: boolean;
  /** A picture of the base ship, for ship rewards the ship list knows (set by the API) */
  image?: string | null;
}

export interface WikeloDataDto {
  build: string | null;
  missions: WikeloMission[];
}

const STATION = /^Wikelo Emporium (.+)$/;

/** "a, b or c" */
const listWords = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

const clean = (s: string) => s
  .replace(/<\/?EM\d*>/g, '')
  .replace(/\r\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

function categoryOf(type: string | undefined, rewards: WikeloRewardItem[][]): WikeloCategory {
  if (type === 'Wikelo - Vehicles') return 'ships';
  const only = rewards.length === 1 && rewards[0]?.length === 1 ? rewards[0][0] : undefined;
  if (only?.name === WIKELO_FAVOR) return 'favors';
  if (type === 'Wikelo - Other Items') return 'gear';
  return 'other';
}

/** One contract → a mission, or null if it has no readable title or nothing to turn in. */
export function buildWikeloMission(id: string, c: WikeloContractJson): WikeloMission | null {
  const title = (c.DisplayTitle && !c.DisplayTitle.startsWith('~') ? c.DisplayTitle : c.Title)?.trim();
  if (!title || title.startsWith('<=')) return null;

  const turnIn: WikeloTurnIn[] = [];
  for (const o of c.HaulingOrders ?? []) {
    const name = o.Name?.trim();
    if (!name) continue;
    const scu = (o.MinScu ?? 0) > 0 ? o.MinScu! : null;
    const amount = scu === null ? Math.max(1, o.MinAmount ?? 1) : null;
    const key = o.UUID || name;
    const same = turnIn.find((t) => t.key === key);
    if (same) { // the same item listed twice: add them up
      if (same.amount !== null && amount !== null) same.amount += amount;
      if (same.scu !== null && scu !== null) same.scu += scu;
      continue;
    }
    turnIn.push({ key, name, amount, scu });
  }
  if (turnIn.length === 0) return null;

  const rewards = (c.RewardItems ?? [])
    .map((g) => (g.Items ?? [])
      .filter((i) => i.Name && (i.Amount ?? 0) > 0)
      .map((i) => ({ name: i.Name!.trim(), amount: i.Amount! })))
    .filter((g) => g.length > 0);

  const stations = new Set<string>();
  for (const pool of Object.values(c.LocationPools ?? {})) {
    for (const l of pool.ResolvedLocations ?? []) {
      const m = l.Name ? STATION.exec(l.Name.trim()) : null;
      if (m?.[1]) stations.add(m[1]);
    }
  }

  // "Bring it to ~mission(destination|ListAll)": any of his stations.
  const rawText = (c.Description ?? '').replace(/<\/?EM\d*>/g, '')
    .replace(/(Wikelo Emporium (at )?)?(~mission\(destination[^)]*\)|\[destination\|[^\]]*\])/gi,
      () => (stations.size ? `Wikelo Emporium (${listWords([...stations].sort())})` : 'a Wikelo Emporium'));
  const description = clean(fillMissionTokens(rawText, c));

  return {
    id,
    title,
    category: categoryOf(c.MissionType?.Name, rewards),
    rewards,
    turnIn,
    favors: turnIn.filter((t) => t.name === WIKELO_FAVOR).reduce((n, t) => n + (t.amount ?? 0), 0),
    description,
    stations: [...stations].sort(),
    onceOnly: c.OnceOnly ?? false,
    shareable: c.Shareable ?? false,
  };
}

/** Every mission, ships first, then by title. Same-titled copies (the game keeps a few) are kept once. */
export function buildWikeloMissions(rows: readonly { uuid: string; data: WikeloContractJson }[]): WikeloMission[] {
  const order: Record<WikeloCategory, number> = { ships: 0, gear: 1, favors: 2, other: 3 };
  const seen = new Set<string>();
  const out: WikeloMission[] = [];
  for (const r of [...rows].sort((a, b) => a.uuid.localeCompare(b.uuid))) {
    const m = buildWikeloMission(r.uuid, r.data);
    if (!m) continue;
    const sig = `${m.title}\u0000${JSON.stringify(m.rewards)}\u0000${JSON.stringify(m.turnIn.map((t) => [t.name, t.amount, t.scu]))}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(m);
  }
  return out.sort((a, b) => order[a.category] - order[b.category] || a.title.localeCompare(b.title));
}

/** "16" or "36 SCU" */
export const turnInQty = (t: WikeloTurnIn) => (t.scu !== null ? `${t.scu} SCU` : `${t.amount ?? 1}`);

/** The reward's headline: the main item ("Anvil F7 Hornet Mk Wikelo"), or "18 possible rewards". */
export function wikeloRewardTitle(m: Pick<WikeloMission, 'rewards' | 'title'>): string {
  if (m.rewards.length > 1) return `${m.rewards.length} possible rewards`;
  const items = (m.rewards[0] ?? []).filter((i) => !AMMO.test(i.name)); // weapons come with spare magazines
  const main = items.find((i) => /\bWikelo\b/.test(i.name)) ?? items[0] ?? m.rewards[0]?.[0];
  if (!main) return m.title;
  const name = main.amount > 1 ? `${main.amount}× ${main.name}` : main.name;
  return items.length > 1 ? `${name} + ${items.length - 1} more` : name;
}

const AMMO = /\b(Magazine|Battery)\b.*\(\d+ cap\)|^Boomtube Rocket$/i;

/** The base ship's name, for finding its picture: "Anvil F7 Hornet Mk Wikelo" → "Anvil F7 Hornet Mk". */
export function wikeloBaseShipName(reward: string): string {
  return reward
    .replace(/\bWikelo\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s: string) => s.toLowerCase().replace(/["'“”‘’]/g, '').split(/[^a-z0-9#]+/).filter(Boolean);

/**
 * Search (v1.34.0): every word in any order, across the mission's title, its
 * rewards and what you turn in, so "pearl" finds every mission that wants one.
 */
export function searchWikelo(missions: readonly WikeloMission[], query: string): WikeloMission[] {
  const q = words(query);
  if (!q.length) return [...missions];
  return missions.filter((m) => {
    const hay = words([m.title, ...m.rewards.flat().map((r) => r.name), ...m.turnIn.map((t) => t.name)].join(' ')).join(' ');
    return q.every((w) => hay.includes(w));
  });
}

/** The mission as a Discord message (the website's "Copy for Discord" and the bot's /wikelo). */
export function wikeloDiscordText(m: WikeloMission): string {
  const lines = [`**${m.title}** (Wikelo)`];
  if (m.rewards.length > 1) lines.push(`Reward: ${m.rewards.length} possible rewards`);
  else lines.push(`Reward: ${(m.rewards[0] ?? []).map((r) => (r.amount > 1 ? `${r.amount}× ${r.name}` : r.name)).join(', ')}`);
  lines.push('Turn in:');
  for (const t of m.turnIn) lines.push(`• ${turnInQty(t)}${t.scu !== null ? '' : '×'} ${t.name}`);
  if (m.stations.length) lines.push(`At: ${m.stations.join(', ')}`);
  return lines.join('\n');
}

// ═══ A person's checklist ═══════════════════════════════════════════════════

export interface WikeloProgressDto {
  missionId: string;
  /** Turn-in keys they've ticked */
  ticked: string[];
  completedAt: string | null;
}

/** WikeloProgress.ticked (JSON) → the keys, junk dropped. */
export function parseTicked(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string'))] : [];
  } catch {
    return [];
  }
}

/** How many of a mission's turn-ins are ticked (keys that no longer exist don't count). */
export function tickedCount(m: Pick<WikeloMission, 'turnIn'>, ticked: readonly string[]): number {
  const set = new Set(ticked);
  return m.turnIn.filter((t) => set.has(t.key)).length;
}
