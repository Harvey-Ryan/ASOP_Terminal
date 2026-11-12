// Modules a platform admin hid for every server (v1.28.0), from
// AdminConfig.hiddenModules. Read on every module check, so it's cached for a
// few seconds; the admin route clears the cache when it changes them.

import { parseHiddenModules, type ModuleSetting } from '@dem/shared';
import { prisma } from './prisma.js';

const TTL_MS = 15_000;
let cache: { at: number; hidden: Set<ModuleSetting> } | null = null;

export async function hiddenModules(): Promise<Set<ModuleSetting>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.hidden;
  try {
    const row = await prisma.adminConfig.findUnique({ where: { id: 1 }, select: { hiddenModules: true } });
    cache = { at: Date.now(), hidden: new Set(parseHiddenModules(row?.hiddenModules)) };
  } catch (err) {
    // Keep the last known list rather than showing hidden modules.
    console.error('[hiddenModules] could not read AdminConfig', err);
    if (!cache) return new Set();
    cache = { ...cache, at: Date.now() };
  }
  return cache.hidden;
}

export function forgetHiddenModules(): void {
  cache = null;
}
