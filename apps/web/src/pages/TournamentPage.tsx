import { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { canManageGuild, getRoundLabel } from '@dem/shared';
import { tournamentApi } from '../api/tournament';
import type { Tournament, TournamentDetail, TournamentMatch, PlayerRating } from '../api/tournament';
import { BracketView } from '../components/BracketView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Trophy, Plus, Users, X, TrendingUp, TrendingDown, Minus, Swords } from 'lucide-react';
import type { EloSummaryEntry } from '../api/tournament';

// ── Constants ─────────────────────────────────────────────────────────────────

const TAB_STATUS: Record<string, string | undefined> = {
  upcoming:    'DRAFT,REGISTRATION',
  active:      'IN_PROGRESS',
  completed:   'COMPLETED,CANCELLED',
  rankings:    undefined,
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT:       'bg-zinc-700 text-zinc-300',
  REGISTRATION:'bg-blue-700/30 text-blue-300',
  IN_PROGRESS: 'bg-yellow-700/30 text-yellow-300',
  COMPLETED:   'bg-green-700/30 text-green-300',
  CANCELLED:   'bg-red-700/30 text-red-300',
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function TournamentPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'upcoming';
  const { guilds, user } = useAuth();
  const guild = guilds.find((g) => g.id === guildId);
  const isManager = !!guild && canManageGuild(guild);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resultMatch, setResultMatch] = useState<TournamentMatch | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const statusFilter = TAB_STATUS[tab];
  const { data: tournaments = [], isLoading } = useQuery({
    queryKey: ['tournaments', guildId, statusFilter],
    queryFn: () => tournamentApi.list(guildId!, statusFilter),
    enabled: !!guildId && tab !== 'rankings',
  });

  const { data: detail } = useQuery({
    queryKey: ['tournament-detail', selectedId],
    queryFn: () => tournamentApi.get(guildId!, selectedId!),
    enabled: !!selectedId && !!guildId,
  });

  const { data: rankings } = useQuery({
    queryKey: ['tournament-rankings', guildId],
    queryFn: () => tournamentApi.getRankings(guildId!),
    enabled: !!guildId && tab === 'rankings',
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
    qc.invalidateQueries({ queryKey: ['tournament-detail', selectedId] });
  };

  const openMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.open(guildId!, id),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.start(guildId!, id),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.delete(guildId!, id),
    onSuccess: (_, deletedId) => {
      setSelectedId(null);
      qc.setQueriesData<Tournament[]>({ queryKey: ['tournaments', guildId] }, (old) =>
        old ? old.filter((t) => t.id !== deletedId) : []
      );
    },
    onError: (e: Error) => alert(e.message),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.complete(guildId!, id),
    onSuccess: () => {
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
    },
    onError: (e: Error) => alert(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.cancel(guildId!, id),
    onSuccess: (_, cancelledId) => {
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
      qc.setQueriesData<Tournament[]>({ queryKey: ['tournaments', guildId] }, (old) =>
        old ? old.filter((t) => t.id !== cancelledId) : []
      );
    },
    onError: (e: Error) => alert(e.message),
  });

  const resultMutation = useMutation({
    mutationFn: ({ matchId, winnerId, scoreA, scoreB, forfeit }: { matchId: string; winnerId: string; scoreA?: number; scoreB?: number; forfeit?: boolean }) =>
      tournamentApi.submitResult(guildId!, detail!.id, matchId, { winnerId, scoreA, scoreB, forfeit }),
    onSuccess: () => { setResultMatch(null); invalidate(); },
    onError: (e: Error) => alert(e.message),
  });

  const addParticipantMutation = useMutation({
    mutationFn: ({ id, discordId, displayName }: { id: string; discordId?: string; displayName?: string }) =>
      tournamentApi.register(guildId!, id, { discordId, displayName }),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  const removeParticipantMutation = useMutation({
    mutationFn: ({ id, pid }: { id: string; pid: string }) =>
      tournamentApi.removeParticipant(guildId!, id, pid),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  const unregisterMutation = useMutation({
    mutationFn: (id: string) => tournamentApi.unregister(guildId!, id),
    onSuccess: invalidate,
    onError: (e: Error) => alert(e.message),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-yellow-400" />
          <h1 className="text-xl font-semibold">Tournaments</h1>
        </div>
        {isManager && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Tournament
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['upcoming', 'active', 'completed', 'rankings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setParams({ tab: t }); setSelectedId(null); }}
            className={`px-4 py-2 text-sm capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-indigo-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'active' ? 'In Progress' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Rankings Tab */}
      {tab === 'rankings' && (
        <div className="flex gap-6 items-start">
          <div className="flex-1 min-w-0">
            <RankingsView players={rankings?.players ?? []} isLoading={!rankings} guildId={guildId!} />
          </div>
          {isManager && (
            <div className="w-72 shrink-0">
              <H2HCard guildId={guildId!} players={rankings?.players ?? []} />
            </div>
          )}
        </div>
      )}

      {/* Tournament list + detail */}
      {tab !== 'rankings' && (
        <div className="flex gap-6">
          {/* List */}
          <div className="w-72 shrink-0 flex flex-col gap-2">
            {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
            {!isLoading && tournaments.length === 0 && (
              <p className="text-muted-foreground text-sm">No {tab} tournaments.</p>
            )}
            {tournaments.map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                isSelected={t.id === selectedId}
                isManager={isManager}
                onClick={() => setSelectedId(t.id)}
                onOpen={() => openMutation.mutate(t.id)}
                onStart={() => startMutation.mutate(t.id)}
                onDelete={() => { if (confirm(`Delete "${t.name}"?`)) deleteMutation.mutate(t.id); }}
                onComplete={() => { if (confirm(`Mark "${t.name}" as completed? This will distribute DKP and lock the results.`)) completeMutation.mutate(t.id); }}
                onCancel={() => { if (confirm(`Cancel "${t.name}"? This cannot be undone.`)) cancelMutation.mutate(t.id); }}
              />
            ))}
          </div>

          {/* Detail */}
          {selectedId && detail && (
            <TournamentDetail
              detail={detail}
              isManager={isManager}
              guildId={guildId!}
              currentUserId={user?.id ?? null}
              onSubmitResult={setResultMatch}
              onAddParticipant={(discordId, displayName) =>
                addParticipantMutation.mutate({ id: detail.id, discordId, displayName })
              }
              onRemoveParticipant={(pid) =>
                removeParticipantMutation.mutate({ id: detail.id, pid })
              }
              onUnregister={() => {
                if (confirm('Leave this tournament? You will lose your spot.')) {
                  unregisterMutation.mutate(detail.id);
                }
              }}
              isAddingParticipant={addParticipantMutation.isPending}
              isRemovingParticipant={removeParticipantMutation.isPending}
              isUnregistering={unregisterMutation.isPending}
            />
          )}
          {selectedId && !detail && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
          )}
          {!selectedId && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a tournament to view the bracket.
            </div>
          )}
        </div>
      )}

      {/* Create dialog */}
      {createOpen && (
        <CreateTournamentDialog
          guildId={guildId!}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); invalidate(); }}
        />
      )}

      {/* Result submission dialog */}
      {resultMatch && detail && (
        <SubmitResultDialog
          match={resultMatch}
          detail={detail}
          isPending={resultMutation.isPending}
          onClose={() => setResultMatch(null)}
          onSubmit={({ winnerId, scoreA, scoreB, forfeit }) =>
            resultMutation.mutate({ matchId: resultMatch.id, winnerId, scoreA, scoreB, forfeit })
          }
        />
      )}
    </div>
  );
}

// ── Tournament card ───────────────────────────────────────────────────────────

interface TournamentCardProps {
  tournament: Tournament;
  isSelected: boolean;
  isManager: boolean;
  onClick: () => void;
  onOpen: () => void;
  onStart: () => void;
  onDelete: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

function TournamentCard({ tournament: t, isSelected, isManager, onClick, onOpen, onStart, onDelete, onComplete, onCancel }: TournamentCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        isSelected ? 'border-indigo-500 bg-indigo-500/10' : 'border-border hover:border-indigo-500/50 hover:bg-accent/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm truncate">{t.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLORS[t.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
          {t.status.replace('_', ' ')}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" /> {t._count?.participants ?? 0}/{t.size}
        </span>
        <span>{t.format.replace('_', ' ')}</span>
      </div>
      {isManager && (
        <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          {t.status === 'DRAFT' && (
              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onOpen}>Open Reg</Button>
            )}
            {(t.status === 'DRAFT' || t.status === 'REGISTRATION') && (
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive" onClick={onDelete}>Delete</Button>
            )}
          {t.status === 'REGISTRATION' && (
            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onStart}>Start Bracket</Button>
          )}
          {t.status === 'IN_PROGRESS' && (
            <>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-400 border-green-500/40 hover:bg-green-500/10" onClick={onComplete}>Complete</Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive" onClick={onCancel}>Cancel</Button>
            </>
          )}
        </div>
      )}
    </button>
  );
}

// ── Tournament detail (bracket + participants) ────────────────────────────────

interface TournamentDetailProps {
  detail: TournamentDetail;
  isManager: boolean;
  guildId: string;
  currentUserId: string | null;
  onSubmitResult: (match: TournamentMatch) => void;
  onAddParticipant: (discordId?: string, displayName?: string) => void;
  onRemoveParticipant: (pid: string) => void;
  onUnregister: () => void;
  isAddingParticipant: boolean;
  isRemovingParticipant: boolean;
  isUnregistering: boolean;
}

function TournamentDetail({ detail, isManager, guildId, currentUserId, onSubmitResult, onAddParticipant, onRemoveParticipant, onUnregister, isAddingParticipant, isRemovingParticipant, isUnregistering }: TournamentDetailProps) {
  const [activeTab, setActiveTab] = useState<'bracket' | 'participants' | 'schedule'>('bracket');
  const [addName, setAddName] = useState('');
  const [addDiscordId, setAddDiscordId] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  // Manual seeding order — initialised from current seed, reset whenever participants change
  const [seedOrder, setSeedOrder] = useState<string[]>(() =>
    detail.participants
      .slice()
      .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
      .map((p) => p.id),
  );
  const qcDetail = useQueryClient();

  const reorderMutation = useMutation({
    mutationFn: (order: string[]) => tournamentApi.reorder(guildId, detail.id, order),
    onSuccess: () => qcDetail.invalidateQueries({ queryKey: ['tournament-detail', detail.id] }),
    onError: (e: Error) => alert(e.message),
  });

  const canManualSeed = isManager && ['DRAFT', 'REGISTRATION'].includes(detail.status) && detail.seedingMode === 'MANUAL';

  // Keep seedOrder in sync when participants are added/removed (merge: preserve user-set
  // positions for existing IDs, append new arrivals, drop removed ones).
  useEffect(() => {
    setSeedOrder((prev) => {
      const currentIds = new Set(detail.participants.map((p) => p.id));
      const kept = prev.filter((id) => currentIds.has(id));
      const added = detail.participants
        .filter((p) => !prev.includes(p.id))
        .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
        .map((p) => p.id);
      return [...kept, ...added];
    });
  }, [detail.participants]);

  function moveSeed(fromIdx: number, toIdx: number) {
    setSeedOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  }

  const { data: eloSummary } = useQuery({
    queryKey: ['elo-summary', detail.id],
    queryFn: () => tournamentApi.getEloSummary(guildId, detail.id),
    enabled: detail.status === 'COMPLETED',
  });

  const canEdit = isManager && (detail.status === 'DRAFT' || detail.status === 'REGISTRATION');
  const isFull = detail.participants.length >= detail.size;
  const alreadyRegistered = !!currentUserId && detail.participants.some((p) => p.discordId === currentUserId);
  const deadlinePassed = !!detail.registrationEndsAt && new Date(detail.registrationEndsAt) < new Date();
  const canSelfRegister = !isManager && detail.status === 'REGISTRATION' && !alreadyRegistered && !isFull && !deadlinePassed;

  const handleAdd = () => {
    if (!addName.trim() && !addDiscordId.trim()) return;
    onAddParticipant(addDiscordId.trim() || undefined, addName.trim() || undefined);
    setAddName('');
    setAddDiscordId('');
  };

  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">{detail.name}</h2>
        <div className="flex items-center gap-3">
          {isManager && detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED' && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {detail.threadId && (
            <a
              href={`https://discord.com/channels/${detail.guildId}/${detail.threadId}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-400 hover:underline"
            >
              View Discord thread ↗
            </a>
          )}
        </div>
      </div>

      {editOpen && (
        <EditTournamentDialog
          guildId={guildId}
          tournament={detail}
          onClose={() => setEditOpen(false)}
          onSaved={() => setEditOpen(false)}
        />
      )}

      {/* Linked seasons */}
      {detail.seasons && detail.seasons.length > 0 && (
        <SeasonStandingsSection guildId={guildId} seasons={detail.seasons} />
      )}

      {/* Self-registration banner for non-managers during open registration */}
      {canSelfRegister && (
        <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Registration is open</p>
            <p className="text-xs text-muted-foreground">{detail.participants.length}/{detail.size} spots filled{detail.registrationEndsAt ? ` · Closes ${new Date(detail.registrationEndsAt).toLocaleString()}` : ''}</p>
          </div>
          <Button
            size="sm"
            onClick={() => onAddParticipant()}
            disabled={isAddingParticipant}
          >
            {isAddingParticipant ? '…' : 'Join Tournament'}
          </Button>
        </div>
      )}
      {!isManager && alreadyRegistered && detail.status === 'REGISTRATION' && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-green-400">✓ You're registered</p>
            <p className="text-xs text-muted-foreground">{detail.participants.length}/{detail.size} spots filled</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={onUnregister}
            disabled={isUnregistering}
          >
            Leave
          </Button>
        </div>
      )}

      <div className="flex gap-1 text-sm">
        {(['bracket', 'participants', 'schedule'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-3 py-1 rounded capitalize transition-colors ${
              activeTab === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'bracket' && (
        <div className="flex flex-col gap-4">
          <BracketView
            matches={detail.matches}
            participants={detail.participants}
            tournamentName={detail.name}
            onSubmitResult={isManager ? onSubmitResult : undefined}
            isManager={isManager}
          />
          {eloSummary && eloSummary.length > 0 && (
            <EloSummaryTable entries={eloSummary} />
          )}
        </div>
      )}

      {activeTab === 'participants' && (
        <div className="flex flex-col gap-3">
          {/* Add participant form — visible to managers during DRAFT or REGISTRATION */}
          {canEdit && detail.participantMode === 'INDIVIDUAL' && (
            <div className="rounded-lg border border-border p-3 flex flex-col gap-2">
              <p className="text-sm font-medium text-muted-foreground">
                Add Participant ({detail.participants.length} / {detail.size})
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Display name (required)"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="h-8 text-sm flex-1"
                />
                <Input
                  placeholder="Discord ID (optional)"
                  value={addDiscordId}
                  onChange={(e) => setAddDiscordId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="h-8 text-sm w-44 font-mono"
                />
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleAdd}
                  disabled={(!addName.trim() && !addDiscordId.trim()) || isAddingParticipant || isFull}
                >
                  {isAddingParticipant ? '…' : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
                </Button>
              </div>
              {isFull && <p className="text-xs text-amber-500">Bracket is full ({detail.size}/{detail.size})</p>}
            </div>
          )}

          {/* Team registration form — managers only, TEAM mode */}
          {canEdit && detail.participantMode === 'TEAM' && (
            <AddTeamForm
              guildId={guildId}
              tournamentId={detail.id}
              slotsFilled={detail.participants.length}
              totalSlots={detail.size}
            />
          )}

          {/* Manual seeding drag-order panel */}
          {canManualSeed && detail.participants.length > 0 && (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Seed Order <span className="text-xs text-muted-foreground font-normal">(#1 is top seed)</span></p>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => reorderMutation.mutate(seedOrder)}
                  disabled={reorderMutation.isPending}
                >
                  {reorderMutation.isPending ? 'Saving…' : 'Save Order'}
                </Button>
              </div>
              <div className="flex flex-col gap-1">
                {seedOrder.map((pid, idx) => {
                  const p = detail.participants.find((x) => x.id === pid);
                  if (!p) return null;
                  return (
                    <div key={pid} className="flex items-center gap-2 rounded bg-background/60 px-2 py-1.5 border border-border">
                      <span className="w-6 text-center text-xs text-muted-foreground font-mono shrink-0">#{idx + 1}</span>
                      <span className="flex-1 text-sm truncate">{p.displayName}</span>
                      <div className="flex gap-0.5 shrink-0">
                        <button
                          disabled={idx === 0}
                          onClick={() => moveSeed(idx, idx - 1)}
                          className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                          title="Move up"
                        >
                          ▲
                        </button>
                        <button
                          disabled={idx === seedOrder.length - 1}
                          onClick={() => moveSeed(idx, idx + 1)}
                          className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                          title="Move down"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Participant roster table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Seed</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Participant</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Status</th>
                  {canEdit && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {detail.participants.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} className="px-3 py-4 text-center text-muted-foreground text-sm">
                      No participants yet.
                    </td>
                  </tr>
                )}
                {detail.participants
                  .slice()
                  .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
                  .map((p) => (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-3 py-2 text-muted-foreground">#{p.seed ?? '—'}</td>
                      <td className="px-3 py-2 font-medium">
                        {p.displayName}
                        {p.discordId && (
                          <span className="ml-1.5 text-xs text-muted-foreground font-mono">({p.discordId})</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[p.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                          {p.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() => {
                              if (confirm(`Remove "${p.displayName}" from the tournament?`)) {
                                onRemoveParticipant(p.id);
                              }
                            }}
                            disabled={isRemovingParticipant}
                            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                            title="Remove participant"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'schedule' && (
        <MatchScheduleView matches={detail.matches} participants={detail.participants} isManager={isManager} guildId={detail.guildId} tournamentId={detail.id} />
      )}
    </div>
  );
}

// ── Team registration form ────────────────────────────────────────────────────

function AddTeamForm({ guildId, tournamentId, slotsFilled, totalSlots }: {
  guildId: string;
  tournamentId: string;
  slotsFilled: number;
  totalSlots: number;
}) {
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Array<{ discordId: string; displayName: string }>>([
    { discordId: '', displayName: '' },
  ]);
  const qc = useQueryClient();
  const isFull = slotsFilled >= totalSlots;

  const addMutation = useMutation({
    mutationFn: () => tournamentApi.register(guildId, tournamentId, {
      teamName: teamName.trim(),
      teamMembers: members.filter((m) => m.displayName.trim()),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournament-detail', tournamentId] });
      setTeamName('');
      setMembers([{ discordId: '', displayName: '' }]);
    },
    onError: (e: Error) => alert(e.message),
  });

  const updateMember = (i: number, field: 'discordId' | 'displayName', val: string) => {
    setMembers((prev) => prev.map((m, idx) => idx === i ? { ...m, [field]: val } : m));
  };

  const canSubmit = teamName.trim() && members.some((m) => m.displayName.trim());

  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-3">
      <p className="text-sm font-medium text-muted-foreground">
        Add Team ({slotsFilled} / {totalSlots})
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Team name (required)"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          className="h-8 text-sm flex-1"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">Team members</p>
        {members.map((m, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              placeholder="Display name"
              value={m.displayName}
              onChange={(e) => updateMember(i, 'displayName', e.target.value)}
              className="h-7 text-xs flex-1"
            />
            <Input
              placeholder="Discord ID"
              value={m.discordId}
              onChange={(e) => updateMember(i, 'discordId', e.target.value)}
              className="h-7 text-xs w-40 font-mono"
            />
            {members.length > 1 && (
              <button
                onClick={() => setMembers((prev) => prev.filter((_, idx) => idx !== i))}
                className="text-muted-foreground hover:text-destructive text-xs"
                title="Remove member"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => setMembers((prev) => [...prev, { discordId: '', displayName: '' }])}
          className="text-xs text-indigo-400 hover:text-indigo-300 self-start"
        >
          + Add member
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8"
          onClick={() => addMutation.mutate()}
          disabled={!canSubmit || addMutation.isPending || isFull}
        >
          {addMutation.isPending ? '…' : <><Plus className="h-3.5 w-3.5 mr-1" />Add Team</>}
        </Button>
        {isFull && <p className="text-xs text-amber-500">Bracket is full</p>}
      </div>
    </div>
  );
}

// ── Match schedule view ───────────────────────────────────────────────────────

function MatchScheduleView({ matches, participants, isManager, guildId, tournamentId }: {
  matches: TournamentMatch[];
  participants: TournamentDetail['participants'];
  isManager: boolean;
  guildId: string;
  tournamentId: string;
}) {
  const byId = useMemo(() => new Map(participants.map((p) => [p.id, p])), [participants]);
  const maxRound = useMemo(() => {
    const w = matches.filter((m) => m.bracketSide === 'WINNERS');
    return w.length > 0 ? Math.max(...w.map((m) => m.round)) : 1;
  }, [matches]);
  const qc = useQueryClient();

  const scheduleMutation = useMutation({
    mutationFn: ({ matchId, scheduledAt }: { matchId: string; scheduledAt: string }) =>
      tournamentApi.scheduleMatch(guildId, tournamentId, matchId, scheduledAt),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tournament-detail', tournamentId] }),
  });

  const [scheduling, setScheduling] = useState<string | null>(null);
  const [schedDate, setSchedDate] = useState('');

  const ready = matches.filter((m) => m.participantAId && m.participantBId && m.status !== 'COMPLETED' && m.status !== 'BYE');

  if (ready.length === 0) {
    return <p className="text-muted-foreground text-sm">No matches ready to schedule.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {ready.map((m) => {
        const pA = byId.get(m.participantAId!);
        const pB = byId.get(m.participantBId!);
        return (
          <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="flex-1 text-sm">
              <span className="font-medium">
                {m.bracketSide === 'THIRD_PLACE' ? '🥉 3rd Place' : getRoundLabel(m.round, maxRound, m.bracketSide, m.position)}
              </span>
              <span className="text-muted-foreground ml-2">{pA?.displayName ?? '?'} vs {pB?.displayName ?? '?'}</span>
            </div>
            {m.scheduledAt && (
              <span className="text-xs text-muted-foreground">{new Date(m.scheduledAt).toLocaleString()}</span>
            )}
            {isManager && (
              scheduling === m.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="datetime-local"
                    value={schedDate}
                    onChange={(e) => setSchedDate(e.target.value)}
                    className="text-xs border border-border rounded px-2 py-1 bg-background"
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { scheduleMutation.mutate({ matchId: m.id, scheduledAt: new Date(schedDate).toISOString() }); setScheduling(null); }}
                    disabled={!schedDate}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setScheduling(null)}>✕</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  setScheduling(m.id);
                  // Pre-populate with the existing scheduled time so the manager only needs to adjust
                  setSchedDate(m.scheduledAt ? new Date(m.scheduledAt).toISOString().slice(0, 16) : '');
                }}>
                  {m.scheduledAt ? 'Reschedule' : 'Schedule'}
                </Button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── H2H card ──────────────────────────────────────────────────────────────────

// ── H2H player slot ───────────────────────────────────────────────────────────
// Each slot can be in "ranked" mode (dropdown) or "unranked" mode (Discord ID + name inputs).

interface H2HPlayerSlotProps {
  label: string;
  players: PlayerRating[];
  excludeDiscordId: string;
  discordId: string;
  displayName: string;
  unranked: boolean;
  onDiscordId: (v: string) => void;
  onDisplayName: (v: string) => void;
  onUnrankedToggle: (v: boolean) => void;
  onChange: () => void; // clear errors
}

function H2HPlayerSlot({
  label, players, excludeDiscordId, discordId, displayName, unranked,
  onDiscordId, onDisplayName, onUnrankedToggle, onChange,
}: H2HPlayerSlotProps) {
  const selectCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';
  const inputCls  = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
        <button
          type="button"
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          onClick={() => { onUnrankedToggle(!unranked); onDiscordId(''); onDisplayName(''); onChange(); }}
        >
          {unranked ? 'Pick ranked player' : 'Enter Discord ID'}
        </button>
      </div>

      {unranked ? (
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            placeholder="Discord ID (snowflake)"
            value={discordId}
            onChange={(e) => { onDiscordId(e.target.value.trim()); onChange(); }}
            className={inputCls + ' font-mono'}
          />
          <input
            type="text"
            placeholder="Display name (required)"
            value={displayName}
            onChange={(e) => { onDisplayName(e.target.value); onChange(); }}
            className={inputCls}
          />
        </div>
      ) : (
        <select
          value={discordId}
          onChange={(e) => { onDiscordId(e.target.value); onChange(); }}
          className={selectCls}
        >
          <option value="">Select player…</option>
          {players
            .filter((p) => p.discordId !== excludeDiscordId)
            .map((p) => (
              <option key={p.discordId} value={p.discordId}>{p.displayName} ({p.rating})</option>
            ))}
        </select>
      )}
    </div>
  );
}

function H2HCard({ guildId, players }: { guildId: string; players: PlayerRating[] }) {
  const qc = useQueryClient();

  const [playerAId, setPlayerAId]           = useState('');
  const [playerAName, setPlayerAName]       = useState('');
  const [playerAUnranked, setPlayerAUnranked] = useState(false);

  const [playerBId, setPlayerBId]           = useState('');
  const [playerBName, setPlayerBName]       = useState('');
  const [playerBUnranked, setPlayerBUnranked] = useState(false);

  const [winnerId, setWinnerId] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Derive display names: for ranked players, look up from the players array
  const rankedA = players.find((p) => p.discordId === playerAId);
  const rankedB = players.find((p) => p.discordId === playerBId);
  const nameA   = playerAUnranked ? playerAName : (rankedA?.displayName ?? '');
  const nameB   = playerBUnranked ? playerBName : (rankedB?.displayName ?? '');

  // Keep winner in sync: if it no longer refers to one of the two selected players, clear it
  const validWinnerIds = [playerAId, playerBId].filter(Boolean);
  const effectiveWinnerId = validWinnerIds.includes(winnerId) ? winnerId : '';

  function reset() {
    setPlayerAId(''); setPlayerAName(''); setPlayerAUnranked(false);
    setPlayerBId(''); setPlayerBName(''); setPlayerBUnranked(false);
    setWinnerId(''); setAnnounce(false); setError(null);
  }

  const mutation = useMutation({
    mutationFn: () => tournamentApi.submitH2H(guildId, {
      playerADiscordId:  playerAId,
      playerBDiscordId:  playerBId,
      winnerDiscordId:   effectiveWinnerId,
      announce,
      ...(playerAUnranked ? { playerADisplayName: playerAName.trim() } : {}),
      ...(playerBUnranked ? { playerBDisplayName: playerBName.trim() } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tournament-rankings', guildId] }); reset(); },
    onError:   (e: Error) => setError(e.message),
  });

  const canSubmit =
    playerAId && playerBId && effectiveWinnerId && !mutation.isPending &&
    (!playerAUnranked || playerAName.trim()) &&   // unranked A needs a name
    (!playerBUnranked || playerBName.trim());      // unranked B needs a name

  const selectCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center gap-2">
        <Swords className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-medium">Head to Head</span>
      </div>
      <div className="p-4 flex flex-col gap-3">

        <H2HPlayerSlot
          label="Player A"
          players={players}
          excludeDiscordId={playerBId}
          discordId={playerAId}
          displayName={playerAName}
          unranked={playerAUnranked}
          onDiscordId={setPlayerAId}
          onDisplayName={setPlayerAName}
          onUnrankedToggle={setPlayerAUnranked}
          onChange={() => setError(null)}
        />

        <H2HPlayerSlot
          label="Player B"
          players={players}
          excludeDiscordId={playerAId}
          discordId={playerBId}
          displayName={playerBName}
          unranked={playerBUnranked}
          onDiscordId={setPlayerBId}
          onDisplayName={setPlayerBName}
          onUnrankedToggle={setPlayerBUnranked}
          onChange={() => setError(null)}
        />

        {/* Winner — only active once both players are chosen */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Winner</label>
          <select
            value={effectiveWinnerId}
            onChange={(e) => { setWinnerId(e.target.value); setError(null); }}
            disabled={!playerAId || !playerBId}
            className={`${selectCls} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <option value="">Select winner…</option>
            {playerAId && <option value={playerAId}>{nameA || playerAId}</option>}
            {playerBId && <option value={playerBId}>{nameB || playerBId}</option>}
          </select>
        </div>

        {/* Announce toggle */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none mt-1">
          <input
            type="checkbox"
            checked={announce}
            onChange={(e) => setAnnounce(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-indigo-500"
          />
          <span className="text-sm text-muted-foreground">Announce to Discord</span>
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <Button
          className="w-full mt-1"
          disabled={!canSubmit}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Submitting…' : 'Submit Result'}
        </Button>
      </div>
    </div>
  );
}

// ── Season standings section ──────────────────────────────────────────────────

import type { SeasonStanding } from '../api/tournament';

function SeasonStandingsSection({ guildId, seasons }: {
  guildId: string;
  seasons: Array<{ season: { id: string; name: string; status: string } }>;
}) {
  const [openSeasonId, setOpenSeasonId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {seasons.map(({ season }) => (
          <button
            key={season.id}
            onClick={() => setOpenSeasonId(openSeasonId === season.id ? null : season.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              openSeasonId === season.id
                ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            🏆 {season.name}
            {season.status !== 'ACTIVE' && (
              <span className="ml-1 opacity-60">({season.status.toLowerCase()})</span>
            )}
          </button>
        ))}
      </div>
      {openSeasonId && (
        <SeasonStandingsPanel guildId={guildId} seasonId={openSeasonId} />
      )}
    </div>
  );
}

function SeasonStandingsPanel({ guildId, seasonId }: { guildId: string; seasonId: string }) {
  const { data: standings, isLoading } = useQuery({
    queryKey: ['season-standings', guildId, seasonId],
    queryFn: () => tournamentApi.getSeasonStandings(guildId, seasonId),
  });
  const medals = ['🥇', '🥈', '🥉'];

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading standings…</p>;
  if (!standings || standings.length === 0) return <p className="text-xs text-muted-foreground">No standings recorded for this season yet.</p>;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium w-10">#</th>
            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Player</th>
            <th className="text-right px-3 py-2 text-muted-foreground font-medium">Rating</th>
            <th className="text-right px-3 py-2 text-muted-foreground font-medium">W / L</th>
            <th className="text-right px-3 py-2 text-muted-foreground font-medium">Matches</th>
          </tr>
        </thead>
        <tbody>
          {(standings as SeasonStanding[]).map((s, i) => (
            <tr key={s.id} className="border-t border-border hover:bg-muted/20">
              <td className="px-3 py-2 text-center">{medals[i] ?? i + 1}</td>
              <td className="px-3 py-2 font-medium">{s.displayName}</td>
              <td className="px-3 py-2 text-right font-mono">{s.rating}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                <span className="text-green-400">{s.wins}</span> / <span className="text-red-400">{s.losses}</span>
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">{s.matchesPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rankings view ─────────────────────────────────────────────────────────────

function RankingsView({ players, isLoading, guildId }: { players: PlayerRating[]; isLoading: boolean; guildId: string }) {
  const medals = ['🥇', '🥈', '🥉'];
  const [selectedDiscordId, setSelectedDiscordId] = useState<string | null>(null);

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading rankings…</p>;
  if (players.length === 0) return <p className="text-muted-foreground text-sm">No ranked players yet.</p>;

  const selectedPlayer = players.find((p) => p.discordId === selectedDiscordId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-3 py-2 text-muted-foreground font-medium w-10">#</th>
              <th className="text-left px-3 py-2 text-muted-foreground font-medium">Player</th>
              <th className="text-right px-3 py-2 text-muted-foreground font-medium">Rating</th>
              <th className="text-right px-3 py-2 text-muted-foreground font-medium">W / L</th>
              <th className="text-right px-3 py-2 text-muted-foreground font-medium">Matches</th>
              <th className="text-right px-3 py-2 text-muted-foreground font-medium">Peak</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => {
              const isProvisional = p.matchesPlayed < 10;
              const isSelected = p.discordId === selectedDiscordId;
              return (
                <tr
                  key={p.id}
                  className={`border-t border-border cursor-pointer transition-colors ${isSelected ? 'bg-accent/60' : 'hover:bg-muted/20'}`}
                  onClick={() => setSelectedDiscordId(isSelected ? null : p.discordId)}
                >
                  <td className="px-3 py-2 text-center">{medals[i] ?? i + 1}</td>
                  <td className="px-3 py-2 font-medium">{p.displayName}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <Tooltip>
                      <TooltipTrigger>
                        <span className={isProvisional ? 'text-muted-foreground' : ''}>
                          {isProvisional ? '~' : ''}{p.rating}
                        </span>
                      </TooltipTrigger>
                      {isProvisional && <TooltipContent>Provisional (fewer than 10 matches)</TooltipContent>}
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    <span className="text-green-400">{p.wins}</span>
                    {' / '}
                    <span className="text-red-400">{p.losses}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{p.matchesPlayed}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground font-mono">{p.peakRating}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedPlayer && (
        <PlayerHistoryPanel guildId={guildId} player={selectedPlayer} onClose={() => setSelectedDiscordId(null)} />
      )}
    </div>
  );
}

// ── Player history panel ──────────────────────────────────────────────────────

import type { RatingHistoryEntry } from '../api/tournament';

function PlayerHistoryPanel({ guildId, player, onClose }: { guildId: string; player: PlayerRating; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['player-history', guildId, player.discordId],
    queryFn: () => tournamentApi.getPlayerHistory(guildId, player.discordId),
  });

  const history = data?.history ?? [];

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold">{player.displayName}</span>
          <span className="ml-2 text-xs text-muted-foreground font-mono">{player.discordId}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>✕</Button>
      </div>

      <div className="grid grid-cols-4 gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Rating</span>
          <span className="font-mono font-semibold">{player.rating}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Peak</span>
          <span className="font-mono">{player.peakRating}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">W / L</span>
          <span><span className="text-green-400">{player.wins}</span> / <span className="text-red-400">{player.losses}</span></span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Matches</span>
          <span>{player.matchesPlayed}</span>
        </div>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading history…</p>}
      {!isLoading && history.length === 0 && <p className="text-xs text-muted-foreground">No match history recorded yet.</p>}
      {history.length > 0 && (
        <>
          <RatingSparkline history={history} />
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-2 py-1.5 text-muted-foreground">Date</th>
                  <th className="text-left px-2 py-1.5 text-muted-foreground">Opponent</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground">Result</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground">Δ Rating</th>
                  <th className="text-right px-2 py-1.5 text-muted-foreground">After</th>
                </tr>
              </thead>
              <tbody>
                {history.slice().reverse().map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="px-2 py-1.5 text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</td>
                    <td className="px-2 py-1.5">{h.opponentName ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={h.won ? 'text-green-400' : 'text-red-400'}>{h.won ? 'Win' : 'Loss'}</span>
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono ${h.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {h.delta >= 0 ? '+' : ''}{h.delta}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{h.ratingAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function RatingSparkline({ history }: { history: RatingHistoryEntry[] }) {
  if (history.length < 2) return null;

  const ratings = history.map((h) => h.ratingAfter);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;

  const W = 300;
  const H = 48;
  const PAD_X = 4;
  const PAD_Y = 4;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const points = ratings.map((r, i) => {
    const x = PAD_X + (i / (ratings.length - 1)) * innerW;
    const y = PAD_Y + (1 - (r - min) / range) * innerH;
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  // Fill area under the line
  const fillPoints = `${PAD_X},${H - PAD_Y} ${polyline} ${W - PAD_X},${H - PAD_Y}`;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }}>
      <polygon points={fillPoints} fill="rgba(88,101,242,0.15)" />
      <polyline points={polyline} fill="none" stroke="#5865f2" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Start and end dots */}
      <circle cx={points[0]!.split(',')[0]} cy={points[0]!.split(',')[1]} r={2.5} fill="#5865f2" />
      <circle cx={points[points.length - 1]!.split(',')[0]} cy={points[points.length - 1]!.split(',')[1]} r={2.5} fill="#5865f2" />
    </svg>
  );
}

// ── Create tournament dialog ──────────────────────────────────────────────────

interface CreateDialogProps {
  guildId: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateTournamentDialog({ guildId, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState('');
  const [size, setSize] = useState('8');
  const [seedingMode, setSeedingMode] = useState('RANDOM');
  const [participantMode, setParticipantMode] = useState<'INDIVIDUAL' | 'TEAM'>('INDIVIDUAL');
  const [dkp1st, setDkp1st] = useState('0');
  const [dkp2nd, setDkp2nd] = useState('0');

  // Season linkage
  const { data: seasons } = useQuery({
    queryKey: ['seasons', guildId],
    queryFn: () => tournamentApi.getSeasons(guildId),
  });
  const [seasonId, setSeasonId] = useState('');

  const qc = useQueryClient();
  const createMutation = useMutation({
    mutationFn: () => tournamentApi.create(guildId, {
      name: name.trim(),
      size: Number(size),
      seedingMode,
      participantMode,
      dkpPrize1st: Number(dkp1st),
      dkpPrize2nd: Number(dkp2nd),
      ...(seasonId ? { seasonId } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tournaments', guildId] }); onCreated(); },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Tournament</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="t-name" className="text-sm font-medium">Tournament Name</label>
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring Invitational" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Participant Mode</label>
              <select value={participantMode} onChange={(e) => setParticipantMode(e.target.value as 'INDIVIDUAL' | 'TEAM')} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                <option value="INDIVIDUAL">Individual</option>
                <option value="TEAM">Team</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Bracket Size</label>
              <select value={size} onChange={(e) => setSize(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                {[4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64].map((s) => <option key={s} value={String(s)}>{s} {participantMode === 'TEAM' ? 'teams' : 'participants'}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Seeding</label>
              <select value={seedingMode} onChange={(e) => setSeedingMode(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                <option value="RANDOM">Random</option>
                <option value="DKP">DKP Points</option>
                <option value="ACTIVITY">Activity</option>
                <option value="ELO_RANK">ELO Rating</option>
                <option value="MANUAL">Manual</option>
              </select>
            </div>
            {seasons && seasons.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Season (optional)</label>
                <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                  <option value="">None</option>
                  {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dkp1" className="text-sm font-medium">1st Place DKP</label>
              <Input id="dkp1" type="number" min="0" value={dkp1st} onChange={(e) => setDkp1st(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dkp2" className="text-sm font-medium">2nd Place DKP</label>
              <Input id="dkp2" type="number" min="0" value={dkp2nd} onChange={(e) => setDkp2nd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="flex flex-col gap-2">
          {createMutation.isError && (
            <p className="text-sm text-red-500 w-full text-left">{(createMutation.error as Error).message}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Tournament'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit tournament dialog ────────────────────────────────────────────────────

interface EditDialogProps {
  guildId: string;
  tournament: TournamentDetail;
  onClose: () => void;
  onSaved: () => void;
}

function EditTournamentDialog({ guildId, tournament, onClose, onSaved }: EditDialogProps) {
  const isDraft = tournament.status === 'DRAFT';

  const [name, setName] = useState(tournament.name);
  const [description, setDescription] = useState(tournament.description ?? '');
  const [seedingMode, setSeedingMode] = useState(tournament.seedingMode);
  const [size, setSize] = useState(String(tournament.size));
  const [registrationEndsAt, setRegistrationEndsAt] = useState(
    tournament.registrationEndsAt
      ? new Date(tournament.registrationEndsAt).toISOString().slice(0, 16)
      : '',
  );
  const [dkp1st, setDkp1st] = useState(String(tournament.dkpPrize1st ?? 0));
  const [dkp2nd, setDkp2nd] = useState(String(tournament.dkpPrize2nd ?? 0));
  const [dkp3rd, setDkp3rd] = useState(String(tournament.dkpPrize3rd ?? 0));

  const qc = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: () => tournamentApi.update(guildId, tournament.id, {
      name: name.trim(),
      description: description.trim() || undefined,
      registrationEndsAt: registrationEndsAt ? new Date(registrationEndsAt).toISOString() : undefined,
      dkpPrize1st: Number(dkp1st),
      dkpPrize2nd: Number(dkp2nd),
      dkpPrize3rd: Number(dkp3rd),
      ...(isDraft && { seedingMode, size: Number(size) }),
    } as Parameters<typeof tournamentApi.update>[2]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tournament-detail', tournament.id] });
      qc.invalidateQueries({ queryKey: ['tournaments', guildId] });
      onSaved();
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Tournament</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Tournament Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring Invitational" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none"
            />
          </div>
          {isDraft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Bracket Size</label>
                <select value={size} onChange={(e) => setSize(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                  {[4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64].map((s) => <option key={s} value={String(s)}>{s} participants</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Seeding</label>
                <select value={seedingMode} onChange={(e) => setSeedingMode(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                  <option value="RANDOM">Random</option>
                  <option value="DKP">DKP Points</option>
                  <option value="ACTIVITY">Activity</option>
                  <option value="ELO_RANK">ELO Rating</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Registration Deadline</label>
            <input
              type="datetime-local"
              value={registrationEndsAt}
              onChange={(e) => setRegistrationEndsAt(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">1st DKP</label>
              <Input type="number" min="0" value={dkp1st} onChange={(e) => setDkp1st(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">2nd DKP</label>
              <Input type="number" min="0" value={dkp2nd} onChange={(e) => setDkp2nd(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">3rd DKP</label>
              <Input type="number" min="0" value={dkp3rd} onChange={(e) => setDkp3rd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter className="flex flex-col gap-2">
          {updateMutation.isError && (
            <p className="text-sm text-red-500 w-full text-left">{(updateMutation.error as Error).message}</p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={!name.trim() || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Submit result dialog ──────────────────────────────────────────────────────

interface SubmitResultDialogProps {
  match: TournamentMatch;
  detail: TournamentDetail;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (result: { winnerId: string; scoreA?: number; scoreB?: number; forfeit?: boolean }) => void;
}

function SubmitResultDialog({ match, detail, isPending, onClose, onSubmit }: SubmitResultDialogProps) {
  const byId = useMemo(() => new Map(detail.participants.map((p) => [p.id, p])), [detail.participants]);
  const dialogMaxRound = useMemo(() => {
    const w = detail.matches.filter((m) => m.bracketSide === 'WINNERS');
    return w.length > 0 ? Math.max(...w.map((m) => m.round)) : 1;
  }, [detail.matches]);
  const pA = match.participantAId ? byId.get(match.participantAId) : null;
  const pB = match.participantBId ? byId.get(match.participantBId) : null;

  const [winnerId, setWinnerId] = useState(match.participantAId ?? match.participantBId ?? '');
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [forfeit, setForfeit] = useState(false);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
          {match.bracketSide === 'THIRD_PLACE' ? '🥉 3rd Place Result' : `${getRoundLabel(match.round, dialogMaxRound, match.bracketSide, match.position)} Result`}
        </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Winner</label>
            <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
              {pA && <option value={pA.id}>{pA.displayName}</option>}
              {pB && <option value={pB.id}>{pB.displayName}</option>}
            </select>
          </div>
          {!forfeit && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="scoreA" className="text-sm font-medium">{pA?.displayName ?? 'Player A'} Score</label>
                <Input id="scoreA" type="number" min="0" value={scoreA} onChange={(e) => setScoreA(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="scoreB" className="text-sm font-medium">{pB?.displayName ?? 'Player B'} Score</label>
                <Input id="scoreB" type="number" min="0" value={scoreB} onChange={(e) => setScoreB(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={forfeit}
              onChange={(e) => setForfeit(e.target.checked)}
              className="rounded"
            />
            <span>Forfeit <span className="text-muted-foreground">(no ELO change)</span></span>
          </label>
          {forfeit && (
            <p className="text-xs text-amber-500 -mt-2">
              Scores will not be recorded and ELO ratings will remain unchanged.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!winnerId || isPending}
            onClick={() => onSubmit({
              winnerId,
              scoreA: !forfeit && scoreA !== '' ? Number(scoreA) : undefined,
              scoreB: !forfeit && scoreB !== '' ? Number(scoreB) : undefined,
              forfeit: forfeit || undefined,
            })}
          >
            {isPending ? 'Saving…' : forfeit ? 'Record Forfeit' : 'Submit Result'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ELO summary table ─────────────────────────────────────────────────────────

function EloSummaryTable({ entries }: { entries: EloSummaryEntry[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center gap-2">
        <span className="text-sm font-medium">📊 ELO Changes</span>
        <span className="text-xs text-muted-foreground">— this tournament</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/20">
          <tr>
            <th className="text-left px-3 py-1.5 text-muted-foreground font-medium text-xs">Player</th>
            <th className="text-right px-3 py-1.5 text-muted-foreground font-medium text-xs">W / L</th>
            <th className="text-right px-3 py-1.5 text-muted-foreground font-medium text-xs">Before</th>
            <th className="text-right px-3 py-1.5 text-muted-foreground font-medium text-xs">Change</th>
            <th className="text-right px-3 py-1.5 text-muted-foreground font-medium text-xs">After</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const up = e.totalDelta > 0;
            const down = e.totalDelta < 0;
            return (
              <tr key={e.discordId} className="border-t border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{e.displayName}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  <span className="text-green-400">{e.wins}</span>
                  {' / '}
                  <span className="text-red-400">{e.losses}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground">{e.ratingBefore}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  <span className={`flex items-center justify-end gap-1 ${up ? 'text-green-400' : down ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {up ? <TrendingUp className="h-3.5 w-3.5" /> : down ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    {e.totalDelta >= 0 ? `+${e.totalDelta}` : e.totalDelta}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{e.ratingAfter}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
