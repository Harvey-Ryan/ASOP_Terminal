import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import './index.css';
import App from './App';
import { ApiError } from './api/client';
import { AUTH_QUERY_KEY } from './hooks/useAuth';

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
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
);
