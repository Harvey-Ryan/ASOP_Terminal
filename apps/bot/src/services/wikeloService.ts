// Wikelo's missions for /wikelo (v1.34.0), from scdata like the website's
// Wikelo page (packages/shared/src/wikelo.ts). Loaded on first use and again
// when sc-data has synced a new commit (checked at most every 10 minutes).

import { buildWikeloMissions, WIKELO_CONTRACTS_SQL, type WikeloContractJson, type WikeloMission } from '@dem/shared';
import { prisma } from '../db.js';
import { scdataCommit } from '../gamedataScdata.js';

let cache: { commit: string; missions: WikeloMission[] } | null = null;
let checkedAt = 0;
let loading: Promise<WikeloMission[]> | null = null;

async function load(): Promise<WikeloMission[]> {
  const commit = await scdataCommit();
  if (!commit) return [];
  if (cache?.commit === commit) return cache.missions;
  const rows = await prisma.$queryRawUnsafe<{ uuid: string; data: WikeloContractJson }[]>(WIKELO_CONTRACTS_SQL);
  cache = { commit, missions: buildWikeloMissions(rows) };
  console.log(`[wikelo] Loaded ${cache.missions.length} Wikelo missions`);
  return cache.missions;
}

/** Every Wikelo mission in the current game data ([] if sc-data isn't there). */
export async function wikeloMissions(): Promise<WikeloMission[]> {
  if (cache && Date.now() - checkedAt < 10 * 60_000) return cache.missions;
  if (!loading) {
    loading = load()
      .then((m) => { checkedAt = Date.now(); return m; })
      .catch((err: unknown) => { console.error('[wikelo] Could not load missions:', err); return cache?.missions ?? []; })
      .finally(() => { loading = null; });
  }
  return loading;
}
