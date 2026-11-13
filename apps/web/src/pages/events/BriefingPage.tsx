// Mission briefing (v1.36.0): an event's plan, read as a page, presented as
// slides (full screen, arrow keys) or printed to PDF, and edited here by the
// host's event creators. Linked from the event, its Discord roster and thread.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Copy, Eye, MonitorPlay, Pencil, Plus, Printer, Save, Trash2, X } from 'lucide-react';
import {
  bodyBlocks, briefingSlides, forceTotals, groupPeople, sectionHasContent, defaultBriefing, newSectionId, BRIEFING_LIMITS, BRIEFING_SECTION_KINDS,
  type BriefingContent, type BriefingGroup, type BriefingShip, type ShipCatalogEntry, type BriefingLogo, type BriefingSection, type BriefingViewDto,
} from '@dem/shared';
import { briefingsApi, type PastBriefing } from '@/api/briefings';
import { fleetApi } from '@/api/fleet';
import { Button } from '@/components/ui/button';
import { ServerImagePicker } from '@/components/ServerImagePicker';
import { cn } from '@/lib/utils';
import './briefing.css';

const W = 1280;
const H = 720;

const when = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString(undefined, opts);
const stepOff = (iso: string) => when(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ── One slide ─────────────────────────────────────────────────────────────────

function Hud() {
  return (
    <svg className="hud" viewBox="0 0 400 400" fill="none" stroke="#b98a13" aria-hidden="true">
      <circle cx="200" cy="200" r="190" strokeOpacity=".18" />
      <circle cx="200" cy="200" r="150" strokeOpacity=".28" strokeDasharray="2 6" />
      <circle cx="200" cy="200" r="110" strokeOpacity=".14" />
      <path d="M200 0v400M0 200h400" strokeOpacity=".08" />
      <path d="M60 200a140 140 0 0 1 60-115" strokeOpacity=".5" strokeWidth="3" />
      <path d="M290 330a140 140 0 0 0 48-60" strokeOpacity=".35" strokeWidth="2" />
    </svg>
  );
}

/** The logos shown: this briefing's own (or the host's), plus allies' if asked for. */
function shownLogos(c: BriefingContent, logos: BriefingLogo[]): { key: string; url: string | null; label: string }[] {
  const host = logos[0];
  const first = { key: 'host', url: c.appearance.logoUrl ?? host?.logoUrl ?? null, label: host?.tag ?? host?.name ?? '' };
  const allies = c.appearance.allyLogos ? logos.slice(1).map((l) => ({ key: l.guildId, url: l.logoUrl, label: l.tag ?? l.name })) : [];
  return [first, ...allies].filter((l) => l.url || l.label);
}

function shipCrew(s: BriefingShip) {
  return s.crew ? `Crew ${s.crew}` : '';
}

/** A ship section on a slide: only the ships the organisers picked. */
function FleetBlock({ ships }: { ships: BriefingShip[] }) {
  if (!ships.length) return null;
  const t = forceTotals(ships);
  const shown = ships.slice(0, 9);
  return (
    <>
      <div className="sum">
        <div>Ships &amp; vehicles<b>{t.ships}</b></div>
        <div>Crew seats<b>{t.seats}</b></div>
      </div>
      <div className="ships">
        {shown.map((s) => (
          <div key={s.shipId} className="ship">
            <div className="hd"><b>{s.name}{s.count > 1 ? ` ×${s.count}` : ''}</b><span>{shipCrew(s)}</span></div>
            {(s.note || s.focus) && <div className="own">{s.note || s.focus}</div>}
          </div>
        ))}
      </div>
      {ships.length > shown.length && <p className="more">+ {ships.length - shown.length} more on the briefing page</p>}
    </>
  );
}

/** A roster slide (v1.37.0): every group side by side, picture on top, then who's in it. */
function RosterBlock({ groups, roles }: { groups: BriefingGroup[]; roles: BriefingViewDto['event']['roles'] }) {
  if (!groups.length) return null;
  const rows = groups.length > 4 ? 2 : 1;
  const cols = Math.ceil(groups.length / rows);
  const max = rows === 2 ? 4 : cols <= 2 ? 10 : 7;
  return (
    <div className={cn('roster', rows === 2 && 'two')} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {groups.map((g) => {
        const { people, slots } = groupPeople(g, roles);
        return (
          <div key={g.id} className="grp">
            {g.imageUrl ? <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" /> : <div className="noimg" />}
            <div className="gb">
              <div className="gh"><b>{g.title || 'Group'}</b><span>{slots ? `${people.length}/${slots}` : people.length || ''}</span></div>
              {g.note && <div className="gn">{g.note}</div>}
              <ul>
                {people.slice(0, max).map((n) => <li key={n}>{n}</li>)}
                {people.length > max && <li className="more">+ {people.length - max} more</li>}
                {!people.length && <li className="open">{slots ? `${slots} open` : 'Open'}</li>}
              </ul>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Body({ text }: { text: string }) {
  return (
    <>
      {bodyBlocks(text).map((b, i) => (b.kind === 'p'
        ? <p key={i}>{b.text}</p>
        : <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>))}
    </>
  );
}

function Slide({ view, c, index, total }: {
  view: BriefingViewDto;
  c: BriefingContent;
  index: number;
  total: number;
}) {
  const slides = briefingSlides(c);
  const s = slides[index] ?? slides[0]!;
  const logos = shownLogos(c, view.logos);
  const wmUrl = logos[0]?.url ?? null;
  const a = c.appearance;
  const opacity = a.watermarkStrength / 100;
  const logoSide = a.logoPosition === 'TOP_RIGHT' ? 'right' : 'left';
  const allies = view.logos.slice(1).map((l) => l.tag ?? l.name);
  const len = s.kind === 'section' ? s.section.body.length : 0;

  return (
    <div className={cn('brf-slide', s.kind === 'section' && s.section.kind === 'roster' && 'is-roster')}>
      {s.kind === 'section' && s.section.bgUrl && s.section.bgOpacity > 0 && (
        <img className="bgimg" src={s.section.bgUrl} alt="" style={{ opacity: s.section.bgOpacity / 100 }} />
      )}
      {wmUrl && a.watermark !== 'NONE' && opacity > 0 && (a.watermark === 'TILED'
        ? <div className="wm-tiled" style={{ backgroundImage: `url("${wmUrl}")`, opacity }} />
        : <img className={cn('wm', a.watermark === 'CENTER' ? 'center' : 'corner')} src={wmUrl} alt="" style={{ opacity }} />)}
      <Hud />
      <div className="frame" />
      <div className={cn('logos', logoSide)}>
        {logos.map((l) => (l.url ? <img key={l.key} src={l.url} alt={l.label} /> : <span key={l.key} className="tagbox">{l.label}</span>))}
      </div>
      {a.banner && <div className={cn('banner', logoSide === 'right' ? 'left' : 'right')}>{a.banner}</div>}

      {s.kind === 'title' ? (
        <>
          <div className="title-block">
            <div className="eyebrow">{allies.length ? `Joint operation · ${[view.logos[0]?.tag ?? view.logos[0]?.name, ...allies].filter(Boolean).join(' + ')}` : 'Mission briefing'}</div>
            <h2 style={{ fontSize: view.event.name.length > 26 ? 66 : undefined }}>{view.event.name}</h2>
            <div className="rule" />
            {c.objective && <div className="obj">{c.objective}</div>}
          </div>
          <div className="facts">
            <div>Step off<b>{stepOff(view.event.startTime)}</b></div>
            {c.facts.filter((f) => f.label && f.value).slice(0, 3).map((f, i) => <div key={i}>{f.label}<b>{f.value}</b></div>)}
            <div>Signed up<b>{view.event.signedUp}{view.event.maybe ? ` + ${view.event.maybe} maybe` : ''}</b></div>
          </div>
        </>
      ) : (
        <>
          <div className="sec-head"><h2>{s.section.title || 'Untitled'}</h2><div className="rule" /></div>
          <div className={cn('sec-body', len > 900 ? 'tiny' : len > 500 && 'small')}>
            {s.section.kind === 'roster' ? (
              <>{s.section.body.trim() && <div className="roster-note"><Body text={s.section.body} /></div>}<RosterBlock groups={s.section.groups} roles={view.event.roles} /></>
            ) : s.section.kind === 'fleet' ? (
              <>{s.section.body && <Body text={s.section.body} />}<FleetBlock ships={s.section.ships} /></>
            ) : s.section.kind === 'image' && s.section.imageUrl ? (
              <div className={cn('split', !s.section.body.trim() && 'full')}>
                <img src={s.section.imageUrl} alt="" />
                {s.section.body.trim() && <div><Body text={s.section.body} /></div>}
              </div>
            ) : (
              <Body text={s.section.body} />
            )}
          </div>
        </>
      )}
      <div className="bar"><span>{view.event.name}</span><span className="pg">{index + 1} / {total}</span></div>
    </div>
  );
}

/** A slide scaled to the width of its box. */
function ScaledSlide(props: Parameters<typeof Slide>[0] & { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    setScale(el.clientWidth / W);
    return () => ro.disconnect();
  }, []);
  const { className, ...rest } = props;
  return (
    <div ref={box} className={cn('relative w-full overflow-hidden rounded-md border border-[#3a3424]', className)} style={{ height: H * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: W, height: H }}><Slide {...rest} /></div>
    </div>
  );
}

// ── Present mode ──────────────────────────────────────────────────────────────

function Present({ view, c, start, onClose }: {
  view: BriefingViewDto; c: BriefingContent; start: number; onClose: (at: number) => void;
}) {
  const total = briefingSlides(c).length;
  const [i, setI] = useState(Math.min(start, total - 1));
  const [scale, setScale] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const go = useCallback((d: number) => setI((n) => Math.max(0, Math.min(total - 1, n + d))), [total]);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === 'Home') setI(0);
      else if (e.key === 'End') setI(total - 1);
      else if (e.key === 'Escape') onClose(i);
    };
    window.addEventListener('keydown', key);
    ref.current?.focus();
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('keydown', key); };
  }, [go, onClose, i, total]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div ref={ref} className="brf-present" role="dialog" aria-label={`Briefing slides: ${view.event.name}`} tabIndex={-1}>
      <div className="stage" style={{ width: W * scale, height: H * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: W, height: H }}>
          <Slide view={view} c={c} index={i} total={total} />
        </div>
      </div>
      <button type="button" className="nav prev" aria-label="Previous slide" onClick={() => go(-1)} />
      <button type="button" className="nav next" aria-label="Next slide" onClick={() => go(1)} />
      <div className="ctl">
        <Button size="sm" variant="secondary" onClick={() => go(-1)} aria-label="Previous slide"><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="secondary" onClick={() => go(1)} aria-label="Next slide"><ChevronRight className="h-4 w-4" /></Button>
        <Button size="sm" variant="secondary" onClick={fullscreen}>Full screen</Button>
        <Button size="sm" variant="secondary" onClick={() => onClose(i)} aria-label="Close slides"><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

// ── Read mode ─────────────────────────────────────────────────────────────────

function ReadView({ view, c }: { view: BriefingViewDto; c: BriefingContent }) {
  const sections = briefingSlides(c).flatMap((s) => (s.kind === 'section' ? [s.section] : []));
  const logos = shownLogos(c, view.logos);
  return (
    <article className="space-y-6">
      <header className="rounded-lg border border-border bg-card p-5" style={{ background: 'radial-gradient(ellipse 70% 80% at 15% 20%, rgba(185,138,19,.12), transparent 70%), hsl(var(--card))' }}>
        <div className="flex items-center gap-3">
          {logos.map((l) => (l.url ? <img key={l.key} src={l.url} alt={l.label} className="h-10 w-auto max-w-[100px] object-contain" /> : <span key={l.key} className="rounded border border-brand px-2 py-1 font-condensed text-sm font-bold text-brand">{l.label}</span>))}
          {c.appearance.banner && <span className="ml-auto rounded-sm border border-brand/60 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#e2bd5b]">{c.appearance.banner}</span>}
        </div>
        <h2 className="mt-4 font-condensed text-3xl font-bold uppercase tracking-wide text-foreground">{view.event.name}</h2>
        <div className="mt-2 h-[3px] w-24 bg-gradient-to-r from-brand to-[#e2bd5b]" />
        {c.objective && <p className="mt-3 text-base text-foreground/90">{c.objective}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><dt className="font-mono text-[11px] uppercase tracking-wider text-[#8a7a50]">Step off</dt><dd className="font-semibold">{stepOff(view.event.startTime)}</dd></div>
          {c.facts.filter((f) => f.label && f.value).map((f, i) => <div key={i}><dt className="font-mono text-[11px] uppercase tracking-wider text-[#8a7a50]">{f.label}</dt><dd className="font-semibold">{f.value}</dd></div>)}
          <div><dt className="font-mono text-[11px] uppercase tracking-wider text-[#8a7a50]">Signed up</dt><dd className="font-semibold">{view.event.signedUp}{view.event.maybe ? ` + ${view.event.maybe} maybe` : ''}</dd></div>
        </dl>
      </header>
      {sections.map((s) => (
        <section key={s.id} className="rounded-lg border border-border bg-card p-5">
          <h3 className="font-condensed text-xl font-bold uppercase tracking-wide text-foreground">{s.title || 'Untitled'}</h3>
          <div className="mt-1 h-[2px] w-12 bg-brand" />
          {s.kind === 'image' && s.imageUrl && <img src={s.imageUrl} alt="" className="mt-3 max-h-[480px] w-full rounded border border-border object-contain bg-black/40" />}
          {s.body.trim() && (
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90 [&_li]:ml-5 [&_li]:list-disc">
              <Body text={s.body} />
            </div>
          )}
          {s.kind === 'fleet' && <ReadFleet ships={s.ships} />}
          {s.kind === 'roster' && <ReadRoster groups={s.groups} roles={view.event.roles} />}
        </section>
      ))}
    </article>
  );
}

function ReadRoster({ groups, roles }: { groups: BriefingGroup[]; roles: BriefingViewDto['event']['roles'] }) {
  if (!groups.length) return null;
  return (
    <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => {
        const { people, slots } = groupPeople(g, roles);
        return (
          <li key={g.id} className="overflow-hidden rounded border border-border bg-black/20">
            {g.imageUrl && <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" className="h-28 w-full object-cover" />}
            <div className="p-3 text-sm">
              <div className="flex items-baseline justify-between gap-2"><b className="font-semibold">{g.title || 'Group'}</b>
                <span className="shrink-0 text-xs text-muted-foreground">{slots ? `${people.length}/${slots}` : people.length ? `${people.length}` : ''}</span></div>
              {g.note && <div className="text-xs text-[#e2bd5b]">{g.note}</div>}
              <div className="mt-1.5 text-muted-foreground">{people.length ? people.join(' · ') : slots ? `${slots} open` : 'Open'}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ReadFleet({ ships }: { ships: BriefingShip[] }) {
  if (!ships.length) return null;
  const t = forceTotals(ships);
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.ships} ship{t.ships === 1 ? '' : 's'} · {t.seats} crew seats</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {ships.map((s) => (
          <li key={s.shipId} className="rounded border border-border bg-black/20 px-3 py-2 text-sm">
            <div className="flex justify-between gap-2"><b className="truncate font-semibold">{s.name}{s.count > 1 ? ` ×${s.count}` : ''}</b><span className="shrink-0 text-xs text-muted-foreground">{shipCrew(s)}</span></div>
            {(s.note || s.focus) && <div className="truncate text-xs text-muted-foreground">{s.note || s.focus}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Picking ships for a ship section. Nothing is loaded until the organiser
 * asks: the signed-up fleets (allies included, never maybes) or the whole
 * ship list.
 */
function ShipChooser({ guildId, eventId, ships, onChange }: {
  guildId: string; eventId: string; ships: BriefingShip[]; onChange: (ships: BriefingShip[]) => void;
}) {
  const [source, setSource] = useState<'none' | 'fleet' | 'any'>('none');
  const [q, setQ] = useState('');
  const fleetQ = useQuery({ queryKey: ['fleet', guildId, eventId], queryFn: () => fleetApi.guild(guildId, eventId), enabled: source === 'fleet', retry: false, staleTime: 60_000 });
  const allQ = useQuery({ queryKey: ['ships'], queryFn: fleetApi.ships, enabled: source === 'any', staleTime: 60 * 60_000 });
  const picked = new Map(ships.map((s) => [s.shipId, s]));
  const set = (shipId: string, patch: Partial<BriefingShip>) => onChange(ships.map((s) => (s.shipId === shipId ? { ...s, ...patch } : s)));
  const add = (e: ShipCatalogEntry) => {
    const have = picked.get(e.id);
    if (have) return set(e.id, { count: Math.min(BRIEFING_LIMITS.shipCount, have.count + 1) });
    if (ships.length >= BRIEFING_LIMITS.ships) return;
    onChange([...ships, { shipId: e.id, name: e.name, count: 1, crew: e.maxCrew ?? e.minCrew ?? null, focus: e.focus ?? e.type ?? null, note: '' }]);
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (e: ShipCatalogEntry) => words.every((w) => `${e.name} ${e.manufacturer} ${e.focus ?? ''}`.toLowerCase().includes(w));
  const fleetRows = (fleetQ.data?.ships ?? []).filter((r) => r.total > 0 && match(r.ship)).sort((a, b) => (b.ship.maxCrew ?? 1) - (a.ship.maxCrew ?? 1) || a.ship.name.localeCompare(b.ship.name));
  const anyRows = words.length ? (allQ.data ?? []).filter(match).slice(0, 30) : [];
  const tab = (k: 'fleet' | 'any', label: string) => (
    <button type="button" onClick={() => setSource(source === k ? 'none' : k)}
      className={cn('rounded-md border px-3 py-1.5 text-sm', source === k ? 'border-[#b98a13] bg-[#b98a13]/15 text-[#e2bd5b]' : 'border-border text-muted-foreground hover:text-foreground')}>{label}</button>
  );

  return (
    <div className="space-y-3">
      {ships.length > 0 ? (
        <ul className="space-y-2">
          {ships.map((s, i) => (
            <li key={s.shipId} className="flex flex-wrap items-center gap-2 rounded border border-border bg-black/20 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><b className="font-semibold">{s.name}</b> <span className="text-xs text-muted-foreground">{shipCrew(s)}</span></div>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">×
                <input type="number" min={1} max={BRIEFING_LIMITS.shipCount} value={s.count} aria-label={`How many ${s.name}`}
                  onChange={(e) => set(s.shipId, { count: Math.max(1, Math.min(BRIEFING_LIMITS.shipCount, Number(e.target.value) || 1)) })}
                  className="w-14 rounded border border-border bg-background px-2 py-1 text-sm text-foreground" />
              </label>
              <input placeholder="Note (lead, role…)" maxLength={BRIEFING_LIMITS.shipNote} value={s.note} onChange={(e) => set(s.shipId, { note: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1 text-sm sm:w-48" aria-label={`Note for ${s.name}`} />
              <div className="flex">
                <button type="button" aria-label="Move up" disabled={i === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={() => { const n = [...ships]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; onChange(n); }}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" aria-label={`Remove ${s.name}`} className="p-1 text-muted-foreground hover:text-red-400"
                  onClick={() => onChange(ships.filter((x) => x.shipId !== s.shipId))}><X className="h-4 w-4" /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No ships picked yet. This section isn't shown until you pick some (or write something).</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Add ships:</span>
        {tab('fleet', 'From the signed-up fleets')}
        {tab('any', 'Any ship')}
      </div>

      {source !== 'none' && (
        <div className="rounded-md border border-border p-3">
          <input className={inputCls} placeholder={source === 'fleet' ? 'Filter…' : 'Search ships…'} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="mt-2 max-h-72 space-y-1 overflow-auto">
            {source === 'fleet' && fleetQ.isError && <li className="text-sm text-muted-foreground">The fleet isn't available here (the Fleet module may be off).</li>}
            {source === 'fleet' && fleetQ.isLoading && <li className="text-sm text-muted-foreground">Loading the fleet…</li>}
            {source === 'fleet' && fleetQ.data && !fleetRows.length && <li className="text-sm text-muted-foreground">{q ? 'No match.' : "Nobody signed up has added ships to their fleet yet."}</li>}
            {source === 'any' && !words.length && <li className="text-sm text-muted-foreground">Type a ship's name.</li>}
            {(source === 'fleet' ? fleetRows.map((r) => ({ e: r.ship, extra: `${r.total} available · ${r.owners.length} ${r.owners.length === 1 ? 'owner' : 'owners'}` })) : anyRows.map((e) => ({ e, extra: e.manufacturer })))
              .map(({ e, extra }) => (
                <li key={e.id}>
                  <button type="button" onClick={() => add(e)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary">
                    <Plus className="h-4 w-4 shrink-0 text-[#e2bd5b]" />
                    <span className="min-w-0 flex-1 truncate">{e.name}{picked.has(e.id) ? <span className="ml-2 text-xs text-[#e2bd5b]">×{picked.get(e.id)!.count} picked</span> : null}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{e.maxCrew ? `Crew ${e.maxCrew} · ` : ''}{extra}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Roster groups (v1.37.0): a title, an event role and/or names, a picture. */
function GroupsEditor({ guildId, roles, groups, onChange }: {
  guildId: string; roles: BriefingViewDto['event']['roles']; groups: BriefingGroup[]; onChange: (groups: BriefingGroup[]) => void;
}) {
  const set = (id: string, patch: Partial<BriefingGroup>) => onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= groups.length) return;
    const n = [...groups]; [n[i], n[j]] = [n[j]!, n[i]!]; onChange(n);
  };
  const add = () => groups.length < BRIEFING_LIMITS.groups
    && onChange([...groups, { id: newSectionId(), title: '', roleId: null, names: '', imageUrl: null, note: '' }]);
  return (
    <div className="space-y-3">
      {!groups.length && <p className="text-sm text-muted-foreground">Add a group for each team (for example the Ironclad crew, miners, ground defence). They all share one slide.</p>}
      {groups.map((g, i) => {
        const { people, slots } = groupPeople(g, roles);
        return (
          <div key={g.id} className="rounded-md border border-border bg-black/20 p-3">
            <div className="flex items-center gap-2">
              <input className={cn(inputCls, 'font-semibold')} placeholder="Group name (e.g. Ironclad crew)" maxLength={BRIEFING_LIMITS.groupTitle}
                value={g.title} onChange={(e) => set(g.id, { title: e.target.value })} aria-label="Group name" />
              <button type="button" aria-label="Move left" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Move right" disabled={i === groups.length - 1} onClick={() => move(i, 1)} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label={`Remove ${g.title || 'group'}`} onClick={() => onChange(groups.filter((x) => x.id !== g.id))} className="p-1 text-muted-foreground hover:text-red-400"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              <GroupPicture guildId={guildId} value={g.imageUrl} onChange={(imageUrl) => set(g.id, { imageUrl })} />
              <div className="space-y-2 text-sm">
                <label className="block">People from a role
                  <select className={cn(inputCls, 'mt-1')} value={g.roleId ?? ''} onChange={(e) => set(g.id, { roleId: e.target.value || null })}>
                    <option value="">None (names below only)</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.people.length}{r.count ? `/${r.count}` : ''} signed up)</option>)}
                  </select>
                </label>
                <label className="block">Other names <span className="text-muted-foreground">(one per line)</span>
                  <textarea className={cn(inputCls, 'mt-1 min-h-[64px]')} maxLength={BRIEFING_LIMITS.groupNames} value={g.names} onChange={(e) => set(g.id, { names: e.target.value })} />
                </label>
                <input className={inputCls} placeholder="Note (ship, lead…)" maxLength={BRIEFING_LIMITS.groupNote} value={g.note} onChange={(e) => set(g.id, { note: e.target.value })} aria-label="Note" />
                <p className="text-xs text-muted-foreground">{people.length ? `${people.length}${slots ? ` of ${slots}` : ''}: ${people.join(', ')}` : 'Nobody yet.'}</p>
              </div>
            </div>
          </div>
        );
      })}
      {groups.length < BRIEFING_LIMITS.groups
        ? <Button variant="outline" size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add a group</Button>
        : <p className="text-xs text-muted-foreground">{BRIEFING_LIMITS.groups} groups is the most that fit on one slide.</p>}
    </div>
  );
}

/** A group's picture: upload / pick from the server's images, or a ship's picture (the ship list loads only when asked). */
function GroupPicture({ guildId, value, onChange }: { guildId: string; value: string | null; onChange: (url: string | null) => void }) {
  const [shipSearch, setShipSearch] = useState(false);
  const [q, setQ] = useState('');
  const allQ = useQuery({ queryKey: ['ships'], queryFn: fleetApi.ships, enabled: shipSearch, staleTime: 60 * 60_000 });
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? (allQ.data ?? []).filter((e) => (e.imageUrl || e.thumbUrl) && words.every((w) => `${e.name} ${e.manufacturer}`.toLowerCase().includes(w))).slice(0, 8) : [];
  return (
    <div className="w-full space-y-2 sm:w-44">
      <ServerImagePicker guildId={guildId} value={value} onChange={onChange} emptyLabel="No picture" />
      <button type="button" className="text-xs text-[#e2bd5b] hover:underline" onClick={() => setShipSearch((o) => !o)}>{shipSearch ? 'Close ship search' : "Use a ship's picture"}</button>
      {shipSearch && (
        <div>
          <input className={inputCls} placeholder="Ship name…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="mt-1 max-h-48 overflow-auto">
            {allQ.isLoading && <li className="text-xs text-muted-foreground">Loading ships…</li>}
            {hits.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => { onChange(e.imageUrl ?? e.thumbUrl); setShipSearch(false); setQ(''); }}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-secondary">
                  <img src={e.thumbUrl ?? e.imageUrl ?? ''} alt="" referrerPolicy="no-referrer" className="h-6 w-10 shrink-0 rounded object-cover" />
                  <span className="truncate">{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Editor ────────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-brand focus:outline-none';

function Editor({ guildId, view, c, setC, onPreview }: {
  guildId: string; view: BriefingViewDto; c: BriefingContent; setC: (c: BriefingContent) => void; onPreview: (index: number) => void;
}) {
  const [sel, setSel] = useState<string>('title');
  const section = c.sections.find((s) => s.id === sel);
  const slides = briefingSlides(c);
  const previewIndex = sel === 'title' || sel === 'look' ? 0 : Math.max(0, slides.findIndex((s) => s.kind === 'section' && s.section.id === sel));
  const setSection = (patch: Partial<BriefingSection>) => setC({ ...c, sections: c.sections.map((s) => (s.id === sel ? { ...s, ...patch } : s)) });
  const move = (id: string, d: number) => {
    const i = c.sections.findIndex((s) => s.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= c.sections.length) return;
    const next = [...c.sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setC({ ...c, sections: next });
  };
  const add = (kind: BriefingSection['kind']) => {
    if (c.sections.length >= BRIEFING_LIMITS.sections) return;
    const s: BriefingSection = { id: newSectionId(), kind, title: kind === 'fleet' ? 'Force' : kind === 'image' ? 'Map' : kind === 'roster' ? 'Teams' : 'New section', body: '', imageUrl: null, ships: [], groups: [], bgUrl: null, bgOpacity: 35 };
    setC({ ...c, sections: [...c.sections, s] });
    setSel(s.id);
  };
  const a = c.appearance;
  const setA = (patch: Partial<BriefingContent['appearance']>) => setC({ ...c, appearance: { ...a, ...patch } });
  const item = (id: string, label: string, extra?: React.ReactNode) => (
    <button type="button" onClick={() => setSel(id)}
      className={cn('flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm', sel === id ? 'bg-secondary text-[#e2bd5b] shadow-[inset_2px_0_0_#b98a13]' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground')}>
      {label}{extra}
    </button>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav className="h-fit rounded-lg border border-border bg-card p-2" aria-label="Briefing sections">
        {item('title', 'Title & objective')}
        {item('look', 'Logo & watermark')}
        <div className="my-2 border-t border-border" />
        {c.sections.map((s, i) => (
          <div key={s.id} className="group flex items-center">
            <div className="min-w-0 flex-1">{item(s.id, s.title || 'Untitled', <span className={cn('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', sectionHasContent(s) ? 'bg-brand' : 'bg-border')} />)}</div>
            <div className="flex shrink-0 flex-col opacity-40 group-hover:opacity-100">
              <button type="button" aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => move(s.id, -1)} className="p-0.5 disabled:opacity-20"><ArrowUp className="h-3 w-3" /></button>
              <button type="button" aria-label={`Move ${s.title} down`} disabled={i === c.sections.length - 1} onClick={() => move(s.id, 1)} className="p-0.5 disabled:opacity-20"><ArrowDown className="h-3 w-3" /></button>
            </div>
          </div>
        ))}
        <div className="mt-2 border-t border-border pt-2 text-xs">
          <div className="px-2 pb-1 text-muted-foreground">Add a section</div>
          {BRIEFING_SECTION_KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => add(k.kind)} className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[#e2bd5b] hover:bg-secondary/50"><Plus className="h-3 w-3" />{k.label}</button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-4">
        <div className="rounded-lg border border-border bg-card p-5">
          {sel === 'title' && (
            <div className="space-y-4">
              <h3 className="font-condensed text-lg font-bold uppercase tracking-wide">Title &amp; objective</h3>
              <p className="text-xs text-muted-foreground">The title, step-off time and sign-ups come from the event. The objective also shows on the Discord roster once you publish.</p>
              <label className="block text-sm">Objective
                <textarea className={cn(inputCls, 'mt-1 min-h-[80px]')} maxLength={BRIEFING_LIMITS.objective} value={c.objective}
                  placeholder="Retake the Ruin Station hangars and escort two Hull Cs out to Checkmate."
                  onChange={(e) => setC({ ...c, objective: e.target.value })} />
              </label>
              <div>
                <div className="text-sm">Key facts <span className="text-muted-foreground">(up to 3 on the title slide)</span></div>
                {c.facts.map((f, i) => (
                  <div key={i} className="mt-2 flex gap-2">
                    <input className={cn(inputCls, 'w-36')} placeholder="Label" maxLength={BRIEFING_LIMITS.factLabel} value={f.label}
                      onChange={(e) => setC({ ...c, facts: c.facts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <input className={inputCls} placeholder="Value" maxLength={BRIEFING_LIMITS.factValue} value={f.value}
                      onChange={(e) => setC({ ...c, facts: c.facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                    <button type="button" aria-label="Remove this fact" className="px-2 text-muted-foreground hover:text-foreground" onClick={() => setC({ ...c, facts: c.facts.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>
                  </div>
                ))}
                {c.facts.length < 3 && <button type="button" className="mt-2 text-xs text-[#e2bd5b] hover:underline" onClick={() => setC({ ...c, facts: [...c.facts, { label: '', value: '' }] })}>+ Add a fact</button>}
              </div>
            </div>
          )}

          {sel === 'look' && (
            <div className="space-y-4">
              <h3 className="font-condensed text-lg font-bold uppercase tracking-wide">Logo &amp; watermark</h3>
              <p className="text-xs text-muted-foreground">Shown on every slide. Without a logo here, the server's logo from Bot Settings is used.</p>
              <div className="flex flex-wrap gap-8">
                <div>
                  <div className="mb-1 text-sm">Logo for this briefing</div>
                  <ServerImagePicker guildId={guildId} value={a.logoUrl} onChange={(logoUrl) => setA({ logoUrl })} emptyLabel="Use the server's logo" />
                  {!a.logoUrl && <p className="mt-1 text-xs text-muted-foreground">{view.logos[0]?.logoUrl ? 'Using the server\'s logo.' : 'The server has no logo yet: its tag is shown instead.'}</p>}
                </div>
                <div className="space-y-3 text-sm">
                  {view.logos.length > 1 && (
                    <label className="flex items-center gap-2"><input type="checkbox" checked={a.allyLogos} onChange={(e) => setA({ allyLogos: e.target.checked })} />Show allied servers' logos ({view.logos.slice(1).map((l) => l.tag ?? l.name).join(', ')})</label>
                  )}
                  <Choice label="Logo position" value={a.logoPosition} onChange={(logoPosition) => setA({ logoPosition })} options={[['TOP_LEFT', 'Top left'], ['TOP_RIGHT', 'Top right']]} />
                  <Choice label="Watermark" value={a.watermark} onChange={(watermark) => setA({ watermark })} options={[['CORNER', 'Large, bottom right'], ['CENTER', 'Centered'], ['TILED', 'Tiled'], ['NONE', 'None']]} />
                  <label className="flex items-center gap-3">Watermark strength
                    <input type="range" min={0} max={30} value={a.watermarkStrength} onChange={(e) => setA({ watermarkStrength: Number(e.target.value) })} className="accent-[#b98a13]" />
                    <span className="w-8 text-muted-foreground">{a.watermarkStrength}%</span>
                  </label>
                  <label className="block">Banner <span className="text-muted-foreground">(optional, e.g. ORG ONLY)</span>
                    <input className={cn(inputCls, 'mt-1 w-56')} maxLength={BRIEFING_LIMITS.banner} value={a.banner} onChange={(e) => setA({ banner: e.target.value })} />
                  </label>
                </div>
              </div>
            </div>
          )}

          {section && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <input className={cn(inputCls, 'font-condensed text-lg font-bold uppercase tracking-wide')} maxLength={BRIEFING_LIMITS.sectionTitle} value={section.title} onChange={(e) => setSection({ title: e.target.value })} aria-label="Section title" />
                <Button variant="ghost" size="sm" onClick={() => { setC({ ...c, sections: c.sections.filter((s) => s.id !== section.id) }); setSel('title'); }}><Trash2 className="mr-1 h-4 w-4" />Remove</Button>
              </div>
              {section.kind === 'fleet' && <ShipChooser guildId={guildId} eventId={view.event.id} ships={section.ships} onChange={(ships) => setSection({ ships })} />}
              {section.kind === 'roster' && <GroupsEditor guildId={guildId} roles={view.event.roles} groups={section.groups} onChange={(groups) => setSection({ groups })} />}
              {section.kind === 'image' && (
                <div>
                  <div className="mb-1 text-sm">Map or image</div>
                  <ServerImagePicker guildId={guildId} value={section.imageUrl} onChange={(imageUrl) => setSection({ imageUrl })} emptyLabel="Remove image" />
                </div>
              )}
              <label className="block text-sm">{section.kind === 'text' ? 'Text' : 'Notes'} <span className="text-muted-foreground">(start a line with "- " for a bullet)</span>
                <textarea className={cn(inputCls, 'mt-1 min-h-[180px] font-normal')} maxLength={BRIEFING_LIMITS.sectionBody} value={section.body} onChange={(e) => setSection({ body: e.target.value })} />
              </label>
              <details className="rounded-md border border-border p-3 text-sm" open={!!section.bgUrl}>
                <summary className="cursor-pointer select-none">Background picture <span className="text-muted-foreground">(optional, behind this slide)</span></summary>
                <div className="mt-3 space-y-3">
                  <ServerImagePicker guildId={guildId} value={section.bgUrl} onChange={(bgUrl) => setSection({ bgUrl })} emptyLabel="No background" />
                  {section.bgUrl && (
                    <label className="flex items-center gap-3">Opacity
                      <input type="range" min={5} max={100} value={section.bgOpacity} onChange={(e) => setSection({ bgOpacity: Number(e.target.value) })} className="accent-[#b98a13]" />
                      <span className="w-10 text-muted-foreground">{section.bgOpacity}%</span>
                    </label>
                  )}
                </div>
              </details>
              {section.kind !== 'fleet' && section.kind !== 'roster' && !sectionHasContent(section) && <p className="text-xs text-muted-foreground">Empty sections aren't shown.</p>}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>Slide preview</span>
            <button type="button" className="text-[#e2bd5b] hover:underline" onClick={() => onPreview(previewIndex)}>Present from here</button></div>
          <ScaledSlide view={view} c={c} index={previewIndex} total={slides.length} />
        </div>
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div>
      <div className="mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={cn('rounded-md border px-2.5 py-1 text-xs', value === v ? 'border-brand bg-brand/10 text-[#e2bd5b]' : 'border-border text-muted-foreground hover:text-foreground')}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function CopyFrom({ guildId, eventId, onPick, onClose }: { guildId: string; eventId: string; onPick: (b: PastBriefing) => void; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['briefings', guildId], queryFn: () => briefingsApi.past(guildId) });
  const list = (data ?? []).filter((b) => b.eventId !== eventId);
  return (
    <div className="rounded-lg border border-brand/40 bg-card p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Start from a past briefing</h3><button type="button" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button></div>
      <p className="mt-1 text-xs text-muted-foreground">Copies its objective, sections and look into this briefing (replacing what's here). The past one isn't changed.</p>
      {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">This server has no other briefings yet.</p> : (
        <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto">
          {list.map((b) => (
            <li key={b.eventId} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{b.eventName}</div>
                <div className="truncate text-xs text-muted-foreground">{when(b.startTime, { month: 'short', day: 'numeric', year: 'numeric' })}{b.outcome ? ` · ${b.outcome.toLowerCase()}` : ''} · {b.content.objective || 'No objective'}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onPick(b)}>Use this</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function BriefingPage() {
  const { guildId = '', eventId = '' } = useParams<{ guildId: string; eventId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const key = ['briefing', guildId, eventId];
  const { data: view, isLoading, error } = useQuery({ queryKey: key, queryFn: () => briefingsApi.get(guildId, eventId) });

  const editing = params.get('mode') === 'edit' && !!view?.canEdit;
  const presenting = params.has('present');
  const [draft, setDraft] = useState<BriefingContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // The editor works on a copy; a fresh briefing starts from the usual sections.
  useEffect(() => {
    if (view && !dirty) setDraft(view.briefing?.content ?? (view.canEdit ? defaultBriefing() : null));
  }, [view, dirty]);

  const content = editing ? draft : view?.briefing?.content ?? null;

  const save = useMutation({
    mutationFn: (c: BriefingContent) => briefingsApi.save(guildId, eventId, c),
    onSuccess: (b) => { setDirty(false); setMsg('Saved'); qc.setQueryData<BriefingViewDto>(key, (v) => (v ? { ...v, briefing: b } : v)); },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Could not save'),
  });
  const publish = useMutation({
    mutationFn: async (published: boolean) => {
      if (dirty && draft) await briefingsApi.save(guildId, eventId, draft);
      return briefingsApi.publish(guildId, eventId, published);
    },
    onSuccess: (b) => { setDirty(false); setMsg(b.publishedAt ? 'Published: the roster in Discord now has a Briefing button' : 'Unpublished: only editors can see it'); qc.setQueryData<BriefingViewDto>(key, (v) => (v ? { ...v, briefing: b } : v)); },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'Could not publish'),
  });
  const remove = useMutation({
    mutationFn: () => briefingsApi.remove(guildId, eventId),
    onSuccess: () => { setDirty(false); setDraft(defaultBriefing()); void qc.invalidateQueries({ queryKey: key }); setMsg('Briefing deleted'); },
  });

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setC = (c: BriefingContent) => { setDraft(c); setDirty(true); setMsg(null); };
  const setMode = (m: 'edit' | null) => setParams((p) => { const n = new URLSearchParams(p); if (m) n.set('mode', m); else n.delete('mode'); return n; }, { replace: true });
  const present = (at = 0) => setParams((p) => { const n = new URLSearchParams(p); n.set('present', String(at)); return n; });
  const stopPresenting = (_at: number) => setParams((p) => { const n = new URLSearchParams(p); n.delete('present'); return n; }, { replace: true });

  const back = `/dashboard/servers/${guildId}`;
  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading the briefing…</div>;
  if (error || !view) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">{error instanceof Error && /forbidden/i.test(error.message) ? 'You can\'t see this event\'s briefing from this server.' : 'This briefing couldn\'t be loaded.'}</p>
        <Link to={back} className="text-sm text-brand hover:underline">Back to events</Link>
      </div>
    );
  }

  const published = !!view.briefing?.publishedAt;
  const slidesTotal = content ? briefingSlides(content).length : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={() => navigate(back)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" />Events</button>
          <h1 className="mt-1 font-condensed text-2xl font-bold uppercase tracking-wide text-foreground sm:text-3xl">{view.event.name}</h1>
          <p className="text-sm text-muted-foreground">Briefing · step off {stepOff(view.event.startTime)}
            {view.canEdit && <span className={cn('ml-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold', published ? 'border-brand/60 text-[#e2bd5b]' : 'border-orange-500/50 text-orange-400')}>{published ? 'Published' : view.briefing ? 'Draft' : 'Not started'}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {content && slidesTotal > 0 && <Button variant="secondary" size="sm" onClick={() => present(0)}><MonitorPlay className="mr-1 h-4 w-4" />Present</Button>}
          {content && <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button>}
          {view.canEdit && !editing && <Button size="sm" onClick={() => setMode('edit')}><Pencil className="mr-1 h-4 w-4" />{view.briefing ? 'Edit' : 'Write the briefing'}</Button>}
          {editing && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setCopyOpen((o) => !o)}><Copy className="mr-1 h-4 w-4" />From a past op</Button>
              <Button variant="secondary" size="sm" onClick={() => setMode(null)}><Eye className="mr-1 h-4 w-4" />View</Button>
              <Button variant="secondary" size="sm" disabled={!dirty || save.isPending} onClick={() => draft && save.mutate(draft)}><Save className="mr-1 h-4 w-4" />{save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}</Button>
              <Button size="sm" disabled={publish.isPending || (!view.briefing && !dirty)} onClick={() => publish.mutate(!published)}>{published ? 'Unpublish' : 'Publish'}</Button>
            </>
          )}
        </div>
      </div>
      {msg && <p className="text-sm text-[#e2bd5b]" role="status">{msg}</p>}
      {editing && copyOpen && (
        <CopyFrom guildId={guildId} eventId={eventId} onClose={() => setCopyOpen(false)}
          onPick={(b) => { setC(b.content); setCopyOpen(false); setMsg(`Copied from ${b.eventName}. Save to keep it.`); }} />
      )}

      {editing && draft ? (
        <>
          <Editor guildId={guildId} view={view} c={draft} setC={setC} onPreview={present} />
          {view.briefing && (
            <div className="border-t border-border pt-4">
              <Button variant="ghost" size="sm" className="text-red-400" disabled={remove.isPending}
                onClick={() => { if (window.confirm('Delete this briefing? This can\'t be undone.')) remove.mutate(); }}><Trash2 className="mr-1 h-4 w-4" />Delete briefing</Button>
            </div>
          )}
        </>
      ) : content ? (
        <ReadView view={view} c={content} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {view.canEdit ? 'No briefing yet.' : 'There\'s no briefing for this event yet.'}
        </div>
      )}

      {presenting && content && (
        <Present view={view} c={content} start={Number(params.get('present')) || 0} onClose={stopPresenting} />
      )}
      {content && (
        <div className="brf-print" aria-hidden="true">
          {briefingSlides(content).map((_, i) => (
            <Slide key={i} view={view} c={content} index={i} total={slidesTotal} />
          ))}
        </div>
      )}
    </div>
  );
}
