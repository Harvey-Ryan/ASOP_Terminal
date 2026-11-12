// Ships and fleets (v1.32.0). The ship list comes from RSI's own ship data
// (the Ship Matrix: every ship and vehicle sold, concepts included, with
// images), refreshed daily by the API; if RSI can't be reached it falls back
// to the game files (scdata.ships, no images). Fleets are per person and
// show in every ASOP server they're in.

export interface ShipCatalogEntry {
  /** "rsi-<ship matrix id>" or "game-<uuid>" */
  id: string;
  name: string;
  manufacturer: string;
  manufacturerCode: string | null;
  /** Combat | Transport | Exploration | Industrial | Support | Competition | Ground | Multi-Role */
  type: string | null;
  /** "Mining", "Medium Freight / Gunship", … */
  focus: string | null;
  size: string | null;
  minCrew: number | null;
  maxCrew: number | null;
  cargo: number | null;
  /** flight-ready | in-concept | in-production */
  status: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  storeUrl: string | null;
}

export type ShipSource = 'PLEDGE' | 'INGAME' | 'LOANER';
export const SHIP_SOURCES: { value: ShipSource; label: string }[] = [
  { value: 'PLEDGE', label: 'Pledged' },
  { value: 'INGAME', label: 'Bought in game' },
  { value: 'LOANER', label: 'Loaner' },
];
export const isShipSource = (v: unknown): v is ShipSource => v === 'PLEDGE' || v === 'INGAME' || v === 'LOANER';

/** Role groups for the org view, in display order. */
export const SHIP_ROLE_GROUPS = ['Combat', 'Multi-Role', 'Transport', 'Industrial', 'Exploration', 'Support', 'Competition', 'Ground', 'Other'] as const;
export type ShipRoleGroup = (typeof SHIP_ROLE_GROUPS)[number];
export function shipRoleGroup(ship: { type: string | null } | null | undefined): ShipRoleGroup {
  const t = ship?.type?.trim().toLowerCase();
  return SHIP_ROLE_GROUPS.find((g) => g.toLowerCase() === t) ?? 'Other';
}

// ── Reading RSI's ship data ──────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const absolute = (url: string | null) => (url && url.startsWith('/') ? `https://robertsspaceindustries.com${url}` : url);

/** Ships from RSI's ship-matrix JSON (`{ data: [...] }`). Unusable rows are skipped. */
export function parseShipMatrix(json: unknown): ShipCatalogEntry[] {
  const rows = (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const out: ShipCatalogEntry[] = [];
  for (const r of rows as Record<string, any>[]) {
    const id = num(r?.id);
    const name = text(r?.name);
    if (id === null || !name) continue;
    const media = Array.isArray(r.media) ? r.media[0] : null;
    const images = (media?.images ?? {}) as Record<string, unknown>;
    out.push({
      id: `rsi-${id}`,
      name,
      manufacturer: text(r.manufacturer?.name) ?? 'Unknown',
      manufacturerCode: text(r.manufacturer?.code),
      type: text(r.type) ? capitalise(text(r.type)!) : null,
      focus: text(r.focus),
      size: text(r.size) ? capitalise(text(r.size)!) : null,
      minCrew: num(r.min_crew),
      maxCrew: num(r.max_crew),
      cargo: num(r.cargocapacity),
      status: text(r.production_status),
      imageUrl: absolute(text(images['store_hub_large']) ?? text(images['slideshow']) ?? text(media?.source_url)),
      thumbUrl: absolute(text(images['store_small']) ?? text(images['product_thumb_large']) ?? text(images['store_hub_small'])),
      storeUrl: absolute(text(r.url)),
    });
  }
  return out;
}
function capitalise(s: string) {
  return s.split(/([\s/-]+)/).map((w) => (w.length > 1 && w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w)).join('');
}

/** The fallback list from the game files (scdata.ships), without images. */
export function shipsFromGameFiles(rows: { uuid: string; name: string | null; manufacturer_name: string | null; manufacturer_code: string | null; role: string | null; career: string | null; crew: number | null; is_vehicle: boolean | null }[]): ShipCatalogEntry[] {
  const out: ShipCatalogEntry[] = [];
  for (const r of rows) {
    if (!r.name || /placeholder/i.test(r.name)) continue;
    const maker = r.manufacturer_name ?? '';
    // Game names lead with the maker ("Anvil Carrack"); RSI's don't.
    const firstWord = maker.split(' ')[0] ?? '';
    const name = firstWord && r.name.toLowerCase().startsWith(`${firstWord.toLowerCase()} `) ? r.name.slice(firstWord.length + 1) : r.name;
    out.push({
      id: `game-${r.uuid}`, name, manufacturer: maker || 'Unknown', manufacturerCode: r.manufacturer_code,
      type: r.is_vehicle ? 'Ground' : r.career, focus: r.role, size: null, minCrew: null, maxCrew: r.crew ?? null,
      cargo: null, status: 'flight-ready', imageUrl: null, thumbUrl: null, storeUrl: null,
    });
  }
  return out;
}

// ── Matching names to ships ──────────────────────────────────────────────────

export function normalizeShipName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`".]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const tokens = (s: string) => normalizeShipName(s).split(' ').filter(Boolean);

/** Nicknames players use for ships whose full names they rarely type. */
const ALIASES: Record<string, string> = {
  msr: 'mercury star runner',
  mercury: 'mercury star runner',
  conny: 'constellation andromeda',
  connie: 'constellation andromeda',
  andromeda: 'constellation andromeda',
  taurus: 'constellation taurus',
  aquila: 'constellation aquila',
  phoenix: 'constellation phoenix',
  hornet: 'f7c hornet mk ii',
  'cutty black': 'cutlass black',
  'cutty': 'cutlass black',
  c2: 'c2 hercules starlifter',
  m2: 'm2 hercules starlifter',
  a2: 'a2 hercules starlifter',
  hercules: 'c2 hercules starlifter',
  '890': '890 jump',
};
/** Words that say nothing about which ship it is. */
const NOISE = new Set(['lti', 'warbond', 'edition', 'standalone', 'ship', 'pack', 'package', 'with', 'and', 'the', 'plus', 'upgrade', 'ccu', 'ingame', 'game', 'pledge', 'bis', '2948', '2949', '2950', '2951', '2952', '2953', '2954', '2955', 'paint']);

export type ShipMatch =
  | { status: 'matched'; ship: ShipCatalogEntry; exact: boolean }
  | { status: 'ambiguous'; suggestions: ShipCatalogEntry[] }
  | { status: 'none'; suggestions: ShipCatalogEntry[] };

export interface ShipIndex { ships: ShipCatalogEntry[]; byName: Map<string, ShipCatalogEntry>; makerWords: Set<string> }

/** Prepares a ship list for matching many names against it. */
export function shipIndex(ships: ShipCatalogEntry[]): ShipIndex {
  const byName = new Map<string, ShipCatalogEntry>();
  const makerWords = new Set<string>();
  for (const s of ships) {
    byName.set(normalizeShipName(s.name), s);
    byName.set(normalizeShipName(`${s.manufacturer} ${s.name}`), s);
    if (s.manufacturerCode) byName.set(normalizeShipName(`${s.manufacturerCode} ${s.name}`), s);
    for (const w of tokens(s.manufacturer)) makerWords.add(w);
    if (s.manufacturerCode) makerWords.add(s.manufacturerCode.toLowerCase());
  }
  return { ships, byName, makerWords };
}

/** The ship a typed or imported name means, or why it can't be told. */
export function matchShip(input: string, index: ShipIndex, manufacturerHint?: string | null): ShipMatch {
  const norm = normalizeShipName(input);
  if (!norm) return { status: 'none', suggestions: [] };
  const exact = index.byName.get(norm) ?? index.byName.get(ALIASES[norm] ?? '');
  if (exact) return { status: 'matched', ship: exact, exact: true };

  const hint = manufacturerHint ? new Set(tokens(manufacturerHint)) : null;
  const words = tokens(input).filter((w) => !NOISE.has(w) && !index.makerWords.has(w));
  const stripped = words.join(' ');
  const viaAlias = index.byName.get(stripped) ?? index.byName.get(ALIASES[stripped] ?? '');
  if (viaAlias) return { status: 'matched', ship: viaAlias, exact: false };
  if (!words.length) return { status: 'none', suggestions: [] };
  const have = new Set(words);

  const makerOk = (s: ShipCatalogEntry) => !hint || tokens(s.manufacturer).some((w) => hint.has(w)) || (!!s.manufacturerCode && hint.has(s.manufacturerCode.toLowerCase()));
  const nameWords = (s: ShipCatalogEntry) => tokens(s.name).filter((w) => !NOISE.has(w) && !index.makerWords.has(w));

  // The whole ship name appears in what was typed ("Anvil Carrack Expedition LTI").
  const contained = index.ships.filter((s) => { const n = nameWords(s); return n.length > 0 && n.every((w) => have.has(w)); });
  if (contained.length) {
    const best = Math.max(...contained.map((s) => nameWords(s).length));
    const top = contained.filter((s) => nameWords(s).length === best);
    const preferred = top.filter(makerOk);
    const pick = preferred.length ? preferred : top;
    if (pick.length === 1) return { status: 'matched', ship: pick[0]!, exact: false };
    return { status: 'ambiguous', suggestions: pick.slice(0, 5) };
  }
  // What was typed is part of one ship's name ("Prospector" → "Prospector").
  const within = index.ships.filter((s) => { const n = new Set(nameWords(s)); return words.every((w) => n.has(w)); }).filter(makerOk);
  if (within.length === 1) return { status: 'matched', ship: within[0]!, exact: false };
  if (within.length > 1) {
    // Several fit ("Cutlass"): ask, shortest names first.
    return { status: 'ambiguous', suggestions: within.sort((a, b) => nameWords(a).length - nameWords(b).length).slice(0, 5) };
  }
  // Nothing fits: the closest few by shared words.
  const scored = index.ships
    .map((s) => ({ s, n: nameWords(s).filter((w) => have.has(w) || [...have].some((h) => h.length >= 4 && w.startsWith(h))).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  return { status: 'none', suggestions: scored.slice(0, 5).map((x) => x.s) };
}

/** Ships whose name or maker starts with or contains what's typed: for search boxes and autocomplete. */
export function searchShips(query: string, ships: ShipCatalogEntry[], limit = 25): ShipCatalogEntry[] {
  const q = tokens(query);
  if (!q.length) return ships.slice(0, limit);
  const scored: { s: ShipCatalogEntry; score: number }[] = [];
  for (const s of ships) {
    const hay = tokens(`${s.manufacturer} ${s.manufacturerCode ?? ''} ${s.name}`);
    const name = tokens(s.name);
    if (!q.every((w) => hay.some((h) => h.startsWith(w)))) continue;
    const score = (name[0]?.startsWith(q[0]!) ? 0 : 1) + name.length / 100;
    scored.push({ s, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.s.name.localeCompare(b.s.name)).slice(0, limit).map((x) => x.s);
}

// ── Importing a list ─────────────────────────────────────────────────────────

export interface FleetImportLine { name: string; quantity: number; manufacturer?: string | null; nickname?: string | null }
export interface FleetImport { format: 'hangarexport' | 'fleetviewer' | 'json' | 'text'; lines: FleetImportLine[] }

/**
 * Reads what someone pasted or uploaded: Hangar Export / hangar.link JSON
 * (pledge items of kind Ship or Vehicle), a FleetViewer layout (STARJUMP /
 * fleetviewer.link: its SHIP canvas items), a FleetYards or similar JSON list,
 * or plain text, one ship per line ("2x Carrack", "Cutlass Black, 2").
 * The same ship on several lines adds up.
 */
export function parseFleetImport(input: string): FleetImport {
  const trimmed = input.trim();
  let parsed: unknown = undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { parsed = JSON.parse(trimmed); } catch { parsed = undefined; }
  }
  if (parsed !== undefined) {
    const obj = parsed as Record<string, any>;
    if (obj && !Array.isArray(obj) && Array.isArray(obj.pledges)) {
      const lines: FleetImportLine[] = [];
      for (const p of obj.pledges) {
        for (const it of Array.isArray(p?.items) ? p.items : []) {
          if (!/ship|vehicle/i.test(String(it?.kind ?? ''))) continue;
          const name = text(it?.title);
          if (name) lines.push({ name, quantity: 1, manufacturer: text(it?.liner), nickname: text(it?.itemCustomName) });
        }
      }
      return { format: 'hangarexport', lines: mergeLines(lines) };
    }
    if (obj && !Array.isArray(obj) && Array.isArray(obj.canvasItems)) {
      // A fleet picture: every SHIP item is one ship; text, images and the
      // rest of the layout are ignored.
      const lines: FleetImportLine[] = [];
      for (const it of obj.canvasItems) {
        if (String(it?.itemType ?? '').toUpperCase() !== 'SHIP') continue;
        const name = text(it?.defaultText) ?? text(it?.shipSlug)?.replace(/[-_]+/g, ' ') ?? null;
        if (name) lines.push({ name, quantity: 1 });
      }
      return { format: 'fleetviewer', lines: mergeLines(lines) };
    }
    return { format: 'json', lines: mergeLines(jsonShips(parsed)) };
  }
  const lines: FleetImportLine[] = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.replace(/^[\s*•\-–]+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(\d{1,3})\s*[x×]?\s+(.+)$/i)) || (m = line.match(/^(\d{1,3})\s*[x×]\s*(.+)$/i))) lines.push({ name: m[2]!.trim(), quantity: Number(m[1]) });
    else if ((m = line.match(/^(.+?)\s*(?:[x×]\s*|[,;\t]\s*|\(\s*)(\d{1,3})\s*\)?$/i))) lines.push({ name: m[1]!.trim(), quantity: Number(m[2]) });
    else lines.push({ name: line, quantity: 1 });
  }
  return { format: 'text', lines: mergeLines(lines) };
}

function jsonShips(v: unknown, depth = 0): FleetImportLine[] {
  if (depth > 4 || v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v.flatMap((e): FleetImportLine[] => {
      if (typeof e === 'string') return e.trim() ? [{ name: e.trim(), quantity: 1 }] : [];
      if (!e || typeof e !== 'object') return [];
      const o = e as Record<string, any>;
      const model = o.model && typeof o.model === 'object' ? o.model : null;
      const name = text(model?.name) ?? text(o.modelName) ?? text(o.shipName) ?? text(o.title) ?? text(o.name) ?? (text(o.slug) ?? text(model?.slug))?.replace(/[-_]+/g, ' ') ?? null;
      if (!name) {
        const nested = Object.values(o).find((x) => Array.isArray(x) && x.some((e) => e && typeof e === 'object'));
        return nested ? jsonShips(nested, depth + 1) : [];
      }
      const quantity = Math.max(1, Math.min(99, Math.floor(num(o.quantity) ?? num(o.count) ?? num(o.amount) ?? 1)));
      const manufacturer = text(model?.manufacturer?.name) ?? text(o.manufacturer?.name) ?? text(o.manufacturer) ?? text(o.manufacturerName) ?? text(o.manufacturer_name) ?? text(o.liner);
      const nickname = model ? text(o.name) : text(o.nickname) ?? text(o.customName);
      return [{ name, quantity, manufacturer, nickname: nickname && nickname !== name ? nickname : null }];
    });
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const key of ['ships', 'vessels', 'fleet', 'hangar', 'items', 'data']) if (Array.isArray(o[key])) return jsonShips(o[key], depth + 1);
    const arr = Object.values(o).find(Array.isArray);
    return arr ? jsonShips(arr, depth + 1) : [];
  }
  return [];
}

function mergeLines(lines: FleetImportLine[]): FleetImportLine[] {
  const out = new Map<string, FleetImportLine>();
  for (const l of lines) {
    const key = `${normalizeShipName(l.name)}|${l.nickname ?? ''}`;
    const prev = out.get(key);
    if (prev) prev.quantity = Math.min(99, prev.quantity + l.quantity);
    else out.set(key, { ...l, quantity: Math.max(1, Math.min(99, l.quantity)) });
  }
  return [...out.values()];
}

// ── Keeping fleets fresh ─────────────────────────────────────────────────────

/** How often someone is asked "still flying these?". */
export const FLEET_CHECK_DAYS = 90;

/** True when it's time to ask this person to check their fleet. */
export function fleetCheckDue(owner: { checkedAt: Date | null; lastNudgeAt: Date | null; nudges: boolean; createdAt: Date }, shipCount: number, now = new Date()): boolean {
  if (!owner.nudges || shipCount === 0) return false;
  const cutoff = now.getTime() - FLEET_CHECK_DAYS * 86_400_000;
  const last = Math.max(owner.checkedAt?.getTime() ?? owner.createdAt.getTime(), owner.lastNudgeAt?.getTime() ?? 0);
  return last < cutoff;
}

// ── What the website gets ────────────────────────────────────────────────────

export interface FleetShipDto {
  id: number;
  ship: ShipCatalogEntry | null;
  /** The name as imported, when it couldn't be matched to a ship. */
  customName: string | null;
  quantity: number;
  nickname: string | null;
  source: ShipSource;
  available: boolean;
}

export interface MyFleetDto {
  ships: FleetShipDto[];
  checkedAt: string | null;
  nudges: boolean;
  /** Servers (ASOP's, that you're in) where your fleet is hidden. */
  hiddenGuildIds: string[];
}

export interface GuildFleetOwnerDto { discordId: string; name: string; checkedAt: string | null }
export interface GuildFleetShipDto {
  ship: ShipCatalogEntry;
  owners: { discordId: string; quantity: number; nickname: string | null; source: ShipSource }[];
  total: number;
}
export interface GuildFleetDto {
  ships: GuildFleetShipDto[];
  owners: GuildFleetOwnerDto[];
  /** Ships people own that couldn't be matched to the list, by name. */
  unmatched: number;
}

export interface FleetImportPreviewLine extends FleetImportLine {
  match: { status: 'matched'; ship: ShipCatalogEntry; exact: boolean } | { status: 'ambiguous' | 'none'; suggestions: ShipCatalogEntry[] };
}
