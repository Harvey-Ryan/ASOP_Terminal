// Activity (RoleCall) only has data for the servers RoleCall tracks (v1.25.0).
// Everywhere else the module doesn't exist: no link, page, settings or data.
// ACTIVITY_SERVER_IDS: comma-separated Discord server ids; defaults to Fleet 919.

const DEFAULT_IDS = '1497395378495160493';
let cache: { raw: string; ids: Set<string> } | null = null;

export function activityAvailable(guildId: string): boolean {
  const raw = process.env['ACTIVITY_SERVER_IDS'] ?? DEFAULT_IDS;
  if (cache?.raw !== raw) cache = { raw, ids: new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)) };
  return cache.ids.has(guildId);
}
