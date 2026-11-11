// Member history (v1.18.0).
import { api } from './client';
import type { ApiResponse, MemberHistoryDto, MemberSummaryDto } from '@dem/shared';

export const membersApi = {
  /** Everyone who signed up for or attended the server's events (officers). */
  list: (guildId: string) =>
    api.get<ApiResponse<MemberSummaryDto[]>>(`/guilds/${guildId}/members`).then((r) => r.data!),

  /** One person's history; userId "me" for your own. */
  get: (guildId: string, userId: string) =>
    api.get<ApiResponse<MemberHistoryDto>>(`/guilds/${guildId}/members/${userId}`).then((r) => r.data!),
};
