// /api/admin/* (v1.13.0). Platform admins only.
import type {
  AdminConfigDto, AdminGuildDetailDto, AdminGuildDto, AdminLogDto, AdminOverviewDto, ApiResponse,
  ErrorDetailDto, ErrorEventDto, ErrorGroupDto, ErrorGroupStatus,
  AdminModuleDto,
  ModuleSetting,
} from '@dem/shared';
import { api } from './client';

export interface ErrorFilters {
  source?: string; level?: string; q?: string; guildId?: string; userId?: string; ref?: string;
  fingerprint?: string; release?: string; period?: string; status?: string;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const adminApi = {
  overview: () => api.get<ApiResponse<AdminOverviewDto>>('/admin/overview').then((r) => r.data!),
  errors: (f: ErrorFilters & { after?: number; before?: number; limit?: number }) =>
    api.get<ApiResponse<ErrorEventDto[]>>(`/admin/errors${qs({ ...f })}`).then((r) => r.data!),
  groups: (f: ErrorFilters) => api.get<ApiResponse<ErrorGroupDto[]>>(`/admin/errors/groups${qs({ ...f })}`).then((r) => r.data!),
  error: (id: number) => api.get<ApiResponse<ErrorDetailDto>>(`/admin/errors/${id}`).then((r) => r.data!),
  markGroup: (fingerprint: string, body: { status?: ErrorGroupStatus; note?: string }) =>
    api.patch<ApiResponse<{ status: ErrorGroupStatus; note: string }>>(`/admin/errors/groups/${fingerprint}`, body).then((r) => r.data!),
  guilds: () => api.get<ApiResponse<AdminGuildDto[]>>('/admin/guilds').then((r) => r.data!),
  guild: (guildId: string) => api.get<ApiResponse<AdminGuildDetailDto>>(`/admin/guilds/${guildId}`).then((r) => r.data!),
  saveSettings: (guildId: string, changes: Record<string, unknown>) =>
    api.patch<ApiResponse<{ settings: Record<string, unknown>; changed: string[] }>>(`/admin/guilds/${guildId}/settings`, changes).then((r) => r.data!),
  log: (f: { kind?: string; guildId?: string; before?: number; limit?: number }) =>
    api.get<ApiResponse<AdminLogDto[]>>(`/admin/log${qs({ ...f })}`).then((r) => r.data!),
  config: () => api.get<ApiResponse<AdminConfigDto>>('/admin/config').then((r) => r.data!),
  saveConfig: (c: Omit<AdminConfigDto, 'lastDigestDate'>) => api.put<ApiResponse<AdminConfigDto>>('/admin/config', c).then((r) => r.data!),
  modules: () => api.get<ApiResponse<AdminModuleDto[]>>('/admin/modules').then((r) => r.data!),
  saveModules: (hidden: ModuleSetting[]) => api.put<ApiResponse<AdminModuleDto[]>>('/admin/modules', { hidden }).then((r) => r.data!),
  testFeed: () => api.post<ApiResponse<{ queued: boolean }>>('/admin/config/test').then((r) => r.data!),
};
