// Reads the sc-data worker's tables (Postgres schema `scdata`, see
// apps/sc-data/README.md) and adapts them to the raw shapes gamedata.ts already
// understands (the shapes of the old JSON snapshot), shared with the API.

import { prisma } from './db.js';
import { adaptBlueprint, adaptContract, CRAFTING_CONTRACTS_SQL, type RawMission, type ScBlueprintJson, type ScContractJson } from '@dem/shared';
import type { RawGameData, RawResource } from './gamedata.js';

/** Commit of the data currently in scdata, or null if the worker hasn't run. */
export async function scdataCommit(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ commit: string }[]>('SELECT commit FROM scdata.source LIMIT 1');
    return rows[0]?.commit ?? null;
  } catch {
    return null; // schema not there yet
  }
}

// The JSON shapes and adapters are shared with the API (packages/shared/src/crafting.ts).
export { adaptBlueprint, adaptContract, fillMissionTokens } from '@dem/shared';

export async function loadScdataRaw(): Promise<{ raw: RawGameData; build: string | null }> {
  const [bps, res, contracts, src] = await Promise.all([
    prisma.$queryRawUnsafe<{ data: ScBlueprintJson }[]>('SELECT data FROM scdata.blueprints'),
    prisma.$queryRawUnsafe<{ uuid: string; name: string }[]>('SELECT uuid, name FROM scdata.resources'),
    // Only missions that can reward blueprints, and that are actually in the game.
    prisma.$queryRawUnsafe<{ data: ScContractJson }[]>(CRAFTING_CONTRACTS_SQL),
    prisma.$queryRawUnsafe<{ build: string | null }[]>('SELECT build FROM scdata.source LIMIT 1'),
  ]);
  const resources: RawResource[] = res.map((r) => ({ UUID: r.uuid, Name: r.name }));
  return {
    raw: {
      blueprints: bps.map((r) => adaptBlueprint(r.data)),
      resources,
      missions: contracts.map((r) => adaptContract(r.data)).filter((m): m is RawMission => m !== null),
    },
    build: src[0]?.build ?? null,
  };
}
