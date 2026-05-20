import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

/**
 * Central auth hook – wraps the /api/auth/me query.
 *
 * A 401 response is treated as "unauthenticated" (not an error), so React
 * Query won't retry or surface an error state for normal visitors.
 */
export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      try {
        return await authApi.getMe();
      } catch (err) {
        // Unauthenticated is not an error – return null so callers can branch
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,  // treat as fresh for 5 min
    gcTime:   10 * 60 * 1000,  // keep in cache for 10 min
  });

  async function logout() {
    await authApi.logout().catch(() => { /* best-effort */ });
    queryClient.clear();
    window.location.href = '/login';
  }

  return {
    user:            data?.user   ?? null,
    guilds:          data?.guilds ?? [],
    isLoading,
    isAuthenticated: data !== null && data !== undefined && !!data.user,
    logout,
  };
}
