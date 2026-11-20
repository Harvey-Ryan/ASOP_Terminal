// Game Tools (v1.44.0): the public /tools site. Ships needs no sign-in;
// Crafting, Blueprints and Wikelo (v1.46.0) ask people to sign in first. Its
// own look (tools.css), with themes. The same tools also live inside each
// server's dashboard (Ships through `DashboardToolsFrame` below); links follow
// whichever place the person is in (`lib/toolsPaths.ts`).

import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ApiResponse } from '@dem/shared';
import { api } from '../../api/client';
import { authApi } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';
import { GAME_TOOLS_THEMES, readTheme, saveTheme, useGameTools, type GameToolsTheme } from '../../lib/gameTools';
import { PUBLIC_TOOLS_PATHS, ToolsPathsContext, useToolsPaths } from '../../lib/toolsPaths';
import { BuildBadge, DataViewToggle } from './corrections';
import './tools.css';

const ThemeContext = createContext<{ theme: GameToolsTheme; setTheme: (t: GameToolsTheme) => void }>({
  theme: 'asop',
  setTheme: () => {},
});
export const useToolsTheme = () => useContext(ThemeContext);

function ThemeProvider({ children }: { children: (theme: GameToolsTheme) => ReactNode }) {
  const [theme, setThemeState] = useState<GameToolsTheme>(readTheme);
  const setTheme = (t: GameToolsTheme) => {
    setThemeState(t);
    saveTheme(t);
  };
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children(theme)}</ThemeContext.Provider>;
}

/** Tools an admin hid for every server (Admin → Modules) get no tab. */
function useHiddenTools(): Set<string> {
  const { data } = useQuery({
    queryKey: ['game-tools', 'hidden'],
    queryFn: async () => (await api.get<ApiResponse<{ hidden: string[] }>>('/game-tools/hidden')).data!,
    staleTime: 5 * 60_000,
  });
  return new Set(data?.hidden ?? []);
}

export function ToolsLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const { data } = useGameTools();
  const hidden = useHiddenTools();
  const p = PUBLIC_TOOLS_PATHS;
  const tabs = [
    { to: p.ships, label: 'Ships', on: location.pathname === '/tools' || location.pathname.startsWith('/tools/ships') },
    { to: p.mining, label: 'Mining', on: location.pathname.startsWith(p.mining) },
    { to: p.crafting, label: 'Crafting', on: location.pathname.startsWith(p.crafting), module: 'craftingEnabled' },
    {
      to: p.blueprints,
      label: 'Blueprints',
      on: location.pathname.startsWith(p.blueprints),
      module: 'blueprintsEnabled',
    },
    { to: p.wikelo, label: 'Wikelo', on: location.pathname.startsWith(p.wikelo), module: 'wikeloEnabled' },
    { to: '/tools/corrections', label: 'Corrections', on: location.pathname.startsWith('/tools/corrections') },
  ].filter((t) => !t.module || !hidden.has(t.module));

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const prev = document.title;
    document.title = 'Game Tools – ASOP Terminal';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <ToolsPathsContext.Provider value={PUBLIC_TOOLS_PATHS}>
      <ThemeProvider>
        {(theme) => (
          <div className="gt" data-theme={theme}>
            <header
              className="flex flex-wrap items-center justify-between gap-x-7 gap-y-0 px-5 sm:px-10 border-b"
              style={{ borderColor: 'var(--gt-line)', minHeight: 60 }}
            >
              <Link to="/tools" className="flex items-baseline gap-2.5 no-underline py-3">
                <span className="font-bold tracking-[0.12em] gt-hi">ASOP</span>
                <span className="gt-label gt-label-acc">Game Tools</span>
              </Link>
              {/* Its own row below the header until everything fits on one line
                  (about 1300px; v1.59.1: at laptop widths it was squeezed to a few tabs). */}
              <nav
                aria-label="Game Tools"
                className="flex gap-x-5 overflow-x-auto order-last w-full min-[1320px]:order-none min-[1320px]:w-auto min-[1320px]:flex-1 min-w-0"
              >
                {tabs.map((t) => (
                  <Link key={t.to} to={t.to} className="gt-tab" aria-current={t.on ? 'page' : undefined}>
                    {t.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center gap-3 py-2">
                <BuildBadge />
                <DataViewToggle />
              </div>
              <ThemeMenu />
              {user ? (
                <a href="/dashboard" className="text-sm gt-hi py-3">
                  Dashboard
                </a>
              ) : (
                <a
                  href={authApi.loginUrl(location.pathname + location.search)}
                  className="gt-btn gt-btn-primary whitespace-nowrap"
                >
                  Sign in<span className="hidden sm:inline"> with Discord</span>
                </a>
              )}
            </header>

            <Suspense fallback={<p className="gt-dim px-5 sm:px-10 py-16">Loading…</p>}>
              <Outlet />
            </Suspense>

            <ToolsFooter build={data?.build ?? null} />
          </div>
        )}
      </ThemeProvider>
    </ToolsPathsContext.Provider>
  );
}

function ToolsFooter({ build }: { build: string | null }) {
  return (
    <footer className="px-5 sm:px-10 py-5 text-xs gt-dim border-t" style={{ borderColor: 'var(--gt-line)' }}>
      Game data: Star Citizen Wiki (scunpacked)
      {build ? (
        <>
          {' '}
          · build <span className="gt-mono">{build}</span>
        </>
      ) : null}{' '}
      · Prices: UEX Corp, player-reported · Not affiliated with Cloud Imperium Games
    </footer>
  );
}

/**
 * Crafting, Blueprints and Wikelo on the public site (v1.46.0): signed-in
 * people get the page (in a padded frame, as in the dashboard); everyone
 * else a sign-in prompt that brings them back here.
 */
export function SignInForTool({ name, children }: { name: string; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <p className="gt-dim px-5 sm:px-10 py-16">Loading…</p>;
  if (!user) {
    return (
      <section className="px-5 sm:px-10 py-16 flex flex-col items-start gap-4 max-w-[560px]">
        <span className="gt-label gt-label-acc">{name}</span>
        <h1 className="m-0 text-3xl font-bold gt-hi">Sign in to use {name}</h1>
        <p className="m-0 gt-dim leading-relaxed">
          {name} is part of ASOP Terminal. Sign in with your Discord account to open it. Ships and Mining stay open to
          everyone.
        </p>
        <a href={authApi.loginUrl(location.pathname + location.search)} className="gt-btn gt-btn-primary">
          Sign in with Discord
        </a>
      </section>
    );
  }
  return <div className="p-6">{children}</div>;
}

/**
 * Ships inside a server's dashboard (v1.46.0): the same pages as /tools, in the
 * Game Tools look, with the theme menu and a link to the page on its own.
 */
export function DashboardToolsFrame() {
  const paths = useToolsPaths();
  const location = useLocation();
  const { data } = useGameTools();
  // Ships or Mining (v1.49.0); "Open on its own page" goes to the same page on the public site.
  const mining = location.pathname.startsWith(paths.mining);
  const prefix = mining ? paths.mining : paths.ships;
  const rest = location.pathname.startsWith(prefix) ? location.pathname.slice(prefix.length) : '';
  const standalone = mining
    ? `/tools/mining${location.search}`
    : `${rest ? `/tools/ships${rest}` : '/tools'}${location.search}`;
  const title = mining ? 'Mining' : 'Ships & Loadouts';
  return (
    <ThemeProvider>
      {(theme) => (
        <div className="gt -m-6" data-theme={theme} style={{ minHeight: 'calc(100% + 3rem)' }}>
          <div
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 sm:px-10 border-b"
            style={{ borderColor: 'var(--gt-line)', minHeight: 52 }}
          >
            <Link to={prefix} className="no-underline py-2.5">
              <span className="gt-label gt-label-acc">{title}</span>
            </Link>
            <div className="flex flex-wrap items-center gap-4">
              <BuildBadge />
              <DataViewToggle />
              <a href={standalone} className="text-sm gt-dim">
                Open on its own page
              </a>
              <ThemeMenu />
            </div>
          </div>
          <Suspense fallback={<p className="gt-dim px-5 sm:px-10 py-16">Loading…</p>}>
            <Outlet />
          </Suspense>
          <ToolsFooter build={data?.build ?? null} />
        </div>
      )}
    </ThemeProvider>
  );
}

/** Theme choice in the header: a small menu of maker-inspired palettes. */
function ThemeMenu() {
  const { theme, setTheme } = useToolsTheme();
  const ref = useRef<HTMLDetailsElement>(null);
  const current = GAME_TOOLS_THEMES.find((t) => t.id === theme) ?? GAME_TOOLS_THEMES[0];
  return (
    <details ref={ref} className="relative py-3">
      <summary className="gt-btn list-none cursor-pointer" style={{ minHeight: 36 }} aria-label="Colour theme">
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: current.swatch }} />
        <span className="hidden sm:inline">Theme</span>
      </summary>
      <div
        className="absolute right-0 z-30 mt-2 flex flex-col p-1 min-w-[170px]"
        style={{ background: 'var(--gt-bg)', border: '1px solid var(--gt-line)' }}
      >
        {GAME_TOOLS_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={theme === t.id}
            onClick={() => {
              setTheme(t.id);
              ref.current?.removeAttribute('open');
            }}
            className="gt-slot"
            style={{ minHeight: 40 }}
          >
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: t.swatch }} />
            <span>{t.label}</span>
          </button>
        ))}
        <span className="text-[11px] gt-dim px-2 py-1.5">Inspired by each maker&rsquo;s cockpit displays</span>
      </div>
    </details>
  );
}

/** Loading and "not loaded yet" states shared by every tools page. */
export function ToolsDataState({ isLoading, error }: { isLoading: boolean; error: unknown }) {
  if (isLoading) return <p className="gt-dim px-5 sm:px-10 py-16">Loading game data…</p>;
  if (error)
    return (
      <p className="gt-dim px-5 sm:px-10 py-16">
        Game data isn&rsquo;t available right now. Try again in a few minutes.
      </p>
    );
  return null;
}
