import { api } from './client';
import type { ApiResponse, UexSyncStatusDto } from '@dem/shared';

// UEX Corp is now only used for average commodity prices; item search and
// details come from the game item catalog (api/catalog.ts).

export const uexApi = {
  getStatus: () =>
    api.get<ApiResponse<UexSyncStatusDto>>('/uex/sync/status').then((r) => r.data!),

  triggerSync: (guildId: string) =>
    api.post<ApiResponse<{ logId: string }>>(`/uex/sync?guildId=${guildId}`, {}).then((r) => r.data!),
};
