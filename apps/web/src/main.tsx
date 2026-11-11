import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import './index.css';
import App from './App';
import { ApiError } from './api/client';
import { AUTH_QUERY_KEY } from './hooks/useAuth';
import { ErrorNotices, showError } from './components/ErrorNotices';

declare module '@tanstack/react-query' {
  interface Register {
    // quietErrors: the mutation shows its own error (or failing doesn't matter to
    // the user), so the site-wide error notice stays out of the way.
    mutationMeta: { quietErrors?: boolean };
  }
}

const queryClient = new QueryClient({
  // When any useQuery call returns 401, clear the auth cache so ProtectedRoute
  // immediately redirects to /login — handles expired or server-cleared sessions.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(AUTH_QUERY_KEY, null);
      }
    },
  }),
  // A failed button or form shows an error notice, unless it shows its own
  // error (an onError handler, or meta.quietErrors). v1.12.0.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError || mutation.meta?.quietErrors) return;
      // Signed out (session expired): back to the login page, as for queries.
      if (error instanceof ApiError && error.status === 401) { queryClient.setQueryData(AUTH_QUERY_KEY, null); return; }
      showError(error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.');
    },
  }),
  defaultOptions: {
    queries: {
      // Don't refetch just because the user switched tabs
      refetchOnWindowFocus: false,
      // Never retry auth errors — they require re-login, not retries
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
        return failureCount < 3;
      },
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ErrorNotices />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
);
