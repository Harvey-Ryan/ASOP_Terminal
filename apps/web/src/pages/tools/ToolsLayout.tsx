// Game Tools (v1.44.0): the public /tools pages. No sign-in needed; signing
// in only adds the server-bound tools (Crafting, Blueprints, Wikelo) and a
// way back to the dashboard. Its own look (tools.css), with themes.

import { createContext, Suspense, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { settingsApi } from '../../api/settings';
import { GAME_TOOLS_THEMES, readTheme, readToolsServer, saveTheme, saveToolsServer, useGameTools, type GameToolsTheme } from '../../lib/gameTools';
import './tools.css';

const ThemeContext = createContext<{ theme: GameToolsTheme; setTheme: (t: GameToolsTheme) => void }>({ theme: 'asop', setTheme: () => {} });
export const useToolsTheme = () => useContext(ThemeContext);

const TABS = [
  { to: '/tools', label: 'Home', end: true },
  { to: '/tools/ships', label: 'Ships' },
  { to: '/tools/loadout', label: 'Loadout' },
  { to: '/tools/optimizer', label: 'Optimizer' },
];

export function ToolsLayout() {
  const [theme, setThemeState] = useState<GameToolsTheme>(readTheme);
  const setTheme = (t: GameToolsTheme) => { setThemeState(t); saveTheme(t); };
  const { user, guilds } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const { data } = useGameTools();

  // Arriving from a server's sidebar remembers that server for the server tabs.
  const fromServer = params.get('server');
  useEffect(() => { if (fromServer) saveToolsServer(fromServer); }, [fromServer]);
  const serverId = fromServer ?? readToolsServer();
  const server = user ? guilds.find((g) => g.id === serverId) ?? null : null;
  // The same module switches the sidebar uses (hidden modules included).
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', server?.id],
    queryFn: () => settingsApi.getMyPermissions(server!.id),
    enabled: !!server,
    staleTime: 5 * 60_000,
  });

  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const prev = document.title;
    document.title = 'Game Tools – ASOP Terminal';
    return () => { document.title = prev; };
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className="gt" data-theme={theme}>
        <header className="flex flex-wrap items-center justify-between gap-x-7 gap-y-0 px-5 sm:px-10 border-b" style={{ borderColor: 'var(--gt-line)', minHeight: 60 }}>
          <Link to="/tools" className="flex items-baseline gap-2.5 no-underline py-3">
            <span className="font-bold tracking-[0.12em] gt-hi">ASOP</span>
            <span className="gt-label gt-label-acc">Game Tools</span>
          </Link>
          <nav aria-label="Game Tools" className="flex gap-x-5 overflow-x-auto order-last w-full sm:order-none sm:w-auto sm:flex-1 min-w-0">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className="gt-tab">{t.label}</NavLink>
            ))}
            {server && (
              <>
                {perms?.craftingEnabled !== false && <a className="gt-tab" href={`/dashboard/servers/${server.id}/crafting-calculator`}>Crafting</a>}
                {perms?.blueprintsEnabled !== false && <a className="gt-tab" href={`/dashboard/servers/${server.id}/blueprints`}>Blueprints</a>}
                {perms?.wikeloEnabled !== false && <a className="gt-tab" href={`/dashboard/servers/${server.id}/wikelo`}>Wikelo</a>}
              </>
            )}
          </nav>
          {user ? (
            <span className="text-sm gt-dim py-3">
              {server ? <>{server.name} · </> : null}
              <a href={server ? `/dashboard/servers/${server.id}` : '/dashboard'} className="gt-hi">Dashboard</a>
            </span>
          ) : (
            <a href="/login" className="gt-btn gt-btn-primary">Sign in<span className="hidden sm:inline">&nbsp;with Discord</span></a>
          )}
        </header>

        <Suspense fallback={<p className="gt-dim px-5 sm:px-10 py-16">Loading…</p>}>
          <Outlet />
        </Suspense>

        <footer className="px-5 sm:px-10 py-5 text-xs gt-dim border-t" style={{ borderColor: 'var(--gt-line)' }}>
          Game data: Star Citizen Wiki (scunpacked){data?.build ? <> · build <span className="gt-mono">{data.build}</span></> : null} · Prices: UEX Corp, player-reported · Not affiliated with Cloud Imperium Games
        </footer>
      </div>
    </ThemeContext.Provider>
  );
}

export function ThemePicker() {
  const { theme, setTheme } = useToolsTheme();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="gt-label">Theme</span>
      {GAME_TOOLS_THEMES.map((t) => (
        <button key={t.id} type="button" className="gt-btn" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} style={{ minHeight: 36 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: t.swatch }} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Loading and "not loaded yet" states shared by every tools page. */
export function ToolsDataState({ isLoading, error }: { isLoading: boolean; error: unknown }) {
  if (isLoading) return <p className="gt-dim px-5 sm:px-10 py-16">Loading game data…</p>;
  if (error) return <p className="gt-dim px-5 sm:px-10 py-16">Game data isn&rsquo;t available right now. Try again in a few minutes.</p>;
  return null;
}
