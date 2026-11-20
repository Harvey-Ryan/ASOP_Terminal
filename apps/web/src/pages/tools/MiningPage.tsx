// Mining (v1.49.0): the ore finder (where an ore is the main ore of a rock, by
// place, with both quality bands), the scanner signature lookup, every rock
// signature, and the mining lasers, modules and gadgets. Exact numbers from
// the game files; nothing estimated. Lives at /tools/mining and in each
// server's dashboard. The view and ore are in the address (?view=, ?ore=),
// and the scanner's place too (?at=, v1.52.0). Community corrections
// (v1.53.0) are applied on top unless the viewer picks "Game files"; every
// correctable stat has a subtle ✎ to submit one (pages/tools/corrections.tsx).
// Since v1.54.0 it sits in the Crafting Calculator's "bay" frame (fabrication.css,
// `.fab.gt`) like Crafting and Blueprints: the ore finder is list · ore · scanner.
// The Refinery view (v1.58.0, RefineryView.tsx) is a work-order calculator on UEX's data.

import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useToolsPaths } from '@/lib/toolsPaths';
import '../crafting/fabrication.css';
import {
  applyCorrections,
  rockRecordKey,
  matchSignature,
  scanHitLabel,
  MINING_METHOD_LABELS,
  SCAN_METHOD_LABELS,
  oreName,
  type MiningGadget,
  type MiningLaser,
  type MiningMethod,
  type MiningModule,
  type OreSpot,
  type RockSignature,
  type ScanMethod,
} from '@dem/shared';
import { fmt, trackDownload, useMiningData } from '../../lib/gameTools';
import { ToolsDataState } from './ToolsLayout';
import { GADGET_MOD_COLUMNS, LASER_MOD_COLUMNS, MOD_COLUMNS, ModCell } from './miningBits';
import { BuildBadge, CorrectionsProvider, DataViewToggle, Fix, useCorrections } from './corrections';
import { Heading, Plate } from './bay';
import { RefineryView } from './RefineryView';

type View = 'ores' | 'refinery' | 'signatures' | 'lasers' | 'modules' | 'gadgets';
const VIEWS: { id: View; label: string }[] = [
  { id: 'ores', label: 'Ore finder' },
  { id: 'refinery', label: 'Refinery' },
  { id: 'signatures', label: 'Rock signatures' },
  { id: 'lasers', label: 'Lasers' },
  { id: 'modules', label: 'Modules' },
  { id: 'gadgets', label: 'Gadgets' },
];

const METHOD_WORD: Record<MiningMethod, string> = { ship: 'Ship', roc: 'ROC', hand: 'By hand' };

export function MiningPage() {
  const { data: files, isLoading, error } = useMiningData();
  const { index } = useCorrections();
  // Corrections (when the viewer uses them) go in before anything sorts, matches or adds up.
  const data = useMemo(
    () =>
      files && {
        ...files,
        signatures: applyCorrections(files.signatures, 'rock-signature', rockRecordKey, index),
        lasers: applyCorrections(files.lasers, 'mining-laser', (l) => l.uuid, index),
        modules: applyCorrections(files.modules, 'mining-module', (m) => m.uuid, index),
        gadgets: applyCorrections(files.gadgets ?? [], 'mining-gadget', (g) => g.uuid, index),
      },
    [files, index],
  );
  const [params, setParams] = useSearchParams();
  const paths = useToolsPaths();
  const location = useLocation();
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'ores') as View;
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  // In a server's dashboard the page fills the content area like the calculator; on /tools it sits under the tools bar.
  const frame = cn('fab gt pb-10', !paths.standalone && '-m-6');
  const frameStyle = paths.standalone ? undefined : { minHeight: 'calc(100% + 3rem)' };
  if (!data)
    return (
      <div className={frame} style={frameStyle}>
        <ToolsDataState isLoading={isLoading} error={error} />
      </div>
    );
  return (
    <CorrectionsProvider build={data.build}>
      <div className={frame} style={frameStyle}>
        <div aria-hidden="true" className="fab-hazard h-2 opacity-85" />
        <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#0d0d0d] px-5 pb-4 pt-5 shadow-[0_1px_0_#2c2c2c] sm:px-8">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="fab-stencil flex h-11 w-11 items-center justify-center border-2 border-[var(--fab-gold)] text-xl text-[var(--fab-gold-text)]"
            >
              M
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="fab-label">Extraction bay{data.build ? ` · ${data.build}` : ''}</span>
              <h1 className="fab-stencil m-0 text-[26px] text-[var(--fab-gold-text)] sm:text-[32px]">MINING</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!paths.standalone && (
              <>
                <BuildBadge />
                <DataViewToggle />
                <a
                  href={`/tools/mining${location.search}`}
                  className="text-sm text-[var(--fab-muted)] hover:text-[var(--fab-bright)]"
                >
                  Open on its own page
                </a>
              </>
            )}
            <span className="fab-mono border border-[#333] bg-[#121212] px-2.5 py-1.5 text-xs text-[var(--fab-muted)]">
              <span className="font-semibold text-[var(--fab-gold-text)]">{data.ores.length}</span> ORES ·{' '}
              <span className="font-semibold text-[var(--fab-gold-text)]">{data.lasers.length}</span> LASERS
            </span>
          </div>
        </header>
        <RockCrawlerStrip />
        <nav
          aria-label="Mining views"
          className="flex flex-wrap gap-x-6 border-b border-[#2c2c2c] bg-[#141414] px-5 sm:px-8"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="fab-view fab-label text-[13px]"
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => set('view', v.id === 'ores' ? null : v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="px-5 pt-6 sm:px-8">
          {view === 'ores' && (
            <OreFinder
              spots={data.spots}
              ores={data.ores}
              signatures={data.signatures}
              ore={params.get('ore') ?? 'quantainium'}
              picked={params.has('ore')}
              setOre={(o) => set('ore', o)}
              place={params.get('at')}
              setPlace={(p) => set('at', p)}
            />
          )}
          {view === 'refinery' && <RefineryView get={(k) => params.get(k)} set={set} />}
          {view === 'signatures' && (
            <Signatures
              signatures={data.signatures}
              spots={data.spots}
              place={params.get('at')}
              setPlace={(p) => set('at', p)}
            />
          )}
          {view === 'lasers' && <Lasers lasers={data.lasers} />}
          {view === 'modules' && <Modules modules={data.modules} />}
          {view === 'gadgets' && <Gadgets gadgets={data.gadgets ?? []} />}
          <p className="m-0 pt-5 text-xs text-[var(--fab-muted)]">
            From the game files
            {data.build ? (
              <>
                , build <span className="fab-mono">{data.build}</span>
              </>
            ) : null}
            , with members&rsquo; corrections where they found the files wrong (dotted underline; hover for who).
            Refinery bonuses and prices are player-reported on UEX.
          </p>
        </div>
      </div>
    </CorrectionsProvider>
  );
}

// ASOP RockCrawler (v1.55.0): the desktop overlay that reads the signature off the HUD with
// this page's data. GitHub's latest-release address always serves the newest installer
// (its release workflow uploads it as RockCrawler-Setup.exe).
const ROCKCRAWLER_REPO = 'https://github.com/Harvey-Ryan/ASOP_RockCrawler';
const ROCKCRAWLER_SETUP = `${ROCKCRAWLER_REPO}/releases/latest/download/RockCrawler-Setup.exe`;

function RockCrawlerStrip() {
  const { standalone } = useToolsPaths();
  return (
    <section
      aria-label="ASOP RockCrawler"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-[#2c2c2c] bg-[#121212] px-5 py-3 sm:px-8"
    >
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="fab-stencil text-[17px] text-[var(--fab-gold-text)]">ROCKCRAWLER</span>
          <span className="fab-label">Desktop overlay · Windows 10/11 · free</span>
        </span>
        <span className="text-sm text-[var(--fab-text)]">
          Reads the signature off your HUD and shows the rock right beside it, using this page&rsquo;s scanner data. It
          updates itself.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={ROCKCRAWLER_SETUP}
          className="fab-btn-primary inline-flex h-11 items-center px-4 text-[15px] no-underline"
          download
          onClick={() => trackDownload('rockcrawler', standalone ? 'tools' : 'dashboard')}
        >
          Download for Windows
        </a>
        <a
          href={`${ROCKCRAWLER_REPO}#readme`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-[var(--fab-muted)] underline underline-offset-2 hover:text-[var(--fab-bright)]"
        >
          How it works
        </a>
        <a
          href={`${ROCKCRAWLER_REPO}/releases/latest`}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-[var(--fab-muted)] underline underline-offset-2 hover:text-[var(--fab-bright)]"
        >
          What&rsquo;s new
        </a>
      </div>
      <p className="m-0 w-full text-xs text-[var(--fab-muted)]">
        The installer isn&rsquo;t code-signed yet, so Windows may say it protected your PC: choose{' '}
        <b className="text-[var(--fab-text)]">More info → Run anyway</b>. Set Star Citizen to Borderless so the overlay
        can show.
      </p>
    </section>
  );
}

/** The right-hand panel, as the calculator's build list. */
function ScannerPanel({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Scanner" className="fab-plate min-w-0 flex-[1_1_300px] lg:max-w-[380px]">
      <div aria-hidden="true" className="fab-hazard-thin h-1.5" />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <h2 className="fab-stencil m-0 text-[22px] text-[var(--fab-gold-text)]">SCANNER</h2>
        {children}
      </div>
    </aside>
  );
}

// ── A sortable table ─────────────────────────────────────────────────────────

interface Col<T> {
  key: string;
  label: string;
  sort?: (x: T) => number | string | null;
  render: (x: T) => ReactNode;
  num?: boolean;
  low?: boolean;
}

function SortTable<T>({
  rows,
  cols,
  initial,
  rowKey,
  minWidth = 900,
}: {
  rows: T[];
  cols: Col<T>[];
  initial: string;
  rowKey: (x: T) => string;
  minWidth?: number;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({
    key: initial,
    dir: cols.find((c) => c.key === initial)?.low || !cols.find((c) => c.key === initial)?.num ? 1 : -1,
  });
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sort!(a),
        bv = col.sort!(b);
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (
        (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * sort.dir
      );
    });
  }, [rows, cols, sort]);
  return (
    <div className="gt-scroll">
      <table className="gt-table" style={{ minWidth }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''}>
                {c.sort ? (
                  <button
                    type="button"
                    className="whitespace-nowrap"
                    aria-pressed={sort.key === c.key}
                    onClick={() =>
                      setSort((s) => ({
                        key: c.key,
                        dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.low || !c.num ? 1 : -1,
                      }))
                    }
                  >
                    {c.label}
                    {sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {cols.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={label}>
      <span className="fab-label">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className="fab-btn h-9 px-3 text-xs"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Ore finder ───────────────────────────────────────────────────────────────

const bandsText = (s: OreSpot) => s.bands.map((b) => `${fmt(b.minPct, 1)}–${fmt(b.maxPct, 1)}%  Q ${b.minQ}–${b.maxQ}`);
const cluster = (s: { clusterMin: number | null; clusterMax: number | null }) =>
  s.clusterMin == null ? '–' : s.clusterMin === s.clusterMax ? `${s.clusterMin}` : `${s.clusterMin}–${s.clusterMax}`;

function OreFinder({
  spots,
  ores,
  signatures,
  ore,
  picked,
  setOre,
  place,
  setPlace,
}: {
  spots: OreSpot[];
  ores: { key: string; name: string }[];
  signatures: RockSignature[];
  ore: string;
  picked: boolean;
  setOre: (o: string | null) => void;
  place: string | null;
  setPlace: (p: string | null) => void;
}) {
  const [system, setSystem] = useState('All');
  const [method, setMethod] = useState('All');
  const found = ores.find((o) => o.key === ore) ?? ores[0];
  const forOre = useMemo(() => spots.filter((s) => s.ore === found?.key), [spots, found]);
  const systems = ['All', ...new Set(forOre.map((s) => s.system))].sort((a, b) =>
    a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b),
  );
  const methods = [
    'All',
    ...(['ship', 'roc', 'hand'] as const).filter((m) => forOre.some((s) => s.method === m)).map((m) => METHOD_WORD[m]),
  ];
  const shown = forOre.filter(
    (s) => (system === 'All' || s.system === system) && (method === 'All' || METHOD_WORD[s.method] === method),
  );
  const rocks = [...new Map(forOre.map((s) => [`${s.rock}|${s.method}`, s])).values()];
  const bestQ = Math.max(0, ...forOre.flatMap((s) => s.bands.map((b) => b.maxQ)));

  const cols: Col<OreSpot>[] = [
    {
      key: 'place',
      label: 'Location',
      sort: (s) => s.place,
      render: (s) => (
        <>
          <span className="font-semibold gt-hi">{s.place}</span>
          <span className="block text-xs gt-dim">
            {s.system}
            {s.kind ? ` · ${s.kind}` : ''}
          </span>
        </>
      ),
    },
    {
      key: 'rock',
      label: 'Rock',
      sort: (s) => s.rock,
      render: (s) => (
        <>
          <span className="gt-acc font-medium">{s.rock}</span>
          <span className="block text-xs gt-dim">mined by {MINING_METHOD_LABELS[s.method]}</span>
        </>
      ),
    },
    {
      key: 'chance',
      label: 'Chance',
      num: true,
      sort: (s) => s.chance,
      render: (s) => (
        <>
          <span className="gt-hi">{fmt(s.chance * 100, 1)}%</span>
          {s.groupChance != null && (
            <span
              className="block text-xs gt-dim"
              title={`How often a spawn at this place is ${MINING_METHOD_LABELS[s.method]} rocks at all, as the game files give it`}
            >
              of {fmt(s.groupChance * 100, s.groupChance < 0.1 ? 1 : 0)}% spawns
            </span>
          )}
        </>
      ),
    },
    {
      key: 'bands',
      label: 'Share · quality',
      render: (s) => (
        <span className="gt-mono text-[13px] whitespace-pre-line leading-relaxed">{bandsText(s).join('\n')}</span>
      ),
    },
    { key: 'sig', label: 'Signature', num: true, sort: (s) => s.signature, render: (s) => fmt(s.signature) },
    { key: 'cluster', label: 'Rocks', num: true, sort: (s) => s.clusterMax, render: (s) => cluster(s) },
  ];

  return (
    <div className="flex flex-wrap items-start gap-5 xl:flex-nowrap">
      {/* On a phone, a picked ore replaces the list (as a picked blueprint does in the calculator). */}
      <OreList
        ores={ores}
        spots={spots}
        ore={found?.key ?? ''}
        setOre={setOre}
        className={picked ? 'hidden lg:flex' : undefined}
      />

      <Plate label={found?.name} className="flex-[999_1_480px]">
        {picked && (
          <button
            type="button"
            onClick={() => setOre(null)}
            className="fab-btn -mt-1 flex h-9 w-fit items-center px-2.5 text-xs lg:hidden"
          >
            ‹ All ores
          </button>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="fab-label">
            Ore · mined by{' '}
            {methods
              .filter((m) => m !== 'All')
              .join(', ')
              .toLowerCase() || '–'}
          </span>
          <h2 className="fab-stencil m-0 text-[26px] leading-tight text-[var(--fab-bright)] sm:text-[30px]">
            {(found?.name ?? '').toUpperCase()}
          </h2>
          <span className="fab-mono text-xs text-[var(--fab-muted)]">
            Main ore at {new Set(forOre.map((s) => `${s.place}|${s.system}`)).size} places ·{' '}
            {new Set(forOre.map((s) => s.rock)).size} rock type
            {new Set(forOre.map((s) => s.rock)).size === 1 ? '' : 's'}
            {forOre.length ? ` · best chance ${fmt(Math.max(...forOre.map((s) => s.chance)) * 100, 1)}%` : ''}
            {bestQ ? ` · quality up to ${bestQ}` : ''}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <Heading>WHERE IT&rsquo;S THE MAIN ORE</Heading>
          {(systems.length > 2 || methods.length > 2) && (
            <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
              {systems.length > 2 && <Chips label="System" options={systems} value={system} onChange={setSystem} />}
              {methods.length > 2 && <Chips label="Mined by" options={methods} value={method} onChange={setMethod} />}
            </div>
          )}
          {shown.length ? (
            <SortTable
              rows={shown}
              cols={cols}
              initial="chance"
              rowKey={(s) => `${s.place}|${s.system}|${s.method}|${s.rock}`}
              minWidth={660}
            />
          ) : (
            <p className="m-0 text-[var(--fab-muted)]">No {found?.name} rocks match those filters.</p>
          )}
          <p className="m-0 max-w-[900px] text-xs leading-relaxed text-[var(--fab-muted)]">
            Chance is the share of that mining method&rsquo;s rocks at the place that are this rock; under it, how often
            the place spawns that kind of rock at all. Each rock gives its main ore either as a small share at high
            quality or a large share at low quality: both bands are listed.
          </p>
        </div>

        {rocks.length > 0 && (
          <div className="flex flex-col gap-3">
            <Heading>{rocks.length === 1 ? 'THE ROCK' : 'THE ROCKS'}</Heading>
            <div className="grid gap-3 sm:grid-cols-2">
              {rocks.map((s) => (
                <div key={`${s.rock}|${s.method}`} className="fab-inset flex flex-col px-3.5 py-2.5">
                  <span className="fab-label pb-1 text-[var(--fab-text)]">
                    {s.rock} · {MINING_METHOD_LABELS[s.method]}
                  </span>
                  {[
                    ['Signature (one rock)', fmt(s.signature)],
                    ['Cluster', `${cluster(s)} rocks`],
                    ...s.bands.map((b, i) => [
                      i === 0 ? 'High-quality band' : 'Lower-quality band',
                      `${fmt(b.minPct, 1)}–${fmt(b.maxPct, 1)}% · Q ${b.minQ}–${b.maxQ}`,
                    ]),
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-[#222] py-1.5 last:border-0"
                    >
                      <span className="text-sm">{k}</span>
                      <span className="fab-mono ml-auto text-[13px] text-[var(--fab-bright)]">{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </Plate>

      <ScannerPanel>
        <Scanner signatures={signatures} spots={spots} place={place} setPlace={setPlace} />
      </ScannerPanel>
    </div>
  );
}

/** The left list, as the calculator's blueprint list: search, a filter, then every ore. */
function OreList({
  ores,
  spots,
  ore,
  setOre,
  className,
}: {
  ores: { key: string; name: string }[];
  spots: OreSpot[];
  ore: string;
  setOre: (o: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState('All');
  const facts = useMemo(() => {
    const m = new Map<string, { places: Set<string>; methods: Set<MiningMethod>; best: number }>();
    for (const s of spots) {
      const f = m.get(s.ore) ?? { places: new Set(), methods: new Set(), best: 0 };
      f.places.add(`${s.place}|${s.system}`);
      f.methods.add(s.method);
      f.best = Math.max(f.best, s.chance);
      m.set(s.ore, f);
    }
    return m;
  }, [spots]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = ores.filter((o) => {
    const f = facts.get(o.key);
    if (method !== 'All' && !(f && [...f.methods].some((x) => METHOD_WORD[x] === method))) return false;
    return words.every((w) => o.name.toLowerCase().includes(w));
  });
  return (
    <section
      aria-label="Ores"
      className={cn('flex min-w-0 flex-[1_1_260px] flex-col gap-3 lg:max-w-[330px]', className)}
    >
      <label className="flex flex-col gap-1.5">
        <span className="fab-label">Search</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ore…"
          className="fab-input h-11 w-full px-3 text-[15px] outline-none"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="fab-label">Mined by</span>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="fab-input h-10 w-full px-2 text-sm outline-none"
        >
          {['All', 'Ship', 'ROC', 'By hand'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <p className="fab-mono m-0 text-xs text-[var(--fab-faint)]" aria-live="polite">
        {list.length} ore{list.length === 1 ? '' : 's'}
      </p>
      <div className="fab-plate fab-scroll flex flex-col lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto">
        {list.map((o) => {
          const f = facts.get(o.key);
          return (
            <div key={o.key} className="fab-row flex" aria-current={o.key === ore ? 'true' : undefined}>
              <button
                type="button"
                onClick={() => setOre(o.key)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2.5 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold text-[var(--fab-bright)]">{o.name}</span>
                  {f && (
                    <span className="fab-mono shrink-0 text-xs text-[var(--fab-faint)]">{fmt(f.best * 100, 1)}%</span>
                  )}
                </span>
                <span className="fab-mono text-[11.5px] text-[var(--fab-muted)]">
                  {f
                    ? `${f.places.size} place${f.places.size === 1 ? '' : 's'} · ${[...f.methods].map((x) => METHOD_WORD[x].toLowerCase()).join(', ')}`
                    : 'not the main ore anywhere'}
                </span>
              </button>
            </div>
          );
        })}
        {!list.length && <p className="m-0 px-4 py-6 text-sm text-[var(--fab-muted)]">No ore matches.</p>}
      </div>
    </section>
  );
}

/** Places to narrow the scanner to, by system (only places with rocks the scanner can match). */
function placeOptions(
  signatures: readonly RockSignature[],
  spots: readonly OreSpot[],
): { system: string; places: string[] }[] {
  const known = new Set(signatures.flatMap((s) => s.places));
  const bySystem = new Map<string, Set<string>>();
  for (const s of spots)
    if (known.has(s.place)) bySystem.set(s.system, (bySystem.get(s.system) ?? new Set()).add(s.place));
  return [...bySystem]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([system, set]) => ({ system, places: [...set].sort() }));
}

function Scanner({
  signatures,
  spots,
  place,
  setPlace,
}: {
  signatures: RockSignature[];
  spots: OreSpot[];
  place: string | null;
  setPlace: (p: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
  const options = useMemo(() => placeOptions(signatures, spots), [signatures, spots]);
  const at = place && options.some((o) => o.places.includes(place)) ? place : null;
  const hits = matchSignature(n, signatures, { place: at, spots });
  return (
    <section className="flex flex-col gap-2.5">
      <label htmlFor="gt-sig" className="fab-label">
        What&rsquo;s on my scanner?
      </label>
      <input
        id="gt-sig"
        inputMode="numeric"
        className="gt-input gt-mono text-xl"
        placeholder="e.g. 7650"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <label htmlFor="gt-at" className="fab-label">
        Where are you? <span className="normal-case tracking-normal">(optional)</span>
      </label>
      <select id="gt-at" className="gt-input" value={at ?? ''} onChange={(e) => setPlace(e.target.value || null)}>
        <option value="">Anywhere</option>
        {options.map((o) => (
          <optgroup key={o.system} label={o.system}>
            {o.places.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {hits.map((h) => (
        <div key={`${h.method}|${h.each}|${h.count}`} className="flex items-baseline justify-between gap-3 py-2 gt-row">
          <span>
            <b className="gt-hi font-semibold">{scanHitLabel(h)}</b>{' '}
            <span className="text-xs gt-dim">{SCAN_METHOD_LABELS[h.method]}</span>
            {at && h.rocks.some((r) => r.chance != null) && (
              <span className="block text-xs gt-dim">
                {h.rocks
                  .filter((r) => r.chance != null)
                  .map(
                    (r) =>
                      `${r.rock} ${fmt(r.chance! * 100, 1)}% of ${SCAN_METHOD_LABELS[h.method].toLowerCase()} rocks here`,
                  )
                  .join(' · ')}
              </span>
            )}
          </span>
          <span className="gt-mono text-[13px] gt-dim whitespace-nowrap">{fmt(h.each)} each</span>
        </div>
      ))}
      {n > 0 && !hits.length && (
        <span className="text-sm gt-dim">
          Nothing {at ? `found at ${at} ` : ''}adds up to that number. Check the digits: neighbouring ores are only 15
          apart.
        </span>
      )}
      <span className="text-xs gt-dim">
        A cluster reads as one rock&rsquo;s signature times the number of rocks in it, up to the most that rock ever
        clusters in (legendary ores 2, epic 3, rare 4, uncommon 5, common 6).
      </span>
    </section>
  );
}

// ── Rock signatures ──────────────────────────────────────────────────────────

const SIG_METHODS: ScanMethod[] = ['ship', 'roc', 'hand', 'salvage'];

function Signatures({
  signatures,
  spots,
  place,
  setPlace,
}: {
  signatures: RockSignature[];
  spots: OreSpot[];
  place: string | null;
  setPlace: (p: string | null) => void;
}) {
  const [method, setMethod] = useState('Ship');
  const methods = [
    'All',
    ...SIG_METHODS.filter((m) => signatures.some((s) => s.method === m)).map((m) => SCAN_METHOD_LABELS[m]),
  ];
  const rows = signatures.filter((s) => method === 'All' || SCAN_METHOD_LABELS[s.method] === method);
  const cols: Col<RockSignature>[] = [
    {
      key: 'rock',
      label: 'Rock',
      sort: (s) => s.rock,
      render: (s) => (
        <>
          <span className="font-semibold gt-hi">{s.rock}</span>
          <span className="block text-xs gt-dim">
            {s.ore === 'salvage' ? 'Salvage' : `${oreName(s.ore)} · ${MINING_METHOD_LABELS[s.method as MiningMethod]}`}
          </span>
        </>
      ),
    },
    ...[1, 2, 3, 4, 5, 6].map((k) => ({
      key: `x${k}`,
      label: k === 1 ? 'One rock' : `× ${k}`,
      num: true,
      sort: k === 1 ? (s: RockSignature) => s.signature : undefined,
      render: (s: RockSignature) =>
        k > s.maxCluster ? (
          <span className="gt-dim" title="Never this many in one cluster">
            –
          </span>
        ) : k === 1 ? (
          <Fix
            kind="rock-signature"
            recordKey={rockRecordKey(s)}
            recordName={s.rock}
            field="signature"
            value={s.signature}
          >
            <span className="gt-hi">{fmt(s.signature)}</span>
          </Fix>
        ) : (
          <span>{fmt(s.signature * k)}</span>
        ),
    })),
    {
      key: 'max',
      label: 'Most in a cluster',
      num: true,
      sort: (s) => s.maxCluster,
      render: (s) => (
        <Fix
          kind="rock-signature"
          recordKey={rockRecordKey(s)}
          recordName={s.rock}
          field="maxCluster"
          value={s.maxCluster}
        >
          {s.maxCluster}
        </Fix>
      ),
    },
  ];
  return (
    <div className="flex flex-wrap items-start gap-5 xl:flex-nowrap">
      <Plate label="Rock signatures" className="flex-[999_1_620px]">
        <Heading>ROCK SIGNATURES</Heading>
        <Chips label="Scanned by" options={methods} value={method} onChange={setMethod} />
        <SortTable rows={rows} cols={cols} initial="x1" rowKey={(s) => `${s.rock}|${s.method}`} minWidth={820} />
        <p className="m-0 text-xs text-[var(--fab-muted)]">
          What the scanner shows for a cluster of 1 to 6 rocks of each type. A dash means that rock never clusters that
          big, so the number can&rsquo;t be it. ROC and hand-mining gems all share one signature, so the scanner
          can&rsquo;t tell them apart.
        </p>
      </Plate>
      <ScannerPanel>
        <Scanner signatures={signatures} spots={spots} place={place} setPlace={setPlace} />
      </ScannerPanel>
    </div>
  );
}

// ── Lasers and modules ───────────────────────────────────────────────────────

function Lasers({ lasers }: { lasers: MiningLaser[] }) {
  const [size, setSize] = useState('All');
  const sizeLabel = (n: number) => (n === 0 ? 'ROC & hand' : `Size ${n}`);
  const sizes = ['All', ...[...new Set(lasers.map((l) => l.size))].sort().map(sizeLabel)];
  const rows = lasers.filter((l) => size === 'All' || sizeLabel(l.size) === size);
  const cols: Col<MiningLaser>[] = [
    {
      key: 'name',
      label: 'Laser',
      sort: (l) => l.name,
      render: (l) => (
        <>
          <span className="font-semibold gt-hi">{l.name.replace(/ Mining Laser$/, '')}</span>
          <span className="block text-xs gt-dim">
            {l.maker} · {l.size === 0 ? 'ROC / multi-tool' : `size ${l.size}`}
          </span>
        </>
      ),
    },
    {
      key: 'power',
      label: 'Power',
      num: true,
      sort: (l) => l.power,
      render: (l) => (
        <Fix kind="mining-laser" recordKey={l.uuid} recordName={l.name} field="power" value={l.power}>
          <span className="gt-hi">{fmt(l.power)}</span>
        </Fix>
      ),
    },
    {
      key: 'min',
      label: 'Min power',
      num: true,
      sort: (l) => l.minPower,
      render: (l) => (
        <Fix kind="mining-laser" recordKey={l.uuid} recordName={l.name} field="minPower" value={l.minPower}>
          {fmt(l.minPower, l.minPower != null && l.minPower % 1 ? 1 : 0)}
        </Fix>
      ),
    },
    {
      key: 'ext',
      label: 'Extraction',
      num: true,
      sort: (l) => l.extraction,
      render: (l) => (
        <Fix kind="mining-laser" recordKey={l.uuid} recordName={l.name} field="extraction" value={l.extraction}>
          {fmt(l.extraction)}
        </Fix>
      ),
    },
    {
      key: 'opt',
      label: 'Optimal m',
      num: true,
      sort: (l) => l.optimalRange,
      render: (l) => (
        <Fix kind="mining-laser" recordKey={l.uuid} recordName={l.name} field="optimalRange" value={l.optimalRange}>
          {fmt(l.optimalRange)}
        </Fix>
      ),
    },
    {
      key: 'max',
      label: 'Max m',
      num: true,
      sort: (l) => l.maxRange,
      render: (l) => (
        <Fix kind="mining-laser" recordKey={l.uuid} recordName={l.name} field="maxRange" value={l.maxRange}>
          {fmt(l.maxRange)}
        </Fix>
      ),
    },
    {
      key: 'slots',
      label: 'Modules',
      num: true,
      sort: (l) => l.moduleSlots,
      render: (l) => (
        <Fix kind="mining-laser" recordKey={l.uuid} recordName={l.name} field="moduleSlots" value={l.moduleSlots}>
          {l.moduleSlots}
        </Fix>
      ),
    },
    ...LASER_MOD_COLUMNS.map((m) => ({
      key: m.key,
      label: m.label,
      num: true,
      low: m.lowerIsBetter,
      sort: (l: MiningLaser) => l.modifiers[m.key] ?? 0,
      render: (l: MiningLaser) => (
        <Fix
          kind="mining-laser"
          recordKey={l.uuid}
          recordName={l.name}
          field={`modifiers.${m.key}`}
          value={l.modifiers[m.key] ?? 0}
        >
          <ModCell v={l.modifiers[m.key]} lowerIsBetter={m.lowerIsBetter} />
        </Fix>
      ),
    })),
  ];
  return (
    <Plate label="Mining lasers">
      <Heading>MINING LASERS</Heading>
      <Chips label="Size" options={sizes} value={size} onChange={setSize} />
      <SortTable rows={rows} cols={cols} initial="power" rowKey={(l) => l.uuid} minWidth={1200} />
      <p className="m-0 text-xs text-[var(--fab-muted)]">
        Green helps the miner, red hurts. Inert is the share of inert material the laser filters out of what you
        collect.
      </p>
    </Plate>
  );
}

function Modules({ modules }: { modules: MiningModule[] }) {
  const [kind, setKind] = useState('All');
  const rows = modules.filter((m) => kind === 'All' || m.kind === kind);
  const cols: Col<MiningModule>[] = [
    {
      key: 'name',
      label: 'Module',
      sort: (m) => m.name,
      render: (m) => (
        <>
          <span className="font-semibold gt-hi">{m.name.replace(/ Module$/, '')}</span>
          <span className="block text-xs gt-dim">
            {m.maker ?? ''}
            {m.rarity ? ` · ${m.rarity}` : ''}
          </span>
        </>
      ),
    },
    { key: 'kind', label: 'Kind', sort: (m) => m.kind, render: (m) => <span className="text-sm">{m.kind}</span> },
    {
      key: 'uses',
      label: 'Uses',
      num: true,
      sort: (m) => m.charges,
      render: (m) =>
        m.kind === 'Active' ? (
          <>
            <Fix kind="mining-module" recordKey={m.uuid} recordName={m.name} field="charges" value={m.charges}>
              {m.charges ?? '–'}
            </Fix>{' '}
            ×{' '}
            <Fix kind="mining-module" recordKey={m.uuid} recordName={m.name} field="lifetime" value={m.lifetime}>
              {m.lifetime ?? '–'}
            </Fix>{' '}
            s
          </>
        ) : (
          '–'
        ),
    },
    {
      key: 'power',
      label: 'Power',
      num: true,
      sort: (m) => m.power ?? 1,
      render: (m) => (
        <Fix kind="mining-module" recordKey={m.uuid} recordName={m.name} field="power" value={m.power ?? 1}>
          {m.power == null || m.power === 1 ? (
            <span className="gt-dim">–</span>
          ) : (
            <span className={m.power > 1 ? 'gt-good' : 'gt-bad'}>×{fmt(m.power, 2)}</span>
          )}
        </Fix>
      ),
    },
    ...MOD_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      num: true,
      low: c.lowerIsBetter,
      sort: (m: MiningModule) => m.modifiers[c.key] ?? 0,
      render: (m: MiningModule) => (
        <Fix
          kind="mining-module"
          recordKey={m.uuid}
          recordName={m.name}
          field={`modifiers.${c.key}`}
          value={m.modifiers[c.key] ?? 0}
        >
          <ModCell v={m.modifiers[c.key]} lowerIsBetter={c.lowerIsBetter} />
        </Fix>
      ),
    })),
  ];
  return (
    <Plate label="Mining modules">
      <Heading>MINING MODULES</Heading>
      <Chips label="Kind" options={['All', 'Active', 'Passive']} value={kind} onChange={setKind} />
      <SortTable rows={rows} cols={cols} initial="power" rowKey={(m) => m.uuid} minWidth={1200} />
      <p className="m-0 text-xs text-[var(--fab-muted)]">
        Active modules are used up: uses × seconds each. Green helps the miner, red hurts.
      </p>
    </Plate>
  );
}

function Gadgets({ gadgets }: { gadgets: MiningGadget[] }) {
  const cols: Col<MiningGadget>[] = [
    {
      key: 'name',
      label: 'Gadget',
      sort: (g) => g.name,
      render: (g) => (
        <>
          <span className="font-semibold gt-hi">{g.name}</span>
          <span className="block text-xs gt-dim">
            {g.maker ?? ''}
            {g.rarity ? ` · ${g.rarity}` : ''}
          </span>
        </>
      ),
    },
    ...GADGET_MOD_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      num: true,
      low: c.lowerIsBetter,
      sort: (g: MiningGadget) => g.modifiers[c.key] ?? 0,
      render: (g: MiningGadget) => (
        <Fix
          kind="mining-gadget"
          recordKey={g.uuid}
          recordName={g.name}
          field={`modifiers.${c.key}`}
          value={g.modifiers[c.key] ?? 0}
        >
          <ModCell v={g.modifiers[c.key]} lowerIsBetter={c.lowerIsBetter} />
        </Fix>
      ),
    })),
  ];
  return (
    <Plate label="Mining gadgets">
      <Heading>GADGETS</Heading>
      {gadgets.length ? (
        <SortTable rows={gadgets} cols={cols} initial="name" rowKey={(g) => g.uuid} minWidth={660} />
      ) : (
        <p className="gt-dim m-0">No gadgets in this build&rsquo;s data.</p>
      )}
      <p className="text-xs gt-dim m-0 max-w-[900px]">
        Gadgets are placed on the rock itself, not on the laser, and change the rock for everyone mining it. Use one per
        rock: the game warns that two can make it explode. A higher cluster figure keeps more of the rock&rsquo;s ore
        together when it breaks. Numbers are the game&rsquo;s own values, which can differ from the item&rsquo;s
        description text in game.
      </p>
    </Plate>
  );
}
