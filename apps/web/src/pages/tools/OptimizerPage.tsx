// Optimizer (v1.44.0): pick a goal (and a target ship) and ASOP tries every
// legal set of pilot guns, then shows the best three with plain comparisons.
// Everything is worked out here from the game data; nothing is written by AI.

import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { bestGunFits, describeGuns, formatKillTime, killTime, type CombatGun, type FitGoal, type FitResult, type GameToolsShip } from '@dem/shared';
import { fmt, gunsForSlot, pctChange, pilotSlots, shipPath, shortShipName, useGameTools } from '../../lib/gameTools';
import { ToolsDataState } from './ToolsLayout';
import { ShipChooser } from './LoadoutPage';
import { COMMON_TARGETS } from './KillTable';

const GOALS: { id: FitGoal; name: string; desc: string }[] = [
  { id: 'target', name: 'Kill a specific ship', desc: 'Fastest kill, then the biggest volley, against one target' },
  { id: 'sustained', name: 'Sustained damage', desc: 'Most damage over a long fight' },
  { id: 'burst', name: 'Burst damage', desc: 'Most damage while the guns are fresh' },
  { id: 'alpha', name: 'Biggest volley', desc: 'Most damage in one trigger pull' },
];

export function OptimizerPage() {
  const { className = '' } = useParams();
  const { data, index, isLoading, error } = useGameTools();
  if (!data || !index) return <ToolsDataState isLoading={isLoading} error={error} />;
  const ship = className ? index.shipsByClass.get(className.toLowerCase()) ?? null : null;
  if (!ship) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-10 pt-10 pb-16 flex flex-col gap-6">
        <h1 className="m-0 text-3xl font-bold gt-hi">Optimizer</h1>
        <p className="m-0 gt-dim max-w-[620px]">Pick your ship, then a goal: the fastest kill on a particular ship, or the most damage overall. ASOP tries every set of guns that fits and shows the best three.</p>
        <ShipChooser ships={data.ships} current={null} page="optimizer" />
      </main>
    );
  }
  return <Optimizer ship={ship} ships={data.ships} guns={data.guns} gunsByUuid={index.gunsByUuid} />;
}

function Optimizer({ ship, ships, guns, gunsByUuid }: { ship: GameToolsShip; ships: GameToolsShip[]; guns: CombatGun[]; gunsByUuid: Map<string, CombatGun> }) {
  const [params, setParams] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const goal = (GOALS.find((g) => g.id === params.get('goal'))?.id ?? 'target') as FitGoal;
  const targetKey = (params.get('target') ?? 'aegs_vanguard').toLowerCase();
  const target = ships.find((s) => s.className.toLowerCase() === targetKey) ?? ships.find((s) => s.className === 'AEGS_Gladius') ?? ships[0]!;
  const locked = new Set((params.get('lock') ?? '').split(',').filter(Boolean).map(Number));
  const excluded = new Set((params.get('x') ?? '').split(',').filter(Boolean));

  const slots = pilotSlots(ship);
  const stock = slots.map((s) => (s.stockGunUuid ? gunsByUuid.get(s.stockGunUuid) ?? null : null));
  const stockFit = stock.filter((g): g is CombatGun => !!g);

  const results = useMemo<FitResult[]>(() => {
    const input = slots.map((s, i) => ({
      id: s.id,
      candidates: gunsForSlot(guns, s).filter((g) => !excluded.has(g.uuid)),
      locked: locked.has(i) ? stock[i] ?? null : null,
    }));
    if (input.some((s) => !s.locked && !s.candidates.length)) return [];
    return bestGunFits(input, goal, goal === 'target' ? target : null, { limit: 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ship.uuid, guns, goal, target.uuid, params.get('lock'), params.get('x')]);

  const stockVs = { burst: killTime(stockFit, target, 'burst'), sustained: killTime(stockFit, target, 'sustained') };
  const sum = (list: CombatGun[], k: 'burstDps' | 'sustainedDps' | 'alpha') => list.reduce((t, g) => t + g[k], 0);
  const stockLine = goal === 'target'
    ? `${formatKillTime(stockVs.burst.seconds)} to kill (burst) · ${formatKillTime(stockVs.sustained.seconds)} sustained`
    : `${fmt(sum(stockFit, 'sustainedDps'))}/s sustained · ${fmt(sum(stockFit, 'burstDps'))}/s burst · ${fmt(sum(stockFit, 'alpha'))} alpha`;
  const targetChoices = useMemo(() => {
    const common = new Set(COMMON_TARGETS);
    return [...ships].sort((a, b) => Number(common.has(b.className)) - Number(common.has(a.className)) || a.name.localeCompare(b.name));
  }, [ships]);
  const excludable = useMemo(() => {
    const seen = new Map<string, CombatGun>();
    for (const s of slots) for (const g of gunsForSlot(guns, s)) seen.set(g.uuid, g);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [slots, guns]);

  const loadoutLink = (r: FitResult) => {
    const q = new URLSearchParams();
    r.guns.forEach((g, i) => { if (g.uuid !== stock[i]?.uuid) q.set(`s${i}`, g.uuid); });
    const s = q.toString();
    return `${shipPath(ship, 'loadout')}${s ? `?${s}` : ''}`;
  };
  const toggleLock = (i: number) => { const n = new Set(locked); if (n.has(i)) n.delete(i); else n.add(i); set('lock', [...n].sort().join(',') || null); };
  const exclude = (uuid: string) => { if (!uuid) return; const n = new Set(excluded); n.add(uuid); set('x', [...n].join(',')); };
  const include = (uuid: string) => { const n = new Set(excluded); n.delete(uuid); set('x', [...n].join(',') || null); };

  return (
    <div className="flex flex-wrap">
      <section aria-labelledby="gt-opt-h" className="flex-[1_1_320px] max-w-[420px] box-border px-5 sm:pl-10 sm:pr-8 py-7 flex flex-col gap-7" style={{ borderRight: '1px solid var(--gt-line)' }}>
        <div className="flex flex-col gap-1">
          <h1 id="gt-opt-h" className="m-0 text-3xl font-bold gt-hi">Optimizer</h1>
          <span className="text-sm gt-dim">Pilot guns only for now</span>
        </div>
        <ShipChooser ships={ships} current={ship} page="optimizer" />

        <fieldset className="border-0 m-0 p-0 flex flex-col">
          <legend className="gt-label pb-1.5">Make it best at</legend>
          {GOALS.map((g) => (
            <button key={g.id} type="button" aria-pressed={goal === g.id} onClick={() => set('goal', g.id === 'target' ? null : g.id)} className="gt-slot" style={{ minHeight: 56 }}>
              <span className={`gt-mono w-4 ${goal === g.id ? 'gt-acc' : 'gt-dim'}`}>{goal === g.id ? '●' : '○'}</span>
              <span className="flex flex-col gap-0.5">
                <span className={`font-semibold ${goal === g.id ? 'gt-hi' : ''}`}>{g.name}</span>
                <span className="text-xs gt-dim">{g.desc}</span>
              </span>
            </button>
          ))}
        </fieldset>

        {goal === 'target' && (
          <label className="flex flex-col gap-2 -mt-3">
            <span className="gt-label">Target ship</span>
            <select className="gt-input text-base" value={target.className.toLowerCase()} onChange={(e) => set('target', e.target.value)}>
              {targetChoices.map((s) => <option key={s.uuid} value={s.className.toLowerCase()}>{s.name}</option>)}
            </select>
            <span className="text-xs gt-dim leading-relaxed">Shields {fmt(target.shieldHp)} · hull {fmt(target.hullHp)} · armour stops shots at or below {fmt(target.deflection.physical)} ballistic / {fmt(target.deflection.energy)} energy</span>
          </label>
        )}

        <fieldset className="border-0 m-0 p-0 flex flex-col gap-1">
          <legend className="gt-label pb-1.5">Keep these guns</legend>
          {slots.map((s, i) => (
            <label key={s.id} className="flex items-center gap-2.5 min-h-[40px]">
              <input type="checkbox" checked={locked.has(i)} onChange={() => toggleLock(i)} className="w-[18px] h-[18px]" style={{ accentColor: 'var(--gt-acc)' }} />
              <span>{s.label}: <span className="gt-dim">{stock[i]?.name ?? 'empty'}</span></span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor="gt-x" className="gt-label">Leave out</label>
          <select id="gt-x" className="gt-input" value="" onChange={(e) => exclude(e.target.value)}>
            <option value="">Add a gun you can&rsquo;t get…</option>
            {excludable.filter((g) => !excluded.has(g.uuid)).map((g) => <option key={g.uuid} value={g.uuid}>{g.name} (S{g.size})</option>)}
          </select>
          {excluded.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...excluded].map((u) => (
                <button key={u} type="button" className="gt-btn text-sm" style={{ minHeight: 32 }} onClick={() => include(u)} aria-label={`Put back ${gunsByUuid.get(u)?.name ?? 'gun'}`}>
                  {gunsByUuid.get(u)?.name ?? 'Unknown gun'} &times;
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs gt-dim leading-relaxed m-0">ASOP tries every gun that fits each slot, keeps the sets that meet your limits and ranks them. Numbers assume every shot hits at full power, with no shield regen under fire.</p>
      </section>

      <section aria-labelledby="gt-res-h" className="flex-[999_1_560px] min-w-0 box-border px-5 sm:px-10 py-7 flex flex-col">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pb-3">
          <h2 id="gt-res-h" className="gt-label gt-label-acc m-0">Best fits · {goal === 'target' ? `vs ${shortShipName(target)}` : GOALS.find((g) => g.id === goal)!.name.toLowerCase()}</h2>
          <span className="text-sm gt-dim">Stock: {stockLine}</span>
        </div>
        {!results.length && <p className="gt-dim">No set of guns fits these limits.</p>}
        {results.map((r, i) => {
          const first = results[0]!;
          const vs = r.vsTarget;
          const metrics: { k: string; v: string; d?: string; good?: boolean }[] = goal === 'target' && vs
            ? [
              { k: 'Kill (burst)', v: formatKillTime(vs.burst.seconds), d: i === 0 && isFinite(vs.burst.seconds) && isFinite(stockVs.burst.seconds) ? pctChange(vs.burst.seconds, stockVs.burst.seconds) : '', good: true },
              { k: 'Kill (sustained)', v: formatKillTime(vs.sustained.seconds) },
              { k: 'Shields down', v: vs.burst.seconds < vs.burst.shieldSeconds ? 'not needed' : formatKillTime(vs.burst.shieldSeconds), d: vs.burst.seconds < vs.burst.shieldSeconds ? 'hull goes first' : '' },
              { k: 'Volley to hull', v: fmt(vs.burst.volleyHull), d: i === 0 ? `stock ${fmt(stockVs.burst.volleyHull)}` : '' },
            ]
            : [
              { k: 'Sustained', v: `${fmt(r.sustained)}/s`, d: pctChange(r.sustained, sum(stockFit, 'sustainedDps')), good: r.sustained >= sum(stockFit, 'sustainedDps') },
              { k: 'Burst', v: `${fmt(r.burst)}/s`, d: pctChange(r.burst, sum(stockFit, 'burstDps')), good: r.burst >= sum(stockFit, 'burstDps') },
              { k: 'Alpha', v: fmt(r.alpha), d: pctChange(r.alpha, sum(stockFit, 'alpha')), good: r.alpha >= sum(stockFit, 'alpha') },
            ];
          let line: string;
          if (goal === 'target' && vs && first.vsTarget) {
            line = i === 0
              ? `vs stock: ${formatKillTime(stockVs.burst.seconds)} → ${formatKillTime(vs.burst.seconds)} to kill.`
              : `vs #1: ${isFinite(vs.burst.seconds) && isFinite(first.vsTarget.burst.seconds) ? `+${(vs.burst.seconds - first.vsTarget.burst.seconds).toFixed(1)} s to kill` : 'slower'}, ${pctChange(vs.burst.volleyHull, first.vsTarget.burst.volleyHull) || 'same'} volley to hull.`;
            const stopped = [...new Set(vs.burst.stopped)];
            line += stopped.length ? ` Its armour stops ${stopped.join(', ')}.` : ' Nothing stopped by its armour.';
          } else {
            line = i === 0
              ? `vs stock: ${pctChange(r.sustained, sum(stockFit, 'sustainedDps')) || 'same'} sustained, ${pctChange(r.alpha, sum(stockFit, 'alpha')) || 'same'} alpha.`
              : `vs #1: ${pctChange(r.sustained, first.sustained) || 'same'} sustained, ${pctChange(r.alpha, first.alpha) || 'same'} alpha.`;
          }
          return (
            <article key={r.guns.map((g) => g.uuid).join()} className="grid grid-cols-[48px_minmax(0,1fr)] gap-x-4 gap-y-1 py-5 gt-rule">
              <span className={`gt-mono text-3xl leading-none ${i === 0 ? 'gt-acc' : 'gt-dim'}`}>0{i + 1}</span>
              <div className="flex flex-col gap-3 min-w-0">
                <h3 className="m-0 text-lg font-semibold gt-hi">{describeGuns(r.guns)}</h3>
                <div className="flex flex-wrap gap-x-9 gap-y-2">
                  {metrics.map((m) => (
                    <div key={m.k} className="flex flex-col gap-0.5">
                      <span className="gt-label">{m.k}</span>
                      <span className="gt-mono text-lg gt-hi">{m.v}</span>
                      <span className={`gt-mono text-xs ${m.d && m.good ? (m.d.startsWith('+') && goal !== 'target') || (m.d.startsWith('−') && goal === 'target') ? 'gt-good' : 'gt-bad' : 'gt-dim'}`}>{m.d || ' '}</span>
                    </div>
                  ))}
                </div>
                <p className="m-0 leading-relaxed max-w-[720px]">{line}</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <Link className={`gt-btn ${i === 0 ? 'gt-btn-primary' : ''}`} to={loadoutLink(r)}>Open in Loadout</Link>
                </div>
              </div>
            </article>
          );
        })}
        <div className="gt-rule pt-3.5 text-xs gt-dim">From the game files. Kill times assume shots at or below a ship&rsquo;s armour deflection do no hull damage; to be confirmed in game.</div>
      </section>
    </div>
  );
}
