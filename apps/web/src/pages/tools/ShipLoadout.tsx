// A ship's loadout (v1.45.0; Erkul-style page since v1.47.0): pilot guns,
// missiles and components as cards grouped by system, a summary bar that
// stays on screen, the ship's panels, and a swap window for every slot.
// The loadout lives in the address so a link shares it: ?s0=<gun>…,
// ?sk0=<component>…, ?sm0=<missile>… for the ship, c0/ck0/cm0 for the one it's
// compared with.

import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  gunFitsSlot, componentFitsSlot, componentTotals, missileFitsRack, COMPONENT_KINDS,
  type CombatGun, type GameToolsShip, type GunSlot, type ShipComponent, type ComponentSlot, type ComponentTotals,
  type MissileItem, type MissileRack,
} from '@dem/shared';
import { fmt, pctChange, pilotSlots } from '../../lib/gameTools';
import { SwapWindow, type SwapColumn } from './SwapWindow';

export interface LoadoutState {
  ship: GameToolsShip;
  slots: GunSlot[];
  stock: (CombatGun | null)[];
  equipped: (CombatGun | null)[];
  /** The guns that are mounted, for the maths. */
  guns: CombatGun[];
  stockGuns: CombatGun[];
  compSlots: ComponentSlot[];
  compStock: (ShipComponent | null)[];
  compFitted: (ShipComponent | null)[];
  systems: ComponentTotals;
  stockSystems: ComponentTotals;
  racks: MissileRack[];
  misStock: (MissileItem | null)[];
  misFitted: (MissileItem | null)[];
  missileDamage: number;
  stockMissileDamage: number;
  missileCount: number;
  changes: number;
  pick: (slot: number, g: CombatGun) => void;
  pickComponent: (slot: number, c: ShipComponent) => void;
  /** Loads the same missile into every rack listed. */
  pickMissiles: (racks: number[], m: MissileItem) => void;
  reset: () => void;
}

export function useLoadout(ship: GameToolsShip | null, prefix: string, gunsByUuid: Map<string, CombatGun>, componentsByUuid: Map<string, ShipComponent>, missilesByUuid: Map<string, MissileItem>): LoadoutState | null {
  const [params, setParams] = useSearchParams();
  if (!ship) return null;
  const slots = pilotSlots(ship);
  const stock = slots.map((s) => (s.stockGunUuid ? gunsByUuid.get(s.stockGunUuid) ?? null : null));
  const equipped = slots.map((s, i) => {
    const id = params.get(`${prefix}${i}`);
    const g = id ? gunsByUuid.get(id) : undefined;
    return g && gunFitsSlot(g, s) ? g : stock[i] ?? null;
  });
  const compSlots = ship.componentSlots ?? [];
  const compStock = compSlots.map((s) => (s.stockUuid ? componentsByUuid.get(s.stockUuid) ?? null : null));
  const compFitted = compSlots.map((s, i) => {
    const id = params.get(`${prefix}k${i}`);
    const c = id ? componentsByUuid.get(id) : undefined;
    return c && componentFitsSlot(c, s) ? c : compStock[i] ?? null;
  });
  const racks = ship.missileRacks ?? [];
  const misStock = racks.map((r) => (r.stockMissileUuid ? missilesByUuid.get(r.stockMissileUuid) ?? null : null));
  const misFitted = racks.map((r, i) => {
    const id = params.get(`${prefix}m${i}`);
    const m = id ? missilesByUuid.get(id) : undefined;
    return m && missileFitsRack(m, r) ? m : misStock[i] ?? null;
  });
  const rackDamage = (list: (MissileItem | null)[]) => list.reduce((t, m, i) => t + (m ? m.damage * racks[i]!.count : 0), 0);
  const set = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next, { replace: true });
  };
  const put = (n: URLSearchParams, key: string, id: string, stockId: string | undefined) => { if (id === stockId) n.delete(key); else n.set(key, id); };
  return {
    ship, slots, stock, equipped,
    guns: equipped.filter((g): g is CombatGun => !!g),
    stockGuns: stock.filter((g): g is CombatGun => !!g),
    compSlots, compStock, compFitted,
    systems: componentTotals(compFitted, ship.qtFuelCapacity),
    stockSystems: componentTotals(compStock, ship.qtFuelCapacity),
    racks, misStock, misFitted,
    missileDamage: rackDamage(misFitted),
    stockMissileDamage: rackDamage(misStock),
    missileCount: racks.reduce((t, r, i) => t + (misFitted[i] ? r.count : 0), 0),
    changes: equipped.filter((g, i) => g?.uuid !== stock[i]?.uuid).length
      + compFitted.filter((c, i) => c?.uuid !== compStock[i]?.uuid).length
      + misFitted.filter((m, i) => m?.uuid !== misStock[i]?.uuid).length,
    pick: (slot, g) => set((n) => put(n, `${prefix}${slot}`, g.uuid, stock[slot]?.uuid)),
    pickComponent: (slot, c) => set((n) => put(n, `${prefix}k${slot}`, c.uuid, compStock[slot]?.uuid)),
    pickMissiles: (list, m) => set((n) => list.forEach((i) => { if (missileFitsRack(m, racks[i]!)) put(n, `${prefix}m${i}`, m.uuid, misStock[i]?.uuid); })),
    reset: () => set((n) => { for (const k of [...n.keys()]) if (new RegExp(`^${prefix}[km]?\\d+$`).test(k)) n.delete(k); }),
  };
}

/** What a click on a card opens. */
export type SwapTarget = { kind: 'gun'; slot: number } | { kind: 'comp'; slot: number } | { kind: 'missile'; racks: number[] };

const sameTarget = (a: SwapTarget | null | undefined, b: SwapTarget) => !!a && JSON.stringify(a) === JSON.stringify(b);

// ── Summary bar ──────────────────────────────────────────────────────────────

export function summaryOf(lo: LoadoutState) {
  const sum = (list: CombatGun[], k: 'alpha' | 'burstDps' | 'sustainedDps') => list.reduce((t, g) => t + g[k], 0);
  const sys = lo.systems, was = lo.stockSystems;
  const shields = sys.activeShields > 0;
  const d = (now: number | null, before: number | null, low = false) => {
    if (!lo.changes || now == null || before == null) return null;
    const text = pctChange(now, before);
    return text ? { text, good: text.startsWith('+') !== low } : null;
  };
  return [
    { label: 'alpha', value: fmt(sum(lo.guns, 'alpha')), delta: d(sum(lo.guns, 'alpha'), sum(lo.stockGuns, 'alpha')), acc: false },
    { label: 'sustained', value: fmt(sum(lo.guns, 'sustainedDps')), delta: d(sum(lo.guns, 'sustainedDps'), sum(lo.stockGuns, 'sustainedDps')), acc: true },
    { label: 'burst', value: fmt(sum(lo.guns, 'burstDps')), delta: d(sum(lo.guns, 'burstDps'), sum(lo.stockGuns, 'burstDps')), acc: false },
    { label: 'missiles', value: lo.racks.length ? fmt(lo.missileDamage) : '–', delta: d(lo.missileDamage, lo.stockMissileDamage), acc: false },
    { label: 'shield HP', value: fmt(shields ? sys.shieldHp : lo.ship.shieldHp), delta: shields ? d(sys.shieldHp, was.shieldHp) : null, acc: false },
    { label: 'regen /s', value: fmt(shields ? sys.shieldRegen : lo.ship.shieldRegen), delta: shields ? d(sys.shieldRegen, was.shieldRegen) : null, acc: false },
    { label: 'quantum range', value: sys.qtRangeGm != null ? `${fmt(sys.qtRangeGm, 1)} Gm` : '–', delta: d(sys.qtRangeGm, was.qtRangeGm), acc: false },
  ];
}

export function SummaryBar({ lo }: { lo: LoadoutState }) {
  return (
    <div aria-label="Summary" className="gt-sum flex flex-wrap items-baseline gap-x-8 gap-y-2 px-5 sm:px-10 py-3">
      {summaryOf(lo).map((s) => (
        <span key={s.label} className="flex items-baseline gap-2">
          <span className={`gt-mono text-xl font-semibold ${s.acc ? 'gt-acc' : 'gt-hi'}`}>{s.value}</span>
          <span className="gt-label">{s.label}</span>
          {s.delta && <span className={`gt-mono text-xs ${s.delta.good ? 'gt-good' : 'gt-bad'}`}>{s.delta.text}</span>}
        </span>
      ))}
    </div>
  );
}

/** The same numbers as a block, for each side when comparing. */
export function SummaryGrid({ lo }: { lo: LoadoutState }) {
  return (
    <div className="grid gap-x-4 gap-y-3 py-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', borderTop: '1px solid var(--gt-line)', borderBottom: '1px solid var(--gt-line)' }}>
      {summaryOf(lo).map((s) => (
        <span key={s.label} className="flex flex-col">
          <span className={`gt-mono text-lg font-semibold ${s.acc ? 'gt-acc' : 'gt-hi'}`}>{s.value}</span>
          <span className="text-xs gt-dim">{s.label}{s.delta && <span className={`gt-mono ml-1.5 ${s.delta.good ? 'gt-good' : 'gt-bad'}`}>{s.delta.text}</span>}</span>
        </span>
      ))}
    </div>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────────

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 pb-2" style={{ borderBottom: '1px solid var(--gt-line)' }}>
        <h2 className="gt-label gt-label-acc m-0">{title}</h2>
        {aside && <span className="text-sm gt-dim">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return <span>{k} <b className="gt-mono font-medium gt-hi">{v}</b>{unit ? ` ${unit}` : ''}</span>;
}

function mountLabel(s: GunSlot): { name: string; sub: string } {
  if (!s.mount) return { name: 'Fixed hardpoint', sub: 'No mount' };
  return { name: s.mount.replace(/ Mount$/, ''), sub: /gimbal/i.test(s.mount) ? 'Gimbal mount' : 'Mount' };
}

const kindWord = (g: CombatGun) => `${g.kind}${g.pellets > 1 ? ` ×${g.pellets}` : ''}`;

export function LoadoutCards({ lo, onOpen, active, narrow = false }: { lo: LoadoutState; onOpen: (t: SwapTarget) => void; active?: SwapTarget | null; narrow?: boolean }) {
  // Racks with the same rack and missiles show as one card ("2 racks").
  const rackGroups: { racks: number[]; rack: MissileRack; missile: MissileItem | null }[] = [];
  lo.racks.forEach((r, i) => {
    const m = lo.misFitted[i] ?? null;
    const g = rackGroups.find((x) => x.rack.name === r.name && x.rack.missileSize === r.missileSize && x.rack.count === r.count && x.missile?.uuid === m?.uuid);
    if (g) g.racks.push(i); else rackGroups.push({ racks: [i], rack: r, missile: m });
  });
  const row = narrow ? 'grid gap-2' : 'grid gap-2.5 grid-cols-1 sm:grid-cols-[minmax(150px,210px)_minmax(0,1fr)]';
  const cardCols = narrow ? '' : 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] md:items-center';

  return (
    <div className="flex flex-col gap-8">
      <Section title={`Armament · ${lo.slots.length} pilot gun${lo.slots.length === 1 ? '' : 's'}`} aside={lo.slots.length ? 'Click a gun to swap it' : undefined}>
        {lo.slots.map((s, i) => {
          const g = lo.equipped[i];
          const changed = g?.uuid !== lo.stock[i]?.uuid;
          const m = mountLabel(s);
          return (
            <div key={s.id} className={row}>
              {!narrow && (
                <div className="gt-box flex flex-col justify-center gap-0.5 px-3 py-2.5">
                  <span className="text-xs gt-dim">{s.label}</span>
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-xs gt-dim">{m.sub} · size {s.maxSize}</span>
                </div>
              )}
              <button type="button" className={`gt-card ${cardCols}`} data-changed={changed || sameTarget(active, { kind: 'gun', slot: i })} onClick={() => onOpen({ kind: 'gun', slot: i })}>
                <span className="flex items-center gap-3 min-w-0">
                  <span className="gt-tag">S{g?.size ?? s.maxSize}</span>
                  <span className="flex flex-col min-w-0">
                    {narrow && <span className="text-xs gt-dim">{s.label} · {m.sub.toLowerCase()}</span>}
                    <span className={`font-semibold text-base truncate ${changed ? 'gt-acc' : 'gt-hi'}`}>{g?.name ?? 'Empty'}</span>
                    <span className="text-xs gt-dim truncate">{g ? `${g.maker ?? ''} · ${kindWord(g)} ${(g.family ?? '').toLowerCase()}` : 'Nothing fitted'}</span>
                  </span>
                </span>
                {g && (
                  <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] gt-dim">
                    <Stat k="alpha" v={fmt(g.alpha)} />
                    <Stat k="rate" v={fmt(g.fireRate)} />
                    <Stat k={g.ammo ? 'ammo' : 'cap.'} v={fmt(g.ammo ?? g.capacitor)} />
                    <Stat k="pen" v={fmt(g.pen, 2)} />
                    <Stat k="speed" v={fmt(g.speed)} unit="m/s" />
                    <Stat k="range" v={fmt(g.range)} unit="m" />
                  </span>
                )}
                {g && (
                  <span className="flex flex-col md:items-end">
                    <span className="gt-mono text-xl font-semibold gt-hi">{fmt(g.sustainedDps)}</span>
                    <span className="text-xs gt-dim">sustained · burst {fmt(g.burstDps)}</span>
                  </span>
                )}
              </button>
            </div>
          );
        })}
        {!lo.slots.length && <p className="gt-dim text-sm m-0">This ship has no pilot guns.</p>}
        {lo.ship.gunSlots.some((s) => s.turret) && <p className="text-xs gt-dim m-0">Turret guns (for crew) aren&rsquo;t counted.</p>}
      </Section>

      {rackGroups.length > 0 && (
        <Section title={`Ordnance · ${lo.missileCount} missile${lo.missileCount === 1 ? '' : 's'} · ${fmt(lo.missileDamage)} damage`} aside="Click to change the missiles">
          {rackGroups.map((grp) => {
            const m = grp.missile;
            const count = grp.racks.reduce((t, i) => t + lo.racks[i]!.count, 0);
            const changed = grp.racks.some((i) => lo.misFitted[i]?.uuid !== lo.misStock[i]?.uuid);
            return (
              <div key={grp.racks.join('-')} className={row}>
                {!narrow && (
                  <div className="gt-box flex flex-col justify-center gap-0.5 px-3 py-2.5">
                    <span className="text-xs gt-dim">{grp.racks.length > 1 ? `${grp.racks.length} racks` : 'Rack'} · size {grp.rack.size}</span>
                    <span className="font-semibold">{grp.rack.name}</span>
                    <span className="text-xs gt-dim">holds {grp.rack.count} × size {grp.rack.missileSize}</span>
                  </div>
                )}
                <button type="button" className={`gt-card ${cardCols}`} data-changed={changed || sameTarget(active, { kind: 'missile', racks: grp.racks })} onClick={() => onOpen({ kind: 'missile', racks: grp.racks })}>
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="gt-tag">S{grp.rack.missileSize}</span>
                    <span className="flex flex-col min-w-0">
                      <span className={`font-semibold text-base truncate ${changed ? 'gt-acc' : 'gt-hi'}`}>{count} × {m?.name ?? 'Empty'}</span>
                      <span className="text-xs gt-dim truncate">{m?.maker ?? ''}{narrow ? ` · ${grp.rack.name}` : ''}</span>
                    </span>
                  </span>
                  {m && (
                    <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] gt-dim">
                      <span>seeker <b className="font-semibold gt-hi">{m.seeker}</b></span>
                      <Stat k="lock" v={fmt(m.lockTime, 1)} unit={`s · ${fmt(m.lockAngle)}°`} />
                      <Stat k="speed" v={fmt(m.speed)} unit="m/s" />
                      <Stat k="range" v={`${fmt(m.lockRangeMin)}–${fmt(m.lockRangeMax)}`} unit="m" />
                    </span>
                  )}
                  {m && (
                    <span className="flex flex-col md:items-end">
                      <span className="gt-mono text-xl font-semibold gt-hi">{fmt(m.damage * count)}</span>
                      <span className="text-xs gt-dim">total · {fmt(m.damage)} each</span>
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </Section>
      )}

      {lo.compSlots.length > 0 && (
        <Section title="Components" aside="Base stats (quality 500) · click one to swap it">
          <div className={`grid gap-2.5 ${narrow ? '' : 'sm:grid-cols-2'}`}>
            {COMPONENT_KINDS.flatMap(({ kind, label }) => {
              const idx = lo.compSlots.map((s, i) => (s.kind === kind ? i : -1)).filter((i) => i >= 0);
              return idx.map((i, n) => {
                const s = lo.compSlots[i]!;
                const c = lo.compFitted[i];
                const changed = c?.uuid !== lo.compStock[i]?.uuid;
                const spare = kind === 'shield' && c && lo.systems.spareShields > 0 && !isActiveShield(lo, i);
                const head = c ? componentHeadline(c, lo.ship) : null;
                return (
                  <button key={s.id} type="button" className="gt-card" data-changed={changed || sameTarget(active, { kind: 'comp', slot: i })} onClick={() => onOpen({ kind: 'comp', slot: i })}>
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="gt-tag">S{s.maxSize}</span>
                      <span className="flex flex-col flex-1 min-w-0">
                        <span className="text-xs gt-dim truncate">{label}{idx.length > 1 ? ` ${n + 1}` : ''}{c ? ` · ${[c.cls, c.grade].filter(Boolean).join(' ')}` : ''}{s.locked ? ' · fixed' : ''}{spare ? ' · spare' : ''}</span>
                        <span className={`font-semibold text-base truncate ${changed ? 'gt-acc' : 'gt-hi'}`}>{c?.name ?? 'Empty'}</span>
                      </span>
                      {head && (
                        <span className="flex flex-col items-end">
                          <span className="gt-mono text-lg font-semibold gt-hi whitespace-nowrap">{head.big}</span>
                          <span className="text-xs gt-dim whitespace-nowrap">{head.label}</span>
                        </span>
                      )}
                    </span>
                    {head?.line && <span className="text-[13px] gt-dim">{head.line}</span>}
                  </button>
                );
              });
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Whether slot `i`'s shield is one of the two that are up (the strongest; ties go to the earlier slot). */
function isActiveShield(lo: LoadoutState, i: number): boolean {
  const ranked = lo.compSlots.map((s, j) => ({ j, hp: s.kind === 'shield' ? lo.compFitted[j]?.shieldHp ?? -1 : -1 }))
    .filter((x) => x.hp >= 0).sort((a, b) => b.hp - a.hp || a.j - b.j);
  return ranked.slice(0, lo.systems.activeShields).some((x) => x.j === i);
}

function componentHeadline(c: ShipComponent, ship: GameToolsShip): { big: string; label: string; line: string } {
  const sig = [c.em ? `EM ${fmt(c.em)}` : null, c.ir ? `IR ${fmt(c.ir)}` : null, c.powerDraw ? `power ${fmt(c.powerDraw, 1)}` : null].filter(Boolean).join(' · ');
  switch (c.kind) {
    case 'shield': return { big: fmt(c.shieldHp), label: 'shield HP', line: `Regen ${fmt(c.shieldRegen)}/s · restarts ${fmt(c.damagedDelay, 1)} s after a hit, ${fmt(c.downedDelay, 1)} s after a drop` };
    case 'power': return { big: fmt(c.powerOut), label: 'power segments', line: [c.em ? `EM ${fmt(c.em)} at full power` : null, c.health ? `HP ${fmt(c.health)}` : null].filter(Boolean).join(' · ') };
    case 'cooler': return { big: `${fmt(c.coolOut)}/s`, label: 'cooling', line: sig };
    case 'quantum': {
      const range = c.qtFuelPerGm && ship.qtFuelCapacity ? ship.qtFuelCapacity / c.qtFuelPerGm : null;
      return { big: fmt(c.qtSpeed != null ? c.qtSpeed / 1000 : null), label: 'km/s', line: `Spool ${fmt(c.qtSpool, 1)} s · cooldown ${fmt(c.qtCooldown, 1)} s · ${fmt(c.qtFuelPerGm)} mSCU/Gm${range != null ? ` · ${fmt(range, 1)} Gm range` : ''}` };
    }
    case 'radar': return { big: `${fmt(c.aimAssist)} m`, label: 'aim assist', line: sig };
  }
}

// ── Panels ───────────────────────────────────────────────────────────────────

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
type Row = [string, string];

export function ShipPanels({ lo }: { lo: LoadoutState }) {
  const s = lo.ship;
  const f = s.flight;
  const sys = lo.systems;
  const qt = sys.quantum;
  const panels: { title: string; rows: Row[] }[] = [
    { title: 'Defense', rows: [
      ['Shield resistance', `phys ${pct(s.resistance.physical)} · energy ${pct(s.resistance.energy)}${s.distortion ? ` · dist ${pct(s.distortion.resistance)}` : ''}`],
      ['Shield absorption', `phys ${pct(s.absorption.physical)} · energy ${pct(s.absorption.energy)}`],
      ...(s.armourHp ? [['Armour HP', fmt(s.armourHp)] as Row] : []),
      ['Armour damage taken', `phys ×${fmt(s.armourMult.physical, 2)} · energy ×${fmt(s.armourMult.energy, 2)}`],
      ['Deflects shots up to', `phys ${fmt(s.deflection.physical)} · energy ${fmt(s.deflection.energy)}`],
      ...(s.countermeasures ? [['Countermeasures', `decoy ${fmt(s.countermeasures.decoy)} · noise ${fmt(s.countermeasures.noise)}`] as Row] : []),
    ] },
    ...(f ? [{ title: 'Flight', rows: [
      ['SCM → boosted', `${fmt(f.scm)} → ${fmt(f.boostForward)} m/s`],
      ['Boosted backwards', `${fmt(f.boostBackward)} m/s`],
      ['Top speed', `${fmt(f.max)} m/s`],
      ['Pitch · yaw · roll', `${fmt(f.pitch)} · ${fmt(f.yaw)} · ${fmt(f.roll)} °/s`],
      ['0 → SCM · 0 → top', `${fmt(f.zeroToScm, 1)} s · ${fmt(f.zeroToMax, 1)} s`],
      ['Hydrogen fuel', `${fmt(f.hydrogen, 1)} SCU`],
    ] as Row[] }] : []),
    { title: 'Hull', rows: [
      ['Main body (the kill point)', fmt(s.hullHp)],
      ...(s.hull ? [['Whole hull', `${fmt(s.hull.total)} · ${s.hull.parts} parts`] as Row] : []),
      ...(s.cargo != null ? [['Cargo', `${fmt(s.cargo)} SCU`] as Row] : []),
      ...(s.insuranceClaimMin != null ? [['Insurance claim', `${fmt(s.insuranceClaimMin, 1)} min`] as Row] : []),
    ] },
    ...(qt ? [{ title: 'Quantum', rows: [
      ['Speed', `${fmt(qt.qtSpeed != null ? qt.qtSpeed / 1000 : null)} km/s`],
      ['Spool · cooldown', `${fmt(qt.qtSpool, 1)} s · ${fmt(qt.qtCooldown, 1)} s`],
      ['Fuel', `${fmt(s.qtFuelCapacity != null ? s.qtFuelCapacity / 1000 : null, 1)} SCU · ${fmt(qt.qtFuelPerGm)} mSCU/Gm`],
      ['Range', sys.qtRangeGm != null ? `${fmt(sys.qtRangeGm, 1)} Gm` : '–'],
    ] as Row[] }] : []),
  ];
  return (
    <div className="flex flex-col gap-7">
      {panels.map((p) => (
        <section key={p.title} className="flex flex-col">
          <h2 className="gt-label gt-label-acc m-0 pb-2" style={{ borderBottom: '1px solid var(--gt-line)' }}>{p.title}</h2>
          {p.rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 gt-row">
              <span className="text-sm">{k}</span>
              <span className="gt-mono gt-hi text-right text-[13px] whitespace-nowrap ml-auto">{v}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ── Swap windows ─────────────────────────────────────────────────────────────

export function Swap({ lo, target, guns, components, missiles, onClose }: {
  lo: LoadoutState; target: SwapTarget; guns: CombatGun[]; components: ShipComponent[]; missiles: MissileItem[]; onClose: () => void;
}) {
  const shipName = lo.ship.name;
  if (target.kind === 'gun') {
    const slot = lo.slots[target.slot];
    if (!slot) return null;
    const cols: SwapColumn<CombatGun>[] = [
      { key: 'name', label: 'Gun', get: (g) => g.name, text: true },
      { key: 'kind', label: 'Damage', get: (g) => g.kind, text: true, render: (g) => <span className={`gt-kind-${g.kind.toLowerCase()}`}>{kindWord(g)}</span> },
      { key: 'alpha', label: 'Alpha', get: (g) => g.alpha },
      { key: 'burst', label: 'Burst', get: (g) => g.burstDps },
      { key: 'sus', label: 'Sustained', get: (g) => g.sustainedDps },
      { key: 'pen', label: 'Pen', get: (g) => g.pen, digits: 2 },
      { key: 'rpm', label: 'RPM', get: (g) => g.fireRate },
      { key: 'range', label: 'Range', get: (g) => g.range },
      { key: 'speed', label: 'Speed', get: (g) => g.speed },
      { key: 'spread', label: 'Spread', get: (g) => g.spread, digits: 2, low: true },
      { key: 'power', label: 'Power', get: (g) => g.powerDraw, digits: 1, low: true },
      { key: 'em', label: 'EM', get: (g) => g.em, low: true },
      { key: 'ammo', label: 'Ammo', get: (g) => g.ammo ?? g.capacitor, render: (g) => (g.ammo ? fmt(g.ammo) : g.capacitor ? <span className="gt-dim">{fmt(g.capacitor)} cap.</span> : '–') },
      { key: 'hp', label: 'HP', get: (g) => g.hp },
    ];
    const fits = guns.filter((g) => gunFitsSlot(g, slot));
    return (
      <SwapWindow eyebrow={`${shipName} · ${slot.label} · size ${slot.minSize === slot.maxSize ? slot.maxSize : `${slot.minSize}–${slot.maxSize}`}`} title="Swap gun"
        items={fits} columns={cols} defaultSort="burst"
        filters={[{ label: 'Damage', get: (g) => g.kind }, { label: 'Type', get: (g) => g.family }]}
        searchText={(g) => `${g.name} ${g.maker ?? ''} ${g.family ?? ''} ${g.kind}`}
        idOf={(g) => g.uuid} nameOf={(g) => g.name} subOf={(g) => `${g.maker ?? ''}${g.variants ? ` · +${g.variants} skins` : ''}`}
        fittedId={lo.equipped[target.slot]?.uuid ?? null} stockId={lo.stock[target.slot]?.uuid ?? null}
        onPick={(g) => { lo.pick(target.slot, g); onClose(); }}
        onStock={() => { const st = lo.stock[target.slot]; if (st) lo.pick(target.slot, st); onClose(); }}
        onClose={onClose}
        note="ammo is the magazine; energy guns show their capacitor" />
    );
  }

  if (target.kind === 'comp') {
    const slot = lo.compSlots[target.slot];
    if (!slot) return null;
    const label = COMPONENT_KINDS.find((k) => k.kind === slot.kind)!.label;
    const range = (c: ShipComponent) => (c.qtFuelPerGm && lo.ship.qtFuelCapacity ? lo.ship.qtFuelCapacity / c.qtFuelPerGm : null);
    const base: SwapColumn<ShipComponent>[] = [
      { key: 'name', label, get: (c) => c.name, text: true },
      { key: 'cls', label: 'Class', get: (c) => [c.cls, c.grade].filter(Boolean).join(' ') || null, text: true },
    ];
    const tail: SwapColumn<ShipComponent>[] = [
      { key: 'pwr', label: 'Power', get: (c) => c.powerDraw, digits: 1, low: true },
      { key: 'em', label: 'EM', get: (c) => c.em, low: true },
      { key: 'ir', label: 'IR', get: (c) => c.ir, low: true },
      { key: 'hp', label: 'HP', get: (c) => c.health },
    ];
    const byKind: Record<ShipComponent['kind'], SwapColumn<ShipComponent>[]> = {
      shield: [
        { key: 'shp', label: 'Shield HP', get: (c) => c.shieldHp },
        { key: 'regen', label: 'Regen /s', get: (c) => c.shieldRegen },
        { key: 'dmg', label: 'After hit s', get: (c) => c.damagedDelay, digits: 1, low: true },
        { key: 'down', label: 'After drop s', get: (c) => c.downedDelay, digits: 1, low: true },
      ],
      power: [{ key: 'out', label: 'Power seg.', get: (c) => c.powerOut }],
      cooler: [{ key: 'out', label: 'Cooling /s', get: (c) => c.coolOut }],
      quantum: [
        { key: 'speed', label: 'km/s', get: (c) => (c.qtSpeed != null ? c.qtSpeed / 1000 : null) },
        { key: 'spool', label: 'Spool s', get: (c) => c.qtSpool, digits: 1, low: true },
        { key: 'cool', label: 'Cooldown s', get: (c) => c.qtCooldown, digits: 1, low: true },
        { key: 'fuel', label: 'mSCU/Gm', get: (c) => c.qtFuelPerGm, low: true },
        { key: 'range', label: 'Range Gm', get: range, digits: 1 },
      ],
      radar: [{ key: 'aim', label: 'Aim assist m', get: (c) => c.aimAssist }],
    };
    const cols = [...base, ...byKind[slot.kind], ...tail];
    const fits = components.filter((c) => componentFitsSlot(c, slot));
    return (
      <SwapWindow eyebrow={`${shipName} · ${label} · size ${slot.maxSize}`} title={`Swap ${label.toLowerCase()}`}
        items={fits} columns={cols} defaultSort={byKind[slot.kind][0]!.key}
        filters={[{ label: 'Class', get: (c) => c.cls }, { label: 'Grade', get: (c) => c.grade }]}
        searchText={(c) => `${c.name} ${c.maker ?? ''} ${c.cls ?? ''} ${c.grade ?? ''}`}
        idOf={(c) => c.uuid} nameOf={(c) => c.name} subOf={(c) => `${c.maker ?? ''}${c.variants ? ` · +${c.variants} copies` : ''}`}
        fittedId={lo.compFitted[target.slot]?.uuid ?? null} stockId={lo.compStock[target.slot]?.uuid ?? null}
        onPick={(c) => { lo.pickComponent(target.slot, c); onClose(); }}
        onStock={() => { const st = lo.compStock[target.slot]; if (st) lo.pickComponent(target.slot, st); onClose(); }}
        onClose={onClose}
        locked={slot.locked ? 'fixed by the maker: it can’t be swapped' : undefined}
        note={slot.kind === 'shield' ? 'only the two strongest shields are up at once' : slot.kind === 'power' ? 'output depends on your power settings' : 'base stats, the same as a crafted part at quality 500'} />
    );
  }

  const racks = target.racks.map((i) => lo.racks[i]).filter((r): r is MissileRack => !!r);
  const first = racks[0];
  if (!first) return null;
  const count = racks.reduce((t, r) => t + r.count, 0);
  const cols: SwapColumn<MissileItem>[] = [
    { key: 'name', label: 'Missile', get: (m) => m.name, text: true },
    { key: 'seeker', label: 'Seeker', get: (m) => m.seeker, text: true },
    { key: 'dmg', label: 'Damage', get: (m) => m.damage },
    { key: 'total', label: `× ${count}`, get: (m) => m.damage * count },
    { key: 'lock', label: 'Lock s', get: (m) => m.lockTime, digits: 1, low: true },
    { key: 'cone', label: 'Cone °', get: (m) => m.lockAngle },
    { key: 'min', label: 'Min range', get: (m) => m.lockRangeMin, low: true },
    { key: 'max', label: 'Max range', get: (m) => m.lockRangeMax },
    { key: 'speed', label: 'Speed', get: (m) => m.speed },
    { key: 'arm', label: 'Arm s', get: (m) => m.armTime, digits: 1, low: true },
  ];
  const fits = missiles.filter((m) => racks.every((r) => missileFitsRack(m, r)));
  const firstIdx = target.racks[0]!;
  return (
    <SwapWindow eyebrow={`${shipName} · ${racks.length > 1 ? `${racks.length} × ` : ''}${first.name} · ${count} × size ${first.missileSize}`} title="Swap missiles"
      items={fits} columns={cols} defaultSort="dmg"
      filters={[{ label: 'Seeker', get: (m) => m.seeker }, { label: 'Damage', get: (m) => m.damageType }]}
      searchText={(m) => `${m.name} ${m.maker ?? ''} ${m.seeker} ${m.damageType}`}
      idOf={(m) => m.uuid} nameOf={(m) => m.name} subOf={(m) => `${m.maker ?? ''} · ${m.damageType.toLowerCase()}${m.cluster ? ' · cluster' : ''}`}
      fittedId={lo.misFitted[firstIdx]?.uuid ?? null} stockId={lo.misStock[firstIdx]?.uuid ?? null}
      onPick={(m) => { lo.pickMissiles(target.racks, m); onClose(); }}
      onStock={() => { const st = lo.misStock[firstIdx]; if (st) lo.pickMissiles(target.racks, st); onClose(); }}
      onClose={onClose}
      note={racks.length > 1 ? `fills all ${racks.length} racks` : undefined} />
  );
}
