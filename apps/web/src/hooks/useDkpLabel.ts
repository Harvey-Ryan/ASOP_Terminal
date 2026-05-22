import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/api/settings';

export function useDkpLabel(guildId: string | undefined): string {
  const { data } = useQuery({
    queryKey: ['dkp-label', guildId],
    queryFn: () => settingsApi.getLabel(guildId!),
    enabled: !!guildId,
    staleTime: 5 * 60_000,
  });
  return data?.dkpLabel ?? 'DKP';
}
