import { api } from './client';
import type { ApiResponse } from '@dem/shared';

export interface ModuleStat {
  module: string;
  requests: number;
  uniqueUsers: number;
}

export interface RouteStat {
  method: string;
  path: string;
  count: number;
}

export interface DayStat {
  date: string;
  total: number;
}

export interface TrafficSummaryData {
  modules: ModuleStat[];
  topRoutes: RouteStat[];
  timeSeries: DayStat[];
  totalRequests: number;
  periodDays: number;
}

function requireData<T>(r: ApiResponse<T>): T {
  if (r.data === undefined) throw new Error('Missing data in API response');
  return r.data;
}

export const trafficApi = {
  getSummary: (guildId: string, days: number) =>
    api
      .get<ApiResponse<TrafficSummaryData>>(`/guilds/${guildId}/traffic?days=${days}`)
      .then(requireData),
};
