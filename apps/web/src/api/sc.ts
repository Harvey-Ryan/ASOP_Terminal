import { api } from './client';
import type { ApiResponse } from '@dem/shared';

// SC Database search. Reads our sc-data copy of the game data (v1.11.1);
// sync status and "Sync now" are in gameDataApi (GameDataPipelineCard).
// Each search answers up to 50 rows.

type Row = Record<string, unknown>;
const search = (path: string) => (q: string) =>
  api.get<ApiResponse<Row[]>>(`/sc/${path}?q=${encodeURIComponent(q)}`).then((r) => r.data ?? []);

export const scApi = {
  getBlueprints: search('blueprints'),
  getShipItems: search('ship-items'),
  getCommodities: search('commodities'),
  getResources: search('resources'),
  getStarmap: search('starmap'),
  getTradeLocations: search('trade-locations'),
  getManufacturers: search('manufacturers'),
  getLabels: search('labels'),
};
