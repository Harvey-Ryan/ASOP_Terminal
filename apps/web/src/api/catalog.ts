import { api } from './client';
import type { ApiResponse, CatalogEntry, CatalogDetail, CatalogKind } from '@dem/shared';

// Game item catalog (sc-data): every item picker and the item info card.

export const catalogApi = {
  search: (q: string, opts: { kind?: CatalogKind; limit?: number } = {}) => {
    const qs = new URLSearchParams({ q });
    if (opts.kind) qs.set('kind', opts.kind);
    if (opts.limit) qs.set('limit', String(opts.limit));
    return api.get<ApiResponse<CatalogEntry[]>>(`/catalog/search?${qs.toString()}`).then((r) => r.data ?? []);
  },

  item: (ref: string) =>
    api.get<ApiResponse<CatalogDetail>>(`/catalog/item/${encodeURIComponent(ref)}`).then((r) => r.data ?? null),
};

/** A row in an item-name suggestion list. `id` is the catalog ref. */
export interface ItemSuggestion {
  id: string;
  name: string;
  detail: string;
  type: 'item' | 'commodity';
}

export async function itemSuggestions(q: string, limit = 12, kind?: CatalogKind): Promise<ItemSuggestion[]> {
  const hits = await catalogApi.search(q, { limit, kind });
  return hits.map((e) => ({ id: e.ref, name: e.name, detail: e.detail, type: e.kind === 'COMMODITY' ? 'commodity' : 'item' }));
}
