// Mining (v1.49.0): the ore finder (where an ore is the main ore of a rock, by
// place, with both quality bands), the scanner signature lookup, every rock
// signature, and the mining lasers and modules. Exact numbers from the game
// files; nothing estimated. Lives at /tools/mining and in each server's
// dashboard. The view and ore are in the address (?view=, ?ore=).

import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { matchSignature, MINING_METHOD_LABELS, oreName, type MiningLaser, type MiningMethod, type MiningModule, type OreSpot, type RockSignature } from '@dem/shared';
import { fmt, useMiningData } from '../../lib/gameTools';
import { ToolsDataState } from './ToolsLayout';
import { MOD_COLUMNS, ModCell, pctText } from './miningBits';

type View = 'ores' | 'signatures' | 'lasers' | 'modules';
const VIEWS: { id: View; label: string }[] = [
  { id: 'ores', label: 'Ore finder' },
  { id: 'signatures', label: 'Rock signatures' },
  { id: 'lasers', label: 'Lasers' },
  { id: 'modules', label: 'Modules' },
];

const METHOD_WORD: Record<MiningMethod, string> = { ship: 'Ship', roc: 'ROC', hand: 'By hand' };

export function MiningPage() {
  const { data, isLoading, error } = useMiningData();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'ores') as View;
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };

  if (!data) return <ToolsDataState isLoading={isLoading} error={error} />;
  return (
    <>
      <nav aria-label="Mining tools" className="flex flex-wrap gap-x-6 px-5 sm:px-10" style={{ borderBottom: '1px solid var(--gt-line)', background: 'var(--gt-faint)' }}>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className="gt-tab" style={{ padding: '14px 0 12px', background: 'none', border: 0, borderBottom: `2px solid ${view === v.id ? 'var(--gt-acc)' : 'transparent'}`, font: 'inherit', cursor: 'pointer' }}
            aria-current={view === v.id ? 'page' : undefined} onClick={() => set('view', v.id === 'ores' ? null : v.id)}>{v.label}</button>
        ))}
      </nav>
      {view === 'ores' && <OreFinder spots={data.spots} ores={data.ores} signatures={data.signatures} ore={params.get('ore') ?? 'quantainium'} setOre={(o) => set('ore', o)} />}
      {view === 'signatures' && <Signatures signatures={data.signatures} />}
      {view === 'lasers' && <Lasers lasers={data.lasers} />}
      {view === 'modules' && <Modules modules={data.modules} />}
      <p className="text-xs gt-dim px-5 sm:px-10 pb-6 m-0">From the game files{data.build ? <>, build <span className="gt-mono">{data.build}</span></> : null}. Prices and refinery yields (UEX) are coming.</p>
    </>
  );
}

// ── A sortable table ─────────────────────────────────────────────────────────

interface Col<T> { key: string; label: string; sort?: (x: T) => number | string | null; render: (x: T) => ReactNode; num?: boolean; low?: boolean }

function SortTable<T>({ rows, cols, initial, rowKey, minWidth = 900 }: { rows: T[]; cols: Col<T>[]; initial: string; rowKey: (x: T) => string; minWidth?: number }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: cols.find((c) => c.key === initial)?.low || !cols.find((c) => c.key === initial)?.num ? 1 : -1 });
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sort!(a), bv = col.sort!(b);
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * sort.dir;
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
                  <button type="button" className="whitespace-nowrap" aria-pressed={sort.key === c.key}
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.low || !c.num ? 1 : -1 }))}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => <tr key={rowKey(r)}>{cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="gt-label" style={{ fontSize: 11 }}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => <button key={o} type="button" className="gt-chip" aria-pressed={value === o} onClick={() => onChange(o)}>{o}</button>)}
      </div>
    </div>
  );
}

// ── Ore finder ───────────────────────────────────────────────────────────────

const bandsText = (s: OreSpot) => s.bands.map((b) => `${fmt(b.minPct, 1)}–${fmt(b.maxPct, 1)}%  Q ${b.minQ}–${b.maxQ}`);
const cluster = (s: { clusterMin: number | null; clusterMax: number | null }) =>
  s.clusterMin == null ? '–' : s.clusterMin === s.clusterMax ? `${s.clusterMin}` : `${s.clusterMin}–${s.clusterMax}`;

function OreFinder({ spots, ores, signatures, ore, setOre }: { spots: OreSpot[]; ores: { key: string; name: string }[]; signatures: RockSignature[]; ore: string; setOre: (o: string) => void }) {
  const [query, setQuery] = useState('');
  const [system, setSystem] = useState('All');
  const [method, setMethod] = useState('All');
  const found = ores.find((o) => o.key === ore) ?? ores[0];
  const forOre = useMemo(() => spots.filter((s) => s.ore === found?.key), [spots, found]);
  const systems = ['All', ...new Set(forOre.map((s) => s.system))].sort((a, b) => (a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b)));
  const methods = ['All', ...(['ship', 'roc', 'hand'] as const).filter((m) => forOre.some((s) => s.method === m)).map((m) => METHOD_WORD[m])];
  const shown = forOre.filter((s) => (system === 'All' || s.system === system) && (method === 'All' || METHOD_WORD[s.method] === method));
  const matches = query.trim() ? ores.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12) : [];
  const rocks = [...new Map(forOre.map((s) => [`${s.rock}|${s.method}`, s])).values()];
  const bestQ = Math.max(0, ...forOre.flatMap((s) => s.bands.map((b) => b.maxQ)));

  const cols: Col<OreSpot>[] = [
    { key: 'place', label: 'Location', sort: (s) => s.place, render: (s) => <><span className="font-semibold gt-hi">{s.place}</span><span className="block text-xs gt-dim">{s.system}{s.kind ? ` · ${s.kind}` : ''}</span></> },
    { key: 'rock', label: 'Rock', sort: (s) => s.rock, render: (s) => <><span className="gt-acc font-medium">{s.rock}</span><span className="block text-xs gt-dim">mined by {MINING_METHOD_LABELS[s.method]}</span></> },
    { key: 'chance', label: 'Chance', num: true, sort: (s) => s.chance, render: (s) => <span className="gt-hi">{fmt(s.chance * 100, 1)}%</span> },
    { key: 'bands', label: `${found?.name ?? ''} in it · quality`, render: (s) => <span className="gt-mono text-[13px] whitespace-pre-line leading-relaxed">{bandsText(s).join('\n')}</span> },
    { key: 'sig', label: 'Signature', num: true, sort: (s) => s.signature, render: (s) => fmt(s.signature) },
    { key: 'cluster', label: 'Cluster', num: true, sort: (s) => s.clusterMax, render: (s) => `${cluster(s)} rocks` },
  ];

  return (
    <>
      <section aria-label="Pick an ore" className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-5 sm:px-10 pt-7 pb-5" style={{ borderBottom: '1px solid var(--gt-line)' }}>
        <div className="relative flex flex-col gap-2 flex-[1_1_380px] max-w-[640px]">
          <label htmlFor="gt-ore" className="gt-label">Ore</label>
          <div className="flex items-center gap-3 pb-2" style={{ borderBottom: '2px solid var(--gt-acc)' }}>
            <span aria-hidden="true" className="gt-mono gt-acc text-2xl">&rsaquo;</span>
            <input id="gt-ore" type="search" autoComplete="off" value={query} placeholder={found?.name ?? 'Type an ore…'}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) { setOre(matches[0].key); setQuery(''); } }}
              className="flex-1 min-w-0 bg-transparent border-0 outline-none gt-mono gt-hi text-xl sm:text-[26px]" />
          </div>
          {matches.length > 0 && (
            <ul className="absolute top-full left-0 right-0 z-20 m-0 p-0 list-none max-h-[360px] overflow-y-auto" style={{ background: 'var(--gt-bg)', border: '1px solid var(--gt-line)' }}>
              {matches.map((o) => (
                <li key={o.key}>
                  <button type="button" className="w-full text-left px-3 py-2.5 border-0 cursor-pointer gt-hi" style={{ background: 'transparent', font: 'inherit', borderBottom: '1px solid var(--gt-faint)' }}
                    onClick={() => { setOre(o.key); setQuery(''); }}>{o.name}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {[
            ['places', String(new Set(forOre.map((s) => `${s.place}|${s.system}`)).size)],
            ['rock types', String(new Set(forOre.map((s) => s.rock)).size)],
            ['best chance', forOre.length ? `${fmt(Math.max(...forOre.map((s) => s.chance)) * 100, 1)}%` : '–'],
            ['best quality', bestQ ? String(bestQ) : '–'],
          ].map(([k, v]) => (
            <span key={k} className="flex flex-col"><span className="gt-mono text-xl font-semibold gt-hi">{v}</span><span className="gt-label">{k}</span></span>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap">
        <div className="flex-[999_1_620px] min-w-0 box-border px-5 sm:pl-10 sm:pr-8 py-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
            {systems.length > 2 && <Chips label="System" options={systems} value={system} onChange={setSystem} />}
            {methods.length > 2 && <Chips label="Mined by" options={methods} value={method} onChange={setMethod} />}
          </div>
          {shown.length
            ? <SortTable rows={shown} cols={cols} initial="chance" rowKey={(s) => `${s.place}|${s.system}|${s.method}|${s.rock}`} minWidth={860} />
            : <p className="gt-dim m-0">No {found?.name} rocks match those filters.</p>}
          <p className="text-xs gt-dim m-0 leading-relaxed max-w-[900px]">
            Rocks where {found?.name} is the main ore. Chance is the share of that mining method&rsquo;s rocks at the place that are this rock. Each rock gives its main ore either as a small share at high quality or a large share at low quality: both bands are listed.
          </p>
        </div>
        <aside aria-label="Scanner and rock facts" className="flex-[1_1_340px] lg:max-w-[440px] box-border px-5 sm:pl-7 sm:pr-10 py-6 flex flex-col gap-7" style={{ borderLeft: '1px solid var(--gt-line)' }}>
          <Scanner signatures={signatures} />
          {rocks.map((s) => (
            <section key={`${s.rock}|${s.method}`} className="flex flex-col">
              <h2 className="gt-label gt-label-acc m-0 pb-2" style={{ borderBottom: '1px solid var(--gt-line)' }}>{s.rock} · {MINING_METHOD_LABELS[s.method]}</h2>
              {[
                ['Signature (one rock)', fmt(s.signature)],
                ['Cluster', `${cluster(s)} rocks`],
                ...s.bands.map((b, i) => [i === 0 ? 'High-quality band' : 'Lower-quality band', `${fmt(b.minPct, 1)}–${fmt(b.maxPct, 1)}% · Q ${b.minQ}–${b.maxQ}`]),
              ].map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 gt-row">
                  <span className="text-sm">{k}</span><span className="gt-mono gt-hi text-[13px] ml-auto">{v}</span>
                </div>
              ))}
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}

function Scanner({ signatures }: { signatures: RockSignature[] }) {
  const [value, setValue] = useState('');
  const n = parseInt(value.replace(/[^0-9]/g, ''), 10);
  const hits = matchSignature(n, signatures);
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="gt-label gt-label-acc m-0 pb-2" style={{ borderBottom: '1px solid var(--gt-line)' }}>What&rsquo;s on my scanner?</h2>
      <label htmlFor="gt-sig" className="text-sm">Signature number</label>
      <input id="gt-sig" inputMode="numeric" className="gt-input gt-mono text-xl" placeholder="e.g. 7650" value={value} onChange={(e) => setValue(e.target.value)} />
      {hits.map((h) => (
        <div key={`${h.rock}|${h.method}|${h.count}`} className="flex items-baseline justify-between gap-3 py-2 gt-row">
          <span><b className="gt-hi font-semibold">{h.count} × {h.rock}</b> <span className="text-xs gt-dim">{MINING_METHOD_LABELS[h.method]}</span></span>
          <span className="gt-mono text-[13px] gt-dim">{fmt(h.each)} each</span>
        </div>
      ))}
      {n > 0 && !hits.length && <span className="text-sm gt-dim">No rock type adds up to that number.</span>}
      <span className="text-xs gt-dim">A cluster reads as one rock&rsquo;s signature times the number of rocks in it.</span>
    </section>
  );
}

// ── Rock signatures ──────────────────────────────────────────────────────────

function Signatures({ signatures }: { signatures: RockSignature[] }) {
  const [method, setMethod] = useState('Ship');
  const methods = ['All', ...(['ship', 'roc'] as const).filter((m) => signatures.some((s) => s.method === m)).map((m) => METHOD_WORD[m])];
  const rows = signatures.filter((s) => method === 'All' || METHOD_WORD[s.method] === method);
  const cols: Col<RockSignature>[] = [
    { key: 'rock', label: 'Rock', sort: (s) => s.rock, render: (s) => <><span className="font-semibold gt-hi">{s.rock}</span><span className="block text-xs gt-dim">{oreName(s.ore)} · {MINING_METHOD_LABELS[s.method]}</span></> },
    ...[1, 2, 3, 4, 5, 6].map((k) => ({ key: `x${k}`, label: k === 1 ? 'One rock' : `× ${k}`, num: true, sort: k === 1 ? (s: RockSignature) => s.signature : undefined, render: (s: RockSignature) => <span className={k === 1 ? 'gt-hi' : ''}>{fmt(s.signature * k)}</span> })),
  ];
  return (
    <div className="flex flex-wrap">
      <div className="flex-[999_1_620px] min-w-0 box-border px-5 sm:pl-10 sm:pr-8 py-6 flex flex-col gap-4">
        <Chips label="Mined by" options={methods} value={method} onChange={setMethod} />
        <SortTable rows={rows} cols={cols} initial="x1" rowKey={(s) => `${s.rock}|${s.method}`} minWidth={760} />
        <p className="text-xs gt-dim m-0">What the scanner shows for a cluster of 1 to 6 rocks of each type.</p>
      </div>
      <aside className="flex-[1_1_340px] lg:max-w-[440px] box-border px-5 sm:pl-7 sm:pr-10 py-6" style={{ borderLeft: '1px solid var(--gt-line)' }}>
        <Scanner signatures={signatures} />
      </aside>
    </div>
  );
}

// ── Lasers and modules ───────────────────────────────────────────────────────

function Lasers({ lasers }: { lasers: MiningLaser[] }) {
  const [size, setSize] = useState('All');
  const sizes = ['All', ...[...new Set(lasers.map((l) => l.size))].sort().map((s) => `Size ${s}`)];
  const rows = lasers.filter((l) => size === 'All' || `Size ${l.size}` === size);
  const cols: Col<MiningLaser>[] = [
    { key: 'name', label: 'Laser', sort: (l) => l.name, render: (l) => <><span className="font-semibold gt-hi">{l.name.replace(/ Mining Laser$/, '')}</span><span className="block text-xs gt-dim">{l.maker} · size {l.size}</span></> },
    { key: 'power', label: 'Power', num: true, sort: (l) => l.power, render: (l) => <span className="gt-hi">{fmt(l.power)}</span> },
    { key: 'min', label: 'Min power', num: true, sort: (l) => l.minPower, render: (l) => fmt(l.minPower, l.minPower != null && l.minPower % 1 ? 1 : 0) },
    { key: 'ext', label: 'Extraction', num: true, sort: (l) => l.extraction, render: (l) => fmt(l.extraction) },
    { key: 'opt', label: 'Optimal m', num: true, sort: (l) => l.optimalRange, render: (l) => fmt(l.optimalRange) },
    { key: 'max', label: 'Max m', num: true, sort: (l) => l.maxRange, render: (l) => fmt(l.maxRange) },
    { key: 'slots', label: 'Modules', num: true, sort: (l) => l.moduleSlots, render: (l) => l.moduleSlots },
    ...MOD_COLUMNS.slice(0, 6).map((m) => ({ key: m.key, label: m.label, num: true, low: m.lowerIsBetter, sort: (l: MiningLaser) => l.modifiers[m.key] ?? 0, render: (l: MiningLaser) => <ModCell v={l.modifiers[m.key]} lowerIsBetter={m.lowerIsBetter} /> })),
  ];
  return (
    <div className="px-5 sm:px-10 py-6 flex flex-col gap-4">
      <Chips label="Size" options={sizes} value={size} onChange={setSize} />
      <SortTable rows={rows} cols={cols} initial="power" rowKey={(l) => l.uuid} minWidth={1200} />
      <p className="text-xs gt-dim m-0">Green helps the miner, red hurts. Hand and ROC lasers are coming.</p>
    </div>
  );
}

function Modules({ modules }: { modules: MiningModule[] }) {
  const [kind, setKind] = useState('All');
  const rows = modules.filter((m) => kind === 'All' || m.kind === kind);
  const cols: Col<MiningModule>[] = [
    { key: 'name', label: 'Module', sort: (m) => m.name, render: (m) => <><span className="font-semibold gt-hi">{m.name.replace(/ Module$/, '')}</span><span className="block text-xs gt-dim">{m.maker ?? ''}{m.rarity ? ` · ${m.rarity}` : ''}</span></> },
    { key: 'kind', label: 'Kind', sort: (m) => m.kind, render: (m) => <span className="text-sm">{m.kind}</span> },
    { key: 'uses', label: 'Uses', num: true, sort: (m) => m.charges, render: (m) => (m.kind === 'Active' ? `${m.charges ?? '–'} × ${m.lifetime ?? '–'} s` : '–') },
    { key: 'power', label: 'Power', num: true, sort: (m) => m.power ?? 1, render: (m) => (m.power == null || m.power === 1 ? <span className="gt-dim">–</span> : <span className={m.power > 1 ? 'gt-good' : 'gt-bad'}>×{fmt(m.power, 2)}</span>) },
    ...MOD_COLUMNS.map((c) => ({ key: c.key, label: c.label, num: true, low: c.lowerIsBetter, sort: (m: MiningModule) => m.modifiers[c.key] ?? 0, render: (m: MiningModule) => <ModCell v={m.modifiers[c.key]} lowerIsBetter={c.lowerIsBetter} /> })),
  ];
  return (
    <div className="px-5 sm:px-10 py-6 flex flex-col gap-4">
      <Chips label="Kind" options={['All', 'Active', 'Passive']} value={kind} onChange={setKind} />
      <SortTable rows={rows} cols={cols} initial="power" rowKey={(m) => m.uuid} minWidth={1200} />
      <p className="text-xs gt-dim m-0">Active modules are used up: uses × seconds each. Green helps the miner, red hurts.</p>
    </div>
  );
}
