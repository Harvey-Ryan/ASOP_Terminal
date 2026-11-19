// A ship's loadout (v1.45.0; Erkul-style page since v1.47.0): pilot guns,
// missiles and components as cards grouped by system, a summary bar that
// stays on screen, the ship's panels, and a swap window for every slot.
// The loadout lives in the address so a link shares it: ?s0=<gun>…,
// ?sk0=<component>…, ?sm0=<missile>… for the ship, c0/ck0/cm0 for the one it's
// compared with. Mining ships (v1.50.0): each mining head's laser and
// modules, ?sl0=<laser>, ?sd0_1=<module> (cl0/cd0_1 when compared).
// Salvage and refuelling (v1.51.0): scraper modules ?sv0_1=, fuel pods ?sf0=.

import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  gunFitsSlot, componentFitsSlot, componentTotals, missileFitsRack, laserFitsHead, miningHeadTotals, salvageModuleFitsSlot, fuelPodFitsSlot, COMPONENT_KINDS,
  type CombatGun, type GameToolsShip, type GunSlot, type ShipComponent, type ComponentSlot, type ComponentTotals,
  type MissileItem, type MissileRack, type MiningHead, type MiningHeadTotals, type MiningLaser, type MiningModule,
  type SalvageHeadMount, type SalvageModule, type FuelPod, type FuelPodSlot,
} from '@dem/shared';
import { fmt, pctChange, pilotSlots } from '../../lib/gameTools';
import { SwapWindow, type SwapColumn } from './SwapWindow';
import { MOD_COLUMNS, ModCell, modIsGood, modLabel, pctText } from './miningBits';

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
  heads: MiningHead[];
  headStock: (MiningLaser | null)[];
  headLaser: (MiningLaser | null)[];
  /** Per head, one entry per module slot of the fitted laser. */
  headModules: (MiningModule | null)[][];
  headTotals: MiningHeadTotals[];
  stockHeadTotals: MiningHeadTotals[];
  salvage: SalvageHeadMount[];
  salvStock: (SalvageModule | null)[][];
  salvFitted: (SalvageModule | null)[][];
  podSlots: FuelPodSlot[];
  podStock: (FuelPod | null)[];
  podFitted: (FuelPod | null)[];
  podCapacity: number;
  stockPodCapacity: number;
  changes: number;
  pick: (slot: number, g: CombatGun) => void;
  pickComponent: (slot: number, c: ShipComponent) => void;
  /** Loads the same missile into every rack listed. */
  pickMissiles: (racks: number[], m: MissileItem) => void;
  pickLaser: (head: number, l: MiningLaser) => void;
  pickModule: (head: number, slot: number, m: MiningModule | null) => void;
  pickSalvage: (head: number, slot: number, m: SalvageModule) => void;
  pickPod: (slot: number, p: FuelPod) => void;
  reset: () => void;
}

export function useLoadout(ship: GameToolsShip | null, prefix: string, gunsByUuid: Map<string, CombatGun>, componentsByUuid: Map<string, ShipComponent>, missilesByUuid: Map<string, MissileItem>,
  lasersByUuid: Map<string, MiningLaser> = new Map(), modulesByUuid: Map<string, MiningModule> = new Map(),
  salvageByUuid: Map<string, SalvageModule> = new Map(), podsByUuid: Map<string, FuelPod> = new Map()): LoadoutState | null {
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
  const heads = ship.miningHeads ?? [];
  const headStock = heads.map((h) => (h.stockLaserUuid ? lasersByUuid.get(h.stockLaserUuid) ?? null : null));
  const headLaser = heads.map((h, i) => {
    const id = params.get(`${prefix}l${i}`);
    const l = id ? lasersByUuid.get(id) : undefined;
    return l && laserFitsHead(l, h) ? l : headStock[i] ?? null;
  });
  // No ship comes with modules fitted, so an empty slot is stock.
  const headModules = headLaser.map((l, i) => Array.from({ length: l?.moduleSlots ?? 0 }, (_, j) => modulesByUuid.get(params.get(`${prefix}d${i}_${j}`) ?? '') ?? null));
  const salvage = ship.salvageHeads ?? [];
  const salvStock = salvage.map((h) => h.slots.map((sl) => (sl.stockUuid ? salvageByUuid.get(sl.stockUuid) ?? null : null)));
  const salvFitted = salvage.map((h, i) => h.slots.map((sl, j) => {
    const m = salvageByUuid.get(params.get(`${prefix}v${i}_${j}`) ?? '');
    return m && salvageModuleFitsSlot(m, sl) ? m : salvStock[i]![j] ?? null;
  }));
  const podSlots = ship.fuelPodSlots ?? [];
  const podStock = podSlots.map((sl) => (sl.stockUuid ? podsByUuid.get(sl.stockUuid) ?? null : null));
  const podFitted = podSlots.map((sl, i) => {
    const p = podsByUuid.get(params.get(`${prefix}f${i}`) ?? '');
    return p && fuelPodFitsSlot(p, sl) ? p : podStock[i] ?? null;
  });
  const podTotal = (list: (FuelPod | null)[]) => list.reduce((t, p) => t + (p?.capacity ?? 0), 0);
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
    heads, headStock, headLaser, headModules,
    headTotals: headLaser.map((l, i) => miningHeadTotals(l, headModules[i]!)),
    stockHeadTotals: headStock.map((l) => miningHeadTotals(l, [])),
    salvage, salvStock, salvFitted, podSlots, podStock, podFitted,
    podCapacity: podTotal(podFitted), stockPodCapacity: podTotal(podStock),
    changes: equipped.filter((g, i) => g?.uuid !== stock[i]?.uuid).length
      + compFitted.filter((c, i) => c?.uuid !== compStock[i]?.uuid).length
      + misFitted.filter((m, i) => m?.uuid !== misStock[i]?.uuid).length
      + headLaser.filter((l, i) => l?.uuid !== headStock[i]?.uuid).length
      + headModules.flat().filter(Boolean).length
      + salvFitted.flat().filter((m, k) => m?.uuid !== salvStock.flat()[k]?.uuid).length
      + podFitted.filter((p, i) => p?.uuid !== podStock[i]?.uuid).length,
    pick: (slot, g) => set((n) => put(n, `${prefix}${slot}`, g.uuid, stock[slot]?.uuid)),
    pickComponent: (slot, c) => set((n) => put(n, `${prefix}k${slot}`, c.uuid, compStock[slot]?.uuid)),
    pickMissiles: (list, m) => set((n) => list.forEach((i) => { if (missileFitsRack(m, racks[i]!)) put(n, `${prefix}m${i}`, m.uuid, misStock[i]?.uuid); })),
    pickLaser: (head, l) => set((n) => {
      put(n, `${prefix}l${head}`, l.uuid, headStock[head]?.uuid);
      // Modules past the new laser's slots fall off.
      for (const k of [...n.keys()]) { const m = new RegExp(`^${prefix}d${head}_(\\d+)$`).exec(k); if (m && Number(m[1]) >= l.moduleSlots) n.delete(k); }
    }),
    pickModule: (head, slot, m) => set((n) => { if (m) n.set(`${prefix}d${head}_${slot}`, m.uuid); else n.delete(`${prefix}d${head}_${slot}`); }),
    pickSalvage: (head, slot, m) => set((n) => put(n, `${prefix}v${head}_${slot}`, m.uuid, salvStock[head]?.[slot]?.uuid)),
    pickPod: (slot, p) => set((n) => put(n, `${prefix}f${slot}`, p.uuid, podStock[slot]?.uuid)),
    reset: () => set((n) => { for (const k of [...n.keys()]) if (new RegExp(`^${prefix}(?:[kmlf]?\\d+|[dv]\\d+_\\d+)$`).test(k)) n.delete(k); }),
  };
}

/** What a click on a card opens. */
export type SwapTarget = { kind: 'gun'; slot: number } | { kind: 'comp'; slot: number } | { kind: 'missile'; racks: number[] }
  | { kind: 'laser'; head: number } | { kind: 'module'; head: number; slot: number }
  | { kind: 'salvage'; head: number; slot: number } | { kind: 'pod'; slot: number };

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
  type Item = { label: string; value: string; delta: ReturnType<typeof d>; acc: boolean };
  const work: Item[] = [];
  if (lo.heads.length) {
    const total = (list: MiningHeadTotals[], k: 'power' | 'extraction') => list.reduce((t, h) => t + (h[k] ?? 0), 0);
    const slots = lo.headModules.reduce((t, m) => t + m.length, 0);
    const fitted = lo.headModules.reduce((t, m) => t + m.filter(Boolean).length, 0);
    work.push(
      { label: lo.heads.length === 1 ? 'mining head' : 'mining heads', value: String(lo.heads.length), delta: null, acc: false },
      { label: 'laser power', value: fmt(total(lo.headTotals, 'power')), delta: d(total(lo.headTotals, 'power'), total(lo.stockHeadTotals, 'power')), acc: true },
      { label: 'extraction', value: fmt(total(lo.headTotals, 'extraction')), delta: d(total(lo.headTotals, 'extraction'), total(lo.stockHeadTotals, 'extraction')), acc: false },
      { label: 'modules', value: `${fitted} / ${slots}`, delta: null, acc: false },
    );
  }
  if (lo.salvage.length) {
    const scrapers = lo.salvFitted.flat().filter((m) => m?.kind === 'scraper').length;
    work.push(
      { label: lo.salvage.length === 1 ? 'salvage head' : 'salvage heads', value: String(lo.salvage.length), delta: null, acc: !lo.heads.length },
      { label: scrapers === 1 ? 'scraper module' : 'scraper modules', value: String(scrapers), delta: null, acc: false },
    );
  }
  if (lo.podSlots.length) {
    work.push(
      { label: lo.podSlots.length === 1 ? 'fuel pod' : 'fuel pods', value: String(lo.podFitted.filter(Boolean).length), delta: null, acc: false },
      { label: 'pod capacity', value: `${fmt(lo.podCapacity)} SCU`, delta: d(lo.podCapacity, lo.stockPodCapacity), acc: true },
    );
  }
  if (work.length) {
    return [
      ...work,
      ...(lo.ship.cargo != null ? [{ label: 'cargo', value: `${fmt(lo.ship.cargo)} SCU`, delta: null, acc: false }] : []),
      { label: 'shield HP', value: fmt(shields ? sys.shieldHp : lo.ship.shieldHp), delta: shields ? d(sys.shieldHp, was.shieldHp) : null, acc: false },
      { label: 'quantum range', value: sys.qtRangeGm != null ? `${fmt(sys.qtRangeGm, 1)} Gm` : '–', delta: d(sys.qtRangeGm, was.qtRangeGm), acc: false },
    ];
  }
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
      {lo.heads.length > 0 && <MiningHeads lo={lo} onOpen={onOpen} active={active} narrow={narrow} />}
      {lo.salvage.length > 0 && <SalvageHeads lo={lo} onOpen={onOpen} active={active} narrow={narrow} />}
      {lo.podSlots.length > 0 && <FuelPods lo={lo} onOpen={onOpen} active={active} narrow={narrow} />}

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
        {!lo.slots.length && <p className="gt-dim text-sm m-0">{lo.heads.length || lo.salvage.length || lo.podSlots.length ? 'No pilot guns.' : 'This ship has no pilot guns.'}</p>}
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

// ── Mining heads (v1.50.0) ───────────────────────────────────────────────────

const modEffects = (m: MiningModule) => [
  m.power != null && m.power !== 1 ? `power ×${fmt(m.power, 2)}` : null,
  ...Object.entries(m.modifiers).map(([k, v]) => `${modLabel(k).toLowerCase()} ${pctText(v)}`),
].filter(Boolean).join(' · ');

const usesText = (m: MiningModule) => (m.kind === 'Active' && m.charges ? `${fmt(m.charges)} × ${fmt(m.lifetime)} s` : null);

function MiningHeads({ lo, onOpen, active, narrow }: { lo: LoadoutState; onOpen: (t: SwapTarget) => void; active?: SwapTarget | null; narrow: boolean }) {
  const crewed = lo.heads.filter((h) => h.crewed).length;
  const title = `Mining heads · ${lo.heads.length}${crewed ? ` crew turret${crewed === 1 ? '' : 's'}` : lo.heads.length === 1 ? ' laser' : ' lasers'}`;
  return (
    <>
      <Section title={title} aside="Click a laser or a module slot to swap it">
        {lo.heads.map((h, i) => {
          const l = lo.headLaser[i] ?? null;
          const changed = l?.uuid !== lo.headStock[i]?.uuid;
          const t = lo.headTotals[i]!;
          const mods = lo.headModules[i] ?? [];
          const totals: [string, string, string][] = [
            ['power', fmt(t.power), 'gt-hi'],
            ...['Resistance', 'Instability', 'OptimalChargeWindow', 'AllChargeRates', 'InertMaterials']
              .filter((k) => k !== 'InertMaterials' || t.modifiers[k] != null)
              .map((k): [string, string, string] => {
                const v = t.modifiers[k];
                return [modLabel(k).toLowerCase(), v != null ? pctText(v) : '0%', v == null ? 'gt-hi' : modIsGood(k, v) ? 'gt-good' : 'gt-bad'];
              }),
          ];
          return (
            <div key={h.id} className="flex flex-col gap-2 p-3 rounded-md" style={{ border: '1px solid var(--gt-line)' }}>
              <div className={narrow ? 'grid gap-2' : 'grid gap-2.5 grid-cols-1 sm:grid-cols-[minmax(150px,200px)_minmax(0,1fr)]'}>
                {!narrow && (
                  <div className="gt-box flex flex-col justify-center gap-0.5 px-3 py-2.5">
                    <span className="text-xs gt-dim">{h.label}</span>
                    <span className="font-semibold">{h.crewed ? 'Manned turret' : 'Pilot laser'}</span>
                    <span className="text-xs gt-dim">Size {h.size} laser · {l?.moduleSlots ?? 0} module slot{l?.moduleSlots === 1 ? '' : 's'}{h.locked ? ' · fixed' : ''}</span>
                  </div>
                )}
                <button type="button" className={`gt-card ${narrow ? '' : 'md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] md:items-center'}`}
                  data-changed={changed || sameTarget(active, { kind: 'laser', head: i })} onClick={() => onOpen({ kind: 'laser', head: i })}>
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="gt-tag">S{l?.size ?? h.size}</span>
                    <span className="flex flex-col min-w-0">
                      {narrow && <span className="text-xs gt-dim">{h.label}{h.locked ? ' · fixed' : ''}</span>}
                      <span className={`font-semibold text-base leading-tight ${changed ? 'gt-acc' : 'gt-hi'}`}>{l?.name ?? 'Empty'}</span>
                      <span className="text-xs gt-dim truncate">{l ? `${l.maker ?? ''}${changed ? '' : ' · stock'}` : 'Nothing fitted'}</span>
                    </span>
                  </span>
                  {l && (
                    <span className="flex flex-wrap gap-1.5">
                      {Object.entries(l.modifiers).map(([k, v]) => (
                        <span key={k} className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${modIsGood(k, v) ? 'gt-good' : 'gt-bad'}`} style={{ border: '1px solid var(--gt-line)' }}>{modLabel(k)} {pctText(v)}</span>
                      ))}
                      {!Object.keys(l.modifiers).length && <span className="text-[13px] gt-dim">No modifiers</span>}
                    </span>
                  )}
                  {l && (
                    <span className="flex flex-col md:items-end">
                      <span className="gt-mono text-xl font-semibold gt-hi">{fmt(l.power)}</span>
                      <span className="text-xs gt-dim whitespace-nowrap">power · min {fmt(l.minPower)}</span>
                      <span className="text-xs gt-dim whitespace-nowrap">extract {fmt(l.extraction)} · {fmt(l.optimalRange)}–{fmt(l.maxRange)} m</span>
                    </span>
                  )}
                </button>
              </div>
              {mods.length > 0 && (
                <div className={`grid gap-2 ${narrow ? '' : 'sm:grid-cols-2'}`}>
                  {mods.map((m, j) => {
                    const on = sameTarget(active, { kind: 'module', head: i, slot: j });
                    return (
                      <button key={j} type="button" className="gt-card" data-changed={!!m || on} style={m ? undefined : { borderStyle: 'dashed', background: 'transparent' }}
                        onClick={() => onOpen({ kind: 'module', head: i, slot: j })}>
                        <span className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-xs gt-dim">Module slot {j + 1}{m ? ` · ${m.kind.toLowerCase()}` : ''}</span>
                          <span className={`font-semibold ${m ? 'gt-acc' : 'gt-dim'}`}>{m?.name ?? '+ Add a module'}</span>
                          <span className="text-[13px] gt-dim">{m ? [modEffects(m), usesText(m) ? `${usesText(m)} uses` : null].filter(Boolean).join(' · ') : 'Empty'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 pt-1 text-[13px] gt-dim">
                <span className="gt-label gt-label-acc">This head</span>
                {totals.map(([k, v, cls]) => <span key={k}>{k} <b className={`gt-mono font-medium ${cls}`}>{v}</b></span>)}
              </div>
            </div>
          );
        })}
        <p className="text-xs gt-dim m-0">Active modules are counted as switched on. How laser and module bonuses combine (added or multiplied) is still to be checked against Regolith; here they are multiplied.</p>
      </Section>

      <Section title="What this loadout can break">
        <div className="flex flex-col gap-1.5 p-4 rounded-md" style={{ border: '1px dashed var(--gt-line)' }}>
          <span className="font-semibold gt-hi">Coming after a check against Regolith</span>
          <span className="text-sm gt-dim">Pick a rock (or type its scanner mass and resistance) and see whether {lo.heads.length === 1 ? 'this head' : `these ${lo.heads.length} heads`} can crack it, with how much power to spare. The rule isn&rsquo;t written out in the game files, so we&rsquo;ll match it to Regolith&rsquo;s numbers before showing it.</span>
        </div>
      </Section>
    </>
  );
}

// ── Salvage heads and fuel pods (v1.51.0) ────────────────────────────────────

const salvageLine = (m: SalvageModule) => [
  m.radius != null ? `radius ${fmt(m.radius, 1)} m` : null,
  m.speed != null ? `speed ×${fmt(m.speed, 2)}` : null,
  m.efficiency != null ? `efficiency ${fmt(m.efficiency * 100)}%` : null,
].filter(Boolean).join(' · ');

function SalvageHeads({ lo, onOpen, active, narrow }: { lo: LoadoutState; onOpen: (t: SwapTarget) => void; active?: SwapTarget | null; narrow: boolean }) {
  return (
    <Section title={`Salvage heads · ${lo.salvage.length}`} aside="Click a scraper module to swap it">
      {lo.salvage.map((h, i) => (
        <div key={h.id} className={narrow ? 'grid gap-2' : 'grid gap-2.5 grid-cols-1 sm:grid-cols-[minmax(150px,200px)_minmax(0,1fr)]'}>
          {!narrow && (
            <div className="gt-box flex flex-col justify-center gap-0.5 px-3 py-2.5">
              <span className="text-xs gt-dim">{h.label}</span>
              <span className="font-semibold">{h.head ?? 'Salvage head'}</span>
              <span className="text-xs gt-dim">{h.crewed ? 'Crew turret' : 'Pilot arm'} · {h.slots.length} module slot{h.slots.length === 1 ? '' : 's'}</span>
            </div>
          )}
          <div className={`grid gap-2 ${narrow ? '' : 'sm:grid-cols-2'}`}>
            {h.slots.map((sl, j) => {
              const m = lo.salvFitted[i]?.[j] ?? null;
              const changed = m?.uuid !== lo.salvStock[i]?.[j]?.uuid;
              const fixed = sl.kind === 'tractor';
              return (
                <button key={sl.id} type="button" className="gt-card" data-changed={changed || sameTarget(active, { kind: 'salvage', head: i, slot: j })}
                  onClick={() => onOpen({ kind: 'salvage', head: i, slot: j })} style={m ? undefined : { borderStyle: 'dashed', background: 'transparent' }}>
                  <span className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-xs gt-dim">{narrow ? `${h.label} · ` : ''}{fixed ? 'Tractor module · fixed' : 'Scraper module'}</span>
                    <span className={`font-semibold text-base ${m ? (changed ? 'gt-acc' : 'gt-hi') : 'gt-dim'}`}>{m?.name ?? '+ Add a scraper module'}</span>
                    <span className="text-[13px] gt-dim">{m ? (m.kind === 'tractor' ? 'The head’s tractor beam' : salvageLine(m)) : 'Empty'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs gt-dim m-0">One scraper module works at a time; the head switches between them. Radius, speed and efficiency are the module&rsquo;s own figures.</p>
    </Section>
  );
}

function FuelPods({ lo, onOpen, active, narrow }: { lo: LoadoutState; onOpen: (t: SwapTarget) => void; active?: SwapTarget | null; narrow: boolean }) {
  return (
    <Section title={`Fuel pods · ${fmt(lo.podCapacity)} SCU`} aside="Click a pod to swap it">
      <div className={`grid gap-2.5 ${narrow ? '' : 'sm:grid-cols-2'}`}>
        {lo.podSlots.map((sl, i) => {
          const p = lo.podFitted[i] ?? null;
          const changed = p?.uuid !== lo.podStock[i]?.uuid;
          return (
            <button key={sl.id} type="button" className="gt-card" data-changed={changed || sameTarget(active, { kind: 'pod', slot: i })} onClick={() => onOpen({ kind: 'pod', slot: i })}>
              <span className="flex items-center gap-3 min-w-0">
                <span className="gt-tag">S{p?.size ?? sl.maxSize}</span>
                <span className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs gt-dim truncate">{sl.label}{p?.maker ? ` · ${p.maker}` : ''}</span>
                  <span className={`font-semibold text-base truncate ${changed ? 'gt-acc' : 'gt-hi'}`}>{p?.name ?? 'Empty'}</span>
                </span>
                {p && (
                  <span className="flex flex-col items-end">
                    <span className="gt-mono text-lg font-semibold gt-hi whitespace-nowrap">{fmt(p.capacity)} SCU</span>
                    <span className="text-xs gt-dim whitespace-nowrap">flow ×{fmt(p.hydrogenFlow, 2)}</span>
                  </span>
                )}
              </span>
              {p && <span className="text-[13px] gt-dim">Hydrogen flow ×{fmt(p.hydrogenFlow, 2)} · quantum flow ×{fmt(p.quantumFlow, 2)} · integrity {fmt(p.integrity)}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-xs gt-dim m-0">Capacity, flow and integrity are each pod&rsquo;s own figures, as the game describes it. A pod holds hydrogen or quantum fuel.</p>
    </Section>
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
  const headPower = lo.headTotals.reduce((t, h) => t + (h.power ?? 0), 0);
  const panels: { title: string; rows: Row[] }[] = [
    ...(lo.heads.length ? [{ title: 'Mining', rows: [
      ['Laser power, all heads', fmt(headPower)],
      ['Extraction, all heads', fmt(lo.headTotals.reduce((t, h) => t + (h.extraction ?? 0), 0))],
      ['Modules fitted', `${lo.headModules.reduce((t, m) => t + m.filter(Boolean).length, 0)} of ${lo.headModules.reduce((t, m) => t + m.length, 0)}`],
      ...(lo.heads.some((h) => h.crewed) ? [['Crew to run every head', fmt(lo.heads.filter((h) => h.crewed).length + 1)] as Row] : []),
      ...(s.crew != null ? [['Crew seats', fmt(s.crew)] as Row] : []),
    ] as Row[] }] : []),
    ...(lo.salvage.length ? [{ title: 'Salvage', rows: [
      ['Salvage heads', fmt(lo.salvage.length)],
      ['Scraper modules fitted', fmt(lo.salvFitted.flat().filter((m) => m?.kind === 'scraper').length)],
      ['Tractor modules', fmt(lo.salvFitted.flat().filter((m) => m?.kind === 'tractor').length)],
      ...(s.crew != null ? [['Crew seats', fmt(s.crew)] as Row] : []),
    ] as Row[] }] : []),
    ...(lo.podSlots.length ? [{ title: 'Refuelling', rows: [
      ['Fuel pods', `${lo.podFitted.filter(Boolean).length} of ${lo.podSlots.length}`],
      ['Pod capacity', `${fmt(lo.podCapacity)} SCU`],
      ['Slowest pod flow', (() => { const f = lo.podFitted.map((p) => p?.hydrogenFlow).filter((v): v is number => v != null); return f.length ? `×${fmt(Math.min(...f), 2)}` : '–'; })()],
      ...(s.flight?.hydrogen != null ? [['Own hydrogen tank', `${fmt(s.flight.hydrogen, 1)} SCU`] as Row] : []),
    ] as Row[] }] : []),
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

export function Swap({ lo, target, guns, components, missiles, lasers = [], modules = [], salvage = [], pods = [], onClose }: {
  lo: LoadoutState; target: SwapTarget; guns: CombatGun[]; components: ShipComponent[]; missiles: MissileItem[];
  lasers?: MiningLaser[]; modules?: MiningModule[]; salvage?: SalvageModule[]; pods?: FuelPod[]; onClose: () => void;
}) {
  const shipName = lo.ship.name;
  if (target.kind === 'salvage') {
    const head = lo.salvage[target.head];
    const slot = head?.slots[target.slot];
    if (!head || !slot) return null;
    const cols: SwapColumn<SalvageModule>[] = [
      { key: 'name', label: 'Module', get: (m) => m.name, text: true },
      { key: 'radius', label: 'Radius m', get: (m) => m.radius, digits: 1 },
      { key: 'speed', label: 'Speed ×', get: (m) => m.speed, digits: 2 },
      { key: 'eff', label: 'Efficiency %', get: (m) => (m.efficiency != null ? m.efficiency * 100 : null) },
    ];
    const fits = salvage.filter((m) => salvageModuleFitsSlot(m, slot));
    return (
      <SwapWindow eyebrow={`${shipName} · ${head.label} · ${head.head ?? 'salvage head'}`} title={slot.kind === 'tractor' ? 'Tractor module' : 'Swap scraper module'}
        items={fits} columns={cols} defaultSort="speed" filters={[]}
        searchText={(m) => `${m.name} ${m.maker ?? ''}`}
        idOf={(m) => m.uuid} nameOf={(m) => m.name} subOf={(m) => m.maker ?? ''}
        fittedId={lo.salvFitted[target.head]?.[target.slot]?.uuid ?? null} stockId={lo.salvStock[target.head]?.[target.slot]?.uuid ?? null}
        onPick={(m) => { lo.pickSalvage(target.head, target.slot, m); onClose(); }}
        onStock={() => { const st = lo.salvStock[target.head]?.[target.slot]; if (st) lo.pickSalvage(target.head, target.slot, st); onClose(); }}
        onClose={onClose}
        locked={slot.kind === 'tractor' ? 'the tractor module is part of the head' : undefined}
        note="a wider beam is slower: radius, speed and efficiency trade off" />
    );
  }

  if (target.kind === 'pod') {
    const slot = lo.podSlots[target.slot];
    if (!slot) return null;
    const cols: SwapColumn<FuelPod>[] = [
      { key: 'name', label: 'Pod', get: (p) => p.name, text: true },
      { key: 'cap', label: 'Capacity SCU', get: (p) => p.capacity },
      { key: 'hflow', label: 'Hydrogen flow ×', get: (p) => p.hydrogenFlow, digits: 2 },
      { key: 'qflow', label: 'Quantum flow ×', get: (p) => p.quantumFlow, digits: 2 },
      { key: 'hp', label: 'Integrity', get: (p) => p.integrity },
    ];
    const fits = pods.filter((p) => fuelPodFitsSlot(p, slot));
    return (
      <SwapWindow eyebrow={`${shipName} · ${slot.label} · size ${slot.maxSize}`} title="Swap fuel pod"
        items={fits} columns={cols} defaultSort="cap"
        filters={[{ label: 'Maker', get: (p) => p.maker }]}
        searchText={(p) => `${p.name} ${p.maker ?? ''}`}
        idOf={(p) => p.uuid} nameOf={(p) => p.name} subOf={(p) => p.maker ?? ''}
        fittedId={lo.podFitted[target.slot]?.uuid ?? null} stockId={lo.podStock[target.slot]?.uuid ?? null}
        onPick={(p) => { lo.pickPod(target.slot, p); onClose(); }}
        onStock={() => { const st = lo.podStock[target.slot]; if (st) lo.pickPod(target.slot, st); onClose(); }}
        onClose={onClose}
        note="a higher flow modifier moves fuel faster" />
    );
  }
  if (target.kind === 'laser') {
    const head = lo.heads[target.head];
    if (!head) return null;
    const cols: SwapColumn<MiningLaser>[] = [
      { key: 'name', label: 'Laser', get: (l) => l.name, text: true },
      { key: 'power', label: 'Power', get: (l) => l.power },
      { key: 'min', label: 'Min power', get: (l) => l.minPower },
      { key: 'ext', label: 'Extraction', get: (l) => l.extraction },
      { key: 'opt', label: 'Optimal m', get: (l) => l.optimalRange },
      { key: 'max', label: 'Max m', get: (l) => l.maxRange },
      { key: 'slots', label: 'Modules', get: (l) => l.moduleSlots },
      ...MOD_COLUMNS.slice(0, 6).map((m): SwapColumn<MiningLaser> => ({
        key: m.key, label: m.label, get: (l) => l.modifiers[m.key] ?? 0, low: m.lowerIsBetter, digits: 1,
        render: (l) => <ModCell v={l.modifiers[m.key]} lowerIsBetter={m.lowerIsBetter} />,
      })),
    ];
    const fits = lasers.filter((l) => laserFitsHead(l, head));
    return (
      <SwapWindow eyebrow={`${shipName} · ${head.label} · size ${head.size}`} title="Swap mining laser"
        items={fits} columns={cols} defaultSort="power"
        filters={[{ label: 'Maker', get: (l) => l.maker }]}
        searchText={(l) => `${l.name} ${l.maker ?? ''}`}
        idOf={(l) => l.uuid} nameOf={(l) => l.name} subOf={(l) => `${l.maker ?? ''}${l.bespokeFor ? ' · made for this ship' : ''}`}
        fittedId={lo.headLaser[target.head]?.uuid ?? null} stockId={lo.headStock[target.head]?.uuid ?? null}
        onPick={(l) => { lo.pickLaser(target.head, l); onClose(); }}
        onStock={() => { const st = lo.headStock[target.head]; if (st) lo.pickLaser(target.head, st); onClose(); }}
        onClose={onClose}
        locked={head.locked ? 'this ship’s laser can’t be swapped; its modules can' : undefined}
        note="green helps the miner, red hurts · modules past a laser’s slots come off" />
    );
  }

  if (target.kind === 'module') {
    const laser = lo.headLaser[target.head];
    const head = lo.heads[target.head];
    if (!head || !laser) return null;
    const fitted = lo.headModules[target.head]?.[target.slot] ?? null;
    const cols: SwapColumn<MiningModule>[] = [
      { key: 'name', label: 'Module', get: (m) => m.name, text: true },
      { key: 'kind', label: 'Kind', get: (m) => m.kind, text: true },
      { key: 'uses', label: 'Uses', get: (m) => (m.charges ?? 0) * (m.lifetime ?? 0) || null, render: (m) => usesText(m) ?? <span className="gt-dim">always on</span> },
      { key: 'power', label: 'Power', get: (m) => m.power ?? 1, digits: 2, render: (m) => (m.power != null && m.power !== 1 ? <span className={m.power > 1 ? 'gt-good' : 'gt-bad'}>×{fmt(m.power, 2)}</span> : <span className="gt-dim">–</span>) },
      ...MOD_COLUMNS.map((c): SwapColumn<MiningModule> => ({
        key: c.key, label: c.label, get: (m) => m.modifiers[c.key] ?? 0, low: c.lowerIsBetter, digits: 1,
        render: (m) => <ModCell v={m.modifiers[c.key]} lowerIsBetter={c.lowerIsBetter} />,
      })),
      { key: 'rarity', label: 'Rarity', get: (m) => m.rarity, text: true },
    ];
    return (
      <SwapWindow eyebrow={`${shipName} · ${head.label} · ${laser.name} · module slot ${target.slot + 1}`} title="Swap module"
        items={modules} columns={cols} defaultSort="power"
        filters={[{ label: 'Kind', get: (m) => m.kind }]}
        searchText={(m) => `${m.name} ${m.maker ?? ''} ${m.kind} ${Object.keys(m.modifiers).join(' ')}`}
        idOf={(m) => m.uuid} nameOf={(m) => m.name} subOf={(m) => m.maker ?? ''}
        fittedId={fitted?.uuid ?? null} stockId={null}
        onPick={(m) => { lo.pickModule(target.head, target.slot, m); onClose(); }}
        extra={fitted ? { label: 'Empty this slot', onClick: () => { lo.pickModule(target.head, target.slot, null); onClose(); } } : undefined}
        onClose={onClose}
        note="active modules are used up: charges × seconds each" />
    );
  }

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
