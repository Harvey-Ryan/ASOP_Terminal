import { useState, useMemo } from 'react';
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
  completed:   'COMPLETED',
  rankings:    undefined,
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT:       'bg-zinc-700 text-zinc-300',
  REGISTRATION:'bg-blue-700/30 text-blue-300',
  IN_PROGRESS: 'bg-yellow-700/30 text-yellow-300',
  COMPLETED:   'bg-green-700/30 text-green-300',
};

// ── Main page ─────────────────────────────────────────────────────────────────

export function TournamentPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'upcoming';
  const { guilds } = useAuth();
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

  const resultMutation = useMutation({
    mutationFn: ({ matchId, winnerId, scoreA, scoreB }: { matchId: string; winnerId: string; scoreA?: number; scoreB?: number }) =>
      tournamentApi.submitResult(guildId!, detail!.id, matchId, { winnerId, scoreA, scoreB }),
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
            <RankingsView players={rankings?.players ?? []} isLoading={!rankings} />
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
              />
            ))}
          </div>

          {/* Detail */}
          {selectedId && detail && (
            <TournamentDetail
              detail={detail}
              isManager={isManager}
              guildId={guildId!}
              onSubmitResult={setResultMatch}
              onAddParticipant={(discordId, displayName) =>
                addParticipantMutation.mutate({ id: detail.id, discordId, displayName })
              }
              onRemoveParticipant={(pid) =>
                removeParticipantMutation.mutate({ id: detail.id, pid })
              }
              isAddingParticipant={addParticipantMutation.isPending}
              isRemovingParticipant={removeParticipantMutation.isPending}
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
          onSubmit={({ winnerId, scoreA, scoreB }) =>
            resultMutation.mutate({ matchId: resultMatch.id, winnerId, scoreA, scoreB })
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
}

function TournamentCard({ tournament: t, isSelected, isManager, onClick, onOpen, onStart, onDelete }: TournamentCardProps) {
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
  onSubmitResult: (match: TournamentMatch) => void;
  onAddParticipant: (discordId?: string, displayName?: string) => void;
  onRemoveParticipant: (pid: string) => void;
  isAddingParticipant: boolean;
  isRemovingParticipant: boolean;
}

function TournamentDetail({ detail, isManager, guildId, onSubmitResult, onAddParticipant, onRemoveParticipant, isAddingParticipant, isRemovingParticipant }: TournamentDetailProps) {
  const [activeTab, setActiveTab] = useState<'bracket' | 'participants' | 'schedule'>('bracket');
  const [addName, setAddName] = useState('');
  const [addDiscordId, setAddDiscordId] = useState('');

  const { data: eloSummary } = useQuery({
    queryKey: ['elo-summary', detail.id],
    queryFn: () => tournamentApi.getEloSummary(guildId, detail.id),
    enabled: detail.status === 'COMPLETED',
  });

  const canEdit = isManager && (detail.status === 'DRAFT' || detail.status === 'REGISTRATION');
  const isFull = detail.participants.length >= detail.size;

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
          {canEdit && (
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
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setScheduling(m.id); setSchedDate(''); }}>
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

// ── Rankings view ─────────────────────────────────────────────────────────────

function RankingsView({ players, isLoading }: { players: PlayerRating[]; isLoading: boolean }) {
  const medals = ['🥇', '🥈', '🥉'];

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading rankings…</p>;
  if (players.length === 0) return <p className="text-muted-foreground text-sm">No ranked players yet.</p>;

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
            <th className="text-right px-3 py-2 text-muted-foreground font-medium">Peak</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => {
            const isProvisional = p.matchesPlayed < 10;
            return (
              <tr key={p.id} className="border-t border-border hover:bg-muted/20">
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
  const [dkp1st, setDkp1st] = useState('0');
  const [dkp2nd, setDkp2nd] = useState('0');

  const qc = useQueryClient();
  const createMutation = useMutation({
    mutationFn: () => tournamentApi.create(guildId, {
      name: name.trim(),
      size: Number(size),
      seedingMode,
      dkpPrize1st: Number(dkp1st),
      dkpPrize2nd: Number(dkp2nd),
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
              <label className="text-sm font-medium">Bracket Size</label>
              <select value={size} onChange={(e) => setSize(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
                {[4, 8, 16, 32].map((s) => <option key={s} value={String(s)}>{s} participants</option>)}
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

// ── Submit result dialog ──────────────────────────────────────────────────────

interface SubmitResultDialogProps {
  match: TournamentMatch;
  detail: TournamentDetail;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (result: { winnerId: string; scoreA?: number; scoreB?: number }) => void;
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!winnerId || isPending}
            onClick={() => onSubmit({
              winnerId,
              scoreA: scoreA !== '' ? Number(scoreA) : undefined,
              scoreB: scoreB !== '' ? Number(scoreB) : undefined,
            })}
          >
            {isPending ? 'Saving…' : 'Submit Result'}
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
