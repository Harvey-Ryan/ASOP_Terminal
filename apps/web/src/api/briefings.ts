import { api } from './client';
import type { ApiResponse, BriefingContent, BriefingDto, BriefingViewDto } from '@dem/shared';

const data = <T>(r: ApiResponse<T>) => r.data as T;
const base = (guildId: string, eventId: string) => `/guilds/${guildId}/events/${eventId}/briefing`;

export interface PastBriefing extends BriefingDto { eventName: string; startTime: string; outcome: string | null }

/** Mission briefings (v1.36.0). */
export const briefingsApi = {
  get: (guildId: string, eventId: string) => api.get<ApiResponse<BriefingViewDto>>(base(guildId, eventId)).then(data),
  save: (guildId: string, eventId: string, content: BriefingContent) =>
    api.put<ApiResponse<BriefingDto>>(base(guildId, eventId), { content }).then(data),
  publish: (guildId: string, eventId: string, published: boolean) =>
    api.post<ApiResponse<BriefingDto>>(`${base(guildId, eventId)}/publish`, { published }).then(data),
  remove: (guildId: string, eventId: string) => api.delete<ApiResponse>(base(guildId, eventId)).then(() => undefined),
  past: (guildId: string) => api.get<ApiResponse<PastBriefing[]>>(`/guilds/${guildId}/briefings`).then(data),
};
