// "What this loadout can kill" (v1.44.0; side by side in v1.45.0): kill
// times against a list of ships, with the verdict and the guns each one's
// armour stops. With two loadouts it's one table with a column per ship.
// Click a target for the breakdown.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { killTime, killVerdict, formatKillTime, KILL_VERDICT_WORDS, type CombatGun, type GameToolsShip, type KillResult, type KillVerdict } from '@dem/shared';
import { fmt, shortShipName } from '../../lib/gameTools';
import { useToolsPaths } from '../../lib/toolsPaths';

/** Ships people run into most, small to huge. */
export const COMMON_TARGETS = [
  'ANVL_Arrow', 'AEGS_Avenger_Titan', 'AEGS_Gladius', 'ANVL_Hornet_F7C_Mk2', 'AEGS_Sabre', 'CRUS_Starfighter_Inferno',
  'MISC_Prospector', 'DRAK_Buccaneer', 'ORIG_300i', 'DRAK_Cutlass_Black', 'ANVL_Hurricane', 'RSI_Scorpius',
  'MISC_Freelancer', 'AEGS_Vanguard', 'MISC_Starlancer_TAC', 'AEGS_Retaliator', 'DRAK_Corsair', 'AEGS_Redeemer',
  'RSI_Constellation_Andromeda_GS', 'DRAK_Caterpillar', 'CRUS_Starlifter_C2', 'ANVL_Carrack', 'AEGS_Hammerhead_GS',
  'RSI_Polaris', 'AEGS_Idris_M',
];

const VERDICT_CLASS: Record<KillVerdict, string> = {
  quick: 'gt-good', workable: 'gt-acc', slow: 'gt-hi', long: 'gt-bad', 'no-hull': 'gt-bad', never: 'gt-bad',
};

const shortGun = (name: string) => name.replace(/^CF-\d+ /, '').replace(/ (GT|T)-\d+/, '').replace(/ (Repeater|Gatling|Scattergun|Cannon|Mass Driver|Laser Repeater|Laser Cannon).*$/, '');

export interface KillTableLoadout { name: string; guns: CombatGun[] }

export function KillTable({ loadouts, ships }: { loadouts: KillTableLoadout[]; ships: GameToolsShip[] }) {
  const paths = useToolsPaths();
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const targets = useMemo(() => {
    if (showAll) return ships;
    const by = new Map(ships.map((s) => [s.className, s]));
    return COMMON_TARGETS.map((c) => by.get(c)).filter((s): s is GameToolsShip => !!s);
  }, [ships, showAll]);

  const rows = useMemo(() => targets.map((t) => ({
    t,
    per: loadouts.map((lo) => {
      const burst = killTime(lo.guns, t, 'burst');
      return { burst, sustained: killTime(lo.guns, t, 'sustained'), verdict: killVerdict(burst) };
    }),
  })), [loadouts, targets]);
  const sel = rows.find((r) => r.t.className === picked) ?? null;
  const two = loadouts.length > 1;

  if (loadouts.every((l) => !l.guns.length)) return <p className="gt-dim m-0">No pilot guns to compare.</p>;

  return (
    <section aria-labelledby="gt-kill-h" className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
        <h2 id="gt-kill-h" className="gt-label gt-label-acc m-0">{two ? 'What each loadout can kill' : 'What this loadout can kill'}</h2>
        <button type="button" className="gt-link text-sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Common ships only' : `All ${ships.length} ships`}</button>
      </div>
      <div className="gt-scroll">
        <table className="gt-table min-w-[620px]">
          <thead>
            {two ? (
              <tr>
                <th>Target</th>
                {loadouts.map((l) => <th key={l.name} className="num">{l.name}<span className="block normal-case tracking-normal font-normal text-[11px]">burst · verdict</span></th>)}
                <th>Faster</th>
              </tr>
            ) : (
              <tr><th>Target</th><th>Verdict</th><th className="num">Burst</th><th className="num">Sustained</th><th>Armour stops</th></tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = r.t.className === picked;
              const nameCell = (
                <td>
                  <button type="button" className="gt-cellbtn" aria-pressed={on} onClick={() => setPicked(on ? null : r.t.className)}>{shortShipName(r.t)}</button>
                  <span className="block text-xs gt-dim">{r.t.role ?? r.t.career ?? ''}</span>
                </td>
              );
              if (two) {
                const [a, b] = r.per as [typeof r.per[0], typeof r.per[0]];
                const winner = a.burst.seconds === b.burst.seconds ? null : (isFinite(a.burst.seconds) ? a.burst.seconds : Infinity) < (isFinite(b.burst.seconds) ? b.burst.seconds : Infinity) ? 0 : 1;
                return (
                  <tr key={r.t.uuid} className={on ? 'is-on' : ''}>
                    {nameCell}
                    {r.per.map((p, i) => (
                      <td key={i} className="num">
                        <span className={i === winner ? 'gt-hi font-semibold' : ''}>{formatKillTime(p.burst.seconds)}</span>
                        <span className={`block text-xs font-sans ${VERDICT_CLASS[p.verdict]}`}>{KILL_VERDICT_WORDS[p.verdict]}</span>
                      </td>
                    ))}
                    <td className="text-sm">{winner == null ? <span className="gt-dim">Same</span> : <span className="gt-acc">{loadouts[winner]!.name}</span>}</td>
                  </tr>
                );
              }
              const p = r.per[0]!;
              const stopped = [...new Set(p.burst.stopped.map(shortGun))];
              return (
                <tr key={r.t.uuid} className={on ? 'is-on' : ''}>
                  {nameCell}
                  <td className={`font-semibold ${VERDICT_CLASS[p.verdict]}`}>{KILL_VERDICT_WORDS[p.verdict]}</td>
                  <td className="num gt-hi">{formatKillTime(p.burst.seconds)}</td>
                  <td className="num">{formatKillTime(p.sustained.seconds)}</td>
                  <td className="text-sm gt-dim">{stopped.length ? stopped.join(', ') : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="mt-4 pt-3.5 flex flex-col gap-4" style={{ borderTop: '2px solid var(--gt-acc)' }}>
          <span className="font-semibold gt-hi">vs {sel.t.name} <Link className="gt-link text-sm font-normal ml-3" to={paths.ship(sel.t.className)}>Open {shortShipName(sel.t)}</Link></span>
          <div className={`grid gap-6 ${two ? 'sm:grid-cols-2' : ''}`}>
            {sel.per.map((p, i) => <Breakdown key={i} title={two ? loadouts[i]!.name : null} t={sel.t} r={p.burst} />)}
          </div>
        </div>
      )}
      <p className="text-xs gt-dim leading-relaxed mt-3 mb-0">
        Every shot hits, full power, no shield regen while under fire. Assumes shots at or below a ship&rsquo;s armour deflection value do no hull damage; to be confirmed in game. A comparison, not a fight prediction.
      </p>
    </section>
  );
}

function Breakdown({ title, t, r }: { title: string | null; t: GameToolsShip; r: KillResult }) {
  return (
    <div className="flex flex-col gap-1.5">
      {title && <span className="gt-label gt-label-acc">{title}</span>}
      <span>Shields ({fmt(t.shieldHp)}) {isFinite(r.shieldSeconds)
        ? r.seconds < r.shieldSeconds ? 'never need to drop: ballistic damage through them kills it first.' : <>down in <span className="gt-mono gt-hi">{formatKillTime(r.shieldSeconds)}</span> of burst fire.</>
        : 'never drop.'}</span>
      <span>Each volley: <span className="gt-mono gt-hi">{fmt(r.volleyShield)}</span> to shields, <span className="gt-mono gt-hi">{fmt(r.volleyThrough)}</span> to the hull through them, <span className="gt-mono gt-hi">{fmt(r.volleyHull)}</span> to the hull once they&rsquo;re down.</span>
      <span>{r.stopped.length
        ? <>Its armour stops {[...new Set(r.stopped)].join(', ')}: shots at or below {fmt(t.deflection.physical)} ballistic / {fmt(t.deflection.energy)} energy damage.</>
        : 'Its armour doesn’t stop any of these guns.'}</span>
      <span>Main hull ({fmt(t.hullHp)}) gone after <span className="gt-mono gt-hi">{formatKillTime(r.seconds)}</span>.</span>
    </div>
  );
}
