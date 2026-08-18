import { useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { canManageGuild } from '@dem/shared';
import { tournamentApi } from '../api/tournament';
import type { Tournament, TournamentDetail, TournamentMatch, PlayerRating } from '../api/tournament';
import { BracketView } from '../components/BracketView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Trophy, Plus, Users } from 'lucide-react';

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
    onSuccess: () => { setSelectedId(null); invalidate(); },
    onError: (e: Error) => alert(e.message),
  });

  const resultMutation = useMutation({
    mutationFn: ({ matchId, winnerId, scoreA, scoreB }: { matchId: string; winnerId: string; scoreA?: number; scoreB?: number }) =>
      tournamentApi.submitResult(guildId!, detail!.id, matchId, { winnerId, scoreA, scoreB }),
    onSuccess: () => { setResultMatch(null); invalidate(); },
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
        <RankingsView players={rankings?.players ?? []} isLoading={!rankings} />
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
            <>
              <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={onOpen}>Open Reg</Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive" onClick={onDelete}>Delete</Button>
            </>
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
}

function TournamentDetail({ detail, isManager, onSubmitResult }: TournamentDetailProps) {
  const [activeTab, setActiveTab] = useState<'bracket' | 'participants' | 'schedule'>('bracket');

  return (
    <div className="flex-1 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">{detail.name}</h2>
        {detail.threadId && (
          <a
            href={`https://discord.com/channels/@me/${detail.threadId}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-400 hover:underline"
          >
            View Discord thread
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
        <BracketView
          matches={detail.matches}
          participants={detail.participants}
          tournamentName={detail.name}
          onSubmitResult={isManager ? onSubmitResult : undefined}
          isManager={isManager}
        />
      )}

      {activeTab === 'participants' && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Seed</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Participant</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.participants
                .slice()
                .sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999))
                .map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 text-muted-foreground">#{p.seed ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{p.displayName}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[p.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
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
              <span className="font-medium">Round {m.round} – Match {m.position + 1}</span>
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
                  Schedule
                </Button>
              )
            )}
          </div>
        );
      })}
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
  const pA = match.participantAId ? byId.get(match.participantAId) : null;
  const pB = match.participantBId ? byId.get(match.participantBId) : null;

  const [winnerId, setWinnerId] = useState(match.participantAId ?? match.participantBId ?? '');
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Round {match.round} — Match {match.position + 1} Result</DialogTitle>
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
