import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Network, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, Server,
  UserPlus, AlertCircle, Clock, CheckCircle2, XCircle, Info, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { allianceApi } from '@/api/alliance';
import { settingsApi } from '@/api/settings';
import type { GuildSettingsData } from '@/api/settings';
import { RolePicker } from '@/components/settings/SettingsControls';
import { getGuildIconUrl } from '@dem/shared';
import type { AllianceDto, AllianceGuildDto, AllianceInvitationDto } from '@dem/shared';

// ── Guild icon helper ─────────────────────────────────────────────────────────

function GuildIcon({ guild, size = 6 }: { guild: { guildId: string; icon: string | null; name: string }; size?: number }) {
  const iconUrl = getGuildIconUrl(guild.guildId, guild.icon);
  const cls = `h-${size} w-${size} rounded-full shrink-0 bg-muted flex items-center justify-center overflow-hidden`;
  if (iconUrl) {
    return <img src={iconUrl} alt={guild.name} className={cn(cls, 'object-cover')} />;
  }
  return (
    <div className={cls}>
      <Server className={`h-${size - 2} w-${size - 2} text-muted-foreground`} />
    </div>
  );
}

// ── Pending Invitations section ───────────────────────────────────────────────

function PendingInvitations({
  invitations,
  discordGuildId,
}: {
  invitations: AllianceInvitationDto[];
  discordGuildId: string;
}) {
  const queryClient = useQueryClient();

  const accept = useMutation({
    mutationFn: (memberId: string) => allianceApi.acceptInvitation(memberId, discordGuildId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliances'] });
      queryClient.invalidateQueries({ queryKey: ['alliance-invitations', discordGuildId] });
    },
  });

  const reject = useMutation({
    mutationFn: (memberId: string) => allianceApi.rejectInvitation(memberId, discordGuildId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliance-invitations', discordGuildId] });
    },
  });

  if (invitations.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-400">
          <Clock className="h-4 w-4 shrink-0" />
          Pending Alliance Invitations
          <span className="ml-auto h-5 w-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {invitations.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {invitations.map((inv) => (
          <div
            key={inv.memberId}
            className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-background/60 px-3 py-2.5"
          >
            <div className="flex-1 min-w-0">
              {inv.isDirect ? (
                <>
                  <p className="text-sm font-medium truncate">
                    {inv.invitedByGuildName ?? 'A guild'} wants to be your ally
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Direct ally request</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium truncate">{inv.allianceName}</p>
                  {inv.invitedByGuildName ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Invited by <span className="text-foreground font-medium">{inv.invitedByGuildName}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Invitation source unknown</p>
                  )}
                </>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 border-green-500/40 text-green-400 hover:bg-green-500/10 hover:text-green-300 shrink-0"
              onClick={() => accept.mutate(inv.memberId)}
              disabled={accept.isPending || reject.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
              onClick={() => reject.mutate(inv.memberId)}
              disabled={accept.isPending || reject.isPending}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Add member picker ─────────────────────────────────────────────────────────

function AddMemberPanel({
  allianceId,
  currentMembers,
  allGuilds,
  invitingGuildDiscordId,
  onClose,
}: {
  allianceId: string;
  currentMembers: AllianceGuildDto[];
  allGuilds: AllianceGuildDto[];
  invitingGuildDiscordId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const addMember = useMutation({
    mutationFn: (guildId: string) =>
      allianceApi.addMember(allianceId, { guildId, invitingGuildId: invitingGuildDiscordId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alliances'] }),
  });

  const currentIds = new Set(currentMembers.map((m) => m.guildId));
  const filtered = allGuilds.filter(
    (g) =>
      !currentIds.has(g.guildId) &&
      g.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
      <Input
        placeholder="Search servers…"
        value={search}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        className="h-8 text-sm mb-2"
        autoFocus
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            {search ? 'No servers match' : 'All servers already added'}
          </p>
        )}
        {filtered.map((g) => (
          <button
            key={g.guildId}
            onClick={() => {
              addMember.mutate(g.guildId);
              onClose();
            }}
            disabled={addMember.isPending}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors text-left"
          >
            <GuildIcon guild={g} size={5} />
            <span className="truncate">{g.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Invite individual ally panel ──────────────────────────────────────────────

function InviteAllyPanel({
  allGuilds,
  callerGuildId,
  existingAllyGuildIds,
  onClose,
}: {
  allGuilds: AllianceGuildDto[];
  callerGuildId: string;
  existingAllyGuildIds: Set<string>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const invite = useMutation({
    mutationFn: (targetGuildId: string) => allianceApi.inviteDirect(callerGuildId, targetGuildId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliances'] });
      onClose();
    },
  });

  const filtered = allGuilds.filter(
    (g) =>
      g.guildId !== callerGuildId &&
      !existingAllyGuildIds.has(g.guildId) &&
      g.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <Input
        placeholder="Search servers…"
        value={search}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        className="h-8 text-sm mb-2"
        autoFocus
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            {search ? 'No servers match' : 'No servers available'}
          </p>
        )}
        {filtered.map((g) => (
          <button
            key={g.guildId}
            onClick={() => invite.mutate(g.guildId)}
            disabled={invite.isPending}
            className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted transition-colors text-left"
          >
            <GuildIcon guild={g} size={5} />
            <span className="truncate">{g.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Alliance card ─────────────────────────────────────────────────────────────

function AllianceCard({
  alliance,
  allGuilds,
  activeDiscordGuildId,
}: {
  alliance: AllianceDto;
  allGuilds: AllianceGuildDto[];
  activeDiscordGuildId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(alliance.name);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const queryClient = useQueryClient();

  const rename = useMutation({
    mutationFn: () => allianceApi.rename(alliance.id, { name, callerGuildId: activeDiscordGuildId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliances'] });
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => allianceApi.remove(alliance.id, activeDiscordGuildId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alliances'] }),
  });

  const removeMember = useMutation({
    mutationFn: (guildId: string) => allianceApi.removeMember(alliance.id, guildId, activeDiscordGuildId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alliances'] }),
  });

  const accepted = alliance.members.filter((m) => m.status === 'ACCEPTED');
  const pending = alliance.members.filter((m) => m.status === 'PENDING');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {editing ? (
            <>
              <Input
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                className="h-7 text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename.mutate();
                  if (e.key === 'Escape') { setName(alliance.name); setEditing(false); }
                }}
                autoFocus
              />
              <Button
                size="icon" variant="ghost"
                className="h-6 w-6 shrink-0 text-green-500 hover:text-green-400"
                onClick={() => rename.mutate()}
                disabled={rename.isPending || !name.trim()}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                onClick={() => { setName(alliance.name); setEditing(false); }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <Network className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1 truncate">{alliance.name}</span>
              <span className="text-xs text-muted-foreground font-normal shrink-0">
                {accepted.length} server{accepted.length !== 1 ? 's' : ''}
                {pending.length > 0 && (
                  <span className="ml-1.5 text-amber-400">· {pending.length} pending</span>
                )}
              </span>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon" variant="ghost"
                className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                onClick={() => { if (confirm(`Delete alliance "${alliance.name}"?`)) remove.mutate(); }}
                disabled={remove.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          {alliance.members.length === 0 && !showAddPanel && (
            <p className="text-xs text-muted-foreground mb-3">No servers in this alliance yet.</p>
          )}

          {accepted.length > 0 && (
            <div className="space-y-0 mb-2">
              {accepted.map((m) => (
                <div
                  key={m.guildId}
                  className="flex items-center gap-2.5 py-1.5 border-b border-border/50 last:border-0 group"
                >
                  <GuildIcon guild={m} size={6} />
                  <span className="flex-1 text-sm truncate">{m.name}</span>
                  {m.guildId !== activeDiscordGuildId && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                      onClick={() => removeMember.mutate(m.guildId)}
                      disabled={removeMember.isPending}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div className="mb-3 space-y-1">
              {pending.map((m) => (
                <div
                  key={m.guildId}
                  className="flex items-center gap-2.5 py-1.5 rounded bg-amber-500/5 border border-amber-500/20 px-2 group"
                >
                  <GuildIcon guild={m} size={6} />
                  <span className="flex-1 text-sm truncate text-muted-foreground">{m.name}</span>
                  <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wide shrink-0">
                    Awaiting
                  </span>
                  <Button
                    size="icon" variant="ghost"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    title="Cancel invitation"
                    onClick={() => removeMember.mutate(m.guildId)}
                    disabled={removeMember.isPending}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {showAddPanel ? (
            <AddMemberPanel
              allianceId={alliance.id}
              currentMembers={alliance.members}
              allGuilds={allGuilds}
              invitingGuildDiscordId={activeDiscordGuildId}
              onClose={() => setShowAddPanel(false)}
            />
          ) : (
            <Button
              variant="outline" size="sm" className="h-7 text-xs w-full"
              onClick={() => setShowAddPanel(true)}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              Invite Server
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type AllianceForm = Pick<GuildSettingsData, 'allianceManagerRoles'>;

export function AllianceSettingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const queryClient = useQueryClient();

  // ── Settings (role picker) ──
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

  const [form, setForm] = useState<AllianceForm>({ allianceManagerRoles: [] });
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // ── Org Tag inline edit ──
  const [editingTag, setEditingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState<string>('');
  const [tagFlash, setTagFlash] = useState(false);

  useEffect(() => {
    if (saved) {
      setForm({ allianceManagerRoles: saved.allianceManagerRoles ?? [] });
      setDirty(false);
    }
  }, [saved]);

  const settingsMutation = useMutation({
    mutationFn: (data: Partial<GuildSettingsData>) => settingsApi.updateSettings(guildId!, data),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  const tagMutation = useMutation({
    mutationFn: (tag: string | null) => settingsApi.updateSettings(guildId!, { allianceTag: tag }),
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings', guildId], data);
      setEditingTag(false);
      setTagFlash(true);
      setTimeout(() => setTagFlash(false), 2500);
    },
  });

  // ── Alliance management ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const { data: alliances = [], isLoading: alliancesLoading, isError } = useQuery({
    queryKey: ['alliances'],
    queryFn: () => allianceApi.list(),
    staleTime: 60_000,
  });

  const { data: allGuilds = [] } = useQuery({
    queryKey: ['alliance-guilds'],
    queryFn: allianceApi.listGuilds,
    staleTime: 5 * 60_000,
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ['alliance-invitations', guildId],
    queryFn: () => allianceApi.getInvitations(guildId!),
    enabled: !!guildId,
    staleTime: 30_000,
  });

  const createAlliance = useMutation({
    mutationFn: () => allianceApi.create({ name: newName.trim(), callerGuildId: guildId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliances'] });
      setNewName('');
      setCreating(false);
    },
  });

  const removeDirectAlly = useMutation({
    mutationFn: (allianceId: string) => allianceApi.remove(allianceId, guildId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alliances'] }),
  });

  // Flat list of all guilds this guild is allied with (direct or via named alliance)
  const individualAllies = useMemo(() => {
    const seen = new Set<string>();
    const result: { guildId: string; name: string; icon: string | null; allianceId: string; isDirect: boolean }[] = [];
    for (const a of alliances) {
      for (const m of a.members) {
        if (m.status === 'ACCEPTED' && m.guildId !== guildId && !seen.has(m.guildId)) {
          seen.add(m.guildId);
          result.push({ guildId: m.guildId, name: m.name, icon: m.icon, allianceId: a.id, isDirect: a.isDirect });
        }
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [alliances, guildId]);

  // Set of Discord guild IDs already allied with (pending or accepted) — used to exclude from invite picker
  const existingAllyGuildIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of alliances) {
      if (a.isDirect) {
        for (const m of a.members) {
          if (m.guildId !== guildId) ids.add(m.guildId);
        }
      }
    }
    return ids;
  }, [alliances, guildId]);

  const [showInviteAlly, setShowInviteAlly] = useState(false);

  const namedAlliances = alliances.filter((a) => !a.isDirect);

  const roles = rolesData ?? [];
  const isSettingsLoading = rolesLoading || settingsLoading;

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Network className="h-6 w-6" />
            Alliance
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Group servers into named alliances for cross-org events and coordination.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Alliance
          </Button>
        )}
      </div>

      {/* ── Alliance Org Tag ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Org Tag
            {tagFlash && (
              <span className="flex items-center gap-1 text-xs font-normal text-green-500">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            A 4-character alphanumeric tag identifying your guild within an alliance (e.g.{' '}
            <span className="font-mono">ASOP</span>).
          </p>
          {settingsLoading ? (
            <Skeleton className="h-8 w-48 rounded-md" />
          ) : editingTag ? (
            <div className="flex items-center gap-2">
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') tagMutation.mutate(tagDraft || null);
                  if (e.key === 'Escape') setEditingTag(false);
                }}
                placeholder="e.g. ASOP"
                maxLength={4}
                autoFocus
                className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono tracking-widest outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                onClick={() => tagMutation.mutate(tagDraft || null)}
                disabled={tagMutation.isPending}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                {tagMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => setEditingTag(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {saved?.allianceTag ? (
                <span className="font-mono text-sm tracking-widest bg-muted px-3 py-1.5 rounded-md border border-border">
                  {saved.allianceTag}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground italic">Not set</span>
              )}
              <Button
                size="icon" variant="ghost" className="h-8 w-8"
                onClick={() => { setTagDraft(saved?.allianceTag ?? ''); setEditingTag(true); }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Alliance Manager Roles ── */}
      {isSettingsLoading ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Alliance Manager Roles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Server admins can always manage alliances. Select roles below to grant alliance management to additional members. If no roles are selected, only server admins can manage alliances.
              </span>
            </div>
            {roles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No assignable roles found in this server.</p>
            ) : (
              <RolePicker
                roles={roles}
                selected={form.allianceManagerRoles}
                onChange={(ids) => { setForm((f) => ({ ...f, allianceManagerRoles: ids })); setDirty(true); setSavedFlash(false); }}
              />
            )}
            <div className="flex items-center gap-3 pt-1">
              <Button
                size="sm"
                onClick={() => settingsMutation.mutate({ allianceManagerRoles: form.allianceManagerRoles })}
                disabled={!dirty || settingsMutation.isPending}
              >
                {settingsMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
              {savedFlash && (
                <span className="flex items-center gap-1.5 text-sm text-green-500">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
              {settingsMutation.isError && (
                <span className="text-sm text-destructive">Failed to save.</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pending invitations for this guild ── */}
      <PendingInvitations invitations={invitations} discordGuildId={guildId} />

      {/* ── Create new alliance ── */}
      {creating && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-2">Alliance name</p>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Northern Coalition"
                value={newName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) createAlliance.mutate();
                  if (e.key === 'Escape') { setNewName(''); setCreating(false); }
                }}
                autoFocus
              />
              <Button size="sm" onClick={() => createAlliance.mutate()} disabled={!newName.trim() || createAlliance.isPending}>
                Create
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setNewName(''); setCreating(false); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {alliancesLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-destructive">Failed to load alliances.</p>
        </div>
      )}

      {/* ── Individual Allies ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0" />
            Individual Allies
            {!showInviteAlly && (
              <Button
                size="sm" variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={() => setShowInviteAlly(true)}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                Invite Ally
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {showInviteAlly && (
            <InviteAllyPanel
              allGuilds={allGuilds}
              callerGuildId={guildId}
              existingAllyGuildIds={existingAllyGuildIds}
              onClose={() => setShowInviteAlly(false)}
            />
          )}
          {alliancesLoading ? (
            <div className="space-y-2 pt-1">
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
            </div>
          ) : individualAllies.length === 0 && !showInviteAlly ? (
            <p className="text-xs text-muted-foreground py-2 italic">
              No allied servers yet. Invite a guild directly or join an alliance.
            </p>
          ) : (
            <div className="space-y-0">
              {individualAllies.map((ally) => (
                <div
                  key={ally.guildId}
                  className="flex items-center gap-2.5 py-1.5 border-b border-border/50 last:border-0 group"
                >
                  <GuildIcon guild={{ guildId: ally.guildId, icon: ally.icon, name: ally.name }} size={6} />
                  <span className="flex-1 text-sm truncate">{ally.name}</span>
                  {ally.isDirect && (
                    <span className="text-[10px] font-medium text-sky-400 uppercase tracking-wide shrink-0">
                      Direct
                    </span>
                  )}
                  {ally.isDirect && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                      title="Remove ally"
                      onClick={() => { if (confirm(`Remove ${ally.name} as an ally?`)) removeDirectAlly.mutate(ally.allianceId); }}
                      disabled={removeDirectAlly.isPending}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Named alliance groups ── */}
      {!alliancesLoading && !isError && namedAlliances.length === 0 && !creating && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <Network className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No alliance groups yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create an alliance to group multiple servers together.</p>
          <Button size="sm" className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Alliance
          </Button>
        </div>
      )}

      {namedAlliances.map((alliance) => (
        <AllianceCard
          key={alliance.id}
          alliance={alliance}
          allGuilds={allGuilds}
          activeDiscordGuildId={guildId}
        />
      ))}
    </div>
  );
}
