import { api } from './client';
import type { ApiResponse, CreateEventBody, EventDto } from '@dem/shared';

export const eventsApi = {
  list: (guildId: string) =>
    api.get<ApiResponse<EventDto[]>>(`/guilds/${guildId}/events`).then((r) => r.data!),

  listCompleted: (guildId: string) =>
    api.get<ApiResponse<EventDto[]>>(`/guilds/${guildId}/events?completed=true`).then((r) => r.data!),

  get: (guildId: string, eventId: string) =>
    api.get<ApiResponse<EventDto>>(`/guilds/${guildId}/events/${eventId}`).then((r) => r.data!),

  create: (guildId: string, body: CreateEventBody) =>
    api.post<ApiResponse<EventDto>>(`/guilds/${guildId}/events`, body).then((r) => r.data!),

  end: (guildId: string, eventId: string) =>
    api.post<ApiResponse>(`/guilds/${guildId}/events/${eventId}/end`).then((r) => r),

  complete: (
    guildId: string,
    eventId: string,
    body: { hadLoot: boolean; lootNotes?: string; confirmedAttendees?: string[] },
  ) => api.post<ApiResponse>(`/guilds/${guildId}/events/${eventId}/complete`, body).then((r) => r),
};
