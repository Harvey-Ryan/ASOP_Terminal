// Job board (v1.21.0).
import { api } from './client';
import type { ApiResponse, JobDto, JobInput } from '@dem/shared';

const base = (guildId: string) => `/guilds/${guildId}/jobs`;

export const jobsApi = {
  /** Open jobs this server can see, or the ones you posted or took. */
  list: (guildId: string, view: 'board' | 'mine') =>
    api.get<ApiResponse<JobDto[]>>(`${base(guildId)}${view === 'mine' ? '?view=mine' : ''}`).then((r) => r.data!),
  post: (guildId: string, job: JobInput) => api.post<ApiResponse<JobDto>>(base(guildId), job).then((r) => r.data!),
  edit: (guildId: string, id: string, job: JobInput) => api.put<ApiResponse<JobDto>>(`${base(guildId)}/${id}`, job).then((r) => r.data!),
  take: (guildId: string, id: string) => api.post<ApiResponse<JobDto>>(`${base(guildId)}/${id}/take`).then((r) => r.data!),
  leave: (guildId: string, id: string) => api.post<ApiResponse<JobDto>>(`${base(guildId)}/${id}/leave`).then((r) => r.data!),
  removeCrew: (guildId: string, id: string, userId: string) => api.delete<ApiResponse<JobDto>>(`${base(guildId)}/${id}/crew/${userId}`).then((r) => r.data!),
  close: (guildId: string, id: string, status: 'DONE' | 'CANCELLED') =>
    api.post<ApiResponse<JobDto>>(`${base(guildId)}/${id}/close`, { status }).then((r) => r.data!),
};
