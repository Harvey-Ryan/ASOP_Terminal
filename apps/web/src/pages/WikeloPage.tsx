// Wikelo (v1.34.0): every one of Wikelo's missions, what it rewards and what
// you turn in for it, plainly stated. Each person can tick off what they've
// collected and mark a mission complete; that checklist is theirs alone and
// never hides or reorders anything, so looking missions up for someone else
// works the same whatever you've ticked.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Search } from 'lucide-react';
import {
  searchWikelo, tickedCount, turnInQty, wikeloDiscordText, wikeloRewardTitle, WIKELO_CATEGORIES,
  type WikeloCategory, type WikeloMission, type WikeloProgressDto,
} from '@dem/shared';
import { wikeloApi } from '@/api/wikelo';
import { cn } from '@/lib/utils';
import './wikelo/wikelo.css';

type Tab = 'all' | WikeloCategory | 'mine';

const CATEGORY_WORD: Record<WikeloCategory, string> = { ships: 'Ship or vehicle', gear: 'Gear', favors: 'Favors', other: 'Other' };

// ── Scenery ───────────────────────────────────────────────────────────────────

const SWAGS: [number, number, number, string, number][] = [
  [-20, 260, 34, '#8a3e22', 0.7], [200, 520, 46, '#a8722b', 0.6], [470, 700, 22, '#2d3a58', 0.7],
  [640, 980, 40, '#7a5a3a', 0.55], [930, 1150, 30, '#8a3e22', 0.65], [1100, 1300, 40, '#a8722b', 0.6],
];
const PALM = 'M78 258 C 70 190, 70 120, 80 70 M80 70 C 50 50, 25 55, 5 75 M80 70 C 60 35, 35 25, 15 30 M80 70 C 85 35, 100 18, 120 15 M80 70 C 110 55, 130 60, 145 80 M80 70 C 95 70, 115 85, 120 110';
/** Bulbs along the string: a quadratic curve each half, a few gone dim. */
const BULBS = Array.from({ length: 22 }, (_, i) => {
  const x = i / 21;
  const q = (a: number, b: number, c: number, t: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
  const y = x <= 0.5 ? q(40, 150, 70, x / 0.5) : q(70, -5, 90, (x - 0.5) / 0.5);
  return { x, y, dim: i === 3 || i === 9 || i === 16 };
});

function Scenery() {
  return (
    <>
      <div className="wk-haze" style={{ left: '22%', top: 30, width: '56%', height: 280, background: 'rgba(127,240,226,.16)' }} />
      <div className="wk-haze" style={{ left: '-10%', top: 380, width: '60%', height: 500, background: 'rgba(240,170,80,.10)' }} />
      <div className="wk-haze" style={{ right: '-15%', top: 640, width: '70%', height: 600, background: 'rgba(200,150,90,.12)' }} />
      <div className="wk-haze" style={{ left: '10%', bottom: -200, width: '80%', height: 400, background: 'rgba(220,170,110,.18)' }} />
      <div className="wk-cloths" aria-hidden="true">
        <svg viewBox="0 0 1280 100" preserveAspectRatio="none">
          <defs>
            {SWAGS.map(([, , , c], i) => (
              <linearGradient key={i} id={`wk-f${i}`} x1="0" x2="1">
                {[0, 0.25, 0.5, 0.75, 1].map((o, j) => <stop key={o} offset={o} stopColor={c} stopOpacity={j % 2 ? 0.72 : 1} />)}
              </linearGradient>
            ))}
          </defs>
          {SWAGS.map(([a, b, sag, , op], i) => <path key={i} d={`M${a} 0 H${b} Q${(a + b) / 2} ${sag * 2} ${a} 0Z`} fill={`url(#wk-f${i})`} opacity={op} />)}
          <g stroke="#e3c48a" strokeOpacity=".25" fill="none">
            {SWAGS.map(([a, b, sag], i) => <path key={i} d={`M${a} 0 Q${(a + b) / 2} ${sag * 2} ${b} 0`} />)}
          </g>
        </svg>
      </div>
      <div className="wk-string" aria-hidden="true">
        <svg viewBox="0 0 1280 170" preserveAspectRatio="none"><path d="M0 40 Q320 150 640 70 Q960 -5 1280 90" fill="none" stroke="rgba(232,199,143,.35)" strokeWidth="1" /></svg>
        {BULBS.map((b, i) => <span key={i} className={cn('wk-bulb', b.dim && 'dim')} style={{ left: `calc(${b.x * 100}% - 3px)`, top: b.y + 2 }} />)}
      </div>
    </>
  );
}

function Sign() {
  return (
    <>
      <div className="wk-sign">
        <svg className="wk-palm" style={{ left: 'calc(50% - 310px)' }} viewBox="0 0 150 260" fill="none" stroke="#c8fff7" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d={PALM} /></svg>
        <svg className="wk-palm" style={{ right: 'calc(50% - 310px)', transform: 'scaleX(-1)' }} viewBox="0 0 150 260" fill="none" stroke="#c8fff7" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d={PALM} /></svg>
        <h1 className="m-0 font-normal">
          <span className="wk-wikelo block" aria-label="Wikelo">Wik<span className="dim">e</span>lo</span>
          <span className="wk-emporium block">Emporium</span>
        </h1>
      </div>
      <div className="wk-skyline" aria-hidden="true">
        <svg viewBox="0 0 1280 160" preserveAspectRatio="none"><path d="M0 160 V120 H60 V96 Q90 70 120 96 V110 H190 L230 80 L270 110 H340 V90 H360 V70 Q380 40 400 70 V90 H420 V118 H500 Q540 84 580 118 H660 V100 L700 76 L740 100 V120 H820 V88 Q860 52 900 88 V116 H960 L1000 92 L1040 116 H1110 V96 H1130 V78 Q1150 52 1170 78 V96 H1190 V120 H1280 V160Z" fill="#1d2a28" opacity=".55" /></svg>
      </div>
    </>
  );
}

// ── Your checklist ────────────────────────────────────────────────────────────

const MINE_KEY = ['wikelo-mine'];

function useMyChecklists() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: MINE_KEY, queryFn: wikeloApi.mine, staleTime: 60_000 });
  const byMission = useMemo(() => new Map((data ?? []).map((p) => [p.missionId, p])), [data]);
  const save = useMutation({
    mutationFn: (v: { missionId: string; ticked: string[]; completed: boolean }) => wikeloApi.save(v.missionId, { ticked: v.ticked, completed: v.completed }),
    // Show the tick straight away; the server's answer (or a refetch on failure) settles it.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: MINE_KEY });
      const before = qc.getQueryData<WikeloProgressDto[]>(MINE_KEY);
      const prev = before?.find((p) => p.missionId === v.missionId);
      const next: WikeloProgressDto = { missionId: v.missionId, ticked: v.ticked, completedAt: v.completed ? prev?.completedAt ?? new Date().toISOString() : null };
      qc.setQueryData<WikeloProgressDto[]>(MINE_KEY, (list = []) => [...list.filter((p) => p.missionId !== v.missionId), ...(v.ticked.length || v.completed ? [next] : [])]);
      return { before };
    },
    onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(MINE_KEY, ctx.before); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: MINE_KEY }); },
  });
  return { byMission, save: save.mutate, failed: save.isError };
}

// ── The list ──────────────────────────────────────────────────────────────────

function MissionList({ missions, all, selectedId, onPick, query, setQuery, tab, setTab, mine }: {
  missions: WikeloMission[];
  all: WikeloMission[];
  selectedId: string | null;
  onPick: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  mine: Map<string, WikeloProgressDto>;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, mine: all.filter((m) => mine.has(m.id)).length };
    for (const m of all) c[m.category] = (c[m.category] ?? 0) + 1;
    return c;
  }, [all, mine]);
  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    ...WIKELO_CATEGORIES.filter((c) => counts[c.key]).map((c) => ({ key: c.key as Tab, label: c.key === 'ships' ? 'Ships' : c.label })),
    { key: 'mine', label: 'Mine' },
  ];
  return (
    <div className="wk-panel">
      <div className="px-3.5 pt-3.5">
        <label className="wk-search">
          <Search aria-hidden="true" className="h-4 w-4 wk-muted" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search missions, rewards or items" aria-label="Search Wikelo's missions" />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3.5 pb-2.5 pt-2.5" role="group" aria-label="Show">
        {tabs.map((t) => (
          <button key={t.key} type="button" className="wk-tab" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label} {counts[t.key] ?? 0}
          </button>
        ))}
      </div>
      {missions.length === 0 ? (
        <p className="border-t border-[var(--wk-line)] px-3.5 py-6 text-sm wk-muted">
          {tab === 'mine' && !query ? 'Missions you tick items on or complete show here.' : 'No mission matches that.'}
        </p>
      ) : (
        <ul className="m-0 list-none p-0 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
          {missions.map((m) => {
            const p = mine.get(m.id);
            const n = p ? tickedCount(m, p.ticked) : 0;
            return (
              <li key={m.id}>
                <button type="button" className="wk-item" aria-current={m.id === selectedId} onClick={() => onPick(m.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{m.title}</span>
                    {m.onceOnly && <span className="wk-once">once</span>}
                    <span className="mt-0.5 block truncate text-xs wk-muted">
                      {wikeloRewardTitle(m)}
                      {p?.completedAt ? <span className="wk-mine"> · ✓ completed</span> : n > 0 ? <span className="wk-mine"> · {n}/{m.turnIn.length} ready</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--wk-sand)]">{m.favors ? `${m.favors} Favor` : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── One mission ───────────────────────────────────────────────────────────────

function MissionDetail({ m, progress, onSave, saveFailed, onBack }: {
  m: WikeloMission;
  progress: WikeloProgressDto | undefined;
  onSave: (v: { missionId: string; ticked: string[]; completed: boolean }) => void;
  saveFailed: boolean;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ticked = new Set(progress?.ticked ?? []);
  const done = !!progress?.completedAt;
  const n = tickedCount(m, [...ticked]);
  const single = m.rewards.length === 1 ? m.rewards[0] ?? [] : null;

  const toggle = (key: string) => {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSave({ missionId: m.id, ticked: [...next], completed: done });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wikeloDiscordText(m));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[wikelo] Copy failed:', err);
    }
  };

  return (
    <article className="wk-panel overflow-hidden" aria-labelledby="wk-reward">
      {m.image && (
        <div className="wk-hero">
          <img src={m.image} alt="" loading="lazy" />
          <span>Base ship shown · image © RSI</span>
        </div>
      )}
      <div className="px-5 pb-5 pt-4 sm:px-6">
        <button type="button" onClick={onBack} className="wk-btn ghost -ml-2 mb-2 flex items-center gap-1 px-2 lg:hidden">
          <ChevronLeft aria-hidden="true" className="h-4 w-4" /> All missions
        </button>
        <div className="wk-label text-[var(--wk-amber)]">Reward</div>
        <h2 id="wk-reward" className="wk-title m-0 mt-1">{wikeloRewardTitle(m)}</h2>
        {single && single.length > 1 && (
          <ul className="m-0 mt-2 list-none p-0 text-sm">
            {single.map((r, i) => <li key={i}>{r.amount > 1 ? `${r.amount}× ` : ''}{r.name}</li>)}
          </ul>
        )}
        {!single && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer wk-muted">Show all {m.rewards.length}</summary>
            <ul className="m-0 mt-2 list-disc pl-5">
              {m.rewards.map((g, i) => <li key={i}>{g.map((r) => `${r.amount > 1 ? `${r.amount}× ` : ''}${r.name}`).join(' + ')}</li>)}
            </ul>
          </details>
        )}
        <p className="m-0 mt-1.5 text-[13px] wk-muted">
          Mission: {m.title} · {CATEGORY_WORD[m.category]}{m.onceOnly ? ' · once only' : ''}{m.shareable ? ' · shareable' : ' · not shareable'}
        </p>

        <div className="mt-6 flex items-baseline justify-between">
          <h3 className="wk-label m-0 font-semibold text-[var(--wk-cyan)]">Turn in</h3>
          <span className="text-xs font-semibold wk-mine" aria-live="polite">{done ? 'Completed' : `${n} of ${m.turnIn.length} ticked`}</span>
        </div>
        <ul className="m-0 mt-1 list-none p-0">
          {m.turnIn.map((t) => (
            <li key={t.key}>
              <label className={cn('wk-ck', ticked.has(t.key) && 'done')}>
                <input type="checkbox" checked={ticked.has(t.key)} onChange={() => toggle(t.key)} />
                <span className="wk-qty">{turnInQty(t)}</span>
                <span className="wk-name">{t.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {m.stations.length > 0 && (
          <p className="m-0 mt-3.5 text-[13px] wk-muted">
            Turn in at any <b className="font-semibold text-[var(--wk-text)]">Wikelo Emporium</b>: {m.stations.join(', ')}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button type="button" className={cn('wk-btn', done ? 'done' : 'main')} aria-pressed={done}
            onClick={() => onSave({ missionId: m.id, ticked: [...ticked], completed: !done })}>
            {done ? '✓ Completed' : '✓ Mark complete'}
          </button>
          <button type="button" className="wk-btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy for Discord'}</button>
          {(ticked.size > 0 || done) && (
            <button type="button" className="wk-btn ghost" onClick={() => onSave({ missionId: m.id, ticked: [], completed: false })}>Start over</button>
          )}
        </div>
        {saveFailed && <p className="m-0 mt-2 text-xs text-red-300">Your last change couldn't be saved. Try again.</p>}
        <p className="m-0 mt-2 text-xs wk-muted">Your ticks are saved to your account and only you see them.</p>

        {m.description && (
          <div className="wk-desc mt-5">
            <div className="wk-label mb-1 wk-muted">Mission text</div>
            {m.description}
          </div>
        )}
      </div>
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WikeloPage() {
  const { guildId, missionId } = useParams<{ guildId: string; missionId?: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const { data, isLoading, error } = useQuery({ queryKey: ['wikelo'], queryFn: wikeloApi.missions, staleTime: 30 * 60_000 });
  const { byMission, save, failed } = useMyChecklists();

  const all = data?.missions ?? [];
  const shown = useMemo(() => {
    const list = tab === 'all' ? all : tab === 'mine' ? all.filter((m) => byMission.has(m.id)) : all.filter((m) => m.category === tab);
    return searchWikelo(list, query);
  }, [all, tab, query, byMission]);

  const selected = all.find((m) => m.id === missionId) ?? null;
  const showing = selected ?? shown[0] ?? null;
  const base = `/dashboard/servers/${guildId}/wikelo`;
  const pick = (id: string) => navigate(`${base}/${id}`);

  return (
    <div className="wk">
      <Scenery />
      <Sign />
      <div className="wk-body">
        {isLoading ? (
          <p className="py-10 text-center text-sm wk-muted">Loading Wikelo's missions…</p>
        ) : error || !data ? (
          <p className="py-10 text-center text-sm wk-muted">{error instanceof Error ? error.message : 'Wikelo\'s missions aren\'t available right now.'}</p>
        ) : (
          <>
            <p className="m-0 mb-3 mt-2 flex flex-wrap gap-x-4 text-[13px] wk-muted">
              <span><b className="font-semibold text-[var(--wk-dust)]">{all.length}</b> missions</span>
              <span>Turn in at a Wikelo Emporium station</span>
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className={cn('min-w-0', selected && 'hidden lg:block')}>
                <MissionList missions={shown} all={all} selectedId={showing?.id ?? null} onPick={pick} query={query} setQuery={setQuery} tab={tab} setTab={setTab} mine={byMission} />
              </div>
              <div className={cn('min-w-0', !selected && 'hidden lg:block')}>
                {showing && (
                  <MissionDetail key={showing.id} m={showing} progress={byMission.get(showing.id)} onSave={save} saveFailed={failed} onBack={() => navigate(base)} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
