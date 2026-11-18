// A ship's loadout (v1.45.0): its pilot gun slots, the gun picker and the
// totals, used once on a ship's page and twice side by side when comparing.
// The loadout lives in the address (?s0=<gun>… for the ship, ?c0=… for the
// one it's compared with), so a link shares it.

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gunFitsSlot, type CombatGun, type GameToolsShip, type GunSlot } from '@dem/shared';
import { fmt, gunsForSlot, pctChange, pilotSlots } from '../../lib/gameTools';

export type SortKey = 'sustainedDps' | 'burstDps' | 'alpha';

export interface LoadoutState {
  ship: GameToolsShip;
  slots: GunSlot[];
  stock: (CombatGun | null)[];
  equipped: (CombatGun | null)[];
  /** The guns that are mounted, for the maths. */
  guns: CombatGun[];
  stockGuns: CombatGun[];
  changes: number;
  pick: (slot: number, g: CombatGun) => void;
  fillAll: (g: CombatGun) => void;
  reset: () => void;
}

export function useLoadout(ship: GameToolsShip | null, prefix: string, gunsByUuid: Map<string, CombatGun>): LoadoutState | null {
  const [params, setParams] = useSearchParams();
  if (!ship) return null;
  const slots = pilotSlots(ship);
  const stock = slots.map((s) => (s.stockGunUuid ? gunsByUuid.get(s.stockGunUuid) ?? null : null));
  const equipped = slots.map((s, i) => {
    const id = params.get(`${prefix}${i}`);
    const g = id ? gunsByUuid.get(id) : undefined;
    return g && gunFitsSlot(g, s) ? g : stock[i] ?? null;
  });
  const set = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next, { replace: true });
  };
  return {
    ship, slots, stock, equipped,
    guns: equipped.filter((g): g is CombatGun => !!g),
    stockGuns: stock.filter((g): g is CombatGun => !!g),
    changes: equipped.filter((g, i) => g?.uuid !== stock[i]?.uuid).length,
    pick: (slot, g) => set((n) => { if (g.uuid === stock[slot]?.uuid) n.delete(`${prefix}${slot}`); else n.set(`${prefix}${slot}`, g.uuid); }),
    fillAll: (g) => set((n) => slots.forEach((s, i) => {
      if (!gunFitsSlot(g, s)) return;
      if (g.uuid === stock[i]?.uuid) n.delete(`${prefix}${i}`); else n.set(`${prefix}${i}`, g.uuid);
    })),
    reset: () => set((n) => { for (const k of [...n.keys()]) if (new RegExp(`^${prefix}\\d+$`).test(k)) n.delete(k); }),
  };
}

/** Six headline numbers for a ship, on one ruled row. */
export function KeyNumbers({ ship, guns, compact = false }: { ship: GameToolsShip; guns: CombatGun[]; compact?: boolean }) {
  const sum = (k: SortKey) => guns.reduce((t, g) => t + g[k], 0);
  const keys = [
    { k: 'Shields', v: fmt(ship.shieldHp), n: `regen ${fmt(ship.shieldRegen)}/s` },
    { k: 'Hull', v: fmt(ship.hullHp), n: 'main body' },
    { k: 'Alpha', v: fmt(sum('alpha')), n: `${fmt(sum('burstDps'))} burst · ${fmt(sum('sustainedDps'))} sust.` },
    { k: 'Top speed', v: fmt(ship.maxSpeed), n: `m/s · SCM ${fmt(ship.scm)}` },
    { k: 'Quantum', v: ship.qtSpool != null ? `${fmt(ship.qtSpool, 1)} s` : '–', n: 'spool' },
    { k: 'Cargo', v: fmt(ship.cargo), n: 'SCU' },
  ];
  return (
    <section aria-label="Key numbers" className="flex flex-wrap" style={{ borderTop: '1px solid var(--gt-line)', borderBottom: '1px solid var(--gt-line)' }}>
      {keys.map((x) => (
        <div key={x.k} className={`${compact ? 'flex-[1_1_110px] py-3 pr-3' : 'flex-[1_1_150px] py-4 pr-5'} flex flex-col gap-1`}>
          <span className="gt-label">{x.k}</span>
          <span className={`gt-mono gt-hi ${compact ? 'text-lg' : 'text-2xl'}`}>{x.v}</span>
          <span className="text-xs gt-dim">{x.n}</span>
        </div>
      ))}
    </section>
  );
}

export function SlotList({ lo, active, onPick }: { lo: LoadoutState; active: number | null; onPick: (i: number) => void }) {
  return (
    <div className="flex flex-col">
      <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Pilot guns · click one to change it</span>
      {lo.slots.map((s, i) => {
        const g = lo.equipped[i];
        const changed = g?.uuid !== lo.stock[i]?.uuid;
        return (
          <button key={s.id} type="button" className="gt-slot" aria-pressed={i === active} onClick={() => onPick(i)}>
            <span className="gt-mono text-xs gt-dim w-7">S{s.maxSize}</span>
            <span className="flex flex-col flex-1 min-w-0">
              <span className="text-xs gt-dim">{s.label}{s.mount ? ` · ${/gimbal/i.test(s.mount) ? 'gimbal' : 'mount'}` : ''}</span>
              <span className={`font-medium truncate ${i === active || changed ? 'gt-acc' : 'gt-hi'}`}>{g?.name ?? 'Empty'}</span>
            </span>
            <span className="gt-mono text-xs gt-dim">{g ? fmt(g.alpha) : ''}</span>
            {changed && <span className="gt-label gt-label-acc">new</span>}
          </button>
        );
      })}
      {!lo.slots.length && <p className="gt-dim text-sm my-3">This ship has no pilot guns.</p>}
      {lo.ship.gunSlots.some((s) => s.turret) && <p className="text-xs gt-dim mt-3 mb-0">Turret guns (for crew) aren&rsquo;t counted.</p>}
    </div>
  );
}

export function GunPicker({ lo, slotIndex, allGuns, expert }: { lo: LoadoutState; slotIndex: number; allGuns: CombatGun[]; expert: boolean }) {
  const [sort, setSort] = useState<SortKey>('alpha');
  const [showAll, setShowAll] = useState(false);
  const slot = lo.slots[slotIndex];
  const current = lo.equipped[slotIndex] ?? null;
  const candidates = useMemo(() => (slot ? [...gunsForSlot(allGuns, slot)].sort((a, b) => b[sort] - a[sort]) : []), [allGuns, slot, sort]);
  if (!slot) return null;
  const top = candidates.slice(0, 12);
  const list = showAll ? candidates : current && !top.includes(current) ? [...top, current] : top;
  const sameSize = lo.slots.filter((s) => s.minSize === slot.minSize && s.maxSize === slot.maxSize).length;
  const label = sort === 'alpha' ? 'Alpha' : sort === 'burstDps' ? 'Burst' : 'Sustained';

  return (
    <section aria-label={`Guns for ${slot.label}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="gt-label gt-label-acc m-0">{slot.label} · size {slot.minSize === slot.maxSize ? slot.maxSize : `${slot.minSize}–${slot.maxSize}`} gun</h2>
        <span className="text-sm gt-dim">{candidates.length} guns for this slot · sorted by {label.toLowerCase()} · click a name to equip it</span>
      </div>
      <div className="gt-scroll">
        <table className="gt-table min-w-[600px]">
          <thead>
            <tr>
              <th>Gun</th><th>Type</th>
              <th className="num"><button type="button" aria-pressed={sort === 'alpha'} onClick={() => setSort('alpha')}>Alpha</button></th>
              <th className="num"><button type="button" aria-pressed={sort === 'burstDps'} onClick={() => setSort('burstDps')}>Burst</button></th>
              <th className="num"><button type="button" aria-pressed={sort === 'sustainedDps'} onClick={() => setSort('sustainedDps')}>Sustained</button></th>
              {expert && <><th className="num">RPM</th><th className="num">Speed</th><th className="num">Range</th></>}
              <th className="num">{label} vs equipped</th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => {
              const on = g.uuid === current?.uuid;
              const d = current ? g[sort] - current[sort] : 0;
              return (
                <tr key={g.uuid} className={on ? 'is-on' : ''}>
                  <td>
                    <button type="button" className="gt-cellbtn" onClick={() => lo.pick(slotIndex, g)}>{g.name}</button>
                    <span className="block text-xs gt-dim">{g.maker}{g.uuid === lo.stock[slotIndex]?.uuid ? ' · stock' : ''}{g.variants ? ` · +${g.variants} skins` : ''}</span>
                  </td>
                  <td className="gt-dim">{g.kind}{g.pellets > 1 ? ` ×${g.pellets}` : ''}</td>
                  <td className="num gt-hi">{fmt(g.alpha)}</td>
                  <td className="num">{fmt(g.burstDps)}</td>
                  <td className="num">{fmt(g.sustainedDps)}</td>
                  {expert && <><td className="num">{fmt(g.fireRate)}</td><td className="num">{fmt(g.speed)}</td><td className="num">{fmt(g.range)}</td></>}
                  <td className={`num ${on ? 'gt-acc' : d > 0.5 ? 'gt-good' : d < -0.5 ? 'gt-bad' : 'gt-dim'}`}>{on ? 'equipped' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {candidates.length > 12 && <button type="button" className="gt-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the top 12' : `Show all ${candidates.length} guns`}</button>}
        {sameSize > 1 && current && <button type="button" className="gt-link" onClick={() => lo.fillAll(current)}>Put {current.name} in every size {slot.maxSize} slot</button>}
      </div>
    </section>
  );
}

export function Totals({ lo, expert }: { lo: LoadoutState; expert: boolean }) {
  const total = (list: CombatGun[], k: SortKey) => list.reduce((t, g) => t + g[k], 0);
  const row = (label: string, k: SortKey, unit = '') => {
    const now = total(lo.guns, k), was = total(lo.stockGuns, k);
    const d = lo.changes ? pctChange(now, was) : '';
    return (
      <div className="flex items-baseline gap-2 py-2 gt-row">
        <span className="flex-1">{label}</span>
        <span className={`gt-mono text-xs ${d.startsWith('+') ? 'gt-good' : d ? 'gt-bad' : ''}`}>{d}</span>
        <span className="gt-mono gt-hi min-w-[84px] text-right">{fmt(now)}{unit}</span>
      </div>
    );
  };
  const e = lo.guns.reduce((t, g) => t + g.sustainedDps * (g.alphaSplit.energy / (g.alpha || 1)), 0);
  const mix = Math.round((e / (total(lo.guns, 'sustainedDps') || 1)) * 100);
  const s = lo.ship;
  const line = (k: string, v: string) => <div className="flex items-baseline gap-2 py-2 gt-row"><span className="flex-1">{k}</span><span className="gt-mono gt-hi">{v}</span></div>;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Damage{lo.changes ? ' · vs stock' : ''}</span>
        {row('Alpha (one volley)', 'alpha')}
        {row('Burst', 'burstDps', '/s')}
        {row('Sustained', 'sustainedDps', '/s')}
        {line('Energy · ballistic', `${mix}% · ${100 - mix}%`)}
      </div>
      <div className="flex flex-col">
        <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Survival</span>
        {line('Shields', fmt(s.shieldHp))}
        {line('Shield regen', `${fmt(s.shieldRegen)}/s`)}
        {line('Main hull', fmt(s.hullHp))}
        {line('Armour: ballistic · energy', `×${fmt(s.armourMult.physical, 2)} · ×${fmt(s.armourMult.energy, 2)}`)}
        {expert && line('Deflects shots up to', `${fmt(s.deflection.physical)} · ${fmt(s.deflection.energy)}`)}
        {expert && s.insuranceClaimMin != null && line('Insurance claim', `${fmt(s.insuranceClaimMin, 1)} min`)}
      </div>
    </div>
  );
}
