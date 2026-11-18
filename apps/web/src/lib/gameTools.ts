// Game Tools (v1.44.0): the shared data, theme and small helpers for the
// public /tools pages. The data is one cached file per game build
// (GET /api/game-tools/data); every calculation runs here in the browser
// with packages/shared/src/combat.ts.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiResponse, CombatGun, GameToolsDataDto, GameToolsShip, GunSlot } from '@dem/shared';
import { api } from '../api/client';

export function useGameTools() {
  const q = useQuery({
    queryKey: ['game-tools', 'data'],
    queryFn: async () => (await api.get<ApiResponse<GameToolsDataDto>>('/game-tools/data')).data!,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
  });
  const index = useMemo(() => {
    const d = q.data;
    if (!d) return null;
    return {
      gunsByUuid: new Map(d.guns.map((g) => [g.uuid, g])),
      shipsByClass: new Map(d.ships.map((s) => [s.className.toLowerCase(), s])),
    };
  }, [q.data]);
  return { ...q, index };
}

/** Guns that fit a slot, best sustained first. */
export function gunsForSlot(guns: CombatGun[], slot: GunSlot): CombatGun[] {
  return guns.filter((g) => g.size >= slot.minSize && g.size <= slot.maxSize);
}

/** The ship's pilot-flown gun slots (crewed and remote turrets are left out of the maths). */
export function pilotSlots(ship: GameToolsShip): GunSlot[] {
  return ship.gunSlots.filter((s) => !s.turret);
}

/** "Anvil Arrow" → "Arrow" when the maker is known. */
export function shortShipName(ship: Pick<GameToolsShip, 'name' | 'maker'>): string {
  if (ship.maker && ship.name.startsWith(ship.maker + ' ')) return ship.name.slice(ship.maker.length + 1);
  // "Aegis Dynamics" makes the "Aegis Gladius": drop the shared first word.
  const first = ship.maker?.split(' ')[0];
  return first && ship.name.startsWith(first + ' ') ? ship.name.slice(first.length + 1) : ship.name;
}

export function shipPath(ship: Pick<GameToolsShip, 'className'>, page: 'ships' | 'loadout' | 'optimizer' = 'ships'): string {
  return `/tools/${page}/${encodeURIComponent(ship.className.toLowerCase())}`;
}

export const fmt = (n: number | null | undefined, digits = 0): string =>
  n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** "+18%" / "−4%" / "" when there's nothing to compare. */
export function pctChange(now: number, before: number): string {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return '';
  const v = Math.round((now / before - 1) * 100);
  if (v === 0) return '';
  return `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
}

// ── Themes ───────────────────────────────────────────────────────────────────

export const GAME_TOOLS_THEMES = [
  { id: 'asop', label: 'ASOP', swatch: '#d4a32a' },
  { id: 'drake', label: 'Drake', swatch: '#ff8a1f' },
  { id: 'origin', label: 'Origin', swatch: '#1f7a72' },
  { id: 'rsi', label: 'RSI', swatch: '#5cb0ff' },
  { id: 'aegis', label: 'Aegis', swatch: '#e2554f' },
  { id: 'anvil', label: 'Anvil', swatch: '#9ad25a' },
  { id: 'misc', label: 'MISC', swatch: '#3cc9c1' },
] as const;
export type GameToolsTheme = (typeof GAME_TOOLS_THEMES)[number]['id'];

const THEME_KEY = 'gt-theme';
export function readTheme(): GameToolsTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (GAME_TOOLS_THEMES.some((t) => t.id === v)) return v as GameToolsTheme;
  } catch { /* private window */ }
  return 'asop';
}
export function saveTheme(t: GameToolsTheme): void {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private window */ }
}

// The server the person came from, for the tabs that belong to a server
// (Crafting, Blueprints, Wikelo).
const SERVER_KEY = 'gt-server';
export function readToolsServer(): string | null {
  try { return localStorage.getItem(SERVER_KEY); } catch { return null; }
}
export function saveToolsServer(id: string): void {
  try { localStorage.setItem(SERVER_KEY, id); } catch { /* private window */ }
}
