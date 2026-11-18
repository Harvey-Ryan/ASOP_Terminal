// Game Tools home (v1.44.0): one search over ships and guns, the tools list,
// the org pitch and the theme picker.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { botInviteUrl } from '@dem/shared';
import { useAuth } from '../../hooks/useAuth';
import { fmt, shipPath, useGameTools } from '../../lib/gameTools';
import { ThemePicker, ToolsDataState } from './ToolsLayout';

const INVITE_URL = botInviteUrl(import.meta.env.VITE_DISCORD_CLIENT_ID ?? '');

const TOOLS = [
  { to: '/tools/ships', name: 'Ships', desc: 'Every ship’s shields, hull, guns, speed and quantum drive. Pick one to see what it can kill.' },
  { to: '/tools/loadout', name: 'Loadout', desc: 'Swap every gun on a ship and see damage, alpha and what the loadout can kill, live.' },
  { to: '/tools/optimizer', name: 'Optimizer', desc: 'Pick a target and a goal; ASOP tries every legal loadout and shows the best ones.' },
];

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

export function ToolsHomePage() {
  const { data, isLoading, error } = useGameTools();
  const { user } = useAuth();
  const [q, setQ] = useState('');

  const results = useMemo(() => {
    const w = words(q);
    if (!data || !w.length) return null;
    const hit = (text: string) => { const t = text.toLowerCase(); return w.every((x) => t.includes(x)); };
    const sizeWord = q.match(/\bs(?:ize)?\s*(\d+)\b/i);
    const size = sizeWord ? Number(sizeWord[1]) : null;
    const plain = q.replace(/\bs(?:ize)?\s*\d+\b/i, '');
    const wp = words(plain);
    const hitPlain = (text: string) => { const t = text.toLowerCase(); return wp.every((x) => t.includes(x)); };
    return {
      ships: data.ships.filter((s) => hit(`${s.name} ${s.role ?? ''} ${s.career ?? ''}`)).slice(0, 12),
      guns: data.guns.filter((g) => (size == null || g.size === size) && hitPlain(`${g.name} ${g.maker ?? ''} ${g.kind} ${g.className}`)).slice(0, 12),
    };
  }, [data, q]);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 sm:px-10 pt-14 pb-12 flex flex-col gap-14">
      <section aria-label="Search" className="flex flex-col gap-3.5">
        <label htmlFor="gt-find" className="gt-label">Find a ship or a gun</label>
        <div className="flex items-center gap-4 pb-2.5" style={{ borderBottom: '2px solid var(--gt-acc)' }}>
          <span aria-hidden="true" className="gt-mono gt-acc text-2xl">&rsaquo;</span>
          <input
            id="gt-find" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="gladius · size 3 repeater · scattergun"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none gt-mono gt-hi text-xl sm:text-[26px]"
          />
        </div>
        <p className="m-0 text-sm gt-dim">
          {data ? <>{fmt(data.ships.length)} ships and {fmt(data.guns.length)} ship guns from the game files · no sign-in needed</> : 'From the game files · no sign-in needed'}
        </p>
      </section>

      <ToolsDataState isLoading={isLoading && !!q} error={error} />

      {results && (
        <section aria-label="Results" className="flex flex-col gap-8">
          {results.ships.length > 0 && (
            <div className="flex flex-col">
              <h2 className="gt-label gt-label-acc m-0 pb-2">Ships</h2>
              {results.ships.map((s) => (
                <Link key={s.uuid} to={shipPath(s)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 gt-row no-underline">
                  <span><span className="gt-hi font-medium">{s.name}</span> <span className="gt-dim text-sm">{s.role ?? s.career ?? ''}</span></span>
                  <span className="gt-mono gt-dim text-sm">shields {fmt(s.shieldHp)} · hull {fmt(s.hullHp)}</span>
                </Link>
              ))}
            </div>
          )}
          {results.guns.length > 0 && (
            <div className="flex flex-col">
              <h2 className="gt-label gt-label-acc m-0 pb-2">Ship guns</h2>
              <div className="gt-scroll">
                <table className="gt-table min-w-[620px]">
                  <thead><tr><th>Gun</th><th>Size</th><th>Type</th><th className="num">Sustained</th><th className="num">Burst</th><th className="num">Alpha</th></tr></thead>
                  <tbody>
                    {results.guns.map((g) => (
                      <tr key={g.uuid}>
                        <td><span className="gt-hi font-medium">{g.name}</span><span className="block text-xs gt-dim">{g.maker}{g.variants ? ` · +${g.variants} skins` : ''}</span></td>
                        <td className="gt-mono">S{g.size}</td>
                        <td className="gt-dim">{g.kind}{g.pellets > 1 ? ` · ${g.pellets} pellets` : ''}</td>
                        <td className="num gt-hi">{fmt(g.sustainedDps)}</td>
                        <td className="num">{fmt(g.burstDps)}</td>
                        <td className="num">{fmt(g.alpha)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!results.ships.length && !results.guns.length && <p className="gt-dim m-0">Nothing matches &ldquo;{q}&rdquo;.</p>}
        </section>
      )}

      {!results && (
        <section aria-labelledby="gt-tools-h" className="flex flex-col">
          <h2 id="gt-tools-h" className="gt-label m-0 pb-2.5">Tools</h2>
          {TOOLS.map((t) => (
            <Link key={t.to} to={t.to} className="grid gap-x-6 gap-y-1 py-4 gt-rule no-underline sm:grid-cols-[220px_minmax(0,1fr)] items-baseline">
              <span className="text-lg font-semibold gt-hi">{t.name}</span>
              <span className="leading-relaxed">{t.desc}</span>
            </Link>
          ))}
          <div className="gt-rule" />
          <p className="text-sm gt-dim mt-4 mb-0">Coming next: components, mining, trade and crafting in one place.</p>
        </section>
      )}

      {!user && (
        <section aria-labelledby="gt-org-h" className="flex flex-wrap gap-x-16 gap-y-6 items-start">
          <div className="flex-[1_1_360px] flex flex-col gap-2.5">
            <h2 id="gt-org-h" className="gt-label gt-label-acc m-0">Better with your org</h2>
            <p className="m-0 text-xl leading-snug gt-hi max-w-[540px]">ASOP runs Star Citizen orgs on Discord: events, sign-ups, loot, fleets and mission briefings.</p>
          </div>
          <div className="flex flex-col gap-3 pt-5">
            <a href={INVITE_URL} className="gt-btn">Add ASOP to your server</a>
            <a href="/login" className="text-sm gt-dim">Already use it? Sign in</a>
          </div>
        </section>
      )}

      <section className="gt-rule pt-5">
        <ThemePicker />
        <p className="text-xs gt-dim mt-3 mb-0">Palettes inspired by each maker&rsquo;s cockpit displays. Saved in this browser.</p>
      </section>
    </main>
  );
}
