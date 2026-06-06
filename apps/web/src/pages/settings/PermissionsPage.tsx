import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ShieldCheck, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import type { DiscordRoleDto } from '@dem/shared';

function roleColorCss(color: number): string {
  if (color === 0) return '#99aab5'; // Discord's default role colour
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function PermissionsPage() {
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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsQuery.data) {
      setSelected(new Set(settingsQuery.data.eventCreatorRoles));
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      settingsApi.updateSettings(guildId!, { eventCreatorRoles: [...selected] }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function toggle(roleId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });
  }

  const isLoading = rolesQuery.isLoading || settingsQuery.isLoading;
  const isError = rolesQuery.isError || settingsQuery.isError;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Permissions</h1>
        <p className="mt-1 text-muted-foreground">Control which Discord roles can create events.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Event Creators
          </CardTitle>
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Server admins can always create events. Select additional roles below to grant
              non-admin members access. If no roles are selected, only admins can create events.
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">Failed to load roles.</p>
          ) : rolesQuery.data?.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
          ) : (
            <div className="space-y-1.5">
              {rolesQuery.data?.map((role: DiscordRoleDto) => {
                const isChecked = selected.has(role.id);
                return (
                  <label
                    key={role.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors ${
                      isChecked
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border hover:bg-accent/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={isChecked}
                      onChange={() => toggle(role.id)}
                    />
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: roleColorCss(role.color) }}
                    />
                    <span className="text-sm font-medium">{role.name}</span>
                  </label>
                );
              })}
            </div>
          )}

          {!isLoading && !isError && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </Button>
              {saveMutation.isError && (
                <p className="text-sm text-destructive">Failed to save. Please try again.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
