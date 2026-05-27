import type { FleetyardsModelDto } from '@dem/shared';

const FY_BASE = 'https://api.fleetyards.net/v1';
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 20; // safety cap — 20 × 240 = 4,800 ships, far above actual count

interface FYManufacturer {
  name: string;
  slug: string;
}

interface FYMedia {
  storeImage: { smallUrl: string | null } | null;
}

interface FYModel {
  slug: string;
  name: string;
  manufacturer: FYManufacturer;
  classification: string | null;
  focus: string | null;
  inGame: boolean;
  playerOwnable: boolean;
  productionStatus: string;
  media: FYMedia | null;
}

interface FYPage {
  items: FYModel[];
  meta: { pagination: { totalPages: number } };
}

let _cache: { data: FleetyardsModelDto[]; expiresAt: number } | null = null;
let _inFlight: Promise<FleetyardsModelDto[]> | null = null;

function toDto(m: FYModel): FleetyardsModelDto {
  return {
    slug: m.slug,
    name: m.name,
    manufacturer: m.manufacturer?.name ?? '',
    manufacturerSlug: m.manufacturer?.slug ?? '',
    classification: m.classification ?? null,
    focus: m.focus ?? null,
    productionStatus: m.productionStatus,
    inGame: m.inGame,
    playerOwnable: m.playerOwnable,
    imageUrl: m.media?.storeImage?.smallUrl ?? null,
  };
}

async function fetchAll(): Promise<FleetyardsModelDto[]> {
  const all: FYModel[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const res = await fetch(`${FY_BASE}/models?perPage=240&page=${page}`);
    if (!res.ok) throw new Error(`FleetYards API error: ${res.status}`);
    const json = (await res.json()) as FYPage;
    all.push(...json.items);
    totalPages = json.meta.pagination.totalPages;
    page++;
  }

  const data = all.map(toDto).sort((a, b) => a.name.localeCompare(b.name));
  _cache = { data, expiresAt: Date.now() + TTL_MS };
  return data;
}

export async function getFleetyardsModels(): Promise<FleetyardsModelDto[]> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data;
  // Deduplicate concurrent requests — all callers share one in-flight fetch.
  if (_inFlight) return _inFlight;
  _inFlight = fetchAll().finally(() => { _inFlight = null; });
  return _inFlight;
}

/** Clear the cache (e.g. for testing). */
export function clearFleetyardsCache(): void {
  _cache = null;
}
