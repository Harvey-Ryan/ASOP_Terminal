import { api } from './client';
import type {
  ApiResponse,
  AllianceDto,
  AllianceGuildDto,
  AllianceInvitationDto,
  CreateAllianceBody,
  RenameAllianceBody,
  AddAllianceMemberBody,
} from '@dem/shared';

export const allianceApi = {
  listGuilds: () =>
    api.get<ApiResponse<AllianceGuildDto[]>>('/alliances/guilds').then((r) => r.data ?? []),

  list: () =>
    api.get<ApiResponse<AllianceDto[]>>('/alliances').then((r) => r.data ?? []),

  create: (body: CreateAllianceBody) =>
    api.post<ApiResponse<AllianceDto>>('/alliances', body).then((r) => r.data!),

  rename: (allianceId: string, body: RenameAllianceBody) =>
    api.patch<ApiResponse<AllianceDto>>(`/alliances/${allianceId}`, body).then((r) => r.data!),

  remove: (allianceId: string) =>
    api.delete<ApiResponse>(`/alliances/${allianceId}`),

  addMember: (allianceId: string, body: AddAllianceMemberBody) =>
    api.post<ApiResponse<AllianceDto>>(`/alliances/${allianceId}/members`, body).then((r) => r.data!),

  removeMember: (allianceId: string, guildId: string) =>
    api.delete<ApiResponse<AllianceDto>>(`/alliances/${allianceId}/members/${guildId}`).then((r) => r.data!),

  getInvitations: (discordGuildId: string) =>
    api
      .get<ApiResponse<AllianceInvitationDto[]>>(`/alliances/invitations?discordGuildId=${discordGuildId}`)
      .then((r) => r.data ?? []),

  acceptInvitation: (memberId: string, discordGuildId: string) =>
    api
      .patch<ApiResponse<AllianceDto>>(
        `/alliances/invitations/${memberId}/accept?discordGuildId=${discordGuildId}`,
        {},
      )
      .then((r) => r.data!),

  rejectInvitation: (memberId: string, discordGuildId: string) =>
    api.delete<ApiResponse>(`/alliances/invitations/${memberId}?discordGuildId=${discordGuildId}`),
};
