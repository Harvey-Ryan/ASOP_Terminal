import { api } from './client';
import type { ApiResponse, CreateEventBody, EventDto, RepeatTemplateDto } from '@dem/shared';

export const eventsApi = {
  list: (guildId: string) =>
    api.get<ApiResponse<EventDto[]>>(`/guilds/${guildId}/events`).then((r) => r.data!),

  listCompleted: (guildId: string) =>
    api.get<ApiResponse<EventDto[]>>(`/guilds/${guildId}/events?completed=true`).then((r) => r.data!),

  get: (guildId: string, eventId: string) =>
    api.get<ApiResponse<EventDto>>(`/guilds/${guildId}/events/${eventId}`).then((r) => r.data!),

  create: (guildId: string, body: CreateEventBody) =>
    api.post<ApiResponse<EventDto>>(`/guilds/${guildId}/events`, body).then((r) => r.data!),

  update: (guildId: string, eventId: string, body: Partial<CreateEventBody>) =>
    api.patch<ApiResponse<EventDto>>(`/guilds/${guildId}/events/${eventId}`, body).then((r) => r.data!),

  reassignRsvp: (guildId: string, eventId: string, userId: string, role: string | null) =>
    api.patch<ApiResponse<EventDto>>(`/guilds/${guildId}/events/${eventId}/rsvp/${userId}`, { role }).then((r) => r.data!),

  rsvp: (guildId: string, eventId: string, role: string | null) =>
    api.put<ApiResponse<EventDto>>(`/guilds/${guildId}/events/${eventId}/rsvp`, { role }).then((r) => r.data!),

  removeRsvp: (guildId: string, eventId: string) =>
    api.delete<ApiResponse<EventDto>>(`/guilds/${guildId}/events/${eventId}/rsvp`).then((r) => r.data!),

  end: (guildId: string, eventId: string) =>
    api.post<ApiResponse>(`/guilds/${guildId}/events/${eventId}/end`).then((r) => r),

  listRepeatTemplates: (guildId: string) =>
    api.get<ApiResponse<RepeatTemplateDto[]>>(`/guilds/${guildId}/repeat-templates`).then((r) => r.data!),

  getOrCreateRepeatTemplate: (guildId: string, eventId: string) =>
    api.post<ApiResponse<RepeatTemplateDto>>(`/guilds/${guildId}/repeat-templates/from-event`, { eventId })
      .then((r) => r.data!),

  complete: (
    guildId: string,
    eventId: string,
    body: { hadLoot: boolean; lootNotes?: string; confirmedAttendees?: string[] },
  ) => api.post<ApiResponse>(`/guilds/${guildId}/events/${eventId}/complete`, body).then((r) => r),
};
