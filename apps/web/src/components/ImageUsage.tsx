// "12.4 MB of 200 MB used" for a server's image library (v1.40.0). Its query
// key sits under ['images', guildId], so anything that refreshes the library
// refreshes this too.
import { useQuery } from '@tanstack/react-query';
import { imagesApi } from '@/api/images';
import { cn } from '@/lib/utils';

export const formatBytes = (b: number) =>
  b >= 1024 * 1024 * 1024 ? `${(b / 1024 ** 3).toFixed(1)} GB`
    : b >= 1024 * 1024 ? `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`
      : `${Math.max(0, Math.round(b / 1024))} KB`;

export function ImageUsage({ guildId, className }: { guildId: string; className?: string }) {
  const q = useQuery({ queryKey: ['images', guildId, 'usage'], queryFn: () => imagesApi.usage(guildId), staleTime: 30_000 });
  if (!q.data) return null;
  const share = q.data.capBytes ? q.data.bytes / q.data.capBytes : 0;
  return (
    <div className={cn('text-xs text-muted-foreground', className)}>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn('h-full rounded-full', share >= 0.9 ? 'bg-red-500' : share >= 0.75 ? 'bg-amber-500' : 'bg-brand')} style={{ width: `${Math.min(100, share * 100)}%` }} />
        </div>
        <span className={cn(share >= 0.9 && 'text-red-400')}>{formatBytes(q.data.bytes)} of {formatBytes(q.data.capBytes)} used</span>
      </div>
      {share >= 0.9 && <p className="mt-1 text-red-400">Nearly full: delete images you no longer use to make room.</p>}
    </div>
  );
}
