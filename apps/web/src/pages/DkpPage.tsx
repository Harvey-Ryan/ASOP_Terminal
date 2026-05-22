import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Coins, Plus, Minus, Search } from 'lucide-react';
import { lootApi } from '@/api/loot';
import { canManageGuild } from '@dem/shared';
import type { DkpBalanceDto, DkpTransactionDto } from '@dem/shared';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DkpPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { guilds } = useAuth();
  const queryClient = useQueryClient();

  const guild = guilds.find((g) => g.id === guildId);
  const isManager = !!guild && canManageGuild(guild);

  const [tab, setTab] = useState<'leaderboard' | 'transactions'>('leaderboard');
  const [txSearch, setTxSearch] = useState('');
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustUsername, setAdjustUsername] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustMode, setAdjustMode] = useState<'grant' | 'deduct'>('grant');
  const [adjustError, setAdjustError] = useState('');

  const leaderboardQuery = useQuery<DkpBalanceDto[]>({
    queryKey: ['dkp', guildId],
    queryFn: () => lootApi.getDkp(guildId!),
    enabled: !!guildId && isManager,
  });

  const myDkpQuery = useQuery<DkpBalanceDto>({
    queryKey: ['dkp-me', guildId],
    queryFn: () => lootApi.getMyDkp(guildId!),
    enabled: !!guildId && !isManager,
  });

  const txQuery = useQuery<DkpTransactionDto[]>({
    queryKey: ['dkp-transactions', guildId],
    queryFn: () => lootApi.getTransactions(guildId!),
    enabled: !!guildId && tab === 'transactions',
  });

  const adjustMutation = useMutation({
    mutationFn: (body: { userId: string; username: string; amount: number; reason: string }) =>
      lootApi.adjustDkp(guildId!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dkp', guildId] });
      void queryClient.invalidateQueries({ queryKey: ['dkp-transactions', guildId] });
      setAdjustUserId('');
      setAdjustUsername('');
      setAdjustAmount('');
      setAdjustReason('');
      setAdjustError('');
    },
    onError: (err: Error) => setAdjustError(err.message),
  });

  function handleAdjust() {
    const amt = parseInt(adjustAmount, 10);
    if (!adjustUserId.trim()) { setAdjustError('Discord user ID is required.'); return; }
    if (!adjustUsername.trim()) { setAdjustError('Username is required.'); return; }
    if (!adjustAmount || isNaN(amt) || amt <= 0) { setAdjustError('Enter a positive amount.'); return; }
    if (!adjustReason.trim()) { setAdjustError('Reason is required.'); return; }
    setAdjustError('');
    adjustMutation.mutate({
      userId: adjustUserId.trim(),
      username: adjustUsername.trim(),
      amount: adjustMode === 'grant' ? amt : -amt,
      reason: adjustReason.trim(),
    });
  }

  const leaderboard: DkpBalanceDto[] = leaderboardQuery.data ?? [];
  const myBalance: DkpBalanceDto | undefined = myDkpQuery.data;

  const filteredTx: DkpTransactionDto[] = (txQuery.data ?? []).filter((t) => {
    if (!txSearch) return true;
    const q = txSearch.toLowerCase();
    return t.username.toLowerCase().includes(q) || t.reason.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Coins className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">DKP</h1>
      </div>

      {/* Member view — just show their own balance */}
      {!isManager && (
        <div className="rounded-xl border border-border bg-card p-6 max-w-sm">
          <p className="text-sm text-muted-foreground mb-1">Your Balance</p>
          {myDkpQuery.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <p className="text-4xl font-bold text-primary">{myBalance?.balance ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">{myBalance?.username}</p>
            </>
          )}
        </div>
      )}

      {/* Manager view — full leaderboard + transactions + adjust */}
      {isManager && (
        <>
          {/* Tab switcher */}
          <div className="flex gap-1 border-b border-border">
            {(['leaderboard', 'transactions'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px',
                  tab === t
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'leaderboard' ? 'Leaderboard' : 'Transactions'}
              </button>
            ))}
          </div>

          {tab === 'leaderboard' && (
            <div className="space-y-4">
              {leaderboardQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}

              {leaderboard.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-10">#</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Player</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((b, i) => (
                        <tr
                          key={b.userId}
                          className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium">{b.username}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary">
                            {b.balance.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {leaderboard.length === 0 && !leaderboardQuery.isLoading && (
                <p className="text-sm text-muted-foreground">No DKP balances recorded yet.</p>
              )}

              {/* Adjustment form */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-lg">
                <h2 className="text-sm font-semibold">Manual Adjustment</h2>

                <div className="flex gap-2">
                  <button
                    onClick={() => setAdjustMode('grant')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      adjustMode === 'grant'
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" /> Grant
                  </button>
                  <button
                    onClick={() => setAdjustMode('deduct')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      adjustMode === 'deduct'
                        ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <Minus className="h-3.5 w-3.5" /> Deduct
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Discord User ID</label>
                    <input
                      value={adjustUserId}
                      onChange={(e) => setAdjustUserId(e.target.value)}
                      placeholder="123456789012345678"
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Username</label>
                    <input
                      value={adjustUsername}
                      onChange={(e) => setAdjustUsername(e.target.value)}
                      placeholder="PlayerName"
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Amount</label>
                    <input
                      type="number"
                      min={1}
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Reason</label>
                    <input
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder="e.g. Bonus for operation"
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                </div>

                {adjustError && <p className="text-xs text-red-400">{adjustError}</p>}

                <Button
                  size="sm"
                  onClick={handleAdjust}
                  disabled={adjustMutation.isPending}
                  className={cn(
                    adjustMode === 'deduct' && 'bg-red-600 hover:bg-red-700',
                  )}
                >
                  {adjustMode === 'grant' ? <Plus className="h-3.5 w-3.5 mr-1.5" /> : <Minus className="h-3.5 w-3.5 mr-1.5" />}
                  {adjustMutation.isPending ? 'Saving…' : adjustMode === 'grant' ? 'Grant DKP' : 'Deduct DKP'}
                </Button>
              </div>
            </div>
          )}

          {tab === 'transactions' && (
            <div className="space-y-3">
              <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  placeholder="Filter by player or reason…"
                  className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              {txQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

              {filteredTx.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Player</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Reason</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Amount</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTx.map((t) => (
                        <tr
                          key={t.id}
                          className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium">{t.username}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{t.reason}</td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 font-mono font-semibold',
                                t.amount >= 0 ? 'text-emerald-400' : 'text-red-400',
                              )}
                            >
                              {t.amount >= 0
                                ? <TrendingUp className="h-3.5 w-3.5" />
                                : <TrendingDown className="h-3.5 w-3.5" />}
                              {t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString()}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">
                            {new Date(t.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {filteredTx.length === 0 && !txQuery.isLoading && (
                <p className="text-sm text-muted-foreground">No transactions found.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
