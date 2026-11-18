// A ship's loadout (v1.45.0): its pilot gun slots, the gun picker and the
// totals, used once on a ship's page and twice side by side when comparing.
// The loadout lives in the address (?s0=<gun>… for the ship, ?c0=… for the
// one it's compared with), so a link shares it. Components (v1.46.0: shields,
// power, coolers, quantum, radar) too: ?sk0=<component>… / ?ck0=….

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  gunFitsSlot, componentFitsSlot, componentTotals, COMPONENT_KINDS,
  type CombatGun, type GameToolsShip, type GunSlot, type ShipComponent, type ComponentSlot, type ComponentTotals,
} from '@dem/shared';
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
  /** Components: slots, stock and fitted, and the totals they give (shields, quantum…). */
  compSlots: ComponentSlot[];
  compStock: (ShipComponent | null)[];
  compFitted: (ShipComponent | null)[];
  systems: ComponentTotals;
  stockSystems: ComponentTotals;
  changes: number;
  pick: (slot: number, g: CombatGun) => void;
  fillAll: (g: CombatGun) => void;
  pickComponent: (slot: number, c: ShipComponent) => void;
  fillAllComponents: (c: ShipComponent) => void;
  reset: () => void;
}

export function useLoadout(ship: GameToolsShip | null, prefix: string, gunsByUuid: Map<string, CombatGun>, componentsByUuid: Map<string, ShipComponent>): LoadoutState | null {
  const [params, setParams] = useSearchParams();
  if (!ship) return null;
  const compSlots = ship.componentSlots ?? [];
  const compStock = compSlots.map((s) => (s.stockUuid ? componentsByUuid.get(s.stockUuid) ?? null : null));
  const compFitted = compSlots.map((s, i) => {
    const id = params.get(`${prefix}k${i}`);
    const c = id ? componentsByUuid.get(id) : undefined;
    return c && componentFitsSlot(c, s) ? c : compStock[i] ?? null;
  });
  const ck = (i: number) => `${prefix}k${i}`;
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
    compSlots, compStock, compFitted,
    systems: componentTotals(compFitted, ship.qtFuelCapacity),
    stockSystems: componentTotals(compStock, ship.qtFuelCapacity),
    changes: equipped.filter((g, i) => g?.uuid !== stock[i]?.uuid).length + compFitted.filter((c, i) => c?.uuid !== compStock[i]?.uuid).length,
    pick: (slot, g) => set((n) => { if (g.uuid === stock[slot]?.uuid) n.delete(`${prefix}${slot}`); else n.set(`${prefix}${slot}`, g.uuid); }),
    fillAll: (g) => set((n) => slots.forEach((s, i) => {
      if (!gunFitsSlot(g, s)) return;
      if (g.uuid === stock[i]?.uuid) n.delete(`${prefix}${i}`); else n.set(`${prefix}${i}`, g.uuid);
    })),
    pickComponent: (slot, c) => set((n) => { if (c.uuid === compStock[slot]?.uuid) n.delete(ck(slot)); else n.set(ck(slot), c.uuid); }),
    fillAllComponents: (c) => set((n) => compSlots.forEach((s, i) => {
      if (!componentFitsSlot(c, s)) return;
      if (c.uuid === compStock[i]?.uuid) n.delete(ck(i)); else n.set(ck(i), c.uuid);
    })),
    reset: () => set((n) => { for (const k of [...n.keys()]) if (new RegExp(`^${prefix}k?\\d+$`).test(k)) n.delete(k); }),
  };
}

/** Six headline numbers for a ship, on one ruled row. */
export function KeyNumbers({ lo, compact = false }: { lo: LoadoutState; compact?: boolean }) {
  const { ship, guns, systems: sys } = lo;
  const sum = (k: SortKey) => guns.reduce((t, g) => t + g[k], 0);
  const qt = sys.quantum;
  const keys = [
    { k: 'Shields', v: fmt(sys.activeShields ? sys.shieldHp : ship.shieldHp), n: `regen ${fmt(sys.activeShields ? sys.shieldRegen : ship.shieldRegen)}/s` },
    { k: 'Hull', v: fmt(ship.hullHp), n: 'main body' },
    { k: 'Alpha', v: fmt(sum('alpha')), n: `${fmt(sum('burstDps'))} burst · ${fmt(sum('sustainedDps'))} sust.` },
    { k: 'Top speed', v: fmt(ship.maxSpeed), n: `m/s · SCM ${fmt(ship.scm)}` },
    { k: 'Quantum', v: qt?.qtSpool != null ? `${fmt(qt.qtSpool, 1)} s` : ship.qtSpool != null ? `${fmt(ship.qtSpool, 1)} s` : '–', n: sys.qtRangeGm != null ? `spool · ${fmt(sys.qtRangeGm, 1)} Gm range` : 'spool' },
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

export interface ActiveSlot { comp: boolean; slot: number }

/** The number shown beside a component in the slot list. */
function componentHeadline(c: ShipComponent): string {
  switch (c.kind) {
    case 'shield': return fmt(c.shieldHp);
    case 'power': return `${fmt(c.powerOut)} seg`;
    case 'cooler': return `${fmt(c.coolOut)}/s`;
    case 'quantum': return c.qtSpeed != null ? `${fmt(c.qtSpeed / 1000)} km/s` : '';
    case 'radar': return c.aimAssist != null ? `${fmt(c.aimAssist)} m` : '';
  }
}

export function SlotList({ lo, active, onPick }: { lo: LoadoutState; active: ActiveSlot | null; onPick: (comp: boolean, i: number) => void }) {
  return (
    <div className="flex flex-col">
      <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>Pilot guns · click one to change it</span>
      {lo.slots.map((s, i) => {
        const g = lo.equipped[i];
        const changed = g?.uuid !== lo.stock[i]?.uuid;
        const on = !!active && !active.comp && active.slot === i;
        return (
          <button key={s.id} type="button" className="gt-slot" aria-pressed={on} onClick={() => onPick(false, i)}>
            <span className="gt-mono text-xs gt-dim w-7">S{s.maxSize}</span>
            <span className="flex flex-col flex-1 min-w-0">
              <span className="text-xs gt-dim">{s.label}{s.mount ? ` · ${/gimbal/i.test(s.mount) ? 'gimbal' : 'mount'}` : ''}</span>
              <span className={`font-medium truncate ${on || changed ? 'gt-acc' : 'gt-hi'}`}>{g?.name ?? 'Empty'}</span>
            </span>
            <span className="gt-mono text-xs gt-dim">{g ? fmt(g.alpha) : ''}</span>
            {changed && <span className="gt-label gt-label-acc">new</span>}
          </button>
        );
      })}
      {!lo.slots.length && <p className="gt-dim text-sm my-3">This ship has no pilot guns.</p>}
      {lo.ship.gunSlots.some((s) => s.turret) && <p className="text-xs gt-dim mt-3 mb-0">Turret guns (for crew) aren&rsquo;t counted.</p>}

      {lo.compSlots.length > 0 && <span className="gt-label pb-1.5 mt-6" style={{ borderBottom: '1px solid var(--gt-line)' }}>Components</span>}
      {COMPONENT_KINDS.map(({ kind, label }) => {
        const idx = lo.compSlots.map((s, i) => (s.kind === kind ? i : -1)).filter((i) => i >= 0);
        return idx.map((i, n) => {
          const s = lo.compSlots[i]!;
          const c = lo.compFitted[i];
          const changed = c?.uuid !== lo.compStock[i]?.uuid;
          const on = !!active && active.comp && active.slot === i;
          const spare = kind === 'shield' && c && lo.systems.spareShields > 0 && !isActiveShield(lo, i);
          return (
            <button key={s.id} type="button" className="gt-slot" aria-pressed={on} onClick={() => onPick(true, i)}>
              <span className="gt-mono text-xs gt-dim w-7">S{s.maxSize}</span>
              <span className="flex flex-col flex-1 min-w-0">
                <span className="text-xs gt-dim">{label}{idx.length > 1 ? ` ${n + 1}` : ''}{c ? ` · ${[c.cls, c.grade].filter(Boolean).join(' ')}` : ''}{s.locked ? ' · fixed' : ''}{spare ? ' · spare' : ''}</span>
                <span className={`font-medium truncate ${on || changed ? 'gt-acc' : 'gt-hi'}`}>{c?.name ?? 'Empty'}</span>
              </span>
              <span className="gt-mono text-xs gt-dim">{c ? componentHeadline(c) : ''}</span>
              {changed && <span className="gt-label gt-label-acc">new</span>}
            </button>
          );
        });
      })}
    </div>
  );
}

/** Whether slot `i`'s shield is one of the two that are up (the strongest; ties go to the earlier slot). */
function isActiveShield(lo: LoadoutState, i: number): boolean {
  const ranked = lo.compSlots.map((s, j) => ({ j, hp: s.kind === 'shield' ? lo.compFitted[j]?.shieldHp ?? -1 : -1 }))
    .filter((x) => x.hp >= 0).sort((a, b) => b.hp - a.hp || a.j - b.j);
  return ranked.slice(0, lo.systems.activeShields).some((x) => x.j === i);
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

interface CompColumn { key: string; label: string; get: (c: ShipComponent) => number | null; digits?: number; lowerIsBetter?: boolean; expert?: boolean }

/** What each kind of component is judged on; the first column is the default sort. */
const COMPONENT_COLUMNS: Record<ShipComponent['kind'], CompColumn[]> = {
  shield: [
    { key: 'hp', label: 'Shield HP', get: (c) => c.shieldHp },
    { key: 'regen', label: 'Regen /s', get: (c) => c.shieldRegen },
    { key: 'dmg', label: 'Regen after hit', get: (c) => c.damagedDelay, digits: 1, lowerIsBetter: true },
    { key: 'down', label: 'After drop', get: (c) => c.downedDelay, digits: 1, lowerIsBetter: true },
    { key: 'em', label: 'EM', get: (c) => c.em, lowerIsBetter: true, expert: true },
    { key: 'pwr', label: 'Power', get: (c) => c.powerDraw, lowerIsBetter: true, expert: true },
  ],
  power: [
    { key: 'out', label: 'Power seg.', get: (c) => c.powerOut },
    { key: 'em', label: 'EM', get: (c) => c.em, lowerIsBetter: true },
    { key: 'hp', label: 'Health', get: (c) => c.health, expert: true },
  ],
  cooler: [
    { key: 'out', label: 'Cooling /s', get: (c) => c.coolOut },
    { key: 'ir', label: 'IR', get: (c) => c.ir, lowerIsBetter: true },
    { key: 'em', label: 'EM', get: (c) => c.em, lowerIsBetter: true },
    { key: 'pwr', label: 'Power', get: (c) => c.powerDraw, lowerIsBetter: true, expert: true },
  ],
  quantum: [
    { key: 'speed', label: 'km/s', get: (c) => (c.qtSpeed != null ? c.qtSpeed / 1000 : null) },
    { key: 'spool', label: 'Spool s', get: (c) => c.qtSpool, digits: 1, lowerIsBetter: true },
    { key: 'cool', label: 'Cooldown s', get: (c) => c.qtCooldown, digits: 1, lowerIsBetter: true },
    { key: 'fuel', label: 'Fuel mSCU/Gm', get: (c) => c.qtFuelPerGm, lowerIsBetter: true },
    { key: 'em', label: 'EM', get: (c) => c.em, lowerIsBetter: true, expert: true },
  ],
  radar: [
    { key: 'aim', label: 'Aim assist m', get: (c) => c.aimAssist },
    { key: 'em', label: 'EM', get: (c) => c.em, lowerIsBetter: true },
    { key: 'pwr', label: 'Power', get: (c) => c.powerDraw, lowerIsBetter: true, expert: true },
  ],
};

export function ComponentPicker({ lo, slotIndex, all, expert }: { lo: LoadoutState; slotIndex: number; all: ShipComponent[]; expert: boolean }) {
  const slot = lo.compSlots[slotIndex];
  const cols = slot ? COMPONENT_COLUMNS[slot.kind].filter((c) => expert || !c.expert) : [];
  const [sortKey, setSortKey] = useState<string | null>(null);
  const col = cols.find((c) => c.key === sortKey) ?? cols[0];
  const current = lo.compFitted[slotIndex] ?? null;
  const [showAll, setShowAll] = useState(false);
  const candidates = useMemo(() => {
    if (!slot || !col) return [];
    const v = (c: ShipComponent) => col.get(c) ?? (col.lowerIsBetter ? Infinity : -Infinity);
    return all.filter((c) => componentFitsSlot(c, slot)).sort((a, b) => (col.lowerIsBetter ? v(a) - v(b) : v(b) - v(a)) || a.name.localeCompare(b.name));
  }, [all, slot, col]);
  if (!slot || !col) return null;
  const kind = COMPONENT_KINDS.find((k) => k.kind === slot.kind)!;
  const sameSize = lo.compSlots.filter((s) => s.kind === slot.kind && s.minSize === slot.minSize && s.maxSize === slot.maxSize && !s.locked).length;
  const range = (c: ShipComponent) => (c.qtFuelPerGm && lo.ship.qtFuelCapacity ? lo.ship.qtFuelCapacity / c.qtFuelPerGm : null);

  return (
    <section aria-label={`${kind.plural} for this slot`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="gt-label gt-label-acc m-0">{kind.label} · size {slot.maxSize}</h2>
        <span className="text-sm gt-dim">
          {slot.locked ? 'Fixed by the maker: it can’t be swapped.' : `${candidates.length} for this slot · sorted by ${col.label.toLowerCase()} · click a name to fit it`}
        </span>
      </div>
      <div className="gt-scroll">
        <table className="gt-table min-w-[560px]">
          <thead>
            <tr>
              <th>{kind.label}</th><th>Class</th>
              {cols.map((c) => <th key={c.key} className="num"><button type="button" aria-pressed={c.key === col.key} onClick={() => setSortKey(c.key)}>{c.label}</button></th>)}
              {slot.kind === 'quantum' && <th className="num">Range Gm</th>}
              <th className="num">{col.label} vs fitted</th>
            </tr>
          </thead>
          <tbody>
            {(showAll ? candidates : (() => { const top = candidates.slice(0, 12); return current && !top.includes(current) ? [...top, current] : top; })()).map((c) => {
              const on = c.uuid === current?.uuid;
              const now = col.get(c), was = current ? col.get(current) : null;
              const d = now != null && was != null ? now - was : 0;
              const better = col.lowerIsBetter ? d < 0 : d > 0;
              const tiny = Math.abs(d) < (col.digits ? 0.05 : 0.5);
              return (
                <tr key={c.uuid} className={on ? 'is-on' : ''}>
                  <td>
                    <button type="button" className="gt-cellbtn" disabled={slot.locked} onClick={() => lo.pickComponent(slotIndex, c)}>{c.name}</button>
                    <span className="block text-xs gt-dim">{c.maker}{c.uuid === lo.compStock[slotIndex]?.uuid ? ' · stock' : ''}{c.variants ? ` · +${c.variants} copies` : ''}</span>
                  </td>
                  <td className="gt-dim whitespace-nowrap">{[c.cls, c.grade].filter(Boolean).join(' ') || '–'}</td>
                  {cols.map((k) => <td key={k.key} className={`num ${k.key === col.key ? 'gt-hi' : ''}`}>{fmt(k.get(c), k.digits ?? 0)}</td>)}
                  {slot.kind === 'quantum' && <td className="num">{fmt(range(c), 1)}</td>}
                  <td className={`num ${on ? 'gt-acc' : tiny ? 'gt-dim' : better ? 'gt-good' : 'gt-bad'}`}>{on ? 'fitted' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d), col.digits ?? 0)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {candidates.length > 12 && <button type="button" className="gt-link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show the top 12' : `Show all ${candidates.length}`}</button>}
        {sameSize > 1 && current && !slot.locked && <button type="button" className="gt-link" onClick={() => lo.fillAllComponents(current)}>Fit {current.name} in every size {slot.maxSize} {kind.label.toLowerCase()} slot</button>}
      </div>
      <p className="text-xs gt-dim m-0 leading-relaxed">
        Base stats from the game files, the same as a crafted part at quality 500.
        {slot.kind === 'shield' && ' Only the two strongest shields are up at once; any others are spares.'}
        {slot.kind === 'power' && ' A power plant’s rating is the most it can give; how much it does depends on your power settings.'}
        {slot.kind === 'quantum' && ' Range is on this ship’s full quantum tank.'}
      </p>
    </section>
  );
}

export function Totals({ lo, expert }: { lo: LoadoutState; expert: boolean }) {
  const total = (list: CombatGun[], k: SortKey) => list.reduce((t, g) => t + g[k], 0);
  /** "+12%" against stock, and whether that's better (spool and cooldown are better lower). */
  type Delta = { text: string; good: boolean } | null;
  const changed = (now: number | null | undefined, was: number | null | undefined, lowerIsBetter = false): Delta => {
    if (now == null || was == null || !lo.changes) return null;
    const text = pctChange(now, was);
    return text ? { text, good: text.startsWith('+') !== lowerIsBetter } : null;
  };
  const cell = (label: string, value: string, delta: Delta = null) => (
    <div className="flex items-baseline gap-2 py-2 gt-row">
      <span className="flex-1">{label}</span>
      <span className={`gt-mono text-xs ${delta ? (delta.good ? 'gt-good' : 'gt-bad') : ''}`}>{delta?.text}</span>
      <span className="gt-mono gt-hi min-w-[84px] text-right whitespace-nowrap">{value}</span>
    </div>
  );
  const row = (label: string, k: SortKey, unit = '') => {
    const now = total(lo.guns, k), was = total(lo.stockGuns, k);
    return cell(label, `${fmt(now)}${unit}`, changed(now, was));
  };
  const e = lo.guns.reduce((t, g) => t + g.sustainedDps * (g.alphaSplit.energy / (g.alpha || 1)), 0);
  const mix = Math.round((e / (total(lo.guns, 'sustainedDps') || 1)) * 100);
  const s = lo.ship;
  const sys = lo.systems, was = lo.stockSystems;
  const hasShields = sys.activeShields > 0;
  const qt = sys.quantum;
  const radar = lo.compFitted.find((c) => c?.kind === 'radar') ?? null;
  const stockRadar = lo.compStock.find((c) => c?.kind === 'radar') ?? null;
  const heading = (t: string) => <span className="gt-label pb-1.5" style={{ borderBottom: '1px solid var(--gt-line)' }}>{t}</span>;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        {heading(`Damage${lo.changes ? ' · vs stock' : ''}`)}
        {row('Alpha (one volley)', 'alpha')}
        {row('Burst', 'burstDps', '/s')}
        {row('Sustained', 'sustainedDps', '/s')}
        {cell('Energy · ballistic', `${mix}% · ${100 - mix}%`)}
      </div>
      <div className="flex flex-col">
        {heading('Survival')}
        {cell(sys.spareShields ? `Shields (2 up, ${sys.spareShields} spare)` : 'Shields', fmt(hasShields ? sys.shieldHp : s.shieldHp), hasShields ? changed(sys.shieldHp, was.shieldHp) : null)}
        {cell('Shield regen', `${fmt(hasShields ? sys.shieldRegen : s.shieldRegen)}/s`, hasShields ? changed(sys.shieldRegen, was.shieldRegen) : null)}
        {cell('Main hull', fmt(s.hullHp))}
        {cell('Armour: ballistic · energy', `×${fmt(s.armourMult.physical, 2)} · ×${fmt(s.armourMult.energy, 2)}`)}
        {expert && cell('Deflects shots up to', `${fmt(s.deflection.physical)} · ${fmt(s.deflection.energy)}`)}
        {expert && s.insuranceClaimMin != null && cell('Insurance claim', `${fmt(s.insuranceClaimMin, 1)} min`)}
      </div>
      {(qt || sys.coolOut > 0 || radar) && (
        <div className="flex flex-col">
          {heading('Systems')}
          {sys.coolOut > 0 && cell('Cooling', `${fmt(sys.coolOut)}/s`, changed(sys.coolOut, was.coolOut))}
          {qt?.qtSpeed != null && cell('Quantum speed', `${fmt(qt.qtSpeed / 1000)} km/s`, changed(qt.qtSpeed, was.quantum?.qtSpeed))}
          {qt?.qtSpool != null && cell('Quantum spool', `${fmt(qt.qtSpool, 1)} s`, changed(qt.qtSpool, was.quantum?.qtSpool, true))}
          {sys.qtRangeGm != null && cell('Quantum range', `${fmt(sys.qtRangeGm, 1)} Gm`, changed(sys.qtRangeGm, was.qtRangeGm))}
          {expert && qt?.qtCooldown != null && cell('Quantum cooldown', `${fmt(qt.qtCooldown, 1)} s`, changed(qt.qtCooldown, was.quantum?.qtCooldown, true))}
          {radar?.aimAssist != null && cell('Aim assist', `${fmt(radar.aimAssist)} m`, changed(radar.aimAssist, stockRadar?.aimAssist))}
        </div>
      )}
    </div>
  );
}
