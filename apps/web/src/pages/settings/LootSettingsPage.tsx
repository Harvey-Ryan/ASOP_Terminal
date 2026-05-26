import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Check, Info, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';

function roleColorCss(color: number): string {
  if (color === 0) return '#99aab5';
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function LootSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();

  const rolesQuery = useQuery({
    queryKey: ['roles', guildId],
    queryFn: () => settingsApi.getRoles(guildId!),
    enabled: !!guildId,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings', guildId],
    queryFn: () => settingsApi.getSettings(guildId!),
    enabled: !!guildId,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setSelected(new Set(settingsQuery.data.lootDraftCreatorRoles));
      setDirty(false);
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      settingsApi.updateSettings(guildId!, { lootDraftCreatorRoles: [...selected] }),
    onSuccess: () => {
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  function toggle(roleId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });
    setDirty(true);
    setSavedFlash(false);
  }

  const isLoading = rolesQuery.isLoading || settingsQuery.isLoading;
  const roles = rolesQuery.data ?? [];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Loot Module</h1>
        <p className="mt-1 text-muted-foreground">Configure who can create standalone loot sessions.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Loot Session Creators
          </CardTitle>
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Server admins can always create loot sessions. Select additional roles below to allow
              non-admin members to create sessions. If no roles are selected, only admins can create sessions.
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
            </div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No roles found. Make sure the bot is in your server.
            </p>
          ) : (
            <div className="space-y-1.5">
              {roles.map((role) => {
                const isSelected = selected.has(role.id);
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggle(role.id)}
                    className={`w-full flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors text-left ${
                      isSelected
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40 hover:bg-accent/50'
                    }`}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: roleColorCss(role.color) }}
                    />
                    <span className="flex-1 font-medium">{role.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
            {savedFlash && (
              <span className="flex items-center gap-1.5 text-sm text-green-500">
                <Check className="h-4 w-4" />
                Saved
              </span>
            )}
            {saveMutation.isError && (
              <span className="text-sm text-destructive">Failed to save.</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
