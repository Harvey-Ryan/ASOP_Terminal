import { api } from './client';
import type { ApiResponse, MemberPinDto, UpsertMemberPinBody, GeocodeResult } from '@dem/shared';

export const memberPinsApi = {
  list: (guildId: string) =>
    api
      .get<ApiResponse<MemberPinDto[]>>(`/guilds/${guildId}/member-pins`)
      .then((r) => r.data ?? []),

  getMine: (guildId: string) =>
    api
      .get<ApiResponse<MemberPinDto | null>>(`/guilds/${guildId}/member-pins/mine`)
      .then((r) => r.data ?? null),

  upsert: (guildId: string, body: UpsertMemberPinBody) =>
    api
      .put<ApiResponse<MemberPinDto>>(`/guilds/${guildId}/member-pins`, body)
      .then((r) => r.data!),

  remove: (guildId: string) =>
    api.delete<ApiResponse>(`/guilds/${guildId}/member-pins`),

  geocode: (guildId: string, lat: number, lng: number) =>
    api
      .get<ApiResponse<GeocodeResult>>(
        `/guilds/${guildId}/member-pins/geocode?lat=${lat}&lng=${lng}`,
      )
      .then((r) => r.data!),
};
