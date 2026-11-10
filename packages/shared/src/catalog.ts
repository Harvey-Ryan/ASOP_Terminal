// Game item catalog: the items and commodities players own, trade and loot,
// built from the sc-data tables (schema `scdata`, see apps/sc-data/README.md).
//
// This replaces UEX as the source of item names and details. UEX is still used
// for average commodity prices, which aren't in the game files.
//
// The SQL here is run by the API and the bot with prisma.$queryRawUnsafe; the
// in-memory index is pure TypeScript so it can be tested on its own.

export type CatalogKind = 'ITEM' | 'COMMODITY';

export interface CatalogEntry {
  /** "ITEM:<uuid>" or "COMMODITY:<uuid>": the value pickers send back. */
  ref: string;
  kind: CatalogKind;
  uuid: string;
  name: string;
  /** Short label shown next to the name, e.g. "Assault Rifle" or "Shield Generator · S1". */
  detail: string;
  /** Unclassified, undescribed game object (a comb, a ketchup bottle): listed after other matches. */
  minor?: boolean;
}

export interface CatalogStat {
  name: string;
  value: string;
}

export interface CatalogCommodityInfo {
  /** Ore or raw form that is refined into something else. */
  raw: boolean;
  illegal: boolean;
  /** The refined commodity, for raw ones. */
  refinedName: string | null;
  /** Average prices in aUEC, from UEX (players report them; not in the game files). */
  avgBuy: number | null;
  avgSell: number | null;
  /** UEX short code, e.g. "QUAN". */
  code: string | null;
}

export interface CatalogDetail extends CatalogEntry {
  category: string | null;
  manufacturer: string | null;
  size: number | null;
  grade: number | null;
  description: string | null;
  /** The in-game stat block ("Rate Of Fire: 550 rpm", "Damage Reduction: 25%"…). */
  stats: CatalogStat[];
  commodity: CatalogCommodityInfo | null;
}

// ── Refs ─────────────────────────────────────────────────────────────────────

export function catalogRef(kind: CatalogKind, uuid: string): string {
  return `${kind}:${uuid}`;
}

export function parseCatalogRef(ref: string | null | undefined): { kind: CatalogKind; uuid: string } | null {
  const m = /^(ITEM|COMMODITY):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref?.trim() ?? '');
  return m ? { kind: m[1]!.toUpperCase() as CatalogKind, uuid: m[2]!.toLowerCase() } : null;
}

// ── Which game items count ───────────────────────────────────────────────────

/**
 * Classifications (first two parts) of things built into ships or the world
 * that players never own on their own: fuel tanks, flight blades, built-in
 * turrets and countermeasure launchers, thrusters, hull armour.
 */
export const CATALOG_EXCLUDED_CLASSES = [
  'Ship.FuelTank', 'Ship.QuantumFuelTank', 'Ship.FlightController', 'Ship.Turret',
  'Ship.WeaponDefensive', 'Ship.Armor', 'Ship.SelfDestruct', 'Ship.FuelIntake',
  'Ship.MainThruster', 'Ship.ManneuverThruster',
] as const;

/** Unclassified item types players do carry: collectibles, food, chips, gadgets, storage boxes, scrip. */
export const CATALOG_EXTRA_TYPES = [
  'Misc', 'Food', 'Drink', 'Gadget', 'RemovableChip', 'Grenade', 'InventoryContainer', 'FPS_Consumable', 'Currency',
] as const;

const sqlList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');

/**
 * One row per distinct item. The game files often hold several copies of the
 * same item (one per ship loadout, colour variant files with the same name…);
 * these are merged by (name, category) and the lowest UUID is kept, so every
 * member who picks "Pembroke Helmet" gets the same item.
 *
 * Usable as a CTE body: `WITH catalog_items AS (${CATALOG_ITEMS_SQL}) …`
 */
export const CATALOG_ITEMS_SQL = `
  SELECT DISTINCT ON (lower(i.name), coalesce(i.classification, i.type))
    i.uuid, i.name, coalesce(i.classification, i.type) AS category, i.type, i.sub_type,
    i.size, i.grade, i.is_ship_item,
    i.data->'stdItem'->'DescriptionData'->>'Item Type' AS item_type,
    (i.classification IS NULL AND coalesce(i.data->'stdItem'->>'DescriptionText', '') !~ '[a-z]{3}') AS minor
  FROM scdata.items i
  WHERE NOT i.is_placeholder
    AND i.name IS NOT NULL AND i.name !~ '^(@|\\[|<=)' AND i.name !~ 'PLACEHOLDER'
    AND (
      (i.classification IS NOT NULL
        AND split_part(i.classification, '.', 1) || '.' || split_part(i.classification, '.', 2)
            NOT IN (${sqlList(CATALOG_EXCLUDED_CLASSES)}))
      OR (i.classification IS NULL AND i.type IN (${sqlList(CATALOG_EXTRA_TYPES)}))
    )
  ORDER BY lower(i.name), coalesce(i.classification, i.type), i.uuid`;

/** One row per distinct commodity name (two names appear twice in the files). */
export const CATALOG_COMMODITIES_SQL = `
  SELECT DISTINCT ON (lower(c.name))
    c.uuid, c.name,
    coalesce(c.data->'CommodityGroups', '[]'::jsonb) AS groups,
    (c.refined_uuid IS NOT NULL) AS raw
  FROM scdata.commodities c
  WHERE c.name IS NOT NULL AND c.name !~ '^(@|\\[|<=)'
  ORDER BY lower(c.name), c.uuid`;

/** Everything the in-memory index needs, in one query. */
export const CATALOG_LIST_SQL = `
  SELECT 'ITEM' AS kind, uuid, name, category, size, is_ship_item, item_type, minor, NULL::jsonb AS groups, NULL::boolean AS raw
  FROM (${CATALOG_ITEMS_SQL}) items
  UNION ALL
  SELECT 'COMMODITY', uuid, name, NULL, NULL, NULL, NULL, false, groups, raw
  FROM (${CATALOG_COMMODITIES_SQL}) commodities`;

/** The scdata commit the catalog was built from; reload when it changes. */
export const CATALOG_VERSION_SQL = 'SELECT commit FROM scdata.source LIMIT 1';

export interface CatalogListRow {
  kind: CatalogKind;
  uuid: string;
  name: string;
  category: string | null;
  size: number | null;
  is_ship_item: boolean | null;
  item_type: string | null;
  minor?: boolean | null;
  groups: string[] | null;
  raw: boolean | null;
}

// ── Labels ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  'FPS.Armor': 'Armour', 'FPS.Clothing': 'Clothing', 'FPS.Weapon': 'Personal Weapon',
  'FPS.WeaponAttachment': 'Weapon Attachment', 'FPS.Consumable': 'Consumable', 'FPS.MobiGlas': 'mobiGlas',
  'FPS.Accessory': 'Accessory', 'FPS.Jetpack': 'Jetpack',
  'Ship.Paints': 'Ship Paint', 'Ship.Weapon': 'Ship Weapon', 'Ship.MissileLauncher': 'Missile Rack',
  'Ship.Flair': 'Ship Flair', 'Ship.PowerPlant': 'Power Plant', 'Ship.Cooler': 'Cooler', 'Ship.Shield': 'Shield Generator',
  'Ship.Missile': 'Missile', 'Ship.Radar': 'Radar', 'Ship.QuantumDrive': 'Quantum Drive', 'Ship.Mining': 'Mining Laser',
  'Ship.Container': 'Cargo Container', 'Ship.Salvage': 'Salvage', 'Ship.BombRack': 'Bomb Rack', 'Ship.Beam': 'Tractor Beam',
  'Ship.LifeSupportGenerator': 'Life Support', 'Ship.EMP': 'EMP', 'Ship.QuantumInterdictionGenerator': 'Quantum Interdiction',
  'Ship.JumpDrive': 'Jump Drive', 'Ship.Bomb': 'Bomb', 'Mining.Module': 'Mining Module', 'Mining.Gadget': 'Mining Gadget',
  Misc: 'Misc', Food: 'Food', Drink: 'Drink', Gadget: 'Gadget', RemovableChip: 'Chip', Grenade: 'Grenade',
  InventoryContainer: 'Storage', FPS_Consumable: 'Consumable', Currency: 'Scrip',
};

const spaced = (s: string) => s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

/** "FPS.Armor.Helmet" → "Armour · Helmet"; ship parts get no sub-type; unknown → the last part, spaced out. */
export function categoryLabel(category: string | null | undefined): string | null {
  if (!category) return null;
  const parts = category.split('.');
  const base = CATEGORY_LABELS[parts.slice(0, 2).join('.')] ?? CATEGORY_LABELS[parts[0]!];
  const tail = parts.length > 2 && parts[0] !== 'Ship' ? spaced(parts.slice(2).join(' ')) : '';
  if (base) return tail && !base.toLowerCase().includes(tail.toLowerCase()) ? `${base} · ${tail}` : base;
  return spaced(parts[parts.length - 1] ?? category);
}

/** Ship parts whose size matters when picking (not paints or flair). */
const showsSize = (category: string | null) => !!category && category.startsWith('Ship.') && !/^Ship\.(Paints|Flair)/.test(category);

export function commodityFlags(groups: string[] | null | undefined, raw: boolean | null | undefined) {
  const g = (groups ?? []).map((x) => x.toLowerCase());
  return {
    raw: !!raw || g.some((x) => x.startsWith('raw')),
    illegal: g.includes('vice') || g.includes('illegal'),
  };
}

export function toCatalogEntry(r: CatalogListRow): CatalogEntry {
  if (r.kind === 'COMMODITY') {
    const f = commodityFlags(r.groups, r.raw);
    const detail = ['Commodity', f.raw ? 'Raw' : null, f.illegal ? 'Illegal' : null].filter(Boolean).join(' · ');
    return { ref: catalogRef('COMMODITY', r.uuid), kind: 'COMMODITY', uuid: r.uuid, name: r.name, detail };
  }
  const label = r.item_type && r.item_type !== r.name ? r.item_type : categoryLabel(r.category) ?? 'Item';
  const size = showsSize(r.category) && r.size != null && r.size > 0 ? ` · S${r.size}` : '';
  return {
    ref: catalogRef('ITEM', r.uuid), kind: 'ITEM', uuid: r.uuid, name: r.name, detail: `${label}${size}`,
    ...(r.minor ? { minor: true } : {}),
  };
}

// ── In-memory index ──────────────────────────────────────────────────────────

export interface CatalogSearchOptions {
  kinds?: readonly CatalogKind[];
  limit?: number;
}

/** Name search over the catalog: exact, then prefix, then word prefix, then substring. */
export class CatalogIndex {
  readonly entries: readonly CatalogEntry[];
  private readonly byRef: Map<string, CatalogEntry>;
  private readonly lower: string[];

  constructor(entries: readonly CatalogEntry[]) {
    this.entries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    this.byRef = new Map(this.entries.map((e) => [e.ref.toUpperCase(), e]));
    this.lower = this.entries.map((e) => e.name.toLowerCase());
  }

  static fromRows(rows: readonly CatalogListRow[]): CatalogIndex {
    return new CatalogIndex(rows.map(toCatalogEntry));
  }

  get(ref: string): CatalogEntry | undefined {
    const p = parseCatalogRef(ref);
    return p ? this.byRef.get(catalogRef(p.kind, p.uuid).toUpperCase()) : undefined;
  }

  /** Exact (case-insensitive) name match, items first. */
  findByName(name: string, kind?: CatalogKind): CatalogEntry | undefined {
    const n = name.trim().toLowerCase();
    const hits = this.entries.filter((e, i) => this.lower[i] === n && (!kind || e.kind === kind));
    return hits.find((e) => e.kind === 'ITEM') ?? hits[0];
  }

  search(query: string, opts: CatalogSearchOptions = {}): CatalogEntry[] {
    const q = query.trim().toLowerCase();
    const limit = opts.limit ?? 25;
    if (!q) return [];
    const kinds = opts.kinds && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
    const scored: { e: CatalogEntry; s: number }[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (kinds && !kinds.has(e.kind)) continue;
      const n = this.lower[i]!;
      const at = n.indexOf(q);
      if (at < 0) continue;
      const s = (n === q ? 0 : at === 0 ? 1 : /[\s\-("'/]/.test(n[at - 1]!) ? 2 : 3) + (e.minor ? 0.5 : 0);
      scored.push({ e, s });
    }
    scored.sort((a, b) => a.s - b.s || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name));
    return scored.slice(0, limit).map((x) => x.e);
  }
}

// ── Detail queries ($1 = uuid) ───────────────────────────────────────────────

export const CATALOG_ITEM_DETAIL_SQL = `
  SELECT i.uuid, i.name, coalesce(i.classification, i.type) AS category, i.size, i.grade, i.is_ship_item,
    CASE WHEN i.manufacturer_name IN ('Unknown Manufacturer', 'Consumable', '') THEN NULL ELSE i.manufacturer_name END AS manufacturer,
    i.data->'stdItem'->>'DescriptionText' AS description,
    i.data->'stdItem'->'DescriptionData' AS stats,
    i.data->'stdItem'->'DescriptionData'->>'Item Type' AS item_type
  FROM scdata.items i WHERE i.uuid = $1`;

/** Commodity detail with UEX prices. UEX rows are matched by name. */
export const CATALOG_COMMODITY_DETAIL_SQL = `
  SELECT c.uuid, c.name, coalesce(c.data->'CommodityGroups', '[]'::jsonb) AS groups,
    (c.refined_uuid IS NOT NULL) AS raw, c.data->>'RefinedVersionName' AS refined_name,
    c.data->>'Description' AS description,
    u."priceAvgBuy" AS avg_buy, u."priceAvgSell" AS avg_sell, u.code, u."isIllegal" AS uex_illegal
  FROM scdata.commodities c
  LEFT JOIN LATERAL (
    SELECT * FROM "UexCommodity" x WHERE lower(x.name) = lower(c.name) AND x."isActive" ORDER BY x.id LIMIT 1
  ) u ON true
  WHERE c.uuid = $1`;

export interface CatalogItemDetailRow {
  uuid: string; name: string; category: string | null; size: number | null; grade: number | null;
  is_ship_item: boolean; manufacturer: string | null; description: string | null;
  stats: Record<string, string> | null; item_type: string | null;
}

export interface CatalogCommodityDetailRow {
  uuid: string; name: string; groups: string[]; raw: boolean; refined_name: string | null;
  description: string | null;
  avg_buy: number | null; avg_sell: number | null; code: string | null; uex_illegal: boolean | null;
}

const cleanText = (s: string | null | undefined) => {
  const t = s?.replace(/\\n/g, '\n').trim();
  return t && !/^(@|<=|\[PH\])/.test(t) && !/PLACEHOLDER/i.test(t) ? t : null;
};

export function itemDetailFromRow(r: CatalogItemDetailRow): CatalogDetail {
  const { minor: _minor, ...entry } = toCatalogEntry({ kind: 'ITEM', uuid: r.uuid, name: r.name, category: r.category,
    size: r.size, is_ship_item: r.is_ship_item, item_type: r.item_type, groups: null, raw: null });
  const stats = Object.entries(r.stats ?? {})
    .filter(([k, v]) => !['Manufacturer', 'Item Type', 'Size'].includes(k) && typeof v === 'string' && v.trim() !== '')
    .map(([name, value]) => ({ name, value: String(value) }));
  return {
    ...entry, category: categoryLabel(r.category), manufacturer: r.manufacturer, size: r.size, grade: r.grade,
    description: cleanText(r.description), stats, commodity: null,
  };
}

export function commodityDetailFromRow(r: CatalogCommodityDetailRow): CatalogDetail {
  const entry = toCatalogEntry({ kind: 'COMMODITY', uuid: r.uuid, name: r.name, category: null, size: null,
    is_ship_item: null, item_type: null, groups: r.groups, raw: r.raw });
  const f = commodityFlags(r.groups, r.raw);
  return {
    ...entry, category: 'Commodity', manufacturer: null, size: null, grade: null,
    description: cleanText(r.description), stats: [],
    commodity: {
      raw: f.raw, illegal: f.illegal || !!r.uex_illegal, refinedName: r.raw ? r.refined_name : null,
      avgBuy: r.avg_buy, avgSell: r.avg_sell, code: r.code || null,
    },
  };
}

// ── Linking saved inventory to the catalog ───────────────────────────────────

/**
 * Fills InventoryEntry."itemUuid" for entries saved before the catalog, in
 * order of confidence. (Items were first linked by the game UUID UEX stored,
 * in v1.6.0; every item entry had been linked by the time UEX items were
 * retired, so items now only need the name match.)
 * $1 = an entry id to link only that entry, or NULL for all. Each statement only touches entries that are still unlinked, so it is safe
 * to run any number of times.
 */
export const INVENTORY_LINK_SQL: readonly string[] = [
  // 1. Items by exact name.
  `WITH catalog_items AS (${CATALOG_ITEMS_SQL}),
        by_name AS (SELECT DISTINCT ON (lower(name)) lower(name) AS n, uuid FROM catalog_items ORDER BY lower(name), uuid)
   UPDATE "InventoryEntry" e SET "itemUuid" = b.uuid
   FROM by_name b
   WHERE e."itemUuid" IS NULL AND e."itemType" = 'ITEM' AND lower(trim(e."itemName")) = b.n
     AND ($1::text IS NULL OR e.id = $1)`,
  // 2. Commodities by exact name (UEX uses the game's names).
  `WITH catalog_commodities AS (${CATALOG_COMMODITIES_SQL})
   UPDATE "InventoryEntry" e SET "itemUuid" = c.uuid
   FROM catalog_commodities c
   WHERE e."itemUuid" IS NULL AND e."itemType" = 'COMMODITY' AND lower(trim(e."itemName")) = lower(c.name)
     AND ($1::text IS NULL OR e.id = $1)`,
  // 3. Commodities whose saved name differs: use the UEX name for that id.
  `WITH catalog_commodities AS (${CATALOG_COMMODITIES_SQL})
   UPDATE "InventoryEntry" e SET "itemUuid" = c.uuid
   FROM "UexCommodity" u
   JOIN catalog_commodities c ON lower(c.name) = lower(u.name)
   WHERE e."itemUuid" IS NULL AND e."itemType" = 'COMMODITY' AND e."externalItemId" = u.id
     AND ($1::text IS NULL OR e.id = $1)`,
];

export const INVENTORY_LINK_STATUS_SQL = `
  SELECT count(*)::int AS total,
         count("itemUuid")::int AS linked,
         coalesce(array_agg(DISTINCT "itemType" || ': ' || "itemName") FILTER (WHERE "itemUuid" IS NULL), '{}') AS unlinked_names
  FROM "InventoryEntry"`;

export interface InventoryLinkStatus {
  total: number;
  linked: number;
  unlinkedNames: string[];
}

// ── Loader shared by the API and the bot ─────────────────────────────────────

/** The one database method the loader needs (a PrismaClient fits). */
export interface CatalogDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
}

export interface CatalogStore {
  /** The index, reloaded when sc-data has synced a new commit (checked at most every `recheckMs`). */
  get(): Promise<CatalogIndex>;
  detail(ref: string): Promise<CatalogDetail | null>;
  /** Commit of the loaded game data, or null before sc-data has run. */
  version(): string | null;
}

export function createCatalogStore(
  db: CatalogDb,
  opts: { recheckMs?: number; onLoad?: (index: CatalogIndex, version: string, previous: string | null) => void } = {},
): CatalogStore {
  const recheckMs = opts.recheckMs ?? 5 * 60_000;
  let index: CatalogIndex | null = null;
  let version: string | null = null;
  let checkedAt = 0;
  let loading: Promise<CatalogIndex> | null = null;

  async function load(): Promise<CatalogIndex> {
    let v: string | null = null;
    try {
      v = (await db.$queryRawUnsafe<{ commit: string }[]>(CATALOG_VERSION_SQL))[0]?.commit ?? null;
    } catch {
      v = null; // scdata schema not there yet
    }
    checkedAt = Date.now();
    if (index && v === version) return index;
    if (!v) return (index ??= new CatalogIndex([]));
    const rows = await db.$queryRawUnsafe<CatalogListRow[]>(CATALOG_LIST_SQL);
    const previous = version;
    index = CatalogIndex.fromRows(rows);
    version = v;
    opts.onLoad?.(index, v, previous);
    return index;
  }

  return {
    async get() {
      if (index && Date.now() - checkedAt < recheckMs) return index;
      loading ??= load().finally(() => { loading = null; });
      return loading;
    },
    async detail(ref) {
      const p = parseCatalogRef(ref);
      if (!p) return null;
      if (p.kind === 'ITEM') {
        const rows = await db.$queryRawUnsafe<CatalogItemDetailRow[]>(CATALOG_ITEM_DETAIL_SQL, p.uuid);
        return rows[0] ? itemDetailFromRow(rows[0]) : null;
      }
      const rows = await db.$queryRawUnsafe<CatalogCommodityDetailRow[]>(CATALOG_COMMODITY_DETAIL_SQL, p.uuid);
      return rows[0] ? commodityDetailFromRow(rows[0]) : null;
    },
    version: () => version,
  };
}
