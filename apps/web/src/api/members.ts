// Member history (v1.18.0); date range v1.23.0.
import { api } from './client';
import type { ApiResponse, MemberHistoryDto, MemberSummaryDto } from '@dem/shared';

/** Only count what happened between these moments (ISO); either end may be open. */
export interface MemberRange { from?: string; to?: string }

const qs = (r: MemberRange) => {
  const p = new URLSearchParams();
  if (r.from) p.set('from', r.from);
  if (r.to) p.set('to', r.to);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const membersApi = {
  /** Everyone who signed up for or attended the server's events (officers). */
  list: (guildId: string, range: MemberRange = {}) =>
    api.get<ApiResponse<MemberSummaryDto[]>>(`/guilds/${guildId}/members${qs(range)}`).then((r) => r.data!),

  /** One person's history; userId "me" for your own. */
  get: (guildId: string, userId: string, range: MemberRange = {}) =>
    api.get<ApiResponse<MemberHistoryDto>>(`/guilds/${guildId}/members/${userId}${qs(range)}`).then((r) => r.data!),
};
