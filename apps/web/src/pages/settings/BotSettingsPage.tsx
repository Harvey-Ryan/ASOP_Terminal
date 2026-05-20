import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { DiscordRoleDto } from '@dem/shared';

function roleColorCss(color: number): string {
  if (color === 0) return '#99aab5';
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function BotSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', guildId],
    queryFn: () => settingsApi.getRoles(guildId!),
    enabled: !!guildId,
  });

  const { data: saved, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [moduleEditorRoles, setModuleEditorRoles] = useState<string[]>([]);
  const [viewerRoles, setViewerRoles] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setModuleEditorRoles(saved.moduleEditorRoles ?? []);
      setViewerRoles(saved.viewerRoles ?? []);
      setDirty(false);
    }
  }, [saved]);

  const mutation = useMutation({
    mutationFn: () =>
      settingsApi.updateSettings(guildId!, { moduleEditorRoles, viewerRoles }),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  function addRole(roleId: string) {
    setModuleEditorRoles((prev) => [...prev, roleId]);
    setDirty(true);
    setSavedFlash(false);
  }

  function removeRole(roleId: string) {
    setModuleEditorRoles((prev) => prev.filter((id) => id !== roleId));
    setDirty(true);
    setSavedFlash(false);
  }

  function addViewerRole(roleId: string) {
    setViewerRoles((prev) => [...prev, roleId]);
    setDirty(true);
    setSavedFlash(false);
  }

  function removeViewerRole(roleId: string) {
    setViewerRoles((prev) => prev.filter((id) => id !== roleId));
    setDirty(true);
    setSavedFlash(false);
  }

  const roles = rolesData ?? [];
  const unselectedRoles = roles.filter((r) => !moduleEditorRoles.includes(r.id));
  const unselectedViewerRoles = roles.filter((r) => !viewerRoles.includes(r.id));
  const isLoading = rolesLoading || settingsLoading;

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-muted-foreground">Manage server-level permissions.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Module Settings Editors</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Roles allowed to edit module settings in addition to server admins.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Server admins can always edit module settings. If no roles are selected, only admins can access Module Settings.
              </span>
            </div>

            {roles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
            ) : (
              <div className="space-y-2">
                {moduleEditorRoles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {moduleEditorRoles.map((roleId) => {
                      const role = roles.find((r: DiscordRoleDto) => r.id === roleId);
                      if (!role) return null;
                      return (
                        <span
                          key={roleId}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: roleColorCss(role.color) }}
                          />
                          {role.name}
                          <button
                            type="button"
                            onClick={() => removeRole(roleId)}
                            className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={`Remove ${role.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {unselectedRoles.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addRole(e.target.value); }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Add a role…</option>
                    {unselectedRoles.map((role: DiscordRoleDto) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                ) : moduleEditorRoles.length > 0 ? (
                  <p className="text-xs text-muted-foreground italic">All roles have been added.</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Dashboard Viewers */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Dashboard Viewers</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Roles allowed to view events and loot on their dashboard.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Server admins and event creators can always view. If no roles are selected, only they can access the dashboard.
              </span>
            </div>

            {roles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
            ) : (
              <div className="space-y-2">
                {viewerRoles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {viewerRoles.map((roleId) => {
                      const role = roles.find((r: DiscordRoleDto) => r.id === roleId);
                      if (!role) return null;
                      return (
                        <span
                          key={roleId}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: roleColorCss(role.color) }}
                          />
                          {role.name}
                          <button
                            type="button"
                            onClick={() => removeViewerRole(roleId)}
                            className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={`Remove ${role.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {unselectedViewerRoles.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addViewerRole(e.target.value); }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Add a role…</option>
                    {unselectedViewerRoles.map((role: DiscordRoleDto) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                ) : viewerRoles.length > 0 ? (
                  <p className="text-xs text-muted-foreground italic">All roles have been added.</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => mutation.mutate()}
              disabled={!dirty || mutation.isPending}
            >
              {mutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {savedFlash && (
              <span className="flex items-center gap-1.5 text-sm text-green-500">
                <Check className="h-4 w-4" />
                Saved
              </span>
            )}
            {mutation.isError && (
              <span className="text-sm text-destructive">Failed to save.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
