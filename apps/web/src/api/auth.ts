import { api } from './client';
import type { ApiResponse, MeResponse } from '@dem/shared';

export const authApi = {
  /** Fetch the currently authenticated user + manageable guilds. */
  getMe: () =>
    api.get<ApiResponse<MeResponse>>('/auth/me').then((r) => r.data!),

  /** Destroy the server session and clear the cookie. */
  logout: () => api.post<ApiResponse>('/auth/logout'),

  /** The URL to navigate to in order to start the Discord OAuth flow. */
  loginUrl: '/api/auth/login',
};
