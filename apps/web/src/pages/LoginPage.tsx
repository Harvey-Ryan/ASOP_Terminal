import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScreen } from '@/components/LoadingScreen';

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Access was denied. Please try again.',
  invalid_state:  'Login attempt expired. Please try again.',
  auth_failed:    'Authentication failed. Please try again.',
  session_error:  'Session error. Please try again.',
  no_code:        'OAuth code missing. Please try again.',
};

export function LoginPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get('error');

  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <img src="/AsopLogo.jpg" alt="ASOP Terminal" className="h-16 w-16 rounded-2xl object-cover shadow-lg" />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">ASOP Terminal</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage your server events with ease</p>
          </div>
        </div>

        {/* Card */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>
              Connect your Discord account to start managing events across your servers.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Error banner */}
            {errorCode && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {ERROR_MESSAGES[errorCode] ?? 'An error occurred. Please try again.'}
              </div>
            )}

            <Button asChild variant="brand" className="w-full" size="lg">
              <a href={authApi.loginUrl}>
                {/* Discord logo SVG */}
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                </svg>
                Login with Discord
              </a>
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Only servers where you have Manage Server permission will appear.
        </p>
      </div>
    </div>
  );
}
