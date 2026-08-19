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
  forfeit: boolean;
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

export interface EloSummaryEntry {
  discordId: string;
  displayName: string;
  totalDelta: number;
  ratingBefore: number;
  ratingAfter: number;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireData<T>(r: ApiResponse<T>): T {
  if (!r.success) throw new Error((r as { error?: string }).error ?? 'Request failed');
  if (r.data === undefined) throw new Error('Missing data in API response');
  return r.data;
}

// For endpoints that return { success: true } with no data body
function requireSuccess(r: ApiResponse<unknown>): void {
  if (!r.success) throw new Error((r as { error?: string }).error ?? 'Request failed');
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
    api.delete<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}`).then(requireSuccess),

  // State transitions
  open: (guildId: string, id: string) =>
    api.post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/open`, {}).then(requireSuccess),

  start: (guildId: string, id: string) =>
    api.post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/start`, {}).then(requireSuccess),

  complete: (guildId: string, id: string) =>
    api.post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/complete`, {}).then(requireSuccess),

  cancel: (guildId: string, id: string) =>
    api.post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/cancel`, {}).then(requireSuccess),

  // Participants
  register: (guildId: string, id: string, body: { discordId?: string; displayName?: string; teamName?: string; teamMembers?: Pick<TournamentTeamMember, 'discordId' | 'displayName'>[] }) =>
    api
      .post<ApiResponse<TournamentParticipant>>(`/guilds/${guildId}/tournaments/${id}/register`, body)
      .then(requireData),

  unregister: (guildId: string, id: string) =>
    api.delete<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/register`).then(requireSuccess),

  removeParticipant: (guildId: string, id: string, pid: string) =>
    api.delete<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/participants/${pid}`).then(requireSuccess),

  reorder: (guildId: string, id: string, order: string[]) =>
    api.patch<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/seed`, { order }).then(requireSuccess),

  // Matches
  scheduleMatch: (guildId: string, id: string, matchId: string, scheduledAt: string) =>
    api
      .post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/matches/${matchId}/schedule`, { scheduledAt })
      .then(requireSuccess),

  submitResult: (guildId: string, id: string, matchId: string, body: { winnerId: string; scoreA?: number; scoreB?: number; forfeit?: boolean }) =>
    api
      .post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/${id}/matches/${matchId}/result`, body)
      .then(requireSuccess),

  // H2H
  submitH2H: (guildId: string, body: {
    playerADiscordId: string; playerBDiscordId: string; winnerDiscordId: string; announce: boolean;
    playerADisplayName?: string; playerBDisplayName?: string;
  }) =>
    api.post<ApiResponse<unknown>>(`/guilds/${guildId}/tournaments/h2h`, body).then(requireSuccess),

  // Rankings
  getRankings: (guildId: string, page = 1) =>
    api
      .get<ApiResponse<{ players: PlayerRating[]; total: number; page: number; limit: number }>>(`/guilds/${guildId}/tournaments/rankings?page=${page}`)
      .then(requireData),

  resetRankings: (guildId: string) =>
    api.delete<ApiResponse<{ deleted: number }>>(`/guilds/${guildId}/tournaments/rankings`).then(requireData),

  getEloSummary: (guildId: string, id: string) =>
    api
      .get<ApiResponse<EloSummaryEntry[]>>(`/guilds/${guildId}/tournaments/${id}/elo-summary`)
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

  demo: (guildId: string) =>
    api
      .post<ApiResponse<{ tournamentId: string; name: string }>>(`/guilds/${guildId}/tournaments/demo`, {})
      .then(requireData),

  demoParticipants: (guildId: string, id: string) =>
    api
      .post<ApiResponse<{ count: number }>>(`/guilds/${guildId}/tournaments/${id}/demo/participants`, {})
      .then(requireData),

  demoBracket: (guildId: string, id: string) =>
    api
      .post<ApiResponse<{ matchCount: number }>>(`/guilds/${guildId}/tournaments/${id}/demo/bracket`, {})
      .then(requireData),

  demoResolve: (guildId: string, id: string) =>
    api
      .post<ApiResponse<{ winner: string; tournamentId: string }>>(`/guilds/${guildId}/tournaments/${id}/demo/resolve`, {})
      .then(requireData),
};
