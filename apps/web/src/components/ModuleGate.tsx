// A module's pages, unless the module is off (v1.28.0, v1.59.2): a bookmarked
// link then says so instead of half-loading. Two ways a module can be off:
//   - a platform admin hid it for every server (`hiddenModules`), or
//   - the server switched it off itself (its `*Enabled` setting is false),
//     for the modules in SERVER_SWITCH_CLOSES_PAGE.
// A module's own settings page passes `settingsPage`: it stays reachable while
// the server's switch is off, or nobody could switch the module back on.

import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PLATFORM_MODULES, type ModuleSetting } from '@dem/shared';
import { settingsApi } from '@/api/settings';

// Modules whose API refuses everyone while the server's switch is off, so their
// pages only showed empty forms (DKP, Auctions, Job Board). The other modules
// still answer some requests when off (managers keep Tournaments, a person's
// own fleet, loot for past events…), so their pages are left as they were.
const SERVER_SWITCH_CLOSES_PAGE: ReadonlySet<ModuleSetting> = new Set(['dkpEnabled', 'jobsEnabled']);

export function ModuleGate({
  setting,
  settingsPage = false,
  children,
}: {
  setting: ModuleSetting;
  /** This is the module's own settings page: only a platform-wide hide closes it. */
  settingsPage?: boolean;
  children: ReactNode;
}) {
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
  // Only an explicit false: a field the API doesn't send means "on", as before.
  if (
    !settingsPage &&
    SERVER_SWITCH_CLOSES_PAGE.has(setting) &&
    (perms as Record<string, unknown> | undefined)?.[setting] === false
  ) {
    const label = PLATFORM_MODULES.find((m) => m.setting === setting)?.label ?? 'This module';
    return (
      <div className="py-24 text-center text-sm text-muted-foreground space-y-2">
        <p>{label} is turned off for this server.</p>
        {perms?.canManageEvents && (
          <p>
            <Link to={`/dashboard/servers/${guildId}/settings/modules`} className="underline underline-offset-2">
              Module Settings
            </Link>{' '}
            can turn it back on.
          </p>
        )}
      </div>
    );
  }
  return <>{children}</>;
}
