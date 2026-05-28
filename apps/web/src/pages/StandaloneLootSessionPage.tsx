import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Plus, Trash2, Shuffle, RotateCcw, CheckCircle2, Save, SkipForward,
  Play, EyeOff, GripVertical, ListOrdered, UserPlus, X, Info, Search, Package, Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lootApi } from '@/api/loot';
import { uexApi } from '@/api/uex';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { resolveUsername } from '@/lib/displayName';
import type { LootSessionDto, LootItemDto, LootMethod, LootQueueItemDto, UexItemDto, UexCommodityDto, LootParticipant } from '@dem/shared';

const METHOD_LABELS: Record<LootMethod, string> = {
  RANDOM_ROLL: '🎲 Random Roll',
  DKP: '🪙 DKP',
  SNAKE_DRAFT: '🐍 Snake Draft',
  COMMODITY_DRAFT: '📦 Commodity Draft',
};

const inputCls = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ── Snake draft helper ────────────────────────────────────────────────────────

function snakePick(position: number, order: string[]): string | null {
  if (order.length === 0) return null;
  const n = order.length;
  const round = Math.floor(position / n);
  const pos = position % n;
  return round % 2 === 0 ? order[pos]! : order[n - 1 - pos]!;
}

// ── UEX info popover ──────────────────────────────────────────────────────────

function UexInfoCard({ data }: { data: UexItemDto | UexCommodityDto }) {
  const isItem = 'categoryName' in data;
  if (isItem) {
    const item = data as UexItemDto;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-foreground leading-tight">{item.name}</p>
          <span className="shrink-0 rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">Item</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          {item.categoryName && <span><span className="text-foreground/60">Category:</span> {item.categoryName}</span>}
          {item.section      && <span><span className="text-foreground/60">Section:</span> {item.section}</span>}
          {item.gameVersion  && <span><span className="text-foreground/60">Version:</span> {item.gameVersion}</span>}
          {item.size         && <span><span className="text-foreground/60">Size:</span> {item.size}</span>}
        </div>
        {item.attributes.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground border-t border-border/50 pt-2 mt-1">
            {item.attributes.map((attr) => (
              <span key={attr.name}>
                <span className="text-foreground/60">{attr.name}:</span> {attr.value}{attr.unit ? ` ${attr.unit}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  const com = data as UexCommodityDto;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground leading-tight">{com.name}</p>
        <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">Commodity</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
        {com.code && <span><span className="text-foreground/60">Code:</span> {com.code}</span>}
        {com.priceAvgBuy != null && <span><span className="text-foreground/60">Buy avg:</span> {com.priceAvgBuy.toLocaleString()} aUEC</span>}
        {com.priceAvgSell != null && <span><span className="text-foreground/60">Sell avg:</span> {com.priceAvgSell.toLocaleString()} aUEC</span>}
      </div>
    </div>
  );
}

function ItemInfoPopover({ name }: { name: string }) {
  const [show, setShow] = useState(false);
  const infoQuery = useQuery({
    queryKey: ['uex-item-info', name],
    queryFn: async () => {
      const [items, commodities] = await Promise.all([
        uexApi.getItems({ q: name, limit: 10 }),
        uexApi.getCommodities({ q: name, limit: 5 }),
      ]);
      const lc = name.toLowerCase();
      return (
        items.find((i) => i.name.toLowerCase() === lc) ??
        commodities.find((c) => c.name.toLowerCase() === lc) ??
        items[0] ?? commodities[0] ?? null
      );
    },
    enabled: show,
    staleTime: 10 * 60 * 1000,
  });
  return (
    <div className="relative" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button type="button" tabIndex={-1} className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors">
        <Info className="h-3.5 w-3.5" />
      </button>
      {show && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-border bg-card p-3 shadow-xl text-xs pointer-events-none">
          {infoQuery.isLoading && <p className="text-muted-foreground">Looking up "{name}"…</p>}
          {!infoQuery.isLoading && infoQuery.data === null && <p className="text-muted-foreground">No UEX record found for "{name}".</p>}
          {infoQuery.data && <UexInfoCard data={infoQuery.data} />}
        </div>
      )}
    </div>
  );
}

// ── Item row ──────────────────────────────────────────────────────────────────

function StandaloneItemRow({
  item,
  session,
  allAssignmentCount,
  skipCount,
  onRolled,
  onAssigned,
  onDelete,
  guildId,
  sessionId,
  currentUserId,
  isManager,
}: {
  item: LootItemDto;
  session: LootSessionDto;
  allAssignmentCount: number;
  skipCount: number;
  onRolled: () => void;
  onAssigned: () => void;
  onDelete: () => void;
  guildId: string;
  sessionId: string;
  currentUserId?: string;
  isManager: boolean;
}) {
  const queryClient = useQueryClient();
  const [rollResult, setRollResult] = useState<{
    rolls: { userId: string; username: string; rollValue: number }[];
    winner: { userId: string; username: string; rollValue: number };
  } | null>(null);
  const [showRolls, setShowRolls] = useState(false);

  const winner = item.assignments[0];
  const isAssigned = !!winner;

  const participantMap = new Map(session.participants.map((p) => [p.userId, p.username]));

  const rollMutation = useMutation({
    mutationFn: () => lootApi.rollStandalone(guildId, sessionId, item.id),
    onSuccess: (result) => { setRollResult(result); setShowRolls(true); onRolled(); },
  });

  const assignMutation = useMutation({
    mutationFn: (body: { userId: string; username: string; pickNumber?: number }) =>
      lootApi.assignStandalone(guildId, sessionId, item.id, body),
    onSuccess: onAssigned,
  });

  const clearMutation = useMutation({
    mutationFn: () => lootApi.clearAssignmentStandalone(guildId, sessionId, item.id),
    onSuccess: () => { setRollResult(null); setShowRolls(false); onAssigned(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => lootApi.deleteStandaloneItem(guildId, sessionId, item.id),
    onSuccess: onDelete,
  });

  // Add all unassigned instances of the same item name to the draft queue at once,
  // so the preference persists until every copy is claimed (requirement 3).
  const addToQueueMutation = useMutation({
    mutationFn: async () => {
      const sameNameIds = session.items
        .filter((i) => i.name === item.name && i.assignments.length === 0)
        .map((i) => i.id);
      const currentQueue = queryClient.getQueryData<LootQueueItemDto[]>(
        ['loot-queue-standalone', guildId, sessionId],
      ) ?? [];
      const alreadyQueued = new Set(currentQueue.map((q) => q.itemId));
      const toAdd = sameNameIds.filter((id) => !alreadyQueued.has(id));
      if (toAdd.length === 0) return;
      await lootApi.setQueueStandalone(guildId, sessionId, [...currentQueue.map((q) => q.itemId), ...toAdd]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loot-queue-standalone', guildId, sessionId] }),
  });

  const nextPicker = session.method === 'SNAKE_DRAFT'
    ? snakePick(allAssignmentCount + skipCount, session.draftOrder)
    : null;
  const nextPickerUsername = nextPicker ? (participantMap.get(nextPicker) ?? nextPicker) : null;
  const isMyTurn = session.method === 'SNAKE_DRAFT' && !isAssigned && nextPicker !== null;

  // Whether this user is in the draft order (not necessarily the current picker).
  const isDraftParticipant = session.draftOrder.includes(currentUserId ?? '');
  // Is this user the current picker?
  const isCurrentPicker = nextPicker === currentUserId;

  // Check if all same-name unassigned instances are already in the queue.
  const currentQueueData = queryClient.getQueryData<LootQueueItemDto[]>(
    ['loot-queue-standalone', guildId, sessionId],
  ) ?? [];
  const queuedIds = new Set(currentQueueData.map((q) => q.itemId));
  const sameNameUnassigned = session.items.filter((i) => i.name === item.name && i.assignments.length === 0);
  const allInQueue = sameNameUnassigned.length > 0 && sameNameUnassigned.every((i) => queuedIds.has(i.id));

  return (
    <div className={`rounded-lg border ${isAssigned ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium truncate">
            {item.name}
            {item.qualityLevel !== null && <span className="ml-1.5 text-xs text-muted-foreground">QL {item.qualityLevel}</span>}
            {item.quantity > 1 && <span className="ml-1 text-muted-foreground text-sm">×{item.quantity}</span>}
          </p>
          {isAssigned ? (
            <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {resolveUsername(winner.userId, winner.username || participantMap.get(winner.userId) || winner.userId, currentUserId)}
              {winner.rollValue != null && <span className="text-muted-foreground"> (rolled {winner.rollValue})</span>}
              {winner.pickNumber != null && <span className="text-muted-foreground"> (pick #{winner.pickNumber + 1})</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">Unassigned</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ItemInfoPopover name={item.name} />
          {isManager && (
            <>
              {isAssigned && (
                <Button size="sm" variant="ghost" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} title="Clear assignment">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} title="Delete item">
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Random roll */}
      {isManager && session.method === 'RANDOM_ROLL' && !isAssigned && (
        <Button size="sm" onClick={() => rollMutation.mutate()} disabled={rollMutation.isPending}>
          🎲 {rollMutation.isPending ? 'Rolling…' : 'Roll Now'}
        </Button>
      )}

      {/* Roll results */}
      {rollResult && showRolls && (
        <div className="rounded-md bg-muted/50 border border-border p-3 space-y-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Roll Results</p>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowRolls(false)}>Hide</button>
          </div>
          {rollResult.rolls.map((r) => (
            <div key={r.userId} className={`flex items-center justify-between text-sm px-2 py-1 rounded ${r.userId === rollResult.winner.userId ? 'bg-primary/10 font-medium' : ''}`}>
              <span>{resolveUsername(r.userId, r.username, currentUserId)} {r.userId === rollResult.winner.userId && '🏆'}</span>
              <span className="font-mono">{r.rollValue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Snake draft — only render interactive controls for managers and draft participants */}
      {session.method === 'SNAKE_DRAFT' && (isManager || isDraftParticipant) && (
        <>
          {/* Manager/current-picker: award / pick button */}
          {isMyTurn && (isManager || isCurrentPicker) && (
            <div className="flex items-center gap-2">
              {isManager && (
                <span className="text-sm text-muted-foreground">
                  Pick for <span className="font-medium text-foreground">{nextPickerUsername}</span>:
                </span>
              )}
              <Button
                size="sm"
                onClick={() => assignMutation.mutate({ userId: nextPicker!, username: nextPickerUsername!, pickNumber: allAssignmentCount })}
                disabled={assignMutation.isPending}
              >
                {isManager ? 'Award' : 'Pick This Item'}
              </Button>
            </div>
          )}

          {/* Participant (non-manager), not their turn: add to draft board */}
          {!isAssigned && !isManager && isDraftParticipant && !isCurrentPicker && session.draftStarted && session.status === 'OPEN' && (
            <Button
              size="sm"
              variant={allInQueue ? 'ghost' : 'outline'}
              className={allInQueue ? 'text-muted-foreground cursor-default' : 'gap-1'}
              onClick={() => !allInQueue && addToQueueMutation.mutate()}
              disabled={addToQueueMutation.isPending || allInQueue}
            >
              {allInQueue ? '✓ On Board' : <><Plus className="h-3 w-3" />Draft Board</>}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ── Draft queue card ──────────────────────────────────────────────────────────

function StandaloneQueueCard({ session, guildId, sessionId }: { session: LootSessionDto; guildId: string; sessionId: string }) {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['loot-queue-standalone', guildId, sessionId],
    queryFn: () => lootApi.getQueueStandalone(guildId, sessionId),
    refetchInterval: 4000,
  });

  const [localIds, setLocalIds] = useState<string[]>([]);
  const isDraggingRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isDraggingRef.current) return;
    setLocalIds((queueQuery.data ?? []).map((q) => q.itemId));
  }, [queueQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) => lootApi.setQueueStandalone(guildId, sessionId, ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['loot-queue-standalone', guildId, sessionId] }),
  });

  const byItemId = new Map<string, LootQueueItemDto>((queueQuery.data ?? []).map((q) => [q.itemId, q]));
  const inQueueIds = new Set(localIds);

  // Names already represented in the queue — used to hide duplicates from the add list.
  const queuedNames = new Set(
    localIds.map((id) => {
      const e = byItemId.get(id);
      const si = session.items.find((i) => i.id === id);
      return e?.itemName ?? si?.name ?? id;
    }),
  );
  // Only show items whose name isn't represented in the queue at all.
  const addable = session.items.filter(
    (i) => i.assignments.length === 0 && !inQueueIds.has(i.id) && !queuedNames.has(i.name),
  );

  function addItem(itemId: string) { const next = [...localIds, itemId]; setLocalIds(next); saveMutation.mutate(next); }
  function removeItem(itemId: string) { const next = localIds.filter((id) => id !== itemId); setLocalIds(next); saveMutation.mutate(next); }

  function onDragStart(index: number) { isDraggingRef.current = true; dragIndexRef.current = index; }
  function onDragOver(e: React.DragEvent, index: number) { e.preventDefault(); setDragOverIndex(index); }
  function onDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === dropIndex) return;
    const next = [...localIds];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved!);
    setLocalIds(next);
    saveMutation.mutate(next);
  }
  function onDragEnd() { isDraggingRef.current = false; dragIndexRef.current = null; setDragOverIndex(null); }

  const isCompleted = session.status === 'COMPLETED';

  return (
    <Card className="w-72 shrink-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          My Draft Queue
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {isCompleted ? 'Draft complete.' : 'Your top available item will be auto-picked on your turn.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-1 pb-3">
        {localIds.length === 0 && <p className="text-xs text-muted-foreground italic py-1">No items queued yet.</p>}

        {localIds.map((itemId, index) => {
          const entry = byItemId.get(itemId);
          const sessionItem = session.items.find((i) => i.id === itemId);
          const name = entry?.itemName ?? sessionItem?.name ?? itemId;
          const assigned = entry?.assigned ?? (sessionItem?.assignments.length ?? 0) > 0;
          const isDragTarget = dragOverIndex === index;

          // Count how many same-name items exist in the queue and show ×N on the first occurrence.
          const getName = (id: string) => {
            const e = byItemId.get(id); const si = session.items.find((i) => i.id === id);
            return e?.itemName ?? si?.name ?? id;
          };
          const sameNameCount = localIds.filter((id) => getName(id) === name).length;
          const isFirstOfName = localIds.findIndex((id) => getName(id) === name) === index;

          return (
            <div
              key={itemId}
              draggable={!isCompleted}
              onDragStart={() => onDragStart(index)}
              onDragOver={(e) => onDragOver(e, index)}
              onDrop={(e) => onDrop(e, index)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors
                ${assigned ? 'opacity-40 line-through border-border/50 bg-muted/30' : 'border-border bg-card'}
                ${isDragTarget ? 'border-primary bg-primary/5' : ''}
                ${!isCompleted ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {!isCompleted && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">{index + 1}.</span>
              <span className="flex-1 min-w-0 truncate">{name}</span>
              {sameNameCount > 1 && isFirstOfName && (
                <span className="text-[10px] font-semibold text-primary/70 shrink-0">×{sameNameCount}</span>
              )}
              {!isCompleted && (
                <button type="button" onClick={() => removeItem(itemId)} className="shrink-0 text-muted-foreground hover:text-destructive transition-colors" title="Remove from queue">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        {!isCompleted && addable.length > 0 && (
          <div className="pt-1">
            <p className="text-xs font-medium text-muted-foreground mb-1">Add to queue</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {addable.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addItem(item.id)}
                  className="w-full flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors text-left"
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Participants panel ────────────────────────────────────────────────────────

function ParticipantsPanel({
  session,
  guildId,
  sessionId,
  isManager,
  onUpdated,
}: {
  session: LootSessionDto;
  guildId: string;
  sessionId: string;
  isManager: boolean;
  onUpdated: () => void;
}) {
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownListRef = useRef<HTMLDivElement>(null);

  const playersQuery = useQuery({
    queryKey: ['players', guildId],
    queryFn: () => lootApi.getPlayers(guildId),
    enabled: isManager,
    staleTime: 5 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: (participants: LootParticipant[]) =>
      lootApi.updateStandaloneSession(guildId, sessionId, { participants }),
    onSuccess: onUpdated,
  });

  useEffect(() => {
    if (!dropdownOpen) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const existingIds = new Set(session.participants.map((p) => p.userId));
  const filtered = (playersQuery.data ?? [])
    .filter((p) => !existingIds.has(p.userId))
    .filter((p) => !search || p.username.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 12);

  useEffect(() => { setHighlight(-1); }, [search]);

  function addParticipant(player: { userId: string; username: string }) {
    updateMutation.mutate([...session.participants, { userId: player.userId, username: player.username }]);
    setSearch('');
    setHighlight(-1);
    setDropdownOpen(false);
  }

  function removeParticipant(userId: string) {
    updateMutation.mutate(session.participants.filter((p) => p.userId !== userId));
  }

  const canEdit = isManager && session.status === 'OPEN' && !session.draftStarted;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          Participants ({session.participants.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {session.participants.length === 0 && (
            <p className="text-sm text-muted-foreground italic">No participants yet.</p>
          )}
          {session.participants.map((p) => (
            <span
              key={p.userId}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {p.username}
              {canEdit && (
                <button
                  type="button"
                  className="ml-1 opacity-50 hover:opacity-100 leading-none hover:text-destructive"
                  onClick={() => removeParticipant(p.userId)}
                  title={`Remove ${p.username}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>

        {canEdit && (
          <div className="relative" ref={dropdownRef}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setDropdownOpen(true); }}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={(e) => {
                  if (!dropdownOpen || filtered.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = Math.min(highlight + 1, filtered.length - 1);
                    setHighlight(next);
                    (dropdownListRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const next = Math.max(highlight - 1, 0);
                    setHighlight(next);
                    (dropdownListRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                  } else if (e.key === 'Enter' && highlight >= 0) {
                    e.preventDefault();
                    const p = filtered[highlight];
                    if (p) addParticipant(p);
                  } else if (e.key === 'Escape') {
                    setDropdownOpen(false);
                    setHighlight(-1);
                  }
                }}
                placeholder="Search server members…"
                className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {dropdownOpen && filtered.length > 0 && (
              <div ref={dropdownListRef} className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-lg max-h-48 overflow-y-auto">
                {filtered.map((p, i) => (
                  <button
                    key={p.userId}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addParticipant(p); }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${i === highlight ? 'bg-accent' : 'hover:bg-accent'}`}
                  >
                    <span className="flex-1 truncate">{p.username}</span>
                  </button>
                ))}
              </div>
            )}

            {dropdownOpen && search.length > 0 && filtered.length === 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-card p-3 shadow text-xs text-muted-foreground">
                No matching members found.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StandaloneLootSessionPage() {
  const { guildId, sessionId } = useParams<{ guildId: string; sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, guilds } = useAuth();

  const [newItemName, setNewItemName] = useState('');
  const [newItemQl, setNewItemQl] = useState('');
  const [newItemCount, setNewItemCount] = useState('1');
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const suggestListRef = useRef<HTMLDivElement>(null);
  const [suggestHighlight, setSuggestHighlight] = useState(-1);
  const [hideAssigned, setHideAssigned] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [startConfirm, setStartConfirm] = useState(false);
  const [completeConfirm, setCompleteConfirm] = useState(false);
  const [newItemInputFocused, setNewItemInputFocused] = useState(false);
  const debouncedNewItem = useDebounce(newItemName, 250);

  const isManager = guilds.some((g) => g.id === guildId);

  const sessionQuery = useQuery({
    queryKey: ['loot-standalone', guildId, sessionId],
    queryFn: () => lootApi.getStandaloneSession(guildId!, sessionId!),
    enabled: !!guildId && !!sessionId,
    refetchInterval: 4000,
  });

  const session = sessionQuery.data;
  const isOwner = !!session?.ownerId && session.ownerId === user?.id;
  const canManage = isManager || isOwner;
  const participantMap = new Map((session?.participants ?? []).map((p) => [p.userId, p.username]));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['loot-standalone', guildId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['loot-queue-standalone', guildId, sessionId] });
    queryClient.invalidateQueries({ queryKey: ['loot-sessions', guildId] });
  };

  const updateMutation = useMutation({
    mutationFn: (body: { method?: LootMethod; draftOrder?: string[]; totalRounds?: number }) =>
      lootApi.updateStandaloneSession(guildId!, sessionId!, body),
    onSuccess: invalidate,
  });

  const addItemMutation = useMutation({
    mutationFn: ({ name, qualityLevel, quantity }: { name: string; qualityLevel: number | null; quantity: number }) =>
      lootApi.addStandaloneItem(guildId!, sessionId!, { name, qualityLevel, quantity }),
    onSuccess: () => {
      setNewItemName('');
      setNewItemQl('');
      setNewItemCount('1');
      invalidate();
      setTimeout(() => newItemInputRef.current?.focus(), 0);
    },
  });

  const commodityRollMutation = useMutation({
    mutationFn: () => lootApi.commodityRollStandalone(guildId!, sessionId!),
    onSuccess: invalidate,
  });

  const toggleDeliveredMutation = useMutation({
    mutationFn: (assignmentId: string) => lootApi.toggleDeliveredStandalone(guildId!, sessionId!, assignmentId),
    onSuccess: invalidate,
  });

  const completeMutation = useMutation({
    mutationFn: () => lootApi.completeStandalone(guildId!, sessionId!),
    onSuccess: () => { setCompleteConfirm(false); navigate(`/dashboard/servers/${guildId}/loot?tab=history`); },
    onError: () => setCompleteConfirm(false),
  });

  const skipMutation = useMutation({
    mutationFn: () => lootApi.skipTurnStandalone(guildId!, sessionId!),
    onSuccess: () => { setSkipConfirm(false); invalidate(); },
    onError: () => setSkipConfirm(false),
  });

  const startDraftMutation = useMutation({
    mutationFn: () => lootApi.startDraftStandalone(guildId!, sessionId!),
    onSuccess: () => { setStartConfirm(false); invalidate(); },
    onError: () => setStartConfirm(false),
  });

  const suggestQuery = useQuery({
    queryKey: ['uex-suggest-standalone', debouncedNewItem, isCommodityDraft],
    queryFn: async () => {
      const seen = new Set<string>();
      const results: { id: number; name: string; detail: string; type: 'item' | 'commodity' }[] = [];
      if (isCommodityDraft) {
        const commodities = await uexApi.getCommodities({ q: debouncedNewItem, limit: 12 });
        for (const c of commodities) {
          const lc = c.name.toLowerCase();
          if (!seen.has(lc)) { seen.add(lc); results.push({ id: c.id, name: c.name, detail: c.code || '', type: 'commodity' }); }
        }
      } else {
        const [items, commodities] = await Promise.all([
          uexApi.getItems({ q: debouncedNewItem, limit: 8 }),
          uexApi.getCommodities({ q: debouncedNewItem, limit: 4 }),
        ]);
        for (const i of items) {
          const lc = i.name.toLowerCase();
          if (!seen.has(lc)) { seen.add(lc); results.push({ id: i.id, name: i.name, detail: i.categoryName || i.section || '', type: 'item' }); }
        }
        for (const c of commodities) {
          const lc = c.name.toLowerCase();
          if (!seen.has(lc)) { seen.add(lc); results.push({ id: c.id, name: c.name, detail: c.code || '', type: 'commodity' }); }
        }
      }
      return results;
    },
    enabled: debouncedNewItem.length >= 3,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => { setSuggestHighlight(-1); }, [suggestQuery.data]);

  function handleShuffle() {
    if (!session) return;
    const allIds = session.participants.map((p) => p.userId);
    const shuffled = [...allIds].sort(() => Math.random() - 0.5);
    updateMutation.mutate({ draftOrder: shuffled });
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-2xl space-y-4">
        <button onClick={() => navigate(`/dashboard/servers/${guildId}/loot`)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Loot
        </button>
        <p className="text-sm text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const allAssignmentCount = session.items.reduce((n, item) => n + item.assignments.length, 0);
  const skipCount = session.skipCount ?? 0;
  const nextPickerId = session.method === 'SNAKE_DRAFT' ? snakePick(allAssignmentCount + skipCount, session.draftOrder) : null;
  const nextPickerUsername = nextPickerId ? (participantMap.get(nextPickerId) ?? nextPickerId) : null;

  const isSnakeDraft = session.method === 'SNAKE_DRAFT';
  const isCommodityDraft = session.method === 'COMMODITY_DRAFT';
  const isDraftParticipant = isSnakeDraft && session.draftOrder.includes(user?.id ?? '');
  const isCurrentPicker = isSnakeDraft && session.status === 'OPEN' && nextPickerId === user?.id;

  // Owners and managers (or draft participants) can interact with the session
  const canInteract = canManage || isDraftParticipant;

  // All participants not yet in draft order
  const draftSet = new Set(session.draftOrder);
  const notInDraft = session.participants.filter((p) => !draftSet.has(p.userId));

  return (
    <div className={isSnakeDraft ? 'space-y-5' : 'max-w-2xl space-y-5'}>
      <button
        onClick={() => navigate(`/dashboard/servers/${guildId}/loot`)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Loot
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🎁 {session.name ?? 'Loot Session'}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs rounded-full border px-2 py-0.5 font-medium ${session.status === 'COMPLETED' ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400' : 'border-primary/30 bg-primary/10 text-primary'}`}>
              {session.status === 'COMPLETED' ? 'Completed' : 'Open'}
            </span>
            <span className="text-sm text-muted-foreground">{METHOD_LABELS[session.method]}</span>
          </div>
        </div>
      </div>

      <div className={isSnakeDraft ? 'flex flex-col lg:flex-row gap-5 items-start' : ''}>
        <div className={isSnakeDraft ? 'flex-1 min-w-0 space-y-5' : 'space-y-5'}>

          {/* Method selector — managers and owners, open sessions */}
          {canManage && session.status === 'OPEN' && (
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Method</label>
                  <div className="flex gap-2 flex-wrap">
                    {(['RANDOM_ROLL', 'SNAKE_DRAFT', 'COMMODITY_DRAFT'] as LootMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => updateMutation.mutate({ method: m })}
                        disabled={session.status === 'COMPLETED' || session.draftStarted}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${session.method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}
                      >
                        {METHOD_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Participants */}
          <ParticipantsPanel
            session={session}
            guildId={guildId!}
            sessionId={sessionId!}
            isManager={canManage}
            onUpdated={invalidate}
          />

          {/* Snake draft order */}
          {isSnakeDraft && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">🐍 Draft Order</CardTitle>
                    {session.draftStarted && session.draftOrder.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Round {Math.floor((allAssignmentCount + skipCount) / session.draftOrder.length) + 1} of {session.totalRounds}
                      </p>
                    )}
                  </div>
                  {canManage && session.status === 'OPEN' && !session.draftStarted && (
                    <div className="flex items-center gap-2">
                      {!startConfirm ? (
                        <>
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={handleShuffle} disabled={session.participants.length === 0}>
                            <Shuffle className="h-3 w-3" /> Shuffle
                          </Button>
                          <Button
                            size="sm"
                            className="gap-1 h-7 text-xs"
                            onClick={() => setStartConfirm(true)}
                            disabled={session.draftOrder.length === 0}
                          >
                            <Play className="h-3 w-3" /> Start Draft
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">Draft order is locked on start.</span>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => startDraftMutation.mutate()} disabled={startDraftMutation.isPending}>
                            {startDraftMutation.isPending ? 'Starting…' : 'Yes, Start'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStartConfirm(false)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {nextPickerUsername && session.status === 'OPEN' && canInteract && (
                  <div className="mb-3">
                    <div className="rounded-md bg-primary/10 border border-primary/30 px-3 py-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-primary">Now picking: {nextPickerUsername}</span>
                      {canManage && (!skipConfirm ? (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => setSkipConfirm(true)}>
                          <SkipForward className="h-3 w-3" /> Skip Turn
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">Skip {nextPickerUsername}?</span>
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => skipMutation.mutate()} disabled={skipMutation.isPending}>
                            {skipMutation.isPending ? 'Skipping…' : 'Yes, Skip'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSkipConfirm(false)}>Cancel</Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {session.draftOrder.map((userId, i) => {
                    const username = participantMap.get(userId) ?? userId;
                    const isCurrent = userId === nextPickerId;
                    const canRemove = canManage && session.status === 'OPEN' && !session.draftStarted;
                    return (
                      <span
                        key={userId}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border ${isCurrent ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                      >
                        {i + 1}. {username}
                        {canRemove && (
                          <button
                            type="button"
                            className="ml-1 opacity-50 hover:opacity-100 leading-none"
                            onClick={() => updateMutation.mutate({ draftOrder: session.draftOrder.filter((id) => id !== userId) })}
                            title={`Remove ${username}`}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {session.draftOrder.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No members in draft order yet.</p>
                  )}
                </div>
                {canManage && session.status === 'OPEN' && !session.draftStarted && notInDraft.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-2">Add participants to draft order:</p>
                    <div className="flex flex-wrap gap-2">
                      {notInDraft.map((p) => (
                        <button
                          key={p.userId}
                          type="button"
                          className="rounded-full px-3 py-1 text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                          onClick={() => updateMutation.mutate({ draftOrder: [...session.draftOrder, p.userId] })}
                        >
                          + {p.username}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rounds setting */}
                <div className="mt-3 pt-3 border-t border-border">
                  {canManage && !session.draftStarted ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">Rounds</span>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={session.totalRounds}
                          onChange={(e) => {
                            const v = Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1));
                            updateMutation.mutate({ totalRounds: v });
                          }}
                          className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Draft ends after {session.totalRounds} round{session.totalRounds !== 1 ? 's' : ''} ({session.draftOrder.length * session.totalRounds} total picks) or when all items are claimed.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {session.totalRounds} round{session.totalRounds !== 1 ? 's' : ''} · {session.draftOrder.length * session.totalRounds} total picks
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Commodity Draft — roll control */}
          {isCommodityDraft && canManage && session.status === 'OPEN' && (
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Package className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Commodity Draft</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Each item name becomes its own group. Items within a group are sorted by QL (highest first)
                      and distributed via a separate randomized snake draft. Requires at least one participant and one item.
                    </p>
                  </div>
                </div>
                {commodityRollMutation.isError && (
                  <p className="text-xs text-destructive">{(commodityRollMutation.error as Error)?.message ?? 'Failed to roll.'}</p>
                )}
                <Button
                  onClick={() => commodityRollMutation.mutate()}
                  disabled={commodityRollMutation.isPending || session.participants.length === 0 || session.items.length === 0}
                  className="gap-2"
                >
                  <Shuffle className="h-4 w-4" />
                  {session.draftStarted ? 'Re-roll Assignments' : 'Roll Assignments'}
                </Button>
                {session.draftStarted && (
                  <p className="text-xs text-muted-foreground">Assignments have been rolled. Re-rolling will clear all current assignments.</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Item list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
                Items ({session.items.length})
              </h2>
              <div className="flex items-center gap-3">
                {session.items.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {session.items.filter((i) => i.assignments.length > 0).length} / {session.items.length} assigned
                  </span>
                )}
                {session.items.some((i) => i.assignments.length > 0) && (
                  <button
                    type="button"
                    onClick={() => setHideAssigned((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                      hideAssigned ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    <EyeOff className="h-3 w-3" />
                    {hideAssigned ? 'Showing available' : 'Hide assigned'}
                  </button>
                )}
              </div>
            </div>

            {/* Add item */}
            {canManage && session.status === 'OPEN' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newItemName.trim()) return;
                  const ql = newItemQl.trim() ? parseInt(newItemQl.trim(), 10) : null;
                  const count = parseInt(newItemCount.trim() || '1', 10);
                  if (isCommodityDraft && (ql === null || isNaN(ql) || isNaN(count) || count < 1)) return;
                  addItemMutation.mutate({
                    name: newItemName.trim(),
                    qualityLevel: ql && !isNaN(ql) ? ql : null,
                    quantity: !isNaN(count) && count > 0 ? count : 1,
                  });
                }}
                className="flex gap-2 items-start"
              >
                <div className="relative flex-1 min-w-0">
                  <input
                    ref={newItemInputRef}
                    className={inputCls}
                    placeholder="Item name…"
                    value={newItemName}
                    onChange={(e) => { setNewItemName(e.target.value); setSuggestHighlight(-1); }}
                    onFocus={() => setNewItemInputFocused(true)}
                    onBlur={() => setNewItemInputFocused(false)}
                    onKeyDown={(e) => {
                      const items = suggestQuery.data ?? [];
                      if (!newItemInputFocused || items.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = Math.min(suggestHighlight + 1, items.length - 1);
                        setSuggestHighlight(next);
                        (suggestListRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const next = Math.max(suggestHighlight - 1, 0);
                        setSuggestHighlight(next);
                        (suggestListRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
                      } else if (e.key === 'Enter' && suggestHighlight >= 0) {
                        e.preventDefault();
                        const s = items[suggestHighlight];
                        if (s) { setNewItemName(s.name); setSuggestHighlight(-1); setNewItemInputFocused(false); }
                      } else if (e.key === 'Escape') {
                        setNewItemInputFocused(false);
                        setSuggestHighlight(-1);
                      }
                    }}
                    autoComplete="off"
                  />
                  {newItemInputFocused && newItemName.length >= 3 && (suggestQuery.data?.length ?? 0) > 0 && (
                    <div ref={suggestListRef} className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
                      {suggestQuery.data!.map((s, i) => (
                        <button
                          key={`${s.type}-${s.id}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setNewItemName(s.name);
                            setSuggestHighlight(-1);
                            setNewItemInputFocused(false);
                            newItemInputRef.current?.focus();
                          }}
                          onMouseEnter={() => setSuggestHighlight(i)}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${i === suggestHighlight ? 'bg-accent' : 'hover:bg-accent'}`}
                        >
                          <span className="flex-1 truncate">{s.name}</span>
                          {s.detail && <span className="text-xs text-muted-foreground shrink-0">{s.detail}</span>}
                          <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${s.type === 'item' ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500'}`}>
                            {s.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {isCommodityDraft && (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      className="w-16 shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring text-center"
                      placeholder="QL"
                      value={newItemQl}
                      onChange={(e) => setNewItemQl(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      title="Quality Level (required)"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      className="w-16 shrink-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring text-center"
                      placeholder="Ct."
                      value={newItemCount}
                      onChange={(e) => setNewItemCount(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      title="Count — number of copies to distribute"
                    />
                  </>
                )}
                <Button
                  type="submit"
                  disabled={
                    !newItemName.trim() ||
                    addItemMutation.isPending ||
                    (isCommodityDraft && (!newItemQl.trim() || !newItemCount.trim()))
                  }
                  className="shrink-0 gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </form>
            )}

            {[...session.items]
              .sort((a, b) => {
                const aA = a.assignments.length > 0 ? 1 : 0;
                const bA = b.assignments.length > 0 ? 1 : 0;
                if (aA !== bA) return aA - bA;
                return a.sortOrder - b.sortOrder;
              })
              .filter((item) => !hideAssigned || item.assignments.length === 0)
              .map((item) => (
                <StandaloneItemRow
                  key={item.id}
                  item={item}
                  session={session}
                  allAssignmentCount={allAssignmentCount}
                  skipCount={skipCount}
                  onRolled={invalidate}
                  onAssigned={invalidate}
                  onDelete={invalidate}
                  guildId={guildId!}
                  sessionId={sessionId!}
                  currentUserId={user?.id}
                  isManager={canManage}
                />
              ))}

            {session.items.length === 0 && (
              <p className="text-sm text-muted-foreground italic py-2">No items yet. Add an item above to start distributing loot.</p>
            )}
          </div>

          {/* Commodity Draft — distribution summary */}
          {isCommodityDraft && session.draftStarted && (() => {
            type Bucket = { username: string; items: { item: typeof session.items[0]; assignment: typeof session.items[0]['assignments'][0] }[] };
            const buckets = new Map<string, Bucket>();
            for (const item of session.items) {
              for (const a of item.assignments) {
                if (!buckets.has(a.userId)) buckets.set(a.userId, { username: a.username, items: [] });
                buckets.get(a.userId)!.items.push({ item, assignment: a });
              }
            }
            for (const b of buckets.values()) {
              b.items.sort((x, y) => {
                if (x.item.name !== y.item.name) return x.item.name.localeCompare(y.item.name);
                return (y.item.qualityLevel ?? -1) - (x.item.qualityLevel ?? -1);
              });
            }
            const entries = [...buckets.entries()];
            const allDelivered = entries.every(([, b]) => b.items.every((e) => e.assignment.delivered));
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">Distribution</h2>
                  {allDelivered && <span className="text-xs text-green-500 font-medium">All delivered</span>}
                </div>
                {entries.map(([userId, bucket]) => {
                  const allMemberDelivered = bucket.items.every((e) => e.assignment.delivered);
                  return (
                    <Card key={userId} className={allMemberDelivered ? 'opacity-60' : ''}>
                      <CardHeader className="pb-2 pt-3 px-4">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-semibold">{bucket.username}</CardTitle>
                          {allMemberDelivered && (
                            <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle2 className="h-3.5 w-3.5" /> Delivered</span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="px-4 pb-3 space-y-1.5">
                        {bucket.items.map(({ item, assignment }) => (
                          <div key={assignment.id} className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {assignment.delivered
                                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                                : <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                              <span className={`text-sm truncate ${assignment.delivered ? 'line-through text-muted-foreground' : ''}`}>
                                {item.name}{item.qualityLevel !== null ? <span className="ml-1.5 text-xs text-muted-foreground">QL {item.qualityLevel}</span> : null}
                              </span>
                            </div>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => toggleDeliveredMutation.mutate(assignment.id)}
                                disabled={toggleDeliveredMutation.isPending}
                                className={`shrink-0 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                                  assignment.delivered
                                    ? 'border-green-500/40 bg-green-500/10 text-green-600 hover:bg-green-500/20'
                                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                                }`}
                              >
                                <Truck className="h-3 w-3" />
                                {assignment.delivered ? 'Delivered' : 'Mark Delivered'}
                              </button>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })()}

          {/* Complete */}
          {canManage && session.status === 'OPEN' && (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => navigate(`/dashboard/servers/${guildId}/loot`)} className="gap-1">
                <Save className="h-4 w-4" />
                Save & Exit
              </Button>
              {(session.draftStarted || session.items.some((i) => i.assignments.length > 0)) && (
                completeConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Completing will close and lock loot distribution.</span>
                    <Button
                      variant="destructive"
                      onClick={() => completeMutation.mutate()}
                      disabled={completeMutation.isPending}
                      className="gap-1 shrink-0"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {completeMutation.isPending ? 'Completing…' : 'Yes, Complete'}
                    </Button>
                    <Button variant="ghost" className="shrink-0" onClick={() => setCompleteConfirm(false)}>Cancel</Button>
                  </div>
                ) : (
                  <Button onClick={() => setCompleteConfirm(true)} className="gap-1">
                    <CheckCircle2 className="h-4 w-4" />
                    Complete Session
                  </Button>
                )
              )}
            </div>
          )}

          {session.status === 'COMPLETED' && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Loot session completed.
            </div>
          )}
        </div>

        {/* Queue card — only shown to draft participants (now that Discord IDs are real) */}
        {isSnakeDraft && (canManage || isDraftParticipant) && (
          <div className="lg:sticky lg:top-4 lg:self-start lg:w-72">
            <StandaloneQueueCard session={session} guildId={guildId!} sessionId={sessionId!} />
          </div>
        )}
      </div>
    </div>
  );
}
