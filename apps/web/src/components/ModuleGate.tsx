// A module's pages, unless a platform admin hid it for every server (v1.28.0):
// then a bookmarked link says so instead of half-loading.

import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ModuleSetting } from '@dem/shared';
import { settingsApi } from '@/api/settings';

export function ModuleGate({ setting, children }: { setting: ModuleSetting; children: ReactNode }) {
  const { guildId } = useParams<{ guildId: string }>();
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', guildId],
    queryFn: () => settingsApi.getMyPermissions(guildId!),
    enabled: !!guildId,
    staleTime: 60_000,
  });
  if (perms?.hiddenModules?.includes(setting)) {
    return <p className="py-24 text-center text-sm text-muted-foreground">This module isn't available right now.</p>;
  }
  return <>{children}</>;
}
