import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { ApiResponse, CraftingDataDto } from '@dem/shared';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { setCraftingData } from '@/lib/gameData';

// Loads the crafting data (blueprints, mission contracts, base stats) from the
// API before the Blueprints and Crafting Calculator pages render (v1.11.2).
// One download per game build: the browser revalidates with the ETag and gets
// a 304 until the game data changes; react-query keeps it for the session.

export function CraftingDataGate({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['crafting-data'],
    queryFn: () => api.get<ApiResponse<CraftingDataDto>>('/game-data/crafting').then((r) => r.data!),
    staleTime: 30 * 60_000,
    gcTime: Infinity,
    retry: 2,
  });

  if (q.data) {
    setCraftingData(q.data);
    return <>{children}</>;
  }
  if (q.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load the game data. {q.error instanceof Error ? q.error.message : ''}</p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading game data…
    </div>
  );
}
