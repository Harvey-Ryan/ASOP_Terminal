import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Network, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp, Server,
  UserPlus, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { allianceApi } from '@/api/alliance';
import { getGuildIconUrl } from '@dem/shared';
import type { AllianceDto, AllianceGuildDto } from '@dem/shared';

// ── Guild icon helper ─────────────────────────────────────────────────────────

function GuildIcon({ guild, size = 6 }: { guild: AllianceGuildDto; size?: number }) {
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

// ── Add member picker ─────────────────────────────────────────────────────────

function AddMemberPanel({
  allianceId,
  currentMembers,
  allGuilds,
  onClose,
}: {
  allianceId: string;
  currentMembers: AllianceGuildDto[];
  allGuilds: AllianceGuildDto[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const addMember = useMutation({
    mutationFn: (guildId: string) => allianceApi.addMember(allianceId, { guildId }),
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

// ── Alliance card ─────────────────────────────────────────────────────────────

function AllianceCard({
  alliance,
  allGuilds,
}: {
  alliance: AllianceDto;
  allGuilds: AllianceGuildDto[];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(alliance.name);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const queryClient = useQueryClient();

  const rename = useMutation({
    mutationFn: () => allianceApi.rename(alliance.id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliances'] });
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => allianceApi.remove(alliance.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alliances'] }),
  });

  const removeMember = useMutation({
    mutationFn: (guildId: string) => allianceApi.removeMember(alliance.id, guildId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alliances'] }),
  });

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
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-green-500 hover:text-green-400"
                onClick={() => rename.mutate()}
                disabled={rename.isPending || !name.trim()}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
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
                {alliance.members.length} server{alliance.members.length !== 1 ? 's' : ''}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(`Delete alliance "${alliance.name}"?`)) remove.mutate();
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
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

          {alliance.members.length > 0 && (
            <div className="space-y-0 mb-3">
              {alliance.members.map((m) => (
                <div
                  key={m.guildId}
                  className="flex items-center gap-2.5 py-1.5 border-b border-border/50 last:border-0 group"
                >
                  <GuildIcon guild={m} size={6} />
                  <span className="flex-1 text-sm truncate">{m.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
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
              onClose={() => setShowAddPanel(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs w-full"
              onClick={() => setShowAddPanel(true)}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              Add Server
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AlliancePage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const queryClient = useQueryClient();

  const { data: alliances = [], isLoading, isError } = useQuery({
    queryKey: ['alliances'],
    queryFn: allianceApi.list,
    staleTime: 60_000,
  });

  const { data: allGuilds = [] } = useQuery({
    queryKey: ['alliance-guilds'],
    queryFn: allianceApi.listGuilds,
    staleTime: 5 * 60_000,
  });

  const createAlliance = useMutation({
    mutationFn: () => allianceApi.create({ name: newName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alliances'] });
      setNewName('');
      setCreating(false);
    },
  });

  if (!guildId) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Network className="h-6 w-6" />
            Alliances
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Group servers into named alliances for cross-org organisation.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Alliance
          </Button>
        )}
      </div>

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
              <Button
                size="sm"
                onClick={() => createAlliance.mutate()}
                disabled={!newName.trim() || createAlliance.isPending}
              >
                Create
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setNewName(''); setCreating(false); }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
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

      {!isLoading && !isError && alliances.length === 0 && !creating && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Network className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No alliances yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create an alliance to group servers together.</p>
          <Button size="sm" className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Alliance
          </Button>
        </div>
      )}

      {alliances.map((alliance) => (
        <AllianceCard key={alliance.id} alliance={alliance} allGuilds={allGuilds} />
      ))}
    </div>
  );
}
