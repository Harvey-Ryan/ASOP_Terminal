const FY_BASE = 'https://api.fleetyards.net/v1';
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAGES = 20; // safety cap — 20 × 240 = 4,800 ships, far above actual count

export interface BotFYModel {
  slug: string;
  name: string;
  manufacturer: string;
}

interface FYPage {
  items: { slug: string; name: string; manufacturer: { name: string } }[];
  meta: { pagination: { totalPages: number } };
}

let _cache: { data: BotFYModel[]; expiresAt: number } | null = null;
let _inFlight: Promise<BotFYModel[]> | null = null;

async function fetchAll(): Promise<BotFYModel[]> {
  const all: BotFYModel[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const res = await fetch(`${FY_BASE}/models?perPage=240&page=${page}`);
    if (!res.ok) throw new Error(`FleetYards API error: ${res.status}`);
    const json = (await res.json()) as FYPage;
    all.push(...json.items.map((m) => ({ slug: m.slug, name: m.name, manufacturer: m.manufacturer?.name ?? '' })));
    totalPages = json.meta.pagination.totalPages;
    page++;
  }

  all.sort((a, b) => a.name.localeCompare(b.name));
  _cache = { data: all, expiresAt: Date.now() + TTL_MS };
  return all;
}

export async function getFleetyardsModels(): Promise<BotFYModel[]> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.data;
  // Deduplicate concurrent autocomplete requests — all share one in-flight fetch.
  if (_inFlight) return _inFlight;
  _inFlight = fetchAll().finally(() => { _inFlight = null; });
  return _inFlight;
}
