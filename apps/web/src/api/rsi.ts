import { api } from './client';
import type { ApiResponse, RsiVerifyStatusDto } from '@dem/shared';

export const rsiApi = {
  getVerifyStatus: (guildId: string) =>
    api.get<ApiResponse<RsiVerifyStatusDto>>(`/guilds/${guildId}/rsi/verify-status`).then((r) => r.data!),

  startVerify: (guildId: string, handle: string) =>
    api.post<ApiResponse<RsiVerifyStatusDto>>(`/guilds/${guildId}/rsi/start-verify`, { handle }).then((r) => r.data!),

  completeVerify: (guildId: string) =>
    api.post<ApiResponse<RsiVerifyStatusDto>>(`/guilds/${guildId}/rsi/complete-verify`, {}).then((r) => r.data!),
};
