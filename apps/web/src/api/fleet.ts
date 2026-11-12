import { api } from './client';
import type {
  ApiResponse, ShipCatalogEntry, MyFleetDto, GuildFleetDto, FleetImportPreviewLine, ShipSource, RsiRosterDto,
} from '@dem/shared';

const data = <T>(r: ApiResponse<T>) => r.data as T;

/** Fleets (v1.32.0): yours, a server's, the ship list and imports. */
export const fleetApi = {
  ships: () => api.get<ApiResponse<ShipCatalogEntry[]>>('/ships').then(data),

  mine: () => api.get<ApiResponse<MyFleetDto>>('/me/fleet').then(data),
  add: (body: { shipId: string; quantity?: number; nickname?: string | null; source?: ShipSource }) =>
    api.post<ApiResponse<MyFleetDto>>('/me/fleet/ships', body).then(data),
  update: (id: number, body: Partial<{ quantity: number; nickname: string | null; source: ShipSource; available: boolean; shipId: string }>) =>
    api.patch<ApiResponse<MyFleetDto>>(`/me/fleet/ships/${id}`, body).then(data),
  remove: (id: number) => api.delete<ApiResponse<MyFleetDto>>(`/me/fleet/ships/${id}`).then(data),
  confirm: () => api.post<ApiResponse<MyFleetDto>>('/me/fleet/confirm').then(data),
  setHidden: (guildIds: string[]) => api.put<ApiResponse<MyFleetDto>>('/me/fleet/hidden', { guildIds }).then(data),
  setNudges: (on: boolean) => api.put<ApiResponse<MyFleetDto>>('/me/fleet/nudges', { on }).then(data),
  previewImport: (text: string) =>
    api.post<ApiResponse<{ format: 'hangarexport' | 'fleetviewer' | 'json' | 'text'; lines: FleetImportPreviewLine[] }>>('/me/fleet/import/preview', { text }).then(data),
  applyImport: (lines: { shipId: string | null; name: string; quantity: number; nickname?: string | null }[], replace: boolean) =>
    api.post<ApiResponse<MyFleetDto>>('/me/fleet/import', { lines, replace }).then(data),

  guild: (guildId: string) => api.get<ApiResponse<GuildFleetDto>>(`/guilds/${guildId}/fleet`).then(data),

  getRsiRoster: (guildId: string) => api.get<ApiResponse<RsiRosterDto>>(`/guilds/${guildId}/rsi/roster`).then(data),
};
