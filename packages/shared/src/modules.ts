// The modules a server can switch on and off (v1.28.0). Platform admins can
// also hide a module for every server from the admin panel
// (AdminConfig.hiddenModules): a hidden module behaves as switched off
// everywhere (no link, page, settings tile or data), whatever each server chose.

export const PLATFORM_MODULES = [
  { setting: 'eventBotEnabled', label: 'Event Bot' },
  { setting: 'dkpEnabled', label: 'DKP & Auctions' },
  { setting: 'lootEnabled', label: 'Loot' },
  { setting: 'exchangeEnabled', label: 'Marketplace' },
  { setting: 'fleetEnabled', label: 'Fleet' },
  { setting: 'blueprintsEnabled', label: 'Blueprints' },
  { setting: 'craftingEnabled', label: 'Crafting Calculator' },
  { setting: 'wikeloEnabled', label: 'Wikelo' },
  { setting: 'activityEnabled', label: 'Activity' },
  { setting: 'jobsEnabled', label: 'Job Board' },
  { setting: 'tournamentsEnabled', label: 'Tournaments' },
] as const;

/** A module's switch in GuildSettings ("fleetEnabled"). */
export type ModuleSetting = (typeof PLATFORM_MODULES)[number]['setting'];

const SETTINGS = new Set<string>(PLATFORM_MODULES.map((m) => m.setting));
export const isModuleSetting = (v: unknown): v is ModuleSetting => typeof v === 'string' && SETTINGS.has(v);

/** AdminConfig.hiddenModules (JSON) → the hidden modules, unknown entries dropped. */
export function parseHiddenModules(raw: string | null | undefined): ModuleSetting[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? [...new Set(v.filter(isModuleSetting))] : [];
  } catch {
    return [];
  }
}

export interface AdminModuleDto {
  setting: ModuleSetting;
  label: string;
  hidden: boolean;
  /** Servers that have it switched on themselves (what they get back when it's shown again) */
  serversOn: number;
}

/** A server's settings as everything else should read them: hidden modules switched off. */
export function withHiddenModules<T extends Record<string, unknown> | null>(settings: T, hidden: ReadonlySet<ModuleSetting>): T {
  if (!settings || hidden.size === 0) return settings;
  const out: Record<string, unknown> = { ...settings };
  for (const m of hidden) out[m] = false;
  return out as T;
}
