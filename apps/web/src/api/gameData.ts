import { api } from './client';
import type { ApiResponse, GameDataStatus } from '@dem/shared';

export interface GameDataStatusResponse extends GameDataStatus {
  canRequestSync: boolean;
}

export const gameDataApi = {
  getStatus: () =>
    api.get<ApiResponse<GameDataStatusResponse>>('/game-data/status').then((r) => r.data!),
  requestSync: () =>
    api.post<ApiResponse<GameDataStatusResponse>>('/game-data/sync').then((r) => r.data!),
  cancelSync: () =>
    api.delete<ApiResponse<GameDataStatusResponse>>('/game-data/sync').then((r) => r.data!),
  /** Ask GitHub now whether there's newer data (v1.38.0). */
  check: () =>
    api.post<ApiResponse<GameDataCheckResult>>('/game-data/check').then((r) => r.data!),
};

export interface GameDataCheckResult {
  checkedAt: string;
  upToDate: boolean;
  upstreamCommit: string;
  upstreamBuild: string | null;
  upstreamCommittedAt: string | null;
}

export const healthApi = {
  get: () =>
    api.get<ApiResponse<{ timestamp: string; version: string; commit: string }>>('/health').then((r) => r.data!),
};
