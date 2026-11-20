import { api } from './client';
import type {
  ApiResponse,
  BriefingContent,
  EventTemplateBriefingDto,
  EventTemplateDto,
  UpsertEventTemplateBody,
} from '@dem/shared';

const data = <T>(r: ApiResponse<T>) => r.data as T;
const base = (guildId: string) => `/guilds/${guildId}/event-templates`;

/** Event templates and their briefings (v1.41.0). */
export const eventTemplatesApi = {
  all: (guildId: string) => api.get<ApiResponse<EventTemplateDto[]>>(`${base(guildId)}/all`).then(data),
  get: (guildId: string, id: string) => api.get<ApiResponse<EventTemplateDto>>(`${base(guildId)}/${id}`).then(data),
  create: (guildId: string, body: UpsertEventTemplateBody) =>
    api.post<ApiResponse<EventTemplateDto>>(base(guildId), body).then(data),
  update: (guildId: string, id: string, body: UpsertEventTemplateBody) =>
    api.put<ApiResponse<EventTemplateDto>>(`${base(guildId)}/${id}`, body).then(data),
  remove: (guildId: string, id: string) => api.delete<ApiResponse>(`${base(guildId)}/${id}`).then(() => undefined),
  briefing: (guildId: string, id: string) =>
    api.get<ApiResponse<EventTemplateBriefingDto>>(`${base(guildId)}/${id}/briefing`).then(data),
  saveBriefing: (guildId: string, id: string, content: BriefingContent, fromEventId?: string) =>
    api
      .put<ApiResponse<EventTemplateBriefingDto>>(`${base(guildId)}/${id}/briefing`, { content, fromEventId })
      .then(data),
  removeBriefing: (guildId: string, id: string) =>
    api.delete<ApiResponse>(`${base(guildId)}/${id}/briefing`).then(() => undefined),
};
