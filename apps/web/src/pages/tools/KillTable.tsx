// "What this loadout can kill" (v1.44.0; side by side in v1.45.0): kill
// times against a list of ships (with each target's stock shields, armour,
// hull and deflection), each time coloured easy / workable / not worth it /
// impossible (v1.60.0; no verdict words), and the guns each one's armour
// stops. With two loadouts it's one table with a column per ship.
// Click a target for the breakdown. v1.60.0: times are at the chosen share of
// shots hitting (default 35%, kept in this browser), with each gun at its
// burst rate until it overheats or empties its capacitor, then sustained, and
// the armour's health counted before the main body; "Every shot hits" is the
// same fight with no misses.

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_ACCURACY,
  killTime,
  formatKillTime,
  type CombatGun,
  type GameToolsShip,
  type KillResult,
} from '@dem/shared';
import { fmt, shortShipName } from '../../lib/gameTools';
import { useToolsPaths } from '../../lib/toolsPaths';

/** Ships people run into most, small to huge. */
export const COMMON_TARGETS = [
  'ANVL_Arrow',
  'AEGS_Avenger_Titan',
  'AEGS_Gladius',
  'ANVL_Hornet_F7C_Mk2',
  'AEGS_Sabre',
  'CRUS_Starfighter_Inferno',
  'MISC_Prospector',
  'DRAK_Buccaneer',
  'ORIG_300i',
  'DRAK_Cutlass_Black',
  'ANVL_Hurricane',
  'RSI_Scorpius',
  'MISC_Freelancer',
  'AEGS_Vanguard',
  'MISC_Starlancer_TAC',
  'AEGS_Retaliator',
  'DRAK_Corsair',
  'AEGS_Redeemer',
  'RSI_Constellation_Andromeda_GS',
  'DRAK_Caterpillar',
  'CRUS_Starlifter_C2',
  'ANVL_Carrack',
  'AEGS_Hammerhead_GS',
  'RSI_Polaris',
  'AEGS_Idris_M',
];

/**
 * Kill-time bands (v1.60.0): the time itself is coloured instead of
 * verdict words. Easy under 45 s, workable under 2 min, not worth it beyond
 * that, impossible when the hull can't be killed at all.
 */
export type KillBand = 'easy' | 'workable' | 'long' | 'never';
export const KILL_BANDS: { band: KillBand; label: string; note: string }[] = [
  { band: 'easy', label: 'Easy', note: 'under 45 s' },
  { band: 'workable', label: 'Workable', note: '45 s – 2 min' },
  { band: 'long', label: 'Not worth it', note: 'over 2 min' },
  { band: 'never', label: 'Impossible', note: 'can’t kill' },
];
export function killBand(seconds: number): KillBand {
  if (!isFinite(seconds)) return 'never';
  if (seconds < 45) return 'easy';
  if (seconds < 120) return 'workable';
  return 'long';
}
/** The old verdict colours, now on the time itself. */
const BAND_CLASS: Record<KillBand, string> = {
  easy: 'gt-good',
  workable: 'gt-acc',
  long: 'gt-bad',
  never: 'gt-bad',
};
function KillTime({ seconds, strong }: { seconds: number; strong?: boolean }) {
  const band = killBand(seconds);
  return (
    <span
      className={`${BAND_CLASS[band]}${strong ? ' font-semibold' : ''}`}
      title={KILL_BANDS.find((b) => b.band === band)!.label}
    >
      {formatKillTime(seconds)}
    </span>
  );
}

const shortGun = (name: string) =>
  name
    .replace(/^CF-\d+ /, '')
    .replace(/ (GT|T)-\d+/, '')
    .replace(/ (Repeater|Gatling|Scattergun|Cannon|Mass Driver|Laser Repeater|Laser Cannon).*$/, '');

// ── Share of shots that hit (kept in this browser) ─────────────────────────────

const ACCURACY_KEY = 'asop.ttkAccuracy';
const ACCURACY_CHOICES = [0.2, 0.35, 0.5, 0.75, 1];
const accuracyListeners = new Set<() => void>();
let accuracyNow: number = (() => {
  try {
    const v = Number(localStorage.getItem(ACCURACY_KEY));
    return ACCURACY_CHOICES.includes(v) ? v : DEFAULT_ACCURACY;
  } catch {
    return DEFAULT_ACCURACY;
  }
})();
function setAccuracy(v: number) {
  accuracyNow = v;
  try {
    localStorage.setItem(ACCURACY_KEY, String(v));
  } catch {
    /* private mode: this tab only */
  }
  accuracyListeners.forEach((l) => l());
}
function useAccuracy(): number {
  return useSyncExternalStore(
    (l) => {
      accuracyListeners.add(l);
      return () => accuracyListeners.delete(l);
    },
    () => accuracyNow,
    () => DEFAULT_ACCURACY,
  );
}
const pct = (v: number) => `${Math.round(v * 100)}%`;

export interface KillTableLoadout {
  name: string;
  guns: CombatGun[];
}

export function KillTable({ loadouts, ships }: { loadouts: KillTableLoadout[]; ships: GameToolsShip[] }) {
  const paths = useToolsPaths();
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const accuracy = useAccuracy();
  const targets = useMemo(() => {
    if (showAll) return ships;
    const by = new Map(ships.map((s) => [s.className, s]));
    return COMMON_TARGETS.map((c) => by.get(c)).filter((s): s is GameToolsShip => !!s);
  }, [ships, showAll]);

  const rows = useMemo(
    () =>
      targets.map((t) => ({
        t,
        per: loadouts.map((lo) => {
          const real = killTime(lo.guns, t, 'real', { accuracy });
          return { real, allHit: killTime(lo.guns, t, 'real') };
        }),
      })),
    [loadouts, targets, accuracy],
  );
  const sel = rows.find((r) => r.t.className === picked) ?? null;
  const two = loadouts.length > 1;

  if (loadouts.every((l) => !l.guns.length)) return <p className="gt-dim m-0">No pilot guns to compare.</p>;

  return (
    <section aria-labelledby="gt-kill-h" className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
        <h2 id="gt-kill-h" className="gt-label gt-label-acc m-0">
          {two ? 'What each loadout can kill' : 'What this loadout can kill'}
        </h2>
        <button type="button" className="gt-link text-sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Common ships only' : `All ${ships.length} ships`}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pb-3" role="group" aria-label="Share of shots that hit">
        <span className="text-sm gt-dim">Shots that hit</span>
        {ACCURACY_CHOICES.map((v) => (
          <button
            key={v}
            type="button"
            className="gt-chip"
            aria-pressed={accuracy === v}
            onClick={() => setAccuracy(v)}
            title={
              v === 1 ? 'Every shot hits: the best case' : v === DEFAULT_ACCURACY ? 'A typical dogfight' : undefined
            }
          >
            {pct(v)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 text-xs gt-dim" aria-label="Colour key">
        {KILL_BANDS.map((b) => (
          <span key={b.band}>
            <span className={BAND_CLASS[b.band]}>{b.label}</span>&nbsp;{b.note}
          </span>
        ))}
      </div>
      <div className="gt-scroll">
        <table className="gt-table min-w-[900px]">
          <thead>
            {two ? (
              <tr>
                <th>Target</th>
                <th className="num">Shields</th>
                <th className="num">Armour</th>
                <th className="num">Hull</th>
                <th className="num" title="Physical / energy: shots at or below this do no hull damage">
                  Deflection
                </th>
                {loadouts.map((l) => (
                  <th key={l.name} className="num">
                    {l.name}
                    <span className="block normal-case tracking-normal font-normal text-[11px]">
                      at {pct(accuracy)} of shots hitting
                    </span>
                  </th>
                ))}
                <th>Faster</th>
              </tr>
            ) : (
              <tr>
                <th>Target</th>
                <th className="num">Shields</th>
                <th className="num">Armour</th>
                <th className="num">Hull</th>
                <th className="num" title="Physical / energy: shots at or below this do no hull damage">
                  Deflection
                </th>
                <th className="num">Time to kill</th>
                <th className="num">Every shot hits</th>
                <th>Armour stops</th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = r.t.className === picked;
              const nameCell = (
                <td>
                  <button
                    type="button"
                    className="gt-cellbtn"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? null : r.t.className)}
                  >
                    {shortShipName(r.t)}
                  </button>
                  <span className="block text-xs gt-dim">{r.t.role ?? r.t.career ?? ''}</span>
                </td>
              );
              const statCells = (
                <>
                  <td className="num gt-dim">{fmt(r.t.shieldHp)}</td>
                  <td className="num gt-dim">{r.t.armourHp ? fmt(r.t.armourHp) : '–'}</td>
                  <td className="num gt-dim">{fmt(r.t.hullHp)}</td>
                  <td className="num gt-dim">
                    {fmt(r.t.deflection.physical)} / {fmt(r.t.deflection.energy)}
                  </td>
                </>
              );
              if (two) {
                const [a, b] = r.per as [(typeof r.per)[0], (typeof r.per)[0]];
                const winner =
                  a.real.seconds === b.real.seconds
                    ? null
                    : (isFinite(a.real.seconds) ? a.real.seconds : Infinity) <
                        (isFinite(b.real.seconds) ? b.real.seconds : Infinity)
                      ? 0
                      : 1;
                return (
                  <tr key={r.t.uuid} className={on ? 'is-on' : ''}>
                    {nameCell}
                    {statCells}
                    {r.per.map((p, i) => (
                      <td key={i} className="num">
                        <KillTime seconds={p.real.seconds} strong={i === winner} />
                      </td>
                    ))}
                    <td className="text-sm">
                      {winner == null ? (
                        <span className="gt-dim">Same</span>
                      ) : (
                        <span className="gt-acc">{loadouts[winner]!.name}</span>
                      )}
                    </td>
                  </tr>
                );
              }
              const p = r.per[0]!;
              const stopped = [...new Set(p.real.stopped.map(shortGun))];
              return (
                <tr key={r.t.uuid} className={on ? 'is-on' : ''}>
                  {nameCell}
                  {statCells}
                  <td className="num">
                    <KillTime seconds={p.real.seconds} strong />
                  </td>
                  <td className="num">
                    <KillTime seconds={p.allHit.seconds} />
                  </td>
                  <td className="text-sm gt-dim">{stopped.length ? stopped.join(', ') : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="mt-4 pt-3.5 flex flex-col gap-4" style={{ borderTop: '2px solid var(--gt-acc)' }}>
          <span className="font-semibold gt-hi">
            vs {sel.t.name}{' '}
            <Link className="gt-link text-sm font-normal ml-3" to={paths.ship(sel.t.className)}>
              Open {shortShipName(sel.t)}
            </Link>
          </span>
          <div className={`grid gap-6 ${two ? 'sm:grid-cols-2' : ''}`}>
            {sel.per.map((p, i) => (
              <Breakdown key={i} title={two ? loadouts[i]!.name : null} t={sel.t} r={p.real} accuracy={accuracy} />
            ))}
          </div>
        </div>
      )}
      <p className="text-xs gt-dim leading-relaxed mt-3 mb-0">
        <span className="gt-tip" tabIndex={0} aria-describedby="gt-kill-tip">
          These are simulation values. <span className="gt-tip-hint">Hover for more info.</span>
          <span id="gt-kill-tip" role="tooltip" className="gt-tip-pop">
            <span className="gt-label gt-label-acc block pb-1.5">How these times are worked out</span>
            <span className="block pb-1.5">
              They come from the game files&rsquo; numbers, not from a recorded fight. A comparison between loadouts,
              not a prediction.
            </span>
            <span className="block">
              <b>Hits:</b> {pct(accuracy)} of shots land (change it above). &ldquo;Every shot hits&rdquo; is the best
              case.
            </span>
            <span className="block">
              <b>Fire rate:</b> each gun fires at its burst rate until it overheats or empties its capacitor, then at
              its sustained rate.
            </span>
            <span className="block">
              <b>Order:</b> shields first (ballistic damage partly passes through them), then the armour&rsquo;s health,
              then the main hull. The ship is destroyed when its main hull is gone.
            </span>
            <span className="block">
              <b>Armour:</b> counted as one extra health pool. In game it&rsquo;s worn down section by section, where
              the shots land.
            </span>
            <span className="block">
              <b>Deflection:</b> shots at or below a ship&rsquo;s armour deflection value do no hull damage (to be
              confirmed in game).
            </span>
            <span className="block">
              <b>Not modelled:</b> shield regeneration under fire, damage falling off with range, and dodging.
            </span>
            <span className="block pt-1.5 gt-dim">
              Colours: green is easy (under 45 s), gold workable (45 s to 2 min), red not worth it (over 2 min) or
              impossible (&ldquo;never&rdquo;: the hull can&rsquo;t be killed). Target figures are the ship as it comes
              from the factory.
            </span>
          </span>
        </span>
      </p>
    </section>
  );
}

function Breakdown({
  title,
  t,
  r,
  accuracy,
}: {
  title: string | null;
  t: GameToolsShip;
  r: KillResult;
  accuracy: number;
}) {
  const armour = t.armourHp ?? 0;
  return (
    <div className="flex flex-col gap-1.5">
      {title && <span className="gt-label gt-label-acc">{title}</span>}
      <span className="text-sm gt-dim">At {pct(accuracy)} of shots hitting.</span>
      <span>
        Shields ({fmt(t.shieldHp)}){' '}
        {isFinite(r.shieldSeconds) ? (
          r.seconds < r.shieldSeconds ? (
            'never need to drop: ballistic damage through them kills it first.'
          ) : (
            <>
              down after <span className="gt-mono gt-hi">{formatKillTime(r.shieldSeconds)}</span>.
            </>
          )
        ) : (
          'never drop.'
        )}
      </span>
      {armour > 0 && (
        <span>
          Armour ({fmt(armour)}, counted as one pool){' '}
          {isFinite(r.armourSeconds) ? (
            <>
              gone after <span className="gt-mono gt-hi">{formatKillTime(r.armourSeconds)}</span>.
            </>
          ) : (
            'never worn through.'
          )}
        </span>
      )}
      <span>
        Each volley: <span className="gt-mono gt-hi">{fmt(r.volleyShield)}</span> to shields,{' '}
        <span className="gt-mono gt-hi">{fmt(r.volleyThrough)}</span> past them,{' '}
        <span className="gt-mono gt-hi">{fmt(r.volleyHull)}</span> to armour and hull once they&rsquo;re down.
      </span>
      {r.firstSlowdown != null && (
        <span>
          The first gun drops to its sustained rate after{' '}
          <span className="gt-mono gt-hi">{formatKillTime(r.firstSlowdown)}</span> (overheat or empty capacitor).
        </span>
      )}
      <span>
        {r.stopped.length ? (
          <>
            Its armour stops {[...new Set(r.stopped)].join(', ')}: shots at or below {fmt(t.deflection.physical)}{' '}
            ballistic / {fmt(t.deflection.energy)} energy damage.
          </>
        ) : (
          'Its armour doesn’t stop any of these guns.'
        )}
      </span>
      <span>
        Main hull ({fmt(t.hullHp)}) gone after <span className="gt-mono gt-hi">{formatKillTime(r.seconds)}</span>.
      </span>
    </div>
  );
}
