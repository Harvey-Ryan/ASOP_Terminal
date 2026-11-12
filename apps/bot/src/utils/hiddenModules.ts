// Modules a platform admin hid for every server (v1.28.0; AdminConfig.hiddenModules,
// set in the admin panel). Cached for a minute: a change reaches the bot within that.

import { parseHiddenModules, type ModuleSetting } from '@dem/shared';
import { prisma } from '../db.js';

let cache: { at: number; hidden: Set<ModuleSetting> } | null = null;

export async function hiddenModules(): Promise<Set<ModuleSetting>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.hidden;
  try {
    const row = await prisma.adminConfig.findUnique({ where: { id: 1 }, select: { hiddenModules: true } });
    cache = { at: Date.now(), hidden: new Set(parseHiddenModules(row?.hiddenModules)) };
  } catch (err) {
    console.error('[hiddenModules] could not read AdminConfig', err);
    if (!cache) return new Set();
    cache = { ...cache, at: Date.now() };
  }
  return cache.hidden;
}
