// Where the game tools live (v1.46.0). Every tool (Ships, Crafting,
// Blueprints, Wikelo) works in two places: inside a server's dashboard
// (/dashboard/servers/:guildId/...) and on the public Game Tools site
// (/tools/...). Pages build their links from here so they stay where the
// person is. The public site provides its paths; anywhere else they come
// from the server in the address.

import { createContext, useContext } from 'react';
import { useParams } from 'react-router-dom';

export interface ToolsPaths {
  /** True on the public /tools site. */
  standalone: boolean;
  ships: string;
  ship: (className: string) => string;
  /** Mining (v1.49.0). */
  mining: string;
  crafting: string;
  blueprints: string;
  wikelo: string;
}

const lower = (c: string) => encodeURIComponent(c.toLowerCase());

export const PUBLIC_TOOLS_PATHS: ToolsPaths = {
  standalone: true,
  ships: '/tools',
  ship: (c) => `/tools/ships/${lower(c)}`,
  mining: '/tools/mining',
  crafting: '/tools/crafting',
  blueprints: '/tools/blueprints',
  wikelo: '/tools/wikelo',
};

export function serverToolsPaths(guildId: string): ToolsPaths {
  const base = `/dashboard/servers/${guildId}`;
  return {
    standalone: false,
    ships: `${base}/ships`,
    ship: (c) => `${base}/ships/${lower(c)}`,
    mining: `${base}/mining`,
    crafting: `${base}/crafting-calculator`,
    blueprints: `${base}/blueprints`,
    wikelo: `${base}/wikelo`,
  };
}

export const ToolsPathsContext = createContext<ToolsPaths | null>(null);

export function useToolsPaths(): ToolsPaths {
  const given = useContext(ToolsPathsContext);
  const { guildId } = useParams<{ guildId?: string }>();
  return given ?? (guildId ? serverToolsPaths(guildId) : PUBLIC_TOOLS_PATHS);
}
