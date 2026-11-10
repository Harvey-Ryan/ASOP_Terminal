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
};

export const healthApi = {
  get: () =>
    api.get<ApiResponse<{ timestamp: string; version: string; commit: string }>>('/health').then((r) => r.data!),
};
