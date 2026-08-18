import { api } from './client';
import type { ApiResponse } from '@dem/shared';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface Tournament {
  id: string;
  guildId: string;
  name: string;
  description: string | null;
  format: string;
  participantMode: string;
  size: number;
  status: string;
  seedingMode: string;
  dkpPrize1st: number;
  dkpPrize2nd: number;
  dkpPrize3rd: number;
  channelId: string | null;
  threadId: string | null;
  registrationEndsAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  _count?: { participants: number; matches: number };
}

export interface TournamentParticipant {
  id: string;
  tournamentId: string;
  displayName: string;
  discordId: string | null;
  seed: number | null;
  status: string;
  inLosers: boolean;
  placement: number | null;
  createdAt: string;
  teamMembers?: TournamentTeamMember[];
}

export interface TournamentTeamMember {
  id: string;
  participantId: string;
  discordId: string;
  displayName: string;
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  round: number;
  position: number;
  bracketSide: string;
  participantAId: string | null;
  participantBId: string | null;
  winnerId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  status: string;
  nextMatchId: string | null;
  scheduledAt: string | null;
  resultPostedAt: string | null;
}

export interface TournamentDetail extends Tournament {
  participants: TournamentParticipant[];
  matches: TournamentMatch[];
  seasons: Array<{ season: { id: string; name: string; status: string } }>;
}

export interface TournamentSeason {
  id: string;
  guildId: string;
  name: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  _count?: { links: number };
}

export interface PlayerRating {
  id: string;
  guildId: string;
  discordId: string;
  displayName: string;
  rating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  peakRating: number;
  updatedAt: string;
}

export interface SeasonStanding {
  id: string;
  seasonId: string;
  guildId: string;
  discordId: string;
  displayName: string;
  rating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
}

export interface RatingHistoryEntry {
  id: string;
  matchId: string;
  tournamentId: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  won: boolean;
  opponentName: string | null;
  opponentRatingBefore: number | null;
  createdAt: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function requireData<T>(r: ApiResponse<T>): T {
  if (r.data === undefined) throw new Error('Missing data in API response');
  return r.data;
}

// ── API client ────────────────────────────────────────────────────────────────

export const tournamentApi = {
  // Tournaments
  list: (guildId: string, status?: string) =>
    api
      .get<ApiResponse<Tournament[]>>(`/guilds/${guildId}/tournaments${status ? `?status=${status}` : ''}`)
      .then(requireData),

  get: (guildId: string, id: string) =>
    api
      .get<ApiResponse<TournamentDetail>>(`/guilds/${guildId}/tournaments/${id}`)
      .then(requireData),

  create: (guildId: string, body: Partial<Tournament> & { name: string; seasonId?: string }) =>
    api
      .post<ApiResponse<Tournament>>(`/guilds/${guildId}/tournaments`, body)
      .then(requireData),

  update: (guildId: string, id: string, body: Partial<Tournament>) =>
    api
      .patch<ApiResponse<Tournament>>(`/guilds/${guildId}/tournaments/${id}`, body)
      .then(requireData),

  delete: (guildId: string, id: string) =>
    api.delete<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}`).then(requireData),

  // State transitions
  open: (guildId: string, id: string) =>
    api.post<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/open`, {}).then(requireData),

  start: (guildId: string, id: string) =>
    api.post<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/start`, {}).then(requireData),

  complete: (guildId: string, id: string) =>
    api.post<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/complete`, {}).then(requireData),

  // Participants
  register: (guildId: string, id: string, body: { discordId?: string; displayName?: string; teamName?: string; teamMembers?: TournamentTeamMember[] }) =>
    api
      .post<ApiResponse<TournamentParticipant>>(`/guilds/${guildId}/tournaments/${id}/register`, body)
      .then(requireData),

  removeParticipant: (guildId: string, id: string, pid: string) =>
    api.delete<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/participants/${pid}`).then(requireData),

  reorder: (guildId: string, id: string, order: string[]) =>
    api.patch<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/seed`, { order }).then(requireData),

  // Matches
  scheduleMatch: (guildId: string, id: string, matchId: string, scheduledAt: string) =>
    api
      .post<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/matches/${matchId}/schedule`, { scheduledAt })
      .then(requireData),

  submitResult: (guildId: string, id: string, matchId: string, body: { winnerId: string; scoreA?: number; scoreB?: number }) =>
    api
      .post<ApiResponse<void>>(`/guilds/${guildId}/tournaments/${id}/matches/${matchId}/result`, body)
      .then(requireData),

  // Rankings
  getRankings: (guildId: string, page = 1) =>
    api
      .get<ApiResponse<{ players: PlayerRating[]; total: number; page: number; limit: number }>>(`/guilds/${guildId}/tournaments/rankings?page=${page}`)
      .then(requireData),

  getPlayerHistory: (guildId: string, discordId: string) =>
    api
      .get<ApiResponse<PlayerRating & { history: RatingHistoryEntry[] }>>(`/guilds/${guildId}/tournaments/players/${discordId}/history`)
      .then(requireData),

  // Seasons
  getSeasons: (guildId: string) =>
    api.get<ApiResponse<TournamentSeason[]>>(`/guilds/${guildId}/tournaments/seasons`).then(requireData),

  createSeason: (guildId: string, name: string) =>
    api.post<ApiResponse<TournamentSeason>>(`/guilds/${guildId}/tournaments/seasons`, { name }).then(requireData),

  updateSeason: (guildId: string, seasonId: string, body: Partial<{ name: string; status: string }>) =>
    api
      .patch<ApiResponse<TournamentSeason>>(`/guilds/${guildId}/tournaments/seasons/${seasonId}`, body)
      .then(requireData),

  getSeasonStandings: (guildId: string, seasonId: string) =>
    api
      .get<ApiResponse<SeasonStanding[]>>(`/guilds/${guildId}/tournaments/seasons/${seasonId}/standings`)
      .then(requireData),
};
