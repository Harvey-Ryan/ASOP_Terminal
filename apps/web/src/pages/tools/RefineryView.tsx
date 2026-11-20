// Mining → Refinery (v1.58.0): a refinery work order calculator. Pick the ores
// and how much of each, the refinery and the method: it shows what comes back
// (85 % × the refinery's bonus for that ore × the method's yield), what that's
// worth where you'll sell it, what selling the ore raw would give instead, and
// which refinery suits the load. Bonuses and prices are UEX's player reports
// (age shown); the fee and timer are the terminal's quote, so the fee is typed in.
// The order lives in the address: ?view=refinery&o=<oreId>:<SCU>,…&r=<refinery>&m=<method>&sell=<system|any>&fee=.

import { useMemo } from 'react';
import {
  REFINERY_METHODS, methodByCode, methodCostWord, methodSpeedWord, parseWorkOrder, rankRefineries, workOrder, workOrderParam,
  type RefineryDataDto, type RefineryPrice, type WorkOrderLine,
} from '@dem/shared';
import { cn } from '@/lib/utils';
import { fmt, useRefineryData } from '../../lib/gameTools';
import { Heading, Plate } from './bay';

const UEX = 'https://uexcorp.space';
const money = (n: number | null | undefined) => (n == null ? '–' : `${fmt(n)} aUEC`);
const scu = (n: number) => fmt(n, 2);
const daysAgo = (at: number) => {
  const d = Math.floor((Date.now() - at * 1000) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
};

export function RefineryView({ get, set }: { get: (k: string) => string | null; set: (k: string, v: string | null) => void }) {
  const { data, isLoading, error } = useRefineryData();
  if (!data) {
    return (
      <Plate label="Refinery">
        <Heading>REFINERY</Heading>
        <p className="m-0 text-sm text-[var(--fab-muted)]">{isLoading ? 'Loading refinery bonuses and prices from UEX…' : `Couldn't load UEX's refinery data${error instanceof Error ? `: ${error.message}` : ''}. Try again in a few minutes.`}</p>
      </Plate>
    );
  }
  return <Calculator data={data} get={get} set={set} />;
}

function Calculator({ data, get, set }: { data: RefineryDataDto; get: (k: string) => string | null; set: (k: string, v: string | null) => void }) {
  const fromUrl = parseWorkOrder(get('o')).filter((l) => data.ores.some((o) => o.id === l.oreId));
  const starter = data.ores.find((o) => /quantainium/i.test(o.name)) ?? data.ores[0];
  const lines: WorkOrderLine[] = fromUrl.length ? fromUrl : starter ? [{ oreId: starter.id, scu: 0 }] : [];
  const setLines = (next: WorkOrderLine[]) => set('o', workOrderParam(next) || null);
  const method = methodByCode(get('m'));
  const fee = get('fee') ? Number(get('fee')) : null;

  const ranked = useMemo(() => rankRefineries(data, lines, method), [data, lines, method]);
  const chosenId = Number(get('r')) || null;
  const site = data.refineries.find((r) => r.id === chosenId) ?? (lines.some((l) => l.scu > 0) ? ranked[0]?.site : undefined) ?? null;
  const sellParam = get('sell');
  const sellSystem = sellParam === 'any' ? null : sellParam ?? site?.system ?? null;
  const result = workOrder(data, lines, site?.id ?? null, method, { sellSystem, fee });
  const systems = [...new Set(data.refineries.map((r) => r.system).filter((s): s is string => !!s))].sort();
  const empty = !lines.some((l) => l.scu > 0);
  const newest = Math.max(0, ...data.refineries.map((r) => r.updatedAt ?? 0));

  const updateLine = (i: number, patch: Partial<WorkOrderLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const unused = data.ores.find((o) => !lines.some((l) => l.oreId === o.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-6">
        {/* The work order */}
        <Plate label="Work order" className="flex-[1_1_320px] lg:max-w-[400px]">
          <Heading>WORK ORDER</Heading>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between"><span className="fab-label">Ore</span><span className="fab-label">SCU</span></div>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select aria-label={`Ore ${i + 1}`} className="fab-input h-10 min-w-0 flex-1 px-2 text-sm" value={l.oreId}
                  onChange={(e) => updateLine(i, { oreId: Number(e.target.value) })}>
                  {data.ores.map((o) => <option key={o.id} value={o.id} disabled={o.id !== l.oreId && lines.some((x) => x.oreId === o.id)}>{o.refinedName}</option>)}
                </select>
                <input aria-label={`SCU of ore ${i + 1}`} type="number" inputMode="decimal" min={0} step={0.01} className="fab-input fab-mono h-10 w-24 px-2 text-right text-sm"
                  value={l.scu || ''} placeholder="0.00" onChange={(e) => updateLine(i, { scu: Math.max(0, Number(e.target.value) || 0) })} />
                <button type="button" aria-label={`Remove ${data.ores.find((o) => o.id === l.oreId)?.refinedName ?? 'ore'}`} className="fab-btn h-10 w-10 text-base"
                  disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {unused && lines.length < 20 && (
              <button type="button" className="fab-btn h-9 self-start px-3 text-xs" onClick={() => setLines([...lines, { oreId: unused.id, scu: 0 }])}>+ Add ore</button>
            )}
            <p className="m-0 text-xs text-[var(--fab-muted)]">The ore amounts the refinery terminal lists (100 cSCU = 1 SCU), without inert material: refineries throw that away.</p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="fab-label">Refinery</span>
            <select className="fab-input h-10 px-2 text-sm" value={site?.id ?? ''} onChange={(e) => set('r', e.target.value || null)}>
              {!site && <option value="">Pick a refinery</option>}
              {systems.map((sys) => (
                <optgroup key={sys} label={sys}>
                  {data.refineries.filter((r) => r.system === sys).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </optgroup>
              ))}
            </select>
            {site && !chosenId && !empty && <span className="text-xs text-[var(--fab-gold-text)]">Best yield for this load</span>}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="fab-label">Method</span>
            <select className="fab-input h-10 px-2 text-sm" value={method.code} onChange={(e) => set('m', e.target.value === 'DIN' ? null : e.target.value)}>
              {REFINERY_METHODS.map((m) => <option key={m.code} value={m.code}>{m.name} · {Math.round(m.yield * 100)}% · {methodSpeedWord(m.time).toLowerCase()}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="fab-label">Sell in</span>
              <select className="fab-input h-10 px-2 text-sm" value={sellParam ?? (site?.system ?? 'any')} onChange={(e) => set('sell', e.target.value === (site?.system ?? 'any') ? null : e.target.value)}>
                <option value="any">Any system</option>
                {systems.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="fab-label">Quoted fee</span>
              <input type="number" inputMode="numeric" min={0} step={1} placeholder="aUEC" className="fab-input fab-mono h-10 px-2 text-right text-sm"
                value={fee ?? ''} onChange={(e) => set('fee', e.target.value === '' ? null : String(Math.max(0, Math.round(Number(e.target.value) || 0))))} />
            </label>
          </div>
          <p className="m-0 text-xs text-[var(--fab-muted)]">The fee and time come from the terminal's quote. Type the fee in to see your profit.</p>
        </Plate>

        {/* What comes back */}
        <Plate label="Result" className="flex-[2_1_420px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Heading>WHAT COMES BACK</Heading>
            {site && <span className="fab-mono text-xs text-[var(--fab-muted)]">{site.place} · {method.name}</span>}
          </div>
          {empty ? (
            <p className="m-0 text-sm text-[var(--fab-muted)]">Enter how much ore you have to see the refined amount, its value, and the best refineries for it.</p>
          ) : (
            <>
              <div className="gt-scroll">
                <table className="gt-table" style={{ minWidth: 480 }}>
                  <thead>
                    <tr><th>Ore</th><th className="num">SCU in → out</th><th className="num">Sells for</th><th className="num">Value</th></tr>
                  </thead>
                  <tbody>
                    {result.lines.map((l) => (
                      <tr key={l.ore.id}>
                        <td>
                          <span className="gt-hi font-semibold">{l.ore.refinedName}</span>
                          <span className={cn('block text-xs', l.bonusPct > 0 ? 'gt-good' : l.bonusPct < 0 ? 'gt-bad' : 'gt-dim')}>{l.bonusPct > 0 ? '+' : ''}{l.bonusPct}% here</span>
                        </td>
                        <td className="num">{scu(l.inScu)} → <span className="gt-hi">{scu(l.outScu)}</span></td>
                        <td className="num"><PriceCell p={l.refinedPrice} data={data} /></td>
                        <td className="num gt-hi">{money(l.refinedValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Stat label="Refined" value={`${scu(result.outScu)} SCU`} note={`from ${scu(result.inScu)} SCU (${result.inScu ? Math.round((result.outScu / result.inScu) * 100) : 0}%)`} />
                <Stat label="Refined value" value={money(result.refinedValue)} note={result.unpriced ? `${result.unpriced} ore${result.unpriced === 1 ? '' : 's'} without a price` : sellSystem ? `selling in ${sellSystem}` : 'best price anywhere'} big />
                <Stat label="Sold raw instead" value={result.rawValue ? money(result.rawValue) : '–'} note={result.rawValue ? `${result.refinedValue >= result.rawValue ? '+' : ''}${fmt(result.refinedValue - result.rawValue)} by refining` : 'no raw buyers reported'} />
                <Stat label="Profit after fee" value={result.profit === null ? '–' : money(result.profit)} note={result.profit === null ? 'type the quoted fee' : `after ${money(fee)}`} big={result.profit !== null} />
              </dl>
            </>
          )}
        </Plate>

        {/* Refineries for this load */}
        <aside aria-label="Refineries" className="fab-plate min-w-0 flex-[1_1_300px] lg:max-w-[380px]">
          <div aria-hidden="true" className="fab-hazard-thin h-1.5" />
          <div className="flex flex-col gap-3 px-5 pb-5 pt-4">
            <h2 className="fab-stencil m-0 text-[22px] text-[var(--fab-gold-text)]">REFINERIES</h2>
            <p className="m-0 text-xs text-[var(--fab-muted)]">{empty ? 'Every refinery, by name.' : `Most refined for this load with ${method.name}, valued in each refinery's own system.`}</p>
            <ol className="m-0 flex list-none flex-col p-0">
              {(empty ? [...ranked].sort((a, b) => a.site.name.localeCompare(b.site.name)) : ranked).map(({ site: s, result: r, known }, i) => (
                <li key={s.id}>
                  <button type="button" className="fab-row flex w-full items-center gap-3 px-2 py-2 text-left" aria-current={site?.id === s.id ? 'true' : undefined} onClick={() => set('r', String(s.id))}>
                    {!empty && <span className="fab-mono w-5 text-xs text-[var(--fab-faint)]">{i + 1}</span>}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-[var(--fab-bright)]">{s.name}</span>
                      <span className="text-xs text-[var(--fab-muted)]">{s.system}{!empty && known < lines.filter((l) => l.scu > 0).length ? ' · some bonuses unknown' : ''}</span>
                    </span>
                    {!empty && (
                      <span className="fab-mono flex flex-col items-end text-xs">
                        <span className="text-[var(--fab-bright)]">{scu(r.outScu)} SCU</span>
                        <span className="text-[var(--fab-muted)]">{r.refinedValue ? `${fmt(r.refinedValue / 1000)}k` : '–'}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>

      {site && !empty && <BonusTable data={data} siteId={site.id} lines={lines} />}
      <Methods current={method.code} onPick={(c) => set('m', c === 'DIN' ? null : c)} />

      <p className="m-0 text-xs text-[var(--fab-muted)]">
        Refined = ore × 85% × the refinery's bonus for that ore × the method's yield, which matches work orders players reported. Refinery bonuses and prices are
        player-reported on <a className="underline" href={UEX} target="_blank" rel="noreferrer">UEX</a> (reports older than 45 days left out; newest bonus report {newest ? daysAgo(newest) : 'unknown'}), so check the terminal's quote before you commit.
        Methods' relative cost and speed are from CIG's data as published by Regolith. The game's own tooltips for methods are known to be wrong.
      </p>
    </div>
  );
}

function Stat({ label, value, note, big }: { label: string; value: string; note?: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="fab-label">{label}</dt>
      <dd className={cn('fab-mono m-0', big ? 'text-lg text-[var(--fab-gold-text)]' : 'text-base text-[var(--fab-bright)]')}>{value}</dd>
      {note && <dd className="m-0 text-xs text-[var(--fab-muted)]">{note}</dd>}
    </div>
  );
}

function PriceCell({ p, data }: { p: RefineryPrice | null; data: RefineryDataDto }) {
  if (!p) return <span className="gt-dim">no buyer reported</span>;
  const t = data.terminals[p.terminalId];
  return (
    <span title={`${t?.place ?? 'Unknown terminal'}, reported ${daysAgo(p.at)}`}>
      {fmt(p.sell)}<span className="block text-xs gt-dim">{t?.name ?? '–'} · {daysAgo(p.at)}</span>
    </span>
  );
}

/** The chosen refinery's bonus for each ore in the load: now, past week, past month. */
function BonusTable({ data, siteId, lines }: { data: RefineryDataDto; siteId: number; lines: WorkOrderLine[] }) {
  const site = data.refineries.find((r) => r.id === siteId)!;
  const sign = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v}%`);
  const all = data.ores.filter((o) => site.bonus[o.id] !== undefined).sort((a, b) => (site.bonus[b.id]!.now - site.bonus[a.id]!.now) || a.refinedName.localeCompare(b.refinedName));
  const inLoad = new Set(lines.map((l) => l.oreId));
  return (
    <Plate label={`${site.name} bonuses`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading>{site.name.toUpperCase()} · YIELD BONUSES</Heading>
        <span className="fab-mono text-xs text-[var(--fab-muted)]">{site.updatedAt ? `reported ${daysAgo(site.updatedAt)}` : ''}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {all.map((o) => {
          const b = site.bonus[o.id]!;
          return (
            <span key={o.id} className={cn('fab-mono border px-2 py-1 text-xs', inLoad.has(o.id) ? 'border-[var(--fab-gold)] text-[var(--fab-bright)]' : 'border-[#333] text-[var(--fab-muted)]')}
              title={`Past 7 days ${sign(b.week)}, past 30 days ${sign(b.month)}`}>
              {o.refinedName} <span className={b.now > 0 ? 'gt-good' : b.now < 0 ? 'gt-bad' : ''}>{sign(b.now)}</span>
            </span>
          );
        })}
      </div>
      <p className="m-0 text-xs text-[var(--fab-muted)]">Ores not listed have no bonus reported here (counted as 0%). Hover for the past week and month.</p>
    </Plate>
  );
}

function Methods({ current, onPick }: { current: string; onPick: (code: string) => void }) {
  return (
    <Plate label="Refining methods">
      <Heading>REFINING METHODS</Heading>
      <div className="gt-scroll">
        <table className="gt-table" style={{ minWidth: 560 }}>
          <thead><tr><th>Method</th><th className="num">Yield</th><th className="num">Overall</th><th>Time</th><th>Fee</th></tr></thead>
          <tbody>
            {REFINERY_METHODS.map((m) => (
              <tr key={m.code} aria-current={m.code === current ? 'true' : undefined} className={cn('cursor-pointer', m.code === current && 'fab-row')} onClick={() => onPick(m.code)}>
                <td><button type="button" className="gt-hi text-left font-semibold" onClick={() => onPick(m.code)}>{m.name}</button></td>
                <td className="num">{Math.round(m.yield * 100)}%</td>
                <td className="num">{Math.round(m.yield * 85)}%</td>
                <td>{methodSpeedWord(m.time)} <span className="gt-dim">×{fmt(m.time, m.time < 1 ? 2 : 0)}</span></td>
                <td>{methodCostWord(m.cost)} <span className="gt-dim">×{fmt(m.cost, m.cost < 1 ? 1 : 0)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 text-xs text-[var(--fab-muted)]">Overall = 85% × the method's yield, before the refinery's bonus. Time and fee are relative to Electrostarolysis (×1).</p>
    </Plate>
  );
}
