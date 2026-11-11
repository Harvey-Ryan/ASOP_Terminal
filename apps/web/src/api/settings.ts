import type { EventHeatmapDto } from '@dem/shared';
import { api } from './client';
import type { ApiResponse, DiscordRoleDto, SetupChecklistDto } from '@dem/shared';

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
  eventChannelId: string | null;
  voiceCategoryId: string | null;
  lootChannelId: string | null;
  dkpAnnouncementChannelId: string | null;
  timezone: string;
  eventCreatorRoles: string[];
  moduleEditorRoles: string[];
  viewerRoles: string[];
  dkpLabel: string;
  lootDraftCreatorRoles: string[];
  allianceManagerRoles: string[];
  eventBotEnabled: boolean;
  dkpEnabled: boolean;
  lootEnabled: boolean;
  exchangeEnabled: boolean;
  fleetEnabled: boolean;
  blueprintsEnabled: boolean;
  craftingEnabled: boolean;
  activityEnabled: boolean;
  activityHeatmapPublic: boolean;
  tournamentsEnabled: boolean;
  tournamentChannelId: string | null;
  h2hChannelId: string | null;
  statusChannelId: string | null;
  allyNoticeChannelId: string | null;
  jobsEnabled: boolean;
  jobsChannelId: string | null;
  tournamentHideElo: boolean;
  dkpDefaultAuctionDuration: number;
  dkpMinBid: number;
  lootDefaultMethod: string;
  rsiOrgTag: string | null;
  allianceTag: string | null;
}

export interface GuildMyPermissions {
  canManageEvents: boolean;
  canViewEvents: boolean;
  canCreateLootDraft: boolean;
  /** Officers who manage allies: guild managers + alliance manager roles. */
  canManageAllies: boolean;
  eventBotEnabled: boolean;
  dkpEnabled: boolean;
  lootEnabled: boolean;
  exchangeEnabled: boolean;
  fleetEnabled: boolean;
  blueprintsEnabled: boolean;
  craftingEnabled: boolean;
  activityEnabled: boolean;
  activityHeatmapPublic: boolean;
  tournamentsEnabled: boolean;
  jobsEnabled: boolean;
  rsiOrgRequired: boolean;
  rsiVerified: boolean;
}

/** The event planning heat map (rules: packages/shared/src/heatmap.ts). */
export type EventHeatmapData = EventHeatmapDto;

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

  /** The setup checklist (v1.15.0); null for people who can't change settings. */
  getSetup: (guildId: string) =>
    api.get<ApiResponse<SetupChecklistDto | null>>(`/guilds/${guildId}/setup`).then((r) => r.data ?? null),

  setSetupHidden: (guildId: string, hidden: boolean) =>
    api.put<ApiResponse<{ hidden: boolean }>>(`/guilds/${guildId}/setup/hidden`, { hidden }).then(requireData),

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

  getEventHeatmap: (guildId: string, params: { days?: number; timezone?: string }) =>
    api.get<ApiResponse<EventHeatmapData>>(`/guilds/${guildId}/heatmap/events?days=${params.days ?? 180}${params.timezone ? `&timezone=${encodeURIComponent(params.timezone)}` : ''}`).then(requireData),
};
