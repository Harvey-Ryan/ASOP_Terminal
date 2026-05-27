import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { kanbanApi } from '@/api/kanban';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { KanbanColumnDto, KanbanCardDto } from '@dem/shared';

const ADMIN_ID = '1135606224155586571';

const COLORS: { key: string; label: string; header: string; border: string; badge: string }[] = [
  { key: 'slate',  label: 'Default', header: 'text-slate-400',  border: 'border-slate-500/40',  badge: 'bg-slate-500/20 text-slate-300' },
  { key: 'blue',   label: 'Blue',    header: 'text-blue-400',   border: 'border-blue-500/40',   badge: 'bg-blue-500/20 text-blue-300' },
  { key: 'green',  label: 'Green',   header: 'text-green-400',  border: 'border-green-500/40',  badge: 'bg-green-500/20 text-green-300' },
  { key: 'yellow', label: 'Yellow',  header: 'text-yellow-400', border: 'border-yellow-500/40', badge: 'bg-yellow-500/20 text-yellow-300' },
  { key: 'red',    label: 'Red',     header: 'text-red-400',    border: 'border-red-500/40',    badge: 'bg-red-500/20 text-red-300' },
  { key: 'purple', label: 'Purple',  header: 'text-purple-400', border: 'border-purple-500/40', badge: 'bg-purple-500/20 text-purple-300' },
  { key: 'orange', label: 'Orange',  header: 'text-orange-400', border: 'border-orange-500/40', badge: 'bg-orange-500/20 text-orange-300' },
];

function colorMeta(key: string) {
  return COLORS.find((c) => c.key === key) ?? COLORS[0]!;
}

// ── Inline text input ─────────────────────────────────────────────────────────

function InlineInput({
  value,
  onSave,
  onCancel,
  placeholder,
  multiline,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [val, setVal] = useState(value);
  const base = cn(
    'w-full rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring',
    className,
  );
  return (
    <div className="space-y-1.5">
      {multiline ? (
        <textarea
          autoFocus
          rows={3}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder}
          className={cn(base, 'resize-none')}
        />
      ) : (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onSave(val.trim()); }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={placeholder}
          className={base}
        />
      )}
      <div className="flex gap-1.5">
        <button onClick={() => onSave(val.trim())} className="text-green-500 hover:text-green-400">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Kanban card ───────────────────────────────────────────────────────────────

function KanbanCardItem({
  card,
  columns,
  isAdmin,
  isFirst,
  isLast,
}: {
  card: KanbanCardDto;
  columns: KanbanColumnDto[];
  isAdmin: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [editDesc, setEditDesc] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kanban'] });

  const updateMut = useMutation({
    mutationFn: (patch: Parameters<typeof kanbanApi.updateCard>[1]) => kanbanApi.updateCard(card.id, patch),
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: () => kanbanApi.deleteCard(card.id),
    onSuccess: invalidate,
  });

  const otherColumns = columns.filter((c) => c.id !== card.columnId);

  return (
    <div className={cn('group rounded-md border border-border bg-background p-3 space-y-1.5', editing && 'ring-1 ring-ring')}>
      {/* Title */}
      {editTitle ? (
        <InlineInput
          value={card.title}
          placeholder="Card title"
          onSave={(v) => { if (v) updateMut.mutate({ title: v }); setEditTitle(false); }}
          onCancel={() => setEditTitle(false)}
        />
      ) : (
        <p className="text-sm font-medium leading-snug">{card.title}</p>
      )}

      {/* Description */}
      {editDesc ? (
        <InlineInput
          value={card.description ?? ''}
          placeholder="Description (optional)"
          multiline
          onSave={(v) => { updateMut.mutate({ description: v || null }); setEditDesc(false); }}
          onCancel={() => setEditDesc(false)}
        />
      ) : card.description ? (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{card.description}</p>
      ) : null}

      {/* Admin controls */}
      {isAdmin && (
        <div className={cn('flex flex-wrap items-center gap-1.5 pt-0.5', !editing && 'opacity-0 group-hover:opacity-100 transition-opacity')}>
          <button
            onClick={() => setEditing((e) => !e)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Pencil className="h-3 w-3" />
          </button>

          {editing && (
            <>
              <button onClick={() => { setEditTitle(true); setEditing(false); }} className="text-xs text-muted-foreground hover:text-foreground">
                Edit title
              </button>
              <button onClick={() => { setEditDesc(true); setEditing(false); }} className="text-xs text-muted-foreground hover:text-foreground">
                Edit desc
              </button>

              {/* Move within column */}
              {!isFirst && (
                <button
                  onClick={() => updateMut.mutate({ sortOrder: card.sortOrder - 1 })}
                  className="text-muted-foreground hover:text-foreground"
                  title="Move up"
                >
                  <ChevronLeft className="h-3.5 w-3.5 -rotate-90" />
                </button>
              )}
              {!isLast && (
                <button
                  onClick={() => updateMut.mutate({ sortOrder: card.sortOrder + 1 })}
                  className="text-muted-foreground hover:text-foreground"
                  title="Move down"
                >
                  <ChevronRight className="h-3.5 w-3.5 -rotate-90" />
                </button>
              )}

              {/* Move to column */}
              {otherColumns.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { updateMut.mutate({ columnId: e.target.value, sortOrder: 9999 }); setEditing(false); } }}
                  className="text-xs rounded border border-input bg-background px-1 py-0.5 text-muted-foreground outline-none"
                >
                  <option value="" disabled>Move to…</option>
                  {otherColumns.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              )}

              <button
                onClick={() => deleteMut.mutate()}
                disabled={deleteMut.isPending}
                className="ml-auto text-destructive hover:text-destructive/80"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Kanban column ─────────────────────────────────────────────────────────────

function KanbanColumnView({
  column,
  columns,
  isAdmin,
  isFirst,
  isLast,
}: {
  column: KanbanColumnDto;
  columns: KanbanColumnDto[];
  isAdmin: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const qc = useQueryClient();
  const meta = colorMeta(column.color);
  const [addingCard, setAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [newCardDesc, setNewCardDesc] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingColor, setEditingColor] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['kanban'] });

  const updateColMut = useMutation({
    mutationFn: (patch: Parameters<typeof kanbanApi.updateColumn>[1]) => kanbanApi.updateColumn(column.id, patch),
    onSuccess: invalidate,
  });

  const deleteColMut = useMutation({
    mutationFn: () => kanbanApi.deleteColumn(column.id),
    onSuccess: invalidate,
  });

  const addCardMut = useMutation({
    mutationFn: () => kanbanApi.createCard(column.id, newCardTitle.trim(), newCardDesc.trim() || undefined),
    onSuccess: () => { invalidate(); setAddingCard(false); setNewCardTitle(''); setNewCardDesc(''); },
  });

  const moveColMut = useMutation({
    mutationFn: (dir: -1 | 1) => kanbanApi.updateColumn(column.id, { sortOrder: column.sortOrder + dir }),
    onSuccess: invalidate,
  });

  return (
    <div className={cn('flex w-72 shrink-0 flex-col rounded-lg border bg-card', meta.border)}>
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        {editingTitle ? (
          <InlineInput
            value={column.title}
            onSave={(v) => { if (v) updateColMut.mutate({ title: v }); setEditingTitle(false); }}
            onCancel={() => setEditingTitle(false)}
            className="flex-1"
          />
        ) : (
          <>
            <span className={cn('flex-1 text-sm font-semibold truncate', meta.header)}>{column.title}</span>
            <span className={cn('rounded-full px-1.5 py-0.5 text-xs tabular-nums', meta.badge)}>
              {column.cards.length}
            </span>
          </>
        )}

        {isAdmin && !editingTitle && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isFirst && (
              <button onClick={() => moveColMut.mutate(-1)} className="text-muted-foreground hover:text-foreground" title="Move left">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}
            {!isLast && (
              <button onClick={() => moveColMut.mutate(1)} className="text-muted-foreground hover:text-foreground" title="Move right">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => setEditingTitle(true)} className="text-muted-foreground hover:text-foreground">
              <Pencil className="h-3 w-3" />
            </button>
            <button onClick={() => setEditingColor((v) => !v)} className="text-muted-foreground hover:text-foreground text-xs">
              ●
            </button>
            <button
              onClick={() => deleteColMut.mutate()}
              disabled={deleteColMut.isPending}
              className="text-destructive hover:text-destructive/80"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* Color picker */}
      {editingColor && isAdmin && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => { updateColMut.mutate({ color: c.key }); setEditingColor(false); }}
              className={cn('h-5 w-5 rounded-full border-2 transition-opacity hover:opacity-80', c.header, column.color === c.key ? 'border-foreground' : 'border-transparent')}
              title={c.label}
            >
              <span className="sr-only">{c.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-3 space-y-2 pb-2 group">
        {column.cards.map((card, i) => (
          <KanbanCardItem
            key={card.id}
            card={card}
            columns={columns}
            isAdmin={isAdmin}
            isFirst={i === 0}
            isLast={i === column.cards.length - 1}
          />
        ))}
      </div>

      {/* Add card */}
      {isAdmin && (
        <div className="px-3 pb-3 pt-1">
          {addingCard ? (
            <div className="space-y-2 rounded-md border border-border bg-background p-2">
              <input
                autoFocus
                value={newCardTitle}
                onChange={(e) => setNewCardTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setAddingCard(false); setNewCardTitle(''); setNewCardDesc(''); } }}
                placeholder="Card title"
                className="w-full rounded border border-input bg-card px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <textarea
                rows={2}
                value={newCardDesc}
                onChange={(e) => setNewCardDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full resize-none rounded border border-input bg-card px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => addCardMut.mutate()} disabled={!newCardTitle.trim() || addCardMut.isPending}>
                  {addCardMut.isPending ? 'Adding…' : 'Add'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAddingCard(false); setNewCardTitle(''); setNewCardDesc(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingCard(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add card
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function KanbanPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.id === ADMIN_ID;

  const { data: columns = [], isLoading } = useQuery({
    queryKey: ['kanban'],
    queryFn: () => kanbanApi.getBoard(),
  });

  const [addingCol, setAddingCol] = useState(false);
  const [newColTitle, setNewColTitle] = useState('');
  const [newColColor, setNewColColor] = useState('slate');

  const addColMut = useMutation({
    mutationFn: () => kanbanApi.createColumn(newColTitle.trim(), newColColor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban'] });
      setAddingCol(false);
      setNewColTitle('');
      setNewColColor('slate');
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Development Milestones</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track features and improvements to ASOP Terminal.
            {!isAdmin && <span className="ml-1">View only.</span>}
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setAddingCol(true)} disabled={addingCol}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Column
          </Button>
        )}
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-72 shrink-0 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1 items-start">
          {columns.length === 0 && !addingCol && (
            <div className="flex-1 flex items-center justify-center py-24">
              <p className="text-sm text-muted-foreground">
                {isAdmin ? 'No columns yet. Add one to get started.' : 'No milestones yet.'}
              </p>
            </div>
          )}

          {columns.map((col, i) => (
            <KanbanColumnView
              key={col.id}
              column={col}
              columns={columns}
              isAdmin={isAdmin}
              isFirst={i === 0}
              isLast={i === columns.length - 1}
            />
          ))}

          {/* Add column inline form */}
          {isAdmin && addingCol && (
            <Card className="w-72 shrink-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">New Column</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <input
                  autoFocus
                  value={newColTitle}
                  onChange={(e) => setNewColTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newColTitle.trim()) addColMut.mutate();
                    if (e.key === 'Escape') { setAddingCol(false); setNewColTitle(''); }
                  }}
                  placeholder="Column title"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Color</p>
                  <div className="flex flex-wrap gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c.key}
                        onClick={() => setNewColColor(c.key)}
                        className={cn('h-5 w-5 rounded-full border-2 transition-opacity hover:opacity-80', c.header, newColColor === c.key ? 'border-foreground' : 'border-transparent')}
                        title={c.label}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => addColMut.mutate()} disabled={!newColTitle.trim() || addColMut.isPending}>
                    {addColMut.isPending ? 'Adding…' : 'Add Column'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAddingCol(false); setNewColTitle(''); }}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
