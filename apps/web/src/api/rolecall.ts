import { api } from './client';

export interface RcGuild {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
}

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

export const roleCallApi = {
  getGuilds: () =>
    api.get<RcGuild[]>('/rolecall/guilds'),

  getStats: (guildId: string) =>
    api.get<RcStats>(`/rolecall/stats?guildId=${encodeURIComponent(guildId)}`),

  getLeaderboard: (guildId: string, page = 1) =>
    api.get<RcLeaderboard>(`/rolecall/leaderboard?guildId=${encodeURIComponent(guildId)}&page=${page}`),

  getMember: (guildId: string, userId: string) =>
    api.get<RcMember>(`/rolecall/member?guildId=${encodeURIComponent(guildId)}&userId=${encodeURIComponent(userId)}`),
};
