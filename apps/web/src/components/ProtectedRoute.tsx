import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LoadingScreen } from './LoadingScreen';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Wraps a route subtree. Shows a spinner while the auth query is in flight,
 * redirects to /login when unauthenticated, and renders children otherwise.
 * Prevents any flash of the login page after a successful OAuth redirect.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) {
    // Come back to this page after signing in (links from Discord, expired sessions).
    const here = location.pathname + location.search + location.hash;
    const next = here === '/dashboard' ? '' : `?next=${encodeURIComponent(here)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  return <>{children}</>;
}
