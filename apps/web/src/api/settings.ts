import { api } from './client';
import type { ApiResponse, DiscordRoleDto } from '@dem/shared';

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

export interface GuildChannels {
  channels: DiscordChannel[];
}

export interface GuildSettingsData {
  forumChannelId: string | null;
  voiceCategoryId: string | null;
  dkpAnnouncementChannelId: string | null;
  eventCreatorRoles: string[];
  moduleEditorRoles: string[];
  viewerRoles: string[];
  dkpLabel: string;
}

export interface GuildMyPermissions {
  canManageEvents: boolean;
  canViewEvents: boolean;
}

function requireData<T>(r: ApiResponse<T>): T {
  if (r.data === undefined) throw new Error('Missing data in API response');
  return r.data;
}

export const settingsApi = {
  getChannels: (guildId: string) =>
    api.get<ApiResponse<GuildChannels>>(`/guilds/${guildId}/channels`).then(requireData),

  getRoles: (guildId: string) =>
    api.get<ApiResponse<{ roles: DiscordRoleDto[] }>>(`/guilds/${guildId}/roles`).then((r) => requireData(r).roles),

  getSettings: (guildId: string) =>
    api.get<ApiResponse<GuildSettingsData>>(`/guilds/${guildId}/settings`).then(requireData),

  updateSettings: (guildId: string, data: Partial<GuildSettingsData>) =>
    api.patch<ApiResponse<GuildSettingsData>>(`/guilds/${guildId}/settings`, data).then(requireData),

  getMyPermissions: (guildId: string) =>
    api.get<ApiResponse<GuildMyPermissions>>(`/guilds/${guildId}/my-permissions`).then(requireData),

  getLabel: (guildId: string) =>
    api.get<ApiResponse<{ dkpLabel: string }>>(`/guilds/${guildId}/settings/label`).then(requireData),

  registerCommands: (guildId: string) =>
    api.post<ApiResponse<null>>(`/guilds/${guildId}/settings/register-commands`, {}).then(requireData),

  getBotConfig: (guildId: string) =>
    api.get<ApiResponse<{ globalCommandsEnabled: boolean }>>(`/guilds/${guildId}/settings/bot-config`).then(requireData),

  updateBotConfig: (guildId: string, data: { globalCommandsEnabled: boolean }) =>
    api.patch<ApiResponse<{ globalCommandsEnabled: boolean }>>(`/guilds/${guildId}/settings/bot-config`, data).then(requireData),
};
