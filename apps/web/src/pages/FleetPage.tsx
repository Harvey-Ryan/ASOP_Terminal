// Fleet (v1.32.0). One fleet per person, shown in every ASOP server they're in.
// /dashboard/servers/:guildId/fleet: the server's fleet by role, and yours.
// /dashboard/fleet: yours only (linked from the bot's /fleet and check-in DM).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Eye, EyeOff, FileUp, Minus, Plus, Rocket, Search, Trash2, Users,
} from 'lucide-react';
import {
  searchShips, shipRoleGroup, SHIP_ROLE_GROUPS, SHIP_SOURCES, FLEET_CHECK_DAYS,
  type ShipCatalogEntry, type FleetShipDto, type MyFleetDto, type FleetImportPreviewLine, type ShipSource, type GuildFleetShipDto,
} from '@dem/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fleetApi } from '@/api/fleet';
import { ApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const MY_FLEET = ['my-fleet'] as const;

function useShips() {
  return useQuery({ queryKey: ['ships'], queryFn: fleetApi.ships, staleTime: 60 * 60_000 });
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}
const stale = (iso: string | null) => !iso || Date.now() - new Date(iso).getTime() > FLEET_CHECK_DAYS * 86_400_000;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function crewText(s: ShipCatalogEntry): string | null {
  if (!s.maxCrew) return null;
  return s.minCrew && s.minCrew !== s.maxCrew ? `Crew ${s.minCrew}–${s.maxCrew}` : `Crew ${s.maxCrew}`;
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function ShipImage({ ship, className, small }: { ship: ShipCatalogEntry | null; className?: string; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const url = ship ? (small ? ship.thumbUrl ?? ship.imageUrl : ship.imageUrl ?? ship.thumbUrl) : null;
  if (!url || broken) {
    return (
      <div className={cn('flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-500', className)} aria-hidden>
        <Rocket className={small ? 'h-4 w-4' : 'h-8 w-8'} />
      </div>
    );
  }
  return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={cn('object-cover bg-slate-900', className)} />;
}

/** Type-ahead over the ship list; picking calls onPick. */
function ShipPicker({ ships, onPick, placeholder = 'Add a ship: start typing…', disabled, autoFocus }: {
  ships: ShipCatalogEntry[]; onPick: (s: ShipCatalogEntry) => void; placeholder?: string; disabled?: boolean; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => (q.trim() ? searchShips(q, ships, 8) : []), [q, ships]);
  const pick = (s: ShipCatalogEntry) => { onPick(s); setQ(''); setOpen(false); setActive(0); };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        role="combobox" aria-expanded={open && results.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-label={placeholder} placeholder={placeholder} value={q} disabled={disabled} autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]!); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg">
          {results.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-3 px-2 py-1.5', i === active && 'bg-accent')}>
              <ShipImage ship={s} small className="h-9 w-14 shrink-0 rounded" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="truncate text-xs text-muted-foreground">{s.manufacturer}{s.focus ? ` · ${s.focus}` : ''}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Your fleet ────────────────────────────────────────────────────────────────

function OwnedShipCard({ row, onChange, onRemove, busy }: {
  row: FleetShipDto; busy: boolean;
  onChange: (body: Partial<{ quantity: number; nickname: string | null; source: ShipSource; available: boolean }>) => void;
  onRemove: () => void;
}) {
  const ship = row.ship!;
  const [nick, setNick] = useState(row.nickname ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setNick(row.nickname ?? ''), [row.nickname]);
  const crew = crewText(ship);
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', !row.available && 'opacity-70')}>
      <div className="relative">
        <ShipImage ship={ship} className="aspect-[16/9] w-full" />
        {row.quantity > 1 && <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">×{row.quantity}</span>}
      </div>
      <div className="space-y-2 p-3">
        <div>
          <div className="font-semibold leading-tight">{ship.name}</div>
          <div className="text-xs text-muted-foreground">{[ship.manufacturer, ship.focus, crew].filter(Boolean).join(' · ')}</div>
        </div>
        <input
          aria-label={`Nickname for ${ship.name}`} placeholder="Nickname (optional)" value={nick} maxLength={60}
          onChange={(e) => setNick(e.target.value)}
          onBlur={() => { if ((nick.trim() || null) !== row.nickname) onChange({ nickname: nick.trim() || null }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-input" role="group" aria-label="Quantity">
            <button type="button" className="px-2 py-1 disabled:opacity-40" aria-label="One fewer" disabled={busy || row.quantity <= 1} onClick={() => onChange({ quantity: row.quantity - 1 })}><Minus className="h-3.5 w-3.5" /></button>
            <span className="min-w-[2ch] text-center text-sm tabular-nums">{row.quantity}</span>
            <button type="button" className="px-2 py-1 disabled:opacity-40" aria-label="One more" disabled={busy || row.quantity >= 99} onClick={() => onChange({ quantity: row.quantity + 1 })}><Plus className="h-3.5 w-3.5" /></button>
          </div>
          <select aria-label="How you got it" value={row.source} disabled={busy} onChange={(e) => onChange({ source: e.target.value as ShipSource })}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs">
            {SHIP_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button type="button" disabled={busy} onClick={() => onChange({ available: !row.available })}
            className={cn('flex items-center gap-1.5 text-xs', row.available ? 'text-emerald-400' : 'text-muted-foreground')}
            aria-pressed={row.available} title="Whether officers see it when planning ops">
            {row.available ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {row.available ? 'Available for org ops' : 'Not for org ops'}
          </button>
          {confirmRemove ? (
            <span className="flex gap-1">
              <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" disabled={busy} onClick={onRemove}>Remove</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmRemove(false)}>Keep</Button>
            </span>
          ) : (
            <button type="button" aria-label={`Remove ${ship.name}`} className="text-muted-foreground hover:text-red-400" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportPanel({ ships, onDone }: { ships: ShipCatalogEntry[]; onDone: (fleet: MyFleetDto) => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ format: string; lines: FleetImportPreviewLine[] } | null>(null);
  const [choice, setChoice] = useState<Record<number, string>>({}); // line index → shipId | '' (keep unmatched) | 'skip'
  const [replace, setReplace] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({}); // ambiguous lines the person has looked at
  const fileRef = useRef<HTMLInputElement>(null);

  const previewMut = useMutation({
    meta: { quietErrors: true },
    mutationFn: (t: string) => fleetApi.previewImport(t),
    onSuccess: (p) => {
      setPreview(p);
      setReplace(p.format === 'hangarexport');
      setChecked({});
      setChoice(Object.fromEntries(p.lines.map((l, i) => [i, l.match.status === 'matched' ? l.match.ship.id : l.match.suggestions[0]?.id && l.match.status === 'ambiguous' ? l.match.suggestions[0].id : ''])));
    },
  });
  const applyMut = useMutation({
    meta: { quietErrors: true },
    mutationFn: () => fleetApi.applyImport(
      preview!.lines.flatMap((l, i) => (choice[i] === 'skip' ? [] : [{ shipId: choice[i] || null, name: l.name, quantity: l.quantity, nickname: l.nickname ?? null }])),
      replace,
    ),
    onSuccess: (fleet) => { onDone(fleet); setPreview(null); setText(''); },
  });

  async function readFile(f: File) {
    if (f.size > 2_000_000) { setText(''); return; }
    const t = await f.text();
    setText(t);
    previewMut.mutate(t);
  }

  const counts = preview ? {
    matched: preview.lines.filter((_, i) => choice[i] && choice[i] !== 'skip').length,
    unmatched: preview.lines.filter((_, i) => choice[i] === '').length,
    skipped: preview.lines.filter((_, i) => choice[i] === 'skip').length,
  } : null;

  if (!preview) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste one ship per line (&ldquo;2x Cutlass Black&rdquo; works), or choose an export file: <span className="text-foreground">Hangar Export / hangar.link</span> JSON, a FleetYards export, or any list.
        </p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Ships to import"
          placeholder={'Carrack\n2x Cutlass Black\nProspector'}
          className="w-full rounded-md border border-input bg-background p-3 font-mono text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!text.trim() || previewMut.isPending} onClick={() => previewMut.mutate(text)}>
            {previewMut.isPending ? 'Reading…' : 'Check the list'}
          </Button>
          <input ref={fileRef} type="file" accept=".json,.txt,.csv,application/json,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileUp className="mr-1.5 h-4 w-4" />Choose a file</Button>
        </div>
        {previewMut.isError && <p role="alert" className="text-sm text-red-400">{errorText(previewMut.error, 'That couldn\'t be read.')}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Found <strong>{preview.lines.length}</strong> ship{preview.lines.length === 1 ? '' : 's'}
        {preview.format === 'hangarexport' ? ' in your hangar export' : ''}. Check the matches, then add them.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {preview.lines.map((l, i) => {
          const pickedId = choice[i];
          const picked = ships.find((s) => s.id === pickedId) ?? (l.match.status === 'matched' && l.match.ship.id === pickedId ? l.match.ship : null);
          const options = l.match.status === 'matched' ? [l.match.ship] : l.match.suggestions;
          const unsure = l.match.status === 'ambiguous' && !checked[i] && pickedId !== 'skip';
          return (
            <li key={i} className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {pickedId === 'skip' ? <Minus className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Skipped" />
                  : unsure ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label="Several ships fit: check this one" />
                  : picked ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Matched" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label="Not matched" />}
                <span className="truncate text-sm">
                  {l.quantity > 1 && <span className="tabular-nums">{l.quantity}× </span>}{l.name}
                  {l.nickname && <span className="text-muted-foreground"> &ldquo;{l.nickname}&rdquo;</span>}
                  {unsure && <span className="ml-1 text-xs text-amber-400">which one?</span>}
                </span>
              </div>
              <select aria-label={`Ship for ${l.name}`} value={pickedId ?? ''} onChange={(e) => { setChoice((c) => ({ ...c, [i]: e.target.value })); setChecked((c) => ({ ...c, [i]: true })); }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-64">
                {options.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.manufacturer}</option>)}
                {picked && !options.some((o) => o.id === picked.id) && <option value={picked.id}>{picked.name} — {picked.manufacturer}</option>}
                <option value="">Keep as &ldquo;{l.name.slice(0, 30)}&rdquo; (fix later)</option>
                <option value="skip">Skip it</option>
              </select>
            </li>
          );
        })}
      </ul>
      {counts && counts.unmatched > 0 && (
        <p className="text-xs text-muted-foreground">Ships kept by name show at the top of your fleet so you can pick the right ship later. Officers don&apos;t see them until then.</p>
      )}
      <fieldset className="space-y-1 text-sm">
        <legend className="sr-only">How to import</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={!replace} onChange={() => setReplace(false)} /> Add these to my fleet</label>
        <label className="flex items-center gap-2"><input type="radio" checked={replace} onChange={() => setReplace(true)} /> Replace my fleet with this list <span className="text-xs text-muted-foreground">(for a whole-hangar export)</span></label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={applyMut.isPending || !counts || counts.matched + counts.unmatched === 0} onClick={() => applyMut.mutate()}>
          {applyMut.isPending ? 'Saving…' : `${replace ? 'Replace with' : 'Add'} ${counts ? counts.matched + counts.unmatched : 0} ship${counts && counts.matched + counts.unmatched === 1 ? '' : 's'}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Back</Button>
      </div>
      {applyMut.isError && <p role="alert" className="text-sm text-red-400">{errorText(applyMut.error, 'Something went wrong. Nothing was changed.')}</p>}
    </div>
  );
}

function YourFleet() {
  const qc = useQueryClient();
  const { guilds } = useAuth();
  const shipsQuery = useShips();
  const fleetQuery = useQuery({ queryKey: MY_FLEET, queryFn: fleetApi.mine });
  const [showImport, setShowImport] = useState(false);
  const [showWhere, setShowWhere] = useState(false);
  const set = (f: MyFleetDto) => qc.setQueryData(MY_FLEET, f);
  const run = useMutation({
    meta: { quietErrors: true },
    mutationFn: (fn: () => Promise<MyFleetDto>) => fn(),
    onSuccess: (f) => { set(f); qc.invalidateQueries({ queryKey: ['guild-fleet'] }); },
  });
  const ships = shipsQuery.data ?? [];
  const fleet = fleetQuery.data;

  if (fleetQuery.isLoading || shipsQuery.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-lg" />)}</div>;
  if (fleetQuery.isError || !fleet) return <p className="text-sm text-red-400">{errorText(fleetQuery.error, 'Your fleet couldn\'t be loaded.')}</p>;

  const matched = fleet.ships.filter((s) => s.ship);
  const loose = fleet.ships.filter((s) => !s.ship);
  const total = fleet.ships.reduce((n, s) => n + s.quantity, 0);
  const hidden = new Set(fleet.hiddenGuildIds);
  const asopGuilds = guilds.filter((g) => g.hasBotInstalled);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <div className="text-sm text-muted-foreground">
            {total ? <>{total} ship{total === 1 ? '' : 's'} · </> : null}
            Last checked <span className={cn(stale(fleet.checkedAt) && total ? 'text-amber-400' : 'text-foreground')}>{ago(fleet.checkedAt)}</span>
          </div>
        </div>
        {total > 0 && (
          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(fleetApi.confirm)}>
            <Check className="mr-1.5 h-4 w-4" />Still correct
          </Button>
        )}
      </div>

      <ShipPicker ships={ships} disabled={run.isPending} onPick={(s) => run.mutate(() => fleetApi.add({ shipId: s.id }))} />
      {run.isError && <p role="alert" className="text-sm text-red-400">{errorText(run.error, 'That didn\'t save. Try again.')}</p>}

      {loose.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-400" />Which ships are these?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">These names couldn&apos;t be matched to a ship. Pick the right one so officers can see it.</p>
            {loose.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-sm sm:w-56 sm:shrink-0">{r.quantity > 1 && `${r.quantity}× `}{r.customName}</span>
                <div className="flex-1"><ShipPicker ships={ships} placeholder="Find the ship…" onPick={(s) => run.mutate(() => fleetApi.update(r.id, { shipId: s.id }))} /></div>
                <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => run.mutate(() => fleetApi.remove(r.id))}>Remove</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {matched.length === 0 && loose.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Rocket className="mx-auto mb-2 h-8 w-8" aria-hidden />
          No ships yet. Search above, use <code>/fleet add</code> in Discord, or import a list below.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matched.map((r) => (
            <OwnedShipCard key={r.id} row={r} busy={run.isPending}
              onChange={(body) => run.mutate(() => fleetApi.update(r.id, body))}
              onRemove={() => run.mutate(() => fleetApi.remove(r.id))} />
          ))}
        </div>
      )}

      <Card>
        <button type="button" className="flex w-full items-center justify-between p-4 text-left" aria-expanded={showImport} onClick={() => setShowImport((v) => !v)}>
          <span className="flex items-center gap-2 text-sm font-medium"><FileUp className="h-4 w-4" />Import a list or hangar export</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', showImport && 'rotate-180')} />
        </button>
        {showImport && <CardContent className="pt-0"><ImportPanel ships={ships} onDone={(f) => { set(f); qc.invalidateQueries({ queryKey: ['guild-fleet'] }); setShowImport(false); }} /></CardContent>}
      </Card>

      {asopGuilds.length > 0 && (
        <Card>
          <button type="button" className="flex w-full items-center justify-between p-4 text-left" aria-expanded={showWhere} onClick={() => setShowWhere((v) => !v)}>
            <span className="flex items-center gap-2 text-sm font-medium"><Eye className="h-4 w-4" />Where your fleet shows
              <span className="font-normal text-muted-foreground">({asopGuilds.length - asopGuilds.filter((g) => hidden.has(g.id)).length} of {asopGuilds.length} servers)</span>
            </span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', showWhere && 'rotate-180')} />
          </button>
          {showWhere && (
            <CardContent className="space-y-2 pt-0">
              {asopGuilds.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!hidden.has(g.id)} disabled={run.isPending}
                    onChange={(e) => {
                      const next = new Set(hidden);
                      if (e.target.checked) next.delete(g.id); else next.add(g.id);
                      run.mutate(() => fleetApi.setHidden([...next]));
                    }} />
                  {g.name}
                </label>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">Ships you mark &ldquo;Not for org ops&rdquo; never show to officers.</p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// ── A server's fleet ──────────────────────────────────────────────────────────

function ServerFleet({ guildId }: { guildId: string }) {
  const q = useQuery({ queryKey: ['guild-fleet', guildId], queryFn: () => fleetApi.guild(guildId), staleTime: 60_000, retry: 1 });
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState<string>('all');
  const [showMembers, setShowMembers] = useState(false);
  const data = q.data;

  const names = useMemo(() => new Map((data?.owners ?? []).map((o) => [o.discordId, o])), [data]);
  const groups = useMemo(() => {
    const by = new Map<string, GuildFleetShipDto[]>();
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const s of data?.ships ?? []) {
      const hay = `${s.ship.name} ${s.ship.manufacturer} ${s.ship.focus ?? ''} ${s.owners.map((o) => names.get(o.discordId)?.name ?? '').join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const g = shipRoleGroup(s.ship);
      by.set(g, [...(by.get(g) ?? []), s]);
    }
    return SHIP_ROLE_GROUPS.filter((g) => by.has(g)).map((g) => ({ group: g, ships: by.get(g)! }));
  }, [data, filter, names]);

  if (q.isLoading) return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-56 rounded-lg" />)}</div>;
  if (q.isError || !data) return <p role="alert" className="text-sm text-red-400">{errorText(q.error, 'The server\'s fleet couldn\'t be loaded.')}</p>;

  const totalShips = data.ships.reduce((n, s) => n + s.total, 0);
  const seats = data.ships.reduce((n, s) => n + (s.ship.maxCrew ?? 0) * s.total, 0);
  const fresh = data.owners.filter((o) => !stale(o.checkedAt)).length;
  const shown = role === 'all' ? groups : groups.filter((g) => g.group === role);

  if (!data.owners.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <Users className="mx-auto mb-2 h-8 w-8" aria-hidden />
        Nobody in this server has added their fleet yet. Members can add ships with <code>/fleet add</code> in Discord or on the &ldquo;Your fleet&rdquo; tab.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Ships', totalShips.toLocaleString()],
          ['Different ships', data.ships.length.toLocaleString()],
          ['Crew seats', seats.toLocaleString()],
          ['Members with a fleet', `${data.owners.length}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {fresh} of {data.owners.length} fleet{data.owners.length === 1 ? '' : 's'} checked in the last {Math.round(FLEET_CHECK_DAYS / 30)} months.
        Ships members marked &ldquo;not for org ops&rdquo; aren&apos;t counted.
        {data.unmatched > 0 && ` ${data.unmatched} ship${data.unmatched === 1 ? '' : 's'} still waiting for their owner to match ${data.unmatched === 1 ? 'it' : 'them'}.`}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input aria-label="Filter ships or members" placeholder="Filter ships or members…" value={filter} onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Role">
          {[{ group: 'all', n: data.ships.length }, ...groups.map((g) => ({ group: g.group, n: g.ships.length }))].map(({ group, n }) => (
            <button key={group} type="button" aria-pressed={role === group} onClick={() => setRole(group)}
              className={cn('rounded-full border px-3 py-1 text-xs', role === group ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>
              {group === 'all' ? 'All' : group} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <p className="text-sm text-muted-foreground">No ships match that filter.</p>}
      {shown.map(({ group, ships }) => (
        <section key={group} className="space-y-2" aria-labelledby={`role-${group}`}>
          <h2 id={`role-${group}`} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ships.map((s) => (
              <div key={s.ship.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="relative">
                  <ShipImage ship={s.ship} className="aspect-[16/9] w-full" />
                  <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">×{s.total}</span>
                </div>
                <div className="space-y-2 p-3">
                  <div>
                    <div className="font-semibold leading-tight">{s.ship.name}</div>
                    <div className="text-xs text-muted-foreground">{[s.ship.manufacturer, s.ship.focus, crewText(s.ship)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <ul className="space-y-0.5 text-sm">
                    {s.owners
                      .map((o) => ({ ...o, who: names.get(o.discordId) }))
                      .sort((a, b) => (b.who?.checkedAt ?? '').localeCompare(a.who?.checkedAt ?? ''))
                      .map((o) => (
                        <li key={`${o.discordId}-${o.nickname ?? ''}`} className={cn('flex items-baseline gap-1', stale(o.who?.checkedAt ?? null) && 'text-muted-foreground')}>
                          <span className="truncate">{o.who?.name ?? 'Member'}</span>
                          {o.quantity > 1 && <span className="tabular-nums text-xs">×{o.quantity}</span>}
                          {o.nickname && <span className="truncate text-xs text-muted-foreground">&ldquo;{o.nickname}&rdquo;</span>}
                          {o.source === 'LOANER' && <span className="text-xs text-muted-foreground">(loaner)</span>}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <Card>
        <button type="button" className="flex w-full items-center justify-between p-4 text-left" aria-expanded={showMembers} onClick={() => setShowMembers((v) => !v)}>
          <span className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" />Members&apos; fleets and when they were checked</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', showMembers && 'rotate-180')} />
        </button>
        {showMembers && (
          <CardContent className="pt-0">
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {data.owners.map((o) => (
                <li key={o.discordId} className="flex justify-between gap-2">
                  <span className="truncate">{o.name}</span>
                  <span className={cn('shrink-0 text-xs', stale(o.checkedAt) ? 'text-amber-400' : 'text-muted-foreground')}>{ago(o.checkedAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function FleetPage() {
  const { guildId } = useParams<{ guildId?: string }>();
  const [params, setParams] = useSearchParams();
  const tab = !guildId || params.get('tab') === 'mine' ? 'mine' : 'server';

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{guildId ? 'Fleet' : 'Your fleet'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {guildId
            ? 'The ships this server\'s members fly, by role. Everyone keeps one fleet, shown in every ASOP server they\'re in.'
            : <>Your ships, shown in every ASOP server you&apos;re in. Add them here or with <code>/fleet add</code> in Discord.</>}
        </p>
      </div>

      {guildId && (
        <div className="flex border-b border-border" role="tablist">
          {([['server', 'Server fleet'], ['mine', 'Your fleet']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key}
              onClick={() => setParams(key === 'mine' ? { tab: 'mine' } : {}, { replace: true })}
              className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors', tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'mine' ? <YourFleet /> : <ServerFleet guildId={guildId!} />}

      <p className="text-xs text-muted-foreground">
        Ship details and images: Roberts Space Industries. {!guildId && <Link to="/dashboard" className="underline">Back to the dashboard</Link>}
      </p>
    </div>
  );
}
