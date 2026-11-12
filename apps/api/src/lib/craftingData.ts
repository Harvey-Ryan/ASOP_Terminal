import { gzipSync } from 'node:zlib';
import {
  buildCraftingData,
  CRAFTING_CONTRACTS_SQL,
  isGameDataMissingError,
  type CraftedItemRow,
  type CraftingDataDto,
  type ResourceLocationRow,
  type ScBlueprintJson,
  type ScContractJson,
} from '@dem/shared';
import { prisma } from './prisma.js';

// The Blueprints and Crafting Calculator pages' data (v1.11.2), built from
// sc-data by packages/shared/src/crafting.ts. Built once per game build (the
// sc-data commit) and kept ready to send, compressed: the pages download it
// once per build (ETag), and the API only rebuilds when sc-data moves on.

export interface CraftingPayload {
  /** ETag: changes with the game data. */
  etag: string;
  json: Buffer;
  gzip: Buffer;
  data: CraftingDataDto;
}

let cached: CraftingPayload | null = null;

/**
 * Bump when the payload's shape changes (v2: materialSources, v1.26.0), so
 * browsers holding the old copy for the same game build download it again.
 */
const DATA_VERSION = 3;
const etagFor = (commit: string) => `"crafting-v${DATA_VERSION}-${commit.slice(0, 16)}"`;
let building: Promise<CraftingPayload | null> | null = null;

async function currentSource(): Promise<{ commit: string; build: string | null } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ commit: string | null; build: string | null }[]>('SELECT commit, build FROM scdata.source LIMIT 1');
    return rows[0]?.commit ? { commit: rows[0].commit, build: rows[0].build } : null;
  } catch (err) {
    if (isGameDataMissingError(err)) return null;
    throw err;
  }
}

async function build(source: { commit: string; build: string | null }): Promise<CraftingPayload> {
  const started = Date.now();
  const [bps, resources, contracts, items, resourceLocations] = await Promise.all([
    prisma.$queryRawUnsafe<{ data: ScBlueprintJson }[]>('SELECT data FROM scdata.blueprints'),
    prisma.$queryRawUnsafe<{ uuid: string; name: string }[]>('SELECT uuid, name FROM scdata.resources'),
    prisma.$queryRawUnsafe<{ data: ScContractJson }[]>(CRAFTING_CONTRACTS_SQL),
    prisma.$queryRawUnsafe<{ uuid: string; type: string | null; name: string | null; manufacturer: string | null; mass: number | null; std: unknown }[]>(
      `SELECT uuid, type, name, manufacturer_name AS manufacturer, mass, data->'stdItem' AS std
       FROM scdata.items WHERE uuid IN (SELECT output_uuid FROM scdata.blueprints WHERE output_uuid IS NOT NULL)`,
    ),
    // Where materials are mined (v1.26.0). An older sc-data without the table: no sources.
    prisma.$queryRawUnsafe<ResourceLocationRow[]>('SELECT provider_name, data FROM scdata.resource_locations').catch((err: unknown) => {
      if (isGameDataMissingError(err)) return [] as ResourceLocationRow[];
      throw err;
    }),
  ]);
  const data = buildCraftingData({
    build: source.build,
    commit: source.commit,
    blueprints: bps.map((r) => r.data),
    resources,
    contracts: contracts.map((r) => r.data),
    items: items as CraftedItemRow[],
    resourceLocations,
  });
  const json = Buffer.from(JSON.stringify({ success: true, data }));
  const payload = { etag: etagFor(source.commit), json, gzip: gzipSync(json), data };
  console.log(`[crafting] Built crafting data for ${source.build ?? source.commit.slice(0, 12)}: ${data.blueprints.length} blueprints `
    + `(${data.obtainableUuids.length} from missions), ${data.missions.length} contracts; ${Math.round(json.length / 1024)} KB, `
    + `${Math.round(payload.gzip.length / 1024)} KB gzipped, ${Date.now() - started} ms`);
  return payload;
}

/** The pages' data for the current game build, or null if sc-data isn't set up yet. */
export async function getCraftingPayload(): Promise<CraftingPayload | null> {
  const source = await currentSource();
  if (!source) return null;
  if (cached && cached.etag === etagFor(source.commit)) return cached;
  if (!building) {
    building = build(source)
      .then((p) => { cached = p; return p; })
      .finally(() => { building = null; });
  }
  return building;
}

/** For tests. */
export function resetCraftingCache(): void {
  cached = null;
}
