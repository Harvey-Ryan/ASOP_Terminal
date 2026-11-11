import { api } from './client';
import type { ApiResponse, MeResponse } from '@dem/shared';

export const authApi = {
  /** Fetch the currently authenticated user + manageable guilds. */
  getMe: () =>
    api.get<ApiResponse<MeResponse>>('/auth/me').then((r) => r.data!),

  /** Destroy the server session and clear the cookie. */
  logout: () => api.post<ApiResponse>('/auth/logout'),

  /** Starts the Discord sign-in; `next` is the dashboard page to come back to (v1.12.0). */
  loginUrl: (next?: string | null) => `/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`,
};
