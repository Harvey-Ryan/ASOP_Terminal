import { api, ApiError } from './client';

export interface RcStats {
  total_members: string;
  total_messages: string;
  total_voice_minutes: string;
  inactive_count: string;
  top_streak: string;
}

export interface RcLeaderboardRow {
  user_id: string;
  message_count: number;
  voice_minutes: number;
  streak_days: number;
  is_inactive: boolean;
  score: number;
  achievement_count: number;
  displayName: string;
  username: string;
  avatar: string;
}

export interface RcLeaderboard {
  rows: RcLeaderboardRow[];
  total: number;
  page: number;
  totalPages: number;
  /** Members flagged inactive (no activity for the guild's inactivity window). Missing on older RoleCallBot versions. */
  inactiveCount?: number;
  /** True when inactive members were left out of `rows` */
  inactiveHidden?: boolean;
}

export interface RcAchievement {
  id: number;
  name: string;
  description: string;
  emoji: string;
  type: string;
  threshold: number | null;
  earned_at: string | null;
}

export interface RcHistoryEntry {
  id: number;
  change_type: string;
  roles_removed: string[];
  roles_added: string[];
  reason: string;
  changed_at: string;
}

export interface RcMember {
  activity: {
    message_count: number;
    voice_minutes: number;
    streak_days: number;
    is_inactive: boolean;
    last_active_at: string;
    score: number;
  };
  rank: number;
  achievements: RcAchievement[];
  history: RcHistoryEntry[];
  member: { displayName: string; username: string; avatar: string };
}

export interface RcConfig {
  guild_id: string;
  inactivity_days: number;
  active_role_id: string | null;
  inactive_role_id: string | null;
  achievements_channel_id: string | null;
  leaderboard_channel_id: string | null;
  leaderboard_schedule: 'daily' | 'weekly';
  message_weight: number;
  voice_weight: number;
}

export interface RcRoleChangeRow {
  id: number;
  user_id: string;
  change_type: string;
  roles_removed: string[] | null;
  roles_added: string[] | null;
  reason: string | null;
  changed_at: string;
  displayName: string;
  username: string;
  avatar: string;
}

export interface RcRoleChangeLog {
  rows: RcRoleChangeRow[];
  total: number;
  page: number;
  totalPages: number;
}

export interface RcLeftMember {
  user_id: string;
  message_count: number;
  voice_minutes: number;
  streak_days: number;
  last_active_at: string | null;
  left_at: string | null;
  displayName: string;
  username: string;
  avatar: string;
}

export interface RcLeftMembers {
  rows: RcLeftMember[];
  total: number;
}

export type RcHeatmapType = 'combined' | 'message' | 'voice';

export interface RcHeatmap {
  grid: number[][];  // [7][24]
  max: number;
  days: number;
  timezone: string;
  type: RcHeatmapType;
  guild_id: string;
  user_id?: string;
}

export const roleCallApi = {
  getStats: (guildId: string) =>
    api.get<RcStats>(`/rolecall/stats?guildId=${encodeURIComponent(guildId)}`),

  getLeaderboard: (guildId: string, page = 1, includeInactive = false) =>
    api.get<RcLeaderboard>(
      `/rolecall/leaderboard?guildId=${encodeURIComponent(guildId)}&page=${page}${includeInactive ? '&includeInactive=true' : ''}`,
    ),

  getMember: (guildId: string, userId: string) =>
    api.get<RcMember>(`/rolecall/member?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}`),

  getConfig: (guildId: string) =>
    api.get<RcConfig>(`/rolecall/config?guildId=${encodeURIComponent(guildId)}`),

  updateConfig: (guildId: string, data: Partial<Omit<RcConfig, 'guild_id'>>) =>
    api.patch<RcConfig>(`/rolecall/config?guildId=${encodeURIComponent(guildId)}`, data),

  getRoleChangeLog: (guildId: string, page = 1) =>
    api.get<RcRoleChangeLog>(`/rolecall/role-change-log?guildId=${encodeURIComponent(guildId)}&page=${page}`),

  getLeftMembers: (guildId: string) =>
    api.get<RcLeftMembers>(`/rolecall/left-members?guildId=${encodeURIComponent(guildId)}`),

  /** The server's combined, message and voice grids. */
  getGuildHeatmaps: (guildId: string, params: HeatmapParams) =>
    heatmapLayers(`/rolecall/heatmap/guild?guildId=${encodeURIComponent(guildId)}${heatmapQuery(params)}`),

  /** One member's combined, message and voice grids. */
  getMemberHeatmaps: (guildId: string, userId: string, params: HeatmapParams) =>
    heatmapLayers(`/rolecall/heatmap/user?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}${heatmapQuery(params)}`),
};

interface HeatmapParams { days?: number; timezone?: string }
const heatmapQuery = (p: HeatmapParams) =>
  `${p.days ? `&days=${p.days}` : ''}${p.timezone ? `&timezone=${encodeURIComponent(p.timezone)}` : ''}`;

export interface RcHeatmapLayer { grid: number[][]; max: number }
export type RcHeatmapLayers = Record<RcHeatmapType, RcHeatmapLayer>;

/**
 * All three grids in one request (RoleCall's type=all). A RoleCall from
 * before it answers 400, so then ask for each grid separately.
 */
let allUnsupported = false; // learnt once per page load

async function heatmapLayers(url: string): Promise<RcHeatmapLayers> {
  if (!allUnsupported) {
    try {
      const r = await api.get<RcHeatmap & { layers?: RcHeatmapLayers }>(`${url}&type=all`);
      if (r.layers) return r.layers;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400)) throw err;
    }
    allUnsupported = true;
  }
  const types: RcHeatmapType[] = ['combined', 'message', 'voice'];
  const [combined, message, voice] = await Promise.all(types.map((t) => api.get<RcHeatmap>(`${url}&type=${t}`)));
  return { combined: combined!, message: message!, voice: voice! };
}
