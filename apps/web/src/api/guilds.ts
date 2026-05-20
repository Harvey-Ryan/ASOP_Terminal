import { api } from './client';
import type { ApiResponse, ManagedGuild } from '@dem/shared';

export const guildsApi = {
  /** Fetch the guilds the authed user can manage (MANAGE_GUILD or higher). */
  getGuilds: () =>
    api.get<ApiResponse<ManagedGuild[]>>('/guilds').then((r) => r.data ?? []),
};
