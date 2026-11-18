// Game Tools ships (v1.45.0): one ship-first place. /tools is the ship
// picker (search, recently viewed, common ships, browse all). A ship's page
// has its numbers, an editable loadout and what it can kill, all together;
// Compare puts a second ship beside it (?vs=<class>), with one kill table.
// v1.47.0: Erkul-style page: summary bar, cards by system, a swap window per
// slot (guns, components, missiles) and the ship's panels.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CombatGun, GameToolsShip } from '@dem/shared';
import { fmt, pilotSlots, readRecentShips, rememberShip, shortShipName, useGameTools } from '../../lib/gameTools';
import { useToolsPaths } from '../../lib/toolsPaths';
import { ToolsDataState } from './ToolsLayout';
import { COMMON_TARGETS, KillTable } from './KillTable';
import { LoadoutCards, ShipPanels, SummaryBar, SummaryGrid, Swap, useLoadout, type LoadoutState, type SwapTarget } from './ShipLoadout';

const pilotAlpha = (s: GameToolsShip, gunsByUuid: Map<string, CombatGun>) =>
  pilotSlots(s).reduce((sum, slot) => sum + (slot.stockGunUuid ? gunsByUuid.get(slot.stockGunUuid)?.alpha ?? 0 : 0), 0);

// ── Search: the ship picker ──────────────────────────────────────────────────

export function ShipSearch({ ships, onPick, placeholder = 'Find a ship: gladius, m80, cutlass…', big = false, autoFocus = false }: {
  ships: GameToolsShip[]; onPick: (s: GameToolsShip) => void; placeholder?: string; big?: boolean; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const id = useRef(`gt-s-${Math.random().toString(36).slice(2, 8)}`).current;
  const results = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!w.length) return [];
    return ships.filter((s) => w.every((x) => `${s.name} ${s.role ?? ''} ${s.career ?? ''}`.toLowerCase().includes(x))).slice(0, 10);
  }, [ships, q]);
  const choose = (s: GameToolsShip) => { setQ(''); setHi(0); onPick(s); };
  return (
    <div className="relative flex flex-col">
      <div className="flex items-center gap-3 pb-2" style={{ borderBottom: `${big ? 2 : 1}px solid var(--gt-acc)` }}>
        <span aria-hidden="true" className={`gt-mono gt-acc ${big ? 'text-2xl' : 'text-lg'}`}>&rsaquo;</span>
        <input
          type="search" autoComplete="off" autoFocus={autoFocus} value={q} placeholder={placeholder}
          role="combobox" aria-expanded={results.length > 0} aria-controls={id} aria-label="Find a ship"
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter' && results[hi]) { e.preventDefault(); choose(results[hi]!); }
            else if (e.key === 'Escape') setQ('');
          }}
          className={`flex-1 min-w-0 bg-transparent border-0 outline-none gt-mono gt-hi ${big ? 'text-xl sm:text-[26px]' : 'text-base'}`}
        />
      </div>
      {results.length > 0 && (
        <ul id={id} role="listbox" className="absolute top-full left-0 right-0 z-20 m-0 p-0 list-none max-h-[420px] overflow-y-auto" style={{ background: 'var(--gt-bg)', border: '1px solid var(--gt-line)' }}>
          {results.map((s, i) => (
            <li key={s.uuid} role="option" aria-selected={i === hi}>
              <button type="button" onClick={() => choose(s)} onMouseEnter={() => setHi(i)}
                className={`w-full text-left grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-3 py-2.5 border-0 cursor-pointer ${i === hi ? 'gt-tint' : ''}`}
                style={{ background: i === hi ? undefined : 'transparent', color: 'inherit', font: 'inherit', borderBottom: '1px solid var(--gt-faint)' }}>
                <span><span className="gt-hi font-medium">{s.name}</span> <span className="gt-dim text-sm">{s.role ?? s.career ?? ''}</span></span>
                <span className="gt-mono gt-dim text-xs self-center">shields {fmt(s.shieldHp)} · hull {fmt(s.hullHp)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── /tools: pick a ship ──────────────────────────────────────────────────────

type SortKey = 'name' | 'size' | 'shieldHp' | 'hullHp' | 'alpha' | 'cargo';

export function ShipsHomePage() {
  const paths = useToolsPaths();
  const shipPath = (s: Pick<GameToolsShip, 'className'>) => paths.ship(s.className);
  const { data, index, isLoading, error } = useGameTools();
  const navigate = useNavigate();
  const [browse, setBrowse] = useState(false);
  const [sort, setSort] = useState<SortKey>('name');
  const recent = useMemo(readRecentShips, []);

  if (!data || !index) return <ToolsDataState isLoading={isLoading} error={error} />;
  const by = index.shipsByClass;
  const recentShips = recent.map((c) => by.get(c)).filter((s): s is GameToolsShip => !!s);
  const common = COMMON_TARGETS.slice(0, 12).map((c) => by.get(c.toLowerCase())).filter((s): s is GameToolsShip => !!s);

  const rows = [...data.ships].map((s) => ({ s, alpha: pilotAlpha(s, index.gunsByUuid) })).sort((a, b) => {
    if (sort === 'name') return a.s.name.localeCompare(b.s.name);
    const v = (r: typeof a) => (sort === 'alpha' ? r.alpha : sort === 'size' ? r.s.size ?? 0 : (r.s[sort] as number | null) ?? -1);
    return v(b) - v(a);
  });
  const th = (key: SortKey, label: string, num = true) => (
    <th className={num ? 'num' : ''}><button type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>{label}</button></th>
  );
  const shipRow = (s: GameToolsShip) => (
    <Link key={s.uuid} to={shipPath(s)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 gt-row no-underline">
      <span><span className="gt-hi font-medium">{s.name}</span> <span className="gt-dim text-sm">{s.role ?? s.career ?? ''}</span></span>
      <span className="gt-mono gt-dim text-sm">shields {fmt(s.shieldHp)} · hull {fmt(s.hullHp)} · alpha {fmt(pilotAlpha(s, index.gunsByUuid))}</span>
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-10 pt-12 pb-12 flex flex-col gap-12">
      <section aria-label="Find a ship" className="flex flex-col gap-3">
        <h1 className="gt-label m-0">Pick a ship</h1>
        <ShipSearch ships={data.ships} onPick={(s) => navigate(shipPath(s))} big autoFocus />
        <p className="m-0 text-sm gt-dim">{fmt(data.ships.length)} ships from the game files. Pick one to see its numbers, change its loadout and see what it can kill.</p>
      </section>

      {recentShips.length > 0 && (
        <section aria-labelledby="gt-recent-h" className="flex flex-col gap-3">
          <h2 id="gt-recent-h" className="gt-label m-0">Recently viewed</h2>
          <div className="flex flex-wrap gap-2">
            {recentShips.map((s) => <Link key={s.uuid} to={shipPath(s)} className="gt-btn">{shortShipName(s)}</Link>)}
          </div>
        </section>
      )}

      <section aria-labelledby="gt-common-h" className="flex flex-col">
        <h2 id="gt-common-h" className="gt-label m-0 pb-2">Common ships</h2>
        {common.map(shipRow)}
      </section>

      <section aria-labelledby="gt-all-h" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="gt-all-h" className="gt-label m-0">All ships</h2>
          <button type="button" className="gt-link text-sm" onClick={() => setBrowse(!browse)}>{browse ? 'Hide the list' : `Browse all ${data.ships.length}`}</button>
        </div>
        {browse && (
          <div className="gt-scroll">
            <table className="gt-table min-w-[760px]">
              <thead><tr>{th('name', 'Ship', false)}<th>Role</th>{th('size', 'Size')}{th('shieldHp', 'Shields')}{th('hullHp', 'Hull')}{th('alpha', 'Pilot alpha')}{th('cargo', 'Cargo')}</tr></thead>
              <tbody>
                {rows.map(({ s, alpha }) => (
                  <tr key={s.uuid}>
                    <td><Link to={shipPath(s)} className="gt-hi font-medium no-underline hover:underline">{s.name}</Link></td>
                    <td className="gt-dim">{s.role ?? s.career ?? ''}</td>
                    <td className="num">{fmt(s.size)}</td>
                    <td className="num">{fmt(s.shieldHp)}</td>
                    <td className="num">{fmt(s.hullHp)}</td>
                    <td className="num gt-hi">{alpha ? fmt(alpha) : '–'}</td>
                    <td className="num">{fmt(s.cargo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

// ── /tools/ships/:className: one ship, or two side by side ──────────────────

export function ShipPage() {
  const paths = useToolsPaths();
  const shipPath = (s: Pick<GameToolsShip, 'className'>) => paths.ship(s.className);
  const { className = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data, index, isLoading, error } = useGameTools();
  const ship = index?.shipsByClass.get(className.toLowerCase()) ?? null;
  const vs = params.get('vs');
  const other = vs ? index?.shipsByClass.get(vs.toLowerCase()) ?? null : null;
  const maps = [index?.gunsByUuid ?? new Map(), index?.componentsByUuid ?? new Map(), index?.missilesByUuid ?? new Map()] as const;
  const a = useLoadout(ship, 's', ...maps);
  const b = useLoadout(other, 'c', ...maps);
  const [open, setOpen] = useState<{ side: 'a' | 'b'; target: SwapTarget } | null>(null);
  const [copied, setCopied] = useState(false);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => { if (ship) rememberShip(ship.className); }, [ship]);
  useEffect(() => { setOpen(null); }, [ship?.uuid, other?.uuid]);

  if (!data || !index) return <ToolsDataState isLoading={isLoading} error={error} />;
  if (!ship || !a) return <p className="gt-dim px-5 sm:px-10 py-16">That ship isn&rsquo;t in this game build. <Link className="gt-link" to={paths.ships}>Pick another</Link></p>;

  const COMPARE_KEYS = /^c[km]?\d+$/;
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else { n.delete(k); if (k === 'vs') for (const key of [...n.keys()]) if (COMPARE_KEYS.test(key)) n.delete(key); }
    setParams(n, { replace: true });
  };
  const compareWith = (s: GameToolsShip) => { setChoosing(false); const n = new URLSearchParams(params); for (const k of [...n.keys()]) if (COMPARE_KEYS.test(k)) n.delete(k); n.set('vs', s.className.toLowerCase()); setParams(n, { replace: true }); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ }
  };
  // Swap sides: each loadout moves with its ship.
  const changesOf = (lo: LoadoutState, prefix: string, n: URLSearchParams) => {
    lo.equipped.forEach((g, i) => { if (g && g.uuid !== lo.stock[i]?.uuid) n.set(`${prefix}${i}`, g.uuid); });
    lo.compFitted.forEach((c, i) => { if (c && c.uuid !== lo.compStock[i]?.uuid) n.set(`${prefix}k${i}`, c.uuid); });
    lo.misFitted.forEach((m, i) => { if (m && m.uuid !== lo.misStock[i]?.uuid) n.set(`${prefix}m${i}`, m.uuid); });
  };
  const swap = () => {
    if (!other || !b) return;
    const n = new URLSearchParams();
    n.set('vs', ship.className.toLowerCase());
    changesOf(b, 's', n);
    changesOf(a, 'c', n);
    navigate(`${shipPath(other)}?${n.toString()}`, { replace: true });
  };

  const meta = (s: GameToolsShip) => [s.maker, s.role ?? s.career, s.size != null ? `size ${s.size}` : null, s.crew != null ? `${s.crew} crew` : null].filter(Boolean).join(' · ');
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {!other && (choosing
        ? <div className="min-w-[280px]"><ShipSearch ships={data.ships.filter((s) => s.uuid !== ship.uuid)} onPick={compareWith} placeholder="Compare with…" autoFocus /></div>
        : <button type="button" className="gt-btn gt-btn-primary" onClick={() => setChoosing(true)}>Compare</button>)}
      {other && <button type="button" className="gt-btn" onClick={swap}>Swap sides</button>}
      <button type="button" className="gt-btn" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
    </div>
  );
  const openLo = open?.side === 'b' ? b : a;
  const swapWindow = open && openLo && (
    <Swap key={JSON.stringify(open)} lo={openLo} target={open.target} guns={data.guns} components={data.components ?? []} missiles={data.missiles ?? []} onClose={() => setOpen(null)} />
  );
  const changeLine = (lo: LoadoutState) => (
    <>
      {lo.changes ? `${lo.changes} change${lo.changes === 1 ? '' : 's'} from stock` : 'Stock loadout'}
      {lo.changes > 0 && <> · <button type="button" className="gt-link" onClick={lo.reset}>Back to stock</button></>}
    </>
  );

  // ── Two ships ──
  if (other && b) {
    const side = (lo: LoadoutState, key: 'a' | 'b') => (
      <section aria-label={lo.ship.name} className="flex-[1_1_440px] min-w-0 flex flex-col gap-6 px-5 sm:px-8 py-6" style={key === 'a' ? { borderRight: '1px solid var(--gt-line)' } : undefined}>
        <div className="flex items-start gap-4">
          {lo.ship.thumbUrl || lo.ship.imageUrl
            ? <img src={lo.ship.thumbUrl ?? lo.ship.imageUrl ?? ''} alt="" className="w-28 h-16 object-cover rounded-sm shrink-0" />
            : null}
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="gt-label">{meta(lo.ship)}</span>
            <h2 className="m-0 text-2xl font-bold gt-hi"><Link to={shipPath(lo.ship)} className="no-underline">{shortShipName(lo.ship)}</Link></h2>
            <span className="text-sm gt-dim">
              {changeLine(lo)}
              {key === 'b' && <> · <button type="button" className="gt-link" onClick={() => setParam('vs', null)}>Stop comparing</button></>}
            </span>
          </div>
        </div>
        <SummaryGrid lo={lo} />
        <LoadoutCards lo={lo} narrow active={open?.side === key ? open.target : null} onOpen={(target) => setOpen({ side: key, target })} />
        <ShipPanels lo={lo} />
      </section>
    );
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-10 py-4 border-b" style={{ borderColor: 'var(--gt-line)' }}>
          <h1 className="m-0 text-lg font-semibold gt-hi">{shortShipName(ship)} <span className="gt-dim font-normal">vs</span> {shortShipName(other)}</h1>
          {toolbar}
        </div>
        <div className="flex flex-wrap">{side(a, 'a')}{side(b, 'b')}</div>
        <div className="px-5 sm:px-10 py-8 border-t" style={{ borderColor: 'var(--gt-line)' }}>
          <KillTable loadouts={[{ name: shortShipName(ship), guns: a.guns }, { name: shortShipName(other), guns: b.guns }]} ships={data.ships} />
        </div>
        {swapWindow}
      </>
    );
  }

  // ── One ship ──
  return (
    <>
      <div
        className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-5 sm:px-10 pb-6 border-b"
        style={{
          borderColor: 'var(--gt-line)', minHeight: 220,
          background: ship.imageUrl ? `linear-gradient(to top, var(--gt-bg) 10%, transparent 75%), url("${ship.imageUrl}") center/cover` : 'var(--gt-faint)',
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className="gt-label">{meta(ship)}{ship.cargo ? ` · ${fmt(ship.cargo)} SCU` : ''}</span>
          <h1 className="m-0 text-4xl sm:text-5xl font-bold gt-hi">{shortShipName(ship)}</h1>
          <span className="text-sm gt-dim">
            {changeLine(a)}
            {ship.imageUrl && <> · Picture: Roberts Space Industries</>}
          </span>
        </div>
        {toolbar}
      </div>
      <SummaryBar lo={a} />
      <div className="flex flex-wrap">
        <div className="flex-[999_1_620px] min-w-0 box-border px-5 sm:pl-10 sm:pr-8 py-7 flex flex-col gap-10">
          <LoadoutCards lo={a} active={open?.target ?? null} onOpen={(target) => setOpen({ side: 'a', target })} />
          <KillTable loadouts={[{ name: shortShipName(ship), guns: a.guns }]} ships={data.ships} />
        </div>
        <aside aria-label="Ship stats" className="flex-[1_1_380px] lg:max-w-[460px] box-border px-5 sm:pl-7 sm:pr-10 py-7" style={{ borderLeft: '1px solid var(--gt-line)' }}>
          <ShipPanels lo={a} />
        </aside>
      </div>
      {swapWindow}
    </>
  );
}
