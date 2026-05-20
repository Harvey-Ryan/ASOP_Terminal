import { Navigate } from 'react-router-dom';
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

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
