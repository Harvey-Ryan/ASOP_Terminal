// Game item catalog for the bot (items and commodities from sc-data, commodity
// prices from UEX). Shared logic and SQL: packages/shared/src/catalog.ts.

import type { AutocompleteInteraction } from 'discord.js';
import { createCatalogStore, type CatalogEntry, type CatalogKind } from '@dem/shared';
import { prisma } from './db.js';

export const catalog = createCatalogStore(prisma, {
  onLoad: (index, version) => console.log(`[catalog] Loaded ${index.entries.length} items and commodities from game data ${version.slice(0, 12)}`),
});

/** Autocomplete choices for an item/commodity option. Values are catalog refs. */
export async function respondWithCatalog(interaction: AutocompleteInteraction, kinds?: CatalogKind[]): Promise<void> {
  const focused = interaction.options.getFocused();
  if (focused.trim().length < 2) {
    await interaction.respond([]);
    return;
  }
  const hits = (await catalog.get()).search(focused, { kinds, limit: 25 });
  await interaction.respond(hits.map((e) => ({ name: `${e.name} (${e.detail})`.slice(0, 100), value: e.ref })));
}

/** The picked suggestion, or an exact name typed without picking one. */
export async function resolveCatalogOption(value: string): Promise<CatalogEntry | undefined> {
  const index = await catalog.get();
  return index.get(value) ?? index.findByName(value);
}

/**
 * Prisma filter for inventory entries of this item: linked by game UUID, or
 * not linked yet but saved under exactly the same name.
 */
export function inventoryOf(entry: CatalogEntry) {
  return {
    itemType: entry.kind,
    OR: [
      { itemUuid: entry.uuid },
      { itemUuid: null, itemName: { equals: entry.name, mode: 'insensitive' as const } },
    ],
  };
}
