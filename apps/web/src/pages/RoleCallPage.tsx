import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { roleCallApi } from '@/api/rolecall';
import { settingsApi } from '@/api/settings';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RcLeaderboardRow } from '@/api/rolecall';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVoice(mins: number) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

const MEDALS = ['🥇', '🥈', '🥉'];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function LeaderboardRowItem({
  row,
  rank,
  onClick,
  clickable,
}: {
  row: RcLeaderboardRow;
  rank: number;
  onClick: () => void;
  clickable: boolean;
}) {
  return (
    <button
      onClick={clickable ? onClick : undefined}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 transition-colors text-left border-b border-border last:border-0',
        clickable ? 'hover:bg-accent cursor-pointer' : 'cursor-default',
      )}
    >
      <span className="w-6 text-center text-sm shrink-0">
        {rank <= 3 ? MEDALS[rank - 1] : rank}
      </span>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={row.avatar} alt={row.displayName} />
        <AvatarFallback className="text-xs">{row.displayName[0]?.toUpperCase() ?? '?'}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium truncate', row.is_inactive && 'text-muted-foreground')}>
          {row.displayName}
          {row.is_inactive && <span className="ml-1.5 text-xs font-normal">(inactive)</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.message_count.toLocaleString()} msgs · {fmtVoice(row.voice_minutes)} voice
          {row.streak_days > 0 && ` · 🔥 ${row.streak_days}d`}
        </p>
      </div>
      <span className="text-sm font-semibold shrink-0">{Number(row.score).toLocaleString()}</span>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RoleCallPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { user } = useAuth();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data: myPerms } = useQuery({
    queryKey: ['my-permissions', guildId],
    queryFn: () => settingsApi.getMyPermissions(guildId!),
    enabled: !!guildId,
    staleTime: 60_000,
  });

  // Managers and module editors can view any member's detail.
  // Regular members can only view their own.
  const isPrivileged = myPerms?.canManageEvents ?? false;

  function handleRowClick(userId: string) {
    if (isPrivileged || userId === user?.id) {
      setSelectedUserId(userId);
    }
  }

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['rolecall-stats', guildId],
    queryFn: () => roleCallApi.getStats(guildId!),
    enabled: !!guildId,
    retry: false,
  });

  const { data: lb, isLoading: lbLoading, isError: lbError } = useQuery({
    queryKey: ['rolecall-leaderboard', guildId, page],
    queryFn: () => roleCallApi.getLeaderboard(guildId!, page),
    enabled: !!guildId && !selectedUserId,
    retry: false,
  });

  const { data: member, isLoading: memberLoading } = useQuery({
    queryKey: ['rolecall-member', guildId, selectedUserId],
    queryFn: () => roleCallApi.getMember(guildId!, selectedUserId!),
    enabled: !!guildId && !!selectedUserId,
    retry: false,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-primary shrink-0" />
        <h1 className="text-lg font-semibold">Activity</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4"><Skeleton className="h-10 w-full" /></CardContent></Card>
          ))
        ) : stats ? (
          <>
            <StatCard label="Members" value={Number(stats.total_members).toLocaleString()} />
            <StatCard label="Messages" value={Number(stats.total_messages).toLocaleString()} />
            <StatCard label="Voice" value={fmtVoice(Number(stats.total_voice_minutes))} />
            <StatCard label="Top Streak" value={`${stats.top_streak}d`} />
          </>
        ) : null}
      </div>

      {/* Member detail */}
      {selectedUserId && (
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedUserId(null)}
            className="gap-1 text-muted-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to leaderboard
          </Button>

          {memberLoading && (
            <Card><CardContent className="pt-6 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent></Card>
          )}

          {member && (
            <>
              {/* Member header */}
              <Card>
                <CardContent className="pt-5 flex items-center gap-4">
                  <Avatar className="h-14 w-14 shrink-0">
                    <AvatarImage src={member.member.avatar} alt={member.member.displayName} />
                    <AvatarFallback>{member.member.displayName[0]?.toUpperCase() ?? '?'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base">{member.member.displayName}</p>
                    <p className="text-xs text-muted-foreground">@{member.member.username}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">{Number(member.activity.score).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Rank #{member.rank}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Messages" value={member.activity.message_count.toLocaleString()} />
                <StatCard label="Voice" value={fmtVoice(member.activity.voice_minutes)} />
                <StatCard label="Streak" value={`${member.activity.streak_days}d`} />
              </div>

              {/* Achievements */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    Achievements
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 divide-y divide-border">
                  {member.achievements.length === 0 && (
                    <p className="py-3 text-sm text-muted-foreground">No achievements yet.</p>
                  )}
                  {member.achievements.map((a) => (
                    <div key={a.id} className="py-3 flex items-center gap-3">
                      <span className="text-lg shrink-0">{a.earned_at ? a.emoji : '⬜'}</span>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-medium', !a.earned_at && 'text-muted-foreground')}>
                          {a.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{a.description}</p>
                      </div>
                      {a.earned_at && (
                        <span className="text-xs text-muted-foreground shrink-0">{timeAgo(a.earned_at)}</span>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Role history */}
              {member.history.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Role History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 divide-y divide-border">
                    {member.history.map((h) => (
                      <div key={h.id} className="py-3 pl-3 border-l-2 border-primary ml-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium capitalize">
                            {h.change_type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(h.changed_at).toLocaleDateString()}
                          </span>
                        </div>
                        {h.reason && (
                          <p className="text-xs text-muted-foreground">{h.reason}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Leaderboard */}
      {!selectedUserId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {lbLoading && (
              <div className="space-y-2 px-4 py-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )}

            {lbError && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                Activity service unavailable. Check that <code>ROLECALL_API_URL</code> is configured.
              </p>
            )}

            {lb?.rows.map((row, i) => (
              <LeaderboardRowItem
                key={row.user_id}
                row={row}
                rank={(page - 1) * 25 + i + 1}
                onClick={() => handleRowClick(row.user_id)}
                clickable={isPrivileged || row.user_id === user?.id}
              />
            ))}

            {/* Pagination */}
            {lb && lb.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {lb.page} of {lb.totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(lb.totalPages, p + 1))}
                  disabled={page === lb.totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
