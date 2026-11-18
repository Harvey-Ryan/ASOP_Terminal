// Ships (v1.44.0): every flying ship, sortable, and one ship's page with its
// stock guns and what they can kill.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { GameToolsShip } from '@dem/shared';
import { fmt, pilotSlots, shipPath, shortShipName, useGameTools } from '../../lib/gameTools';
import { ToolsDataState } from './ToolsLayout';
import { KillTable } from './KillTable';

type SortKey = 'name' | 'size' | 'shieldHp' | 'hullHp' | 'dps' | 'cargo';

const pilotDps = (s: GameToolsShip, gunsByUuid: Map<string, { burstDps: number }>) =>
  pilotSlots(s).reduce((sum, slot) => sum + (slot.stockGunUuid ? gunsByUuid.get(slot.stockGunUuid)?.burstDps ?? 0 : 0), 0);

export function ShipsPage() {
  const { data, index, isLoading, error } = useGameTools();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const rows = useMemo(() => {
    if (!data || !index) return [];
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = data.ships
      .filter((s) => w.every((x) => `${s.name} ${s.role ?? ''} ${s.career ?? ''}`.toLowerCase().includes(x)))
      .map((s) => ({ s, dps: pilotDps(s, index.gunsByUuid) }));
    const val = (r: (typeof list)[number]): number | string =>
      sort === 'name' ? r.s.name : sort === 'dps' ? r.dps : sort === 'size' ? r.s.size ?? 0 : (r.s[sort] as number | null) ?? -1;
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      return typeof va === 'string' ? va.localeCompare(vb as string) : (vb as number) - (va as number);
    });
  }, [data, index, q, sort]);

  if (!data) return <ToolsDataState isLoading={isLoading} error={error} />;

  const th = (key: SortKey, label: string, num = true) => (
    <th className={num ? 'num' : ''}><button type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>{label}</button></th>
  );

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-10 pt-10 pb-12 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-3xl font-bold gt-hi">Ships</h1>
          <span className="gt-dim text-sm">{fmt(data.ships.length)} ships · stock loadouts · click a column to sort</span>
        </div>
        <label className="flex flex-col gap-1 min-w-[260px]">
          <span className="gt-label">Filter</span>
          <input type="search" className="gt-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or role" />
        </label>
      </div>
      <div className="gt-scroll">
        <table className="gt-table min-w-[760px]">
          <thead>
            <tr>{th('name', 'Ship', false)}<th>Role</th>{th('size', 'Size')}{th('shieldHp', 'Shields')}{th('hullHp', 'Hull')}{th('dps', 'Pilot DPS')}{th('cargo', 'Cargo')}</tr>
          </thead>
          <tbody>
            {rows.map(({ s, dps }) => (
              <tr key={s.uuid}>
                <td><Link to={shipPath(s)} className="gt-hi font-medium no-underline hover:underline">{s.name}</Link></td>
                <td className="gt-dim">{s.role ?? s.career ?? ''}</td>
                <td className="num">{fmt(s.size)}</td>
                <td className="num">{fmt(s.shieldHp)}</td>
                <td className="num">{fmt(s.hullHp)}</td>
                <td className="num gt-hi">{dps ? fmt(dps) : '–'}</td>
                <td className="num">{fmt(s.cargo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export function ShipPage() {
  const { className = '' } = useParams();
  const { data, index, isLoading, error } = useGameTools();
  if (!data || !index) return <ToolsDataState isLoading={isLoading} error={error} />;
  const ship = index.shipsByClass.get(className.toLowerCase());
  if (!ship) return <p className="gt-dim px-5 sm:px-10 py-16">That ship isn&rsquo;t in this game build. <Link className="gt-link" to="/tools/ships">All ships</Link></p>;

  const slots = pilotSlots(ship);
  const guns = slots.map((s) => (s.stockGunUuid ? index.gunsByUuid.get(s.stockGunUuid) : undefined)).filter((g): g is NonNullable<typeof g> => !!g);
  const turrets = ship.gunSlots.filter((s) => s.turret);
  const sum = (k: 'burstDps' | 'sustainedDps' | 'alpha') => guns.reduce((t, g) => t + g[k], 0);

  const keys = [
    { k: 'Shields', v: fmt(ship.shieldHp), n: `regen ${fmt(ship.shieldRegen)}/s` },
    { k: 'Hull', v: fmt(ship.hullHp), n: `main body · ${fmt(ship.hullTotal)} all parts` },
    { k: 'Pilot DPS', v: fmt(sum('burstDps')), n: `${fmt(sum('sustainedDps'))} sustained · ${fmt(sum('alpha'))} alpha` },
    { k: 'Top speed', v: fmt(ship.maxSpeed), n: `m/s · SCM ${fmt(ship.scm)}` },
    { k: 'Quantum', v: ship.qtSpool != null ? `${fmt(ship.qtSpool, 1)} s` : '–', n: ship.qtSpeed ? `spool · ${fmt(ship.qtSpeed / 1000)} km/s` : 'spool' },
    { k: 'Cargo', v: fmt(ship.cargo), n: 'SCU' },
  ];

  return (
    <>
      <div
        className="flex items-end px-5 sm:px-10 pb-6 border-b"
        style={{
          borderColor: 'var(--gt-line)', minHeight: 240,
          background: ship.imageUrl ? `linear-gradient(to top, var(--gt-bg) 8%, transparent 70%), url("${ship.imageUrl}") center/cover` : 'var(--gt-faint)',
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="gt-label">{[ship.maker, ship.role ?? ship.career, ship.size != null ? `size ${ship.size}` : null, ship.crew != null ? `${ship.crew} crew` : null].filter(Boolean).join(' · ')}</span>
          <h1 className="m-0 text-4xl sm:text-5xl font-bold gt-hi">{shortShipName(ship)}</h1>
          {ship.imageUrl && <span className="text-xs gt-dim">Picture: Roberts Space Industries</span>}
          {slots.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-3">
              <Link className="gt-btn gt-btn-primary" to={shipPath(ship, 'loadout')}>Open Loadout</Link>
              <Link className="gt-btn" style={{ background: 'var(--gt-bg)' }} to={shipPath(ship, 'optimizer')}>Optimize</Link>
            </div>
          )}
        </div>
      </div>
      <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-10 pt-8 pb-12 flex flex-col gap-10">
        <section aria-label="Key numbers" className="flex flex-wrap" style={{ borderTop: '1px solid var(--gt-line)', borderBottom: '1px solid var(--gt-line)' }}>
          {keys.map((x) => (
            <div key={x.k} className="flex-[1_1_150px] py-4 pr-5 flex flex-col gap-1">
              <span className="gt-label">{x.k}</span>
              <span className="gt-mono text-2xl gt-hi">{x.v}</span>
              <span className="text-xs gt-dim">{x.n}</span>
            </div>
          ))}
        </section>

        <section aria-labelledby="gt-guns-h" className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="gt-guns-h" className="gt-label gt-label-acc m-0">Stock pilot guns</h2>
            <span className="flex gap-5">
              <Link className="gt-link" to={shipPath(ship, 'loadout')}>Loadout &rarr;</Link>
              <Link className="gt-link" to={shipPath(ship, 'optimizer')}>Optimize &rarr;</Link>
            </span>
          </div>
          <div className="gt-scroll">
            <table className="gt-table min-w-[560px]">
              <thead><tr><th>Slot</th><th>Gun</th><th>Type</th><th className="num">Sustained</th><th className="num">Burst</th><th className="num">Alpha</th></tr></thead>
              <tbody>
                {slots.map((s) => {
                  const g = s.stockGunUuid ? index.gunsByUuid.get(s.stockGunUuid) : undefined;
                  return (
                    <tr key={s.id}>
                      <td className="gt-dim">{s.label} <span className="gt-mono text-xs">S{s.maxSize}</span></td>
                      <td className="gt-hi">{g?.name ?? 'Empty'}</td>
                      <td className="gt-dim">{g?.kind ?? ''}</td>
                      <td className="num">{fmt(g?.sustainedDps)}</td>
                      <td className="num">{fmt(g?.burstDps)}</td>
                      <td className="num">{fmt(g?.alpha)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {turrets.length > 0 && <p className="text-sm gt-dim m-0">Plus {turrets.length} turret gun{turrets.length === 1 ? '' : 's'} for crew, not counted above.</p>}
        </section>

        <KillTable guns={guns} ships={data.ships} optimizeFor={ship} />

        <section className="flex flex-wrap gap-x-16 gap-y-4 gt-rule pt-5">
          <div className="flex flex-col gap-1">
            <span className="gt-label">Armour</span>
            <span>Takes <span className="gt-mono gt-hi">×{fmt(ship.armourMult.physical, 2)}</span> ballistic, <span className="gt-mono gt-hi">×{fmt(ship.armourMult.energy, 2)}</span> energy · stops shots at or below <span className="gt-mono gt-hi">{fmt(ship.deflection.physical)}</span> / <span className="gt-mono gt-hi">{fmt(ship.deflection.energy)}</span></span>
          </div>
          {ship.insuranceClaimMin != null && (
            <div className="flex flex-col gap-1">
              <span className="gt-label">Insurance claim</span>
              <span><span className="gt-mono gt-hi">{fmt(ship.insuranceClaimMin, 1)}</span> min</span>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
