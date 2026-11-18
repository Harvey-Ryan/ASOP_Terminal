// "What this loadout can kill" (v1.44.0): kill times against a list of ships,
// with the verdict and the guns each one's armour stops. Click a ship for the
// breakdown. Shared by the ship page and Loadout.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { killTime, killVerdict, formatKillTime, KILL_VERDICT_WORDS, type CombatGun, type GameToolsShip, type KillVerdict } from '@dem/shared';
import { fmt, shipPath, shortShipName } from '../../lib/gameTools';

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

export function KillTable({ guns, ships, optimizeFor }: {
  guns: CombatGun[];
  ships: GameToolsShip[];
  /** Ship (class name) whose Optimizer link to show, if any. */
  optimizeFor?: GameToolsShip | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const targets = useMemo(() => {
    if (showAll) return ships;
    const by = new Map(ships.map((s) => [s.className, s]));
    return COMMON_TARGETS.map((c) => by.get(c)).filter((s): s is GameToolsShip => !!s);
  }, [ships, showAll]);

  const rows = useMemo(() => targets.map((t) => {
    const burst = killTime(guns, t, 'burst');
    const sustained = killTime(guns, t, 'sustained');
    return { t, burst, sustained, verdict: killVerdict(burst) };
  }), [guns, targets]);
  const sel = rows.find((r) => r.t.className === picked) ?? null;

  if (!guns.length) return <p className="gt-dim m-0">This ship has no pilot guns.</p>;

  return (
    <section aria-labelledby="gt-kill-h" className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
        <h2 id="gt-kill-h" className="gt-label gt-label-acc m-0">What this loadout can kill</h2>
        <button type="button" className="gt-link text-sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Common ships only' : `All ${ships.length} ships`}</button>
      </div>
      <div className="gt-scroll">
        <table className="gt-table min-w-[640px]">
          <thead>
            <tr><th>Target</th><th>Verdict</th><th className="num">Burst</th><th className="num">Sustained</th><th>Armour stops</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = r.t.className === picked;
              const stopped = [...new Set(r.burst.stopped.map(shortGun))];
              return (
                <tr key={r.t.uuid} className={on ? 'is-on' : ''}>
                  <td>
                    <button type="button" className="gt-cellbtn" aria-pressed={on} onClick={() => setPicked(on ? null : r.t.className)}>{shortShipName(r.t)}</button>
                    <span className="block text-xs gt-dim">{r.t.role ?? r.t.career ?? ''}</span>
                  </td>
                  <td className={`font-semibold ${VERDICT_CLASS[r.verdict]}`}>{KILL_VERDICT_WORDS[r.verdict]}</td>
                  <td className="num gt-hi">{formatKillTime(r.burst.seconds)}</td>
                  <td className="num">{formatKillTime(r.sustained.seconds)}</td>
                  <td className="text-sm gt-dim">{stopped.length ? stopped.join(', ') : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="mt-4 pt-3.5 flex flex-col gap-1.5" style={{ borderTop: '2px solid var(--gt-acc)' }}>
          <span className="font-semibold gt-hi">vs {sel.t.name}</span>
          <span>Shields ({fmt(sel.t.shieldHp)}) {isFinite(sel.burst.shieldSeconds)
            ? sel.burst.seconds < sel.burst.shieldSeconds ? 'never need to drop: ballistic damage through them kills it first.' : <>down in <span className="gt-mono gt-hi">{formatKillTime(sel.burst.shieldSeconds)}</span> of burst fire.</>
            : 'never drop.'}</span>
          <span>Each volley: <span className="gt-mono gt-hi">{fmt(sel.burst.volleyShield)}</span> to shields, <span className="gt-mono gt-hi">{fmt(sel.burst.volleyThrough)}</span> to the hull through them, <span className="gt-mono gt-hi">{fmt(sel.burst.volleyHull)}</span> to the hull once they&rsquo;re down.</span>
          <span>{sel.burst.stopped.length
            ? <>Its armour stops {[...new Set(sel.burst.stopped)].join(', ')}: shots at or below {fmt(sel.t.deflection.physical)} ballistic / {fmt(sel.t.deflection.energy)} energy damage.</>
            : 'Its armour doesn’t stop any of your guns.'}</span>
          <span>Main hull ({fmt(sel.t.hullHp)}) gone after <span className="gt-mono gt-hi">{formatKillTime(sel.burst.seconds)}</span>.</span>
          <span className="flex flex-wrap gap-x-5 pt-1">
            <Link className="gt-link" to={shipPath(sel.t)}>{shortShipName(sel.t)} stats</Link>
            {optimizeFor && <Link className="gt-link" to={`${shipPath(optimizeFor, 'optimizer')}?target=${encodeURIComponent(sel.t.className.toLowerCase())}`}>Best loadout vs {shortShipName(sel.t)} &rarr;</Link>}
          </span>
        </div>
      )}
      <p className="text-xs gt-dim leading-relaxed mt-3 mb-0">
        Every shot hits, full power, no shield regen while under fire. Assumes shots at or below a ship&rsquo;s armour deflection value do no hull damage; to be confirmed in game. A comparison, not a fight prediction.
      </p>
    </section>
  );
}
