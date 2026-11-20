import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Addresses nothing answers (v1.59.1: these used to send people to the sign-in page without a word). */
export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <img src="/AsopLogo.jpg" alt="ASOP Terminal" className="mx-auto h-16 w-16 rounded-2xl object-cover shadow-lg" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing lives at this address. The link may be old or mistyped.
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Button asChild variant="brand">
            <Link to="/dashboard">Dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/tools">Game Tools</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
