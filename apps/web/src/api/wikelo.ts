import { api } from './client';
import type { ApiResponse, WikeloDataDto, WikeloProgressDto } from '@dem/shared';

const data = <T>(r: ApiResponse<T>) => r.data as T;

/** Wikelo (v1.34.0): his missions, and your own turn-in checklists. */
export const wikeloApi = {
  missions: () => api.get<ApiResponse<WikeloDataDto>>('/wikelo').then(data),
  mine: () => api.get<ApiResponse<WikeloProgressDto[]>>('/me/wikelo').then(data),
  save: (missionId: string, body: { ticked: string[]; completed: boolean }) =>
    api.put<ApiResponse<WikeloProgressDto>>(`/me/wikelo/${encodeURIComponent(missionId)}`, body).then(data),
};
