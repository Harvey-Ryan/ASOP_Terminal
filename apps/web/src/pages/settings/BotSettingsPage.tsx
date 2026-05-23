import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Info, RefreshCw, X, ImageIcon, Trash2, GripVertical, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { settingsApi } from '@/api/settings';
import { imagesApi } from '@/api/images';
import type { DiscordRoleDto, ServerImageDto } from '@dem/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── Image Bucket ──────────────────────────────────────────────────────────────

function ImageBucket({ guildId }: { guildId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const imagesQuery = useQuery({
    queryKey: ['images', guildId],
    queryFn: () => imagesApi.list(guildId),
  });

  const [localIds, setLocalIds] = useState<string[]>([]);
  const isDraggingRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isDraggingRef.current) return;
    setLocalIds((imagesQuery.data ?? []).map((img) => img.id));
  }, [imagesQuery.data]);

  const byId = new Map<string, ServerImageDto>((imagesQuery.data ?? []).map((img) => [img.id, img]));

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => imagesApi.reorder(guildId, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['images', guildId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => imagesApi.delete(guildId, imageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['images', guildId] }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => imagesApi.upload(guildId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['images', guildId] }),
  });

  function onDragStart(index: number) {
    isDraggingRef.current = true;
    dragIndexRef.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function onDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === dropIndex) return;
    const next = [...localIds];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved!);
    setLocalIds(next);
    reorderMutation.mutate(next);
  }

  function onDragEnd() {
    isDraggingRef.current = false;
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5">
            <ImageIcon className="h-4 w-4" />
            Image Bucket
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage uploaded images available to event creators. Drag to reorder.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          <Upload className="h-3.5 w-3.5" />
          {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { uploadMutation.mutate(f); e.target.value = ''; }
          }}
        />
      </div>

      {imagesQuery.isLoading && (
        <div className="grid grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      )}

      {!imagesQuery.isLoading && localIds.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground opacity-40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No images uploaded yet.</p>
          <p className="text-xs text-muted-foreground mt-0.5">Click Upload to add images to the library.</p>
        </div>
      )}

      {localIds.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {localIds.map((id, index) => {
            const img = byId.get(id);
            if (!img) return null;
            const isDragTarget = dragOverIndex === index;
            const isConfirming = confirmDeleteId === id;

            return (
              <div
                key={id}
                draggable
                onDragStart={() => onDragStart(index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDrop={(e) => onDrop(e, index)}
                onDragEnd={onDragEnd}
                className={`group relative rounded-lg overflow-hidden border-2 transition-colors cursor-grab active:cursor-grabbing ${
                  isDragTarget ? 'border-primary' : 'border-transparent hover:border-border'
                }`}
              >
                <img
                  src={`${API_BASE}${img.url}`}
                  alt={img.filename}
                  className="h-24 w-full object-cover"
                />

                {/* Drag handle overlay */}
                <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="rounded bg-background/70 p-0.5">
                    <GripVertical className="h-3.5 w-3.5 text-foreground" />
                  </div>
                </div>

                {/* Delete button */}
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isConfirming ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => { deleteMutation.mutate(id); setConfirmDeleteId(null); }}
                        className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(id)}
                      className="rounded bg-background/70 p-0.5 hover:bg-destructive/80 transition-colors"
                      title="Delete image"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-foreground" />
                    </button>
                  )}
                </div>

                {/* Filename tooltip */}
                <div className="absolute bottom-0 left-0 right-0 bg-background/70 px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-foreground truncate">{img.filename}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(deleteMutation.isError || uploadMutation.isError) && (
        <p className="text-xs text-destructive">
          {deleteMutation.isError
            ? `Delete failed: ${(deleteMutation.error as Error).message}`
            : `Upload failed: ${(uploadMutation.error as Error).message}`}
        </p>
      )}
    </div>
  );
}

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
  const [dkpLabel, setDkpLabel] = useState('DKP');
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setModuleEditorRoles(saved.moduleEditorRoles ?? []);
      setViewerRoles(saved.viewerRoles ?? []);
      setDkpLabel(saved.dkpLabel ?? 'DKP');
      setDirty(false);
    }
  }, [saved]);

  const registerMutation = useMutation({
    mutationFn: () => settingsApi.registerCommands(guildId!),
  });

  const { data: botConfig } = useQuery({
    queryKey: ['bot-config', guildId],
    queryFn: () => settingsApi.getBotConfig(guildId!),
    enabled: !!guildId,
  });

  const botConfigMutation = useMutation({
    mutationFn: (data: { globalCommandsEnabled: boolean }) =>
      settingsApi.updateBotConfig(guildId!, data),
    onSuccess: (data) => {
      queryClient.setQueryData(['bot-config', guildId], data);
    },
  });

  const mutation = useMutation({
    mutationFn: () =>
      settingsApi.updateSettings(guildId!, { moduleEditorRoles, viewerRoles, dkpLabel }),
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
          {/* Currency label */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Currency Label</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Rename the DKP currency shown across the dashboard and bot messages.
              </p>
            </div>
            <input
              type="text"
              maxLength={30}
              value={dkpLabel}
              onChange={(e) => { setDkpLabel(e.target.value); setDirty(true); setSavedFlash(false); }}
              placeholder="DKP"
              className="w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="border-t border-border" />

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

          <div className="border-t border-border" />

          {/* Image Bucket */}
          <ImageBucket guildId={guildId!} />

          <div className="border-t border-border" />

          {/* Slash command registration */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Slash Commands</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Re-register slash commands to all servers. Use this after adding new commands.
              </p>
            </div>

            {/* Global commands toggle */}
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Global Slash Commands</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When on, commands appear in all Discord servers. When off, only servers with the bot installed.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={botConfig?.globalCommandsEnabled ?? true}
                disabled={botConfigMutation.isPending}
                onClick={() =>
                  botConfigMutation.mutate({
                    globalCommandsEnabled: !(botConfig?.globalCommandsEnabled ?? true),
                  })
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
                  (botConfig?.globalCommandsEnabled ?? true) ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
                    (botConfig?.globalCommandsEnabled ?? true) ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => registerMutation.mutate()}
                disabled={registerMutation.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${registerMutation.isPending ? 'animate-spin' : ''}`} />
                {registerMutation.isPending ? 'Registering…' : 'Re-register Commands'}
              </Button>
              {registerMutation.isSuccess && (
                <span className="flex items-center gap-1.5 text-sm text-green-500">
                  <Check className="h-4 w-4" />
                  Queued
                </span>
              )}
              {registerMutation.isError && (
                <span className="text-sm text-destructive">Failed to register.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
