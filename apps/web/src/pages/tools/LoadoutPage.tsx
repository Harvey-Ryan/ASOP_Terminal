// Loadout (v1.44.0): swap any pilot gun on a ship and see damage, alpha and
// what the fit can kill, live. The fit lives in the address (?s0=<gun>…),
// so it can be shared.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { gunFitsSlot, type CombatGun, type GameToolsShip } from '@dem/shared';
import { fmt, gunsForSlot, pctChange, pilotSlots, shipPath, shortShipName, useGameTools } from '../../lib/gameTools';
import { ToolsDataState } from './ToolsLayout';
import { KillTable } from './KillTable';

type SortKey = 'sustainedDps' | 'burstDps' | 'alpha';

export function ShipChooser({ ships, current, page }: { ships: GameToolsShip[]; current: GameToolsShip | null; page: 'loadout' | 'optimizer' }) {
  const navigate = useNavigate();
  const armed = useMemo(() => ships.filter((s) => pilotSlots(s).length > 0), [ships]);
  return (
    <label className="flex flex-col gap-1 min-w-[260px]">
      <span className="gt-label">Ship</span>
      <select
        className="gt-input text-base"
        value={current?.className.toLowerCase() ?? ''}
        onChange={(e) => { const s = armed.find((x) => x.className.toLowerCase() === e.target.value); if (s) navigate(shipPath(s, page)); }}
      >
        {!current && <option value="">Choose a ship…</option>}
        {armed.map((s) => <option key={s.uuid} value={s.className.toLowerCase()}>{s.name}</option>)}
      </select>
    </label>
  );
}

export function LoadoutPage() {
  const { className = '' } = useParams();
  const { data, index, isLoading, error } = useGameTools();
  if (!data || !index) return <ToolsDataState isLoading={isLoading} error={error} />;
  const ship = className ? index.shipsByClass.get(className.toLowerCase()) ?? null : null;
  if (!ship) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-10 pt-10 pb-16 flex flex-col gap-6">
        <h1 className="m-0 text-3xl font-bold gt-hi">Loadout</h1>
        <p className="m-0 gt-dim max-w-[620px]">Pick a ship to change its guns and see what the fit can kill.</p>
        <ShipChooser ships={data.ships} current={null} page="loadout" />
      </main>
    );
  }
  return <Loadout ship={ship} ships={data.ships} guns={data.guns} gunsByUuid={index.gunsByUuid} />;
}

function Loadout({ ship, ships, guns, gunsByUuid }: { ship: GameToolsShip; ships: GameToolsShip[]; guns: CombatGun[]; gunsByUuid: Map<string, CombatGun> }) {
  const [params, setParams] = useSearchParams();
  const slots = pilotSlots(ship);
  const [active, setActive] = useState(0);
  const [sort, setSort] = useState<SortKey>('sustainedDps');
  const [expert, setExpert] = useState(false);
  const [copied, setCopied] = useState(false);
  const [allGuns, setAllGuns] = useState(false);

  const stock = slots.map((s) => (s.stockGunUuid ? gunsByUuid.get(s.stockGunUuid) ?? null : null));
  const fitted = slots.map((s, i) => {
    const id = params.get(`s${i}`);
    const g = id ? gunsByUuid.get(id) : undefined;
    return g && gunFitsSlot(g, s) ? g : stock[i] ?? null;
  });
  const fit = fitted.filter((g): g is CombatGun => !!g);
  const stockFit = stock.filter((g): g is CombatGun => !!g);
  const changes = fitted.filter((g, i) => g?.uuid !== stock[i]?.uuid).length;

  const pick = (slot: number, g: CombatGun) => {
    const next = new URLSearchParams(params);
    if (g.uuid === stock[slot]?.uuid) next.delete(`s${slot}`); else next.set(`s${slot}`, g.uuid);
    setParams(next, { replace: true });
  };
  const fillAll = (g: CombatGun) => {
    const next = new URLSearchParams(params);
    slots.forEach((s, i) => {
      if (!gunFitsSlot(g, s)) return;
      if (g.uuid === stock[i]?.uuid) next.delete(`s${i}`); else next.set(`s${i}`, g.uuid);
    });
    setParams(next, { replace: true });
  };
  const reset = () => setParams(new URLSearchParams(), { replace: true });
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  };

  const slot = slots[active] ?? slots[0];
  const current = slot ? fitted[slots.indexOf(slot)] : null;
  const candidates = useMemo(() => (slot ? [...gunsForSlot(guns, slot)].sort((a, b) => b[sort] - a[sort]) : []), [guns, slot, sort]);
  const sameSize = slots.length > 1 && slot ? slots.filter((s) => s.minSize === slot.minSize && s.maxSize === slot.maxSize).length : 0;

  const total = (list: CombatGun[], k: SortKey) => list.reduce((t, g) => t + g[k], 0);
  const statRow = (label: string, k: SortKey, unit = '') => {
    const now = total(fit, k), was = total(stockFit, k);
    const d = changes ? pctChange(now, was) : '';
    return (
      <div className="flex items-baseline gap-2 py-2 gt-row">
        <span className="flex-1">{label}</span>
        <span className={`gt-mono text-xs ${d.startsWith('+') ? 'gt-good' : d ? 'gt-bad' : ''}`}>{d}</span>
        <span className="gt-mono gt-hi min-w-[84px] text-right">{fmt(now)}{unit}</span>
      </div>
    );
  };
  const mix = (() => {
    const e = fit.reduce((t, g) => t + g.sustainedDps * (g.alphaSplit.energy / (g.alpha || 1)), 0);
    const all = total(fit, 'sustainedDps') || 1;
    return Math.round((e / all) * 100);
  })();

  return (
    <>
      <section aria-label="Ship" className="flex flex-wrap items-end gap-x-8 gap-y-4 px-5 sm:px-10 pt-7 pb-5 border-b" style={{ borderColor: 'var(--gt-line)' }}>
        <div className="flex flex-col gap-1 flex-[1_1_320px]">
          <span className="gt-label">{[ship.maker, ship.role ?? ship.career, ship.size != null ? `size ${ship.size}` : null].filter(Boolean).join(' · ')}</span>
          <h1 className="m-0 text-[34px] font-bold gt-hi">{shortShipName(ship)}</h1>
          <span className="text-sm gt-dim">Compared with <strong className="gt-hi font-semibold">stock</strong> · {changes ? `${changes} change${changes === 1 ? '' : 's'}` : 'no changes yet'}</span>
        </div>
        <ShipChooser ships={ships} current={ship} page="loadout" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="gt-btn" aria-pressed={expert} onClick={() => setExpert(!expert)}>Expert view</button>
          {changes > 0 && <button type="button" className="gt-btn" onClick={reset}>Back to stock</button>}
          <button type="button" className="gt-btn" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
          <Link className="gt-btn gt-btn-primary" to={shipPath(ship, 'optimizer')}>Optimize</Link>
        </div>
      </section>

      <div className="flex flex-wrap">
        <section aria-label="Gun slots" className="flex-[1_1_300px] max-w-[380px] box-border px-5 sm:pl-10 sm:pr-7 py-6 flex flex-col gap-1" style={{ borderRight: '1px solid var(--gt-line)' }}>
          <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Pilot guns</span>
          {slots.map((s, i) => {
            const g = fitted[i];
            const changed = g?.uuid !== stock[i]?.uuid;
            return (
              <button key={s.id} type="button" className="gt-slot" aria-pressed={i === active} onClick={() => setActive(i)}>
                <span className="gt-mono text-xs gt-dim w-7">S{s.maxSize}</span>
                <span className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs gt-dim">{s.label}{s.mount ? ` · ${/gimbal/i.test(s.mount) ? 'gimbal' : 'mount'}` : ''}</span>
                  <span className={`font-medium truncate ${i === active || changed ? 'gt-acc' : 'gt-hi'}`}>{g?.name ?? 'Empty'}</span>
                </span>
                {changed && <span className="gt-label gt-label-acc">new</span>}
              </button>
            );
          })}
          {ship.gunSlots.some((s) => s.turret) && <p className="text-xs gt-dim mt-3 mb-0">Turret guns (for crew) aren&rsquo;t counted here.</p>}
          <p className="text-xs gt-dim mt-3 mb-0">Missiles and components are coming next.</p>
        </section>

        <section aria-labelledby="gt-pick-h" className="flex-[999_1_520px] min-w-0 box-border px-5 sm:px-7 py-6 flex flex-col gap-3">
          {slot && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 id="gt-pick-h" className="gt-label gt-label-acc m-0">{slot.label} · size {slot.minSize === slot.maxSize ? slot.maxSize : `${slot.minSize}–${slot.maxSize}`} gun</h2>
                <span className="text-sm gt-dim">{candidates.length} guns fit · click a name to fit it</span>
              </div>
              <div className="gt-scroll">
                <table className="gt-table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Gun</th><th>Type</th>
                      <th className="num"><button type="button" aria-pressed={sort === 'sustainedDps'} onClick={() => setSort('sustainedDps')}>Sustained</button></th>
                      <th className="num"><button type="button" aria-pressed={sort === 'burstDps'} onClick={() => setSort('burstDps')}>Burst</button></th>
                      <th className="num"><button type="button" aria-pressed={sort === 'alpha'} onClick={() => setSort('alpha')}>Alpha</button></th>
                      {expert && <><th className="num">Rate</th><th className="num">Range</th><th className="num">Speed</th></>}
                      <th className="num">vs fitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(allGuns ? candidates : candidates.slice(0, 12).concat(current && !candidates.slice(0, 12).includes(current) ? [current] : [])).map((g) => {
                      const on = g.uuid === current?.uuid;
                      const d = current ? g.sustainedDps - current.sustainedDps : 0;
                      return (
                        <tr key={g.uuid} className={on ? 'is-on' : ''}>
                          <td>
                            <button type="button" className="gt-cellbtn" onClick={() => pick(slots.indexOf(slot), g)}>{g.name}</button>
                            <span className="block text-xs gt-dim">{g.maker}{g.uuid === stock[slots.indexOf(slot)]?.uuid ? ' · stock' : ''}{g.variants ? ` · +${g.variants} skins` : ''}</span>
                          </td>
                          <td className="gt-dim">{g.kind}{g.pellets > 1 ? ` ×${g.pellets}` : ''}</td>
                          <td className="num gt-hi">{fmt(g.sustainedDps)}</td>
                          <td className="num">{fmt(g.burstDps)}</td>
                          <td className="num">{fmt(g.alpha)}</td>
                          {expert && <><td className="num">{fmt(g.fireRate)}</td><td className="num">{fmt(g.range)}</td><td className="num">{fmt(g.speed)}</td></>}
                          <td className={`num ${on ? 'gt-acc' : d > 0.5 ? 'gt-good' : d < -0.5 ? 'gt-bad' : 'gt-dim'}`}>{on ? 'fitted' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {candidates.length > 12 && (
                <p className="text-sm m-0"><button type="button" className="gt-link" onClick={() => setAllGuns(!allGuns)}>{allGuns ? 'Show the top 12' : `Show all ${candidates.length} guns`}</button></p>
              )}
              {sameSize > 1 && current && (
                <p className="text-sm m-0"><button type="button" className="gt-link" onClick={() => fillAll(current)}>Put {current.name} in every size {slot.maxSize} slot</button></p>
              )}
            </>
          )}
          <div className="mt-6"><KillTable guns={fit} ships={ships} optimizeFor={ship} /></div>
        </section>

        <aside aria-label="Totals" className="flex-[1_1_280px] max-w-[380px] box-border px-5 sm:pl-7 sm:pr-10 py-6 flex flex-col gap-6" style={{ borderLeft: '1px solid var(--gt-line)' }}>
          <div className="flex flex-col">
            <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Damage</span>
            {statRow('Sustained', 'sustainedDps', '/s')}
            {statRow('Burst', 'burstDps', '/s')}
            {statRow('Alpha (one volley)', 'alpha')}
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Energy · ballistic</span><span className="gt-mono gt-hi">{mix}% · {100 - mix}%</span></div>
          </div>
          <div className="flex flex-col">
            <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Survival</span>
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Shields</span><span className="gt-mono gt-hi">{fmt(ship.shieldHp)}</span></div>
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Shield regen</span><span className="gt-mono gt-hi">{fmt(ship.shieldRegen)}/s</span></div>
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Main hull</span><span className="gt-mono gt-hi">{fmt(ship.hullHp)}</span></div>
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Armour: ballistic · energy</span><span className="gt-mono gt-hi">×{fmt(ship.armourMult.physical, 2)} · ×{fmt(ship.armourMult.energy, 2)}</span></div>
            {expert && <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Deflects shots up to</span><span className="gt-mono gt-hi">{fmt(ship.deflection.physical)} · {fmt(ship.deflection.energy)}</span></div>}
          </div>
          <div className="flex flex-col">
            <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Flight</span>
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">SCM · max</span><span className="gt-mono gt-hi">{fmt(ship.scm)} · {fmt(ship.maxSpeed)}</span></div>
            <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">Quantum spool</span><span className="gt-mono gt-hi">{ship.qtSpool != null ? `${fmt(ship.qtSpool, 1)} s` : '–'}</span></div>
          </div>
        </aside>
      </div>
    </>
  );
}
