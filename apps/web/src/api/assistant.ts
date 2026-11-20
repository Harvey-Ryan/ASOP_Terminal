// The AI assistant's settings (v1.56.0), for a server's admins. The key is
// sent once and never comes back: the page only ever sees "key ending xxxx".
import type { ApiResponse, AssistantFlagDto, AssistantSettings, AssistantSettingsDto } from '@dem/shared';
import { api } from './client';

const data = <T>(r: ApiResponse<T>): T => {
  if (r.data === undefined) throw new Error('Missing data in API response');
  return r.data;
};

export const assistantApi = {
  get: (guildId: string) => api.get<ApiResponse<AssistantSettingsDto>>(`/guilds/${guildId}/assistant`).then(data),
  update: (guildId: string, patch: Partial<AssistantSettings>) =>
    api.put<ApiResponse<AssistantSettingsDto>>(`/guilds/${guildId}/assistant`, patch).then(data),
  saveKey: (guildId: string, key: string) =>
    api.put<ApiResponse<AssistantSettingsDto>>(`/guilds/${guildId}/assistant/key`, { key }).then(data),
  testKey: (guildId: string) =>
    api.post<ApiResponse<AssistantSettingsDto>>(`/guilds/${guildId}/assistant/key/test`, {}).then(data),
  removeKey: (guildId: string) =>
    api.delete<ApiResponse<AssistantSettingsDto>>(`/guilds/${guildId}/assistant/key`).then(data),
  flags: (guildId: string) => api.get<ApiResponse<AssistantFlagDto[]>>(`/guilds/${guildId}/assistant/flags`).then(data),
  dismissFlag: (guildId: string, id: string) => api.delete<ApiResponse>(`/guilds/${guildId}/assistant/flags/${id}`),
};
