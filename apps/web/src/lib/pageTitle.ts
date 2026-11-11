// The browser tab's title for each dashboard page (v1.12.0), so several open
// tabs can be told apart: "Loot draft · ASOP – ASOP Terminal".

const SITE = 'ASOP Terminal';

// First match wins; paths are relative to /dashboard/servers/:guildId.
const SERVER_PAGES: [RegExp, string][] = [
  [/^\/events\/new$/, 'New event'],
  [/^\/events\/[^/]+\/loot$/, 'Loot draft'],
  [/^\/events\/[^/]+\/audit$/, 'Event review'],
  [/^\/loot\/sessions\/[^/]+$/, 'Loot session'],
  [/^\/loot$/, 'Loot'],
  [/^\/auctions$/, 'Auction'],
  [/^\/dkp$/, 'DKP'],
  [/^\/marketplace$/, 'Marketplace'],
  [/^\/fleet$/, 'Fleet'],
  [/^\/roster$/, 'RSI Roster'],
  [/^\/jobs$/, 'Job Board'],
  [/^\/members\/me$/, 'My history'],
  [/^\/members(\/[^/]+)?$/, 'Members'],
  [/^\/activity$/, 'Activity'],
  [/^\/traffic$/, 'Traffic'],
  [/^\/tournaments$/, 'Tournaments'],
  [/^\/map$/, 'Member Map'],
  [/^\/blueprints$/, 'Blueprints'],
  [/^\/crafting-calculator(\/.*)?$/, 'Crafting Calculator'],
  [/^\/settings\/allies$/, 'Allies'],
  [/^\/settings\/game-data$/, 'Game Data'],
  [/^\/settings\/sc-data$/, 'SC Database'],
  [/^\/settings\/permissions$/, 'Permissions'],
  [/^\/settings\/bot$/, 'Bot Settings'],
  [/^\/settings\/modules\/jobs$/, 'Job Board settings'],
  [/^\/settings\/modules(\/.*)?$/, 'Module Settings'],
  [/^$/, 'Events'],
];

/** "Page · Server – ASOP Terminal" for a dashboard path; the server name is optional. */
export function pageTitle(pathname: string, serverName?: string | null): string {
  const server = pathname.match(/^\/dashboard\/servers\/[^/]+(.*)$/);
  if (server) {
    const rest = server[1]!.replace(/\/$/, '');
    const page = SERVER_PAGES.find(([re]) => re.test(rest))?.[1];
    const parts = [page, serverName].filter(Boolean).join(' · ');
    return parts ? `${parts} – ${SITE}` : SITE;
  }
  if (pathname.startsWith('/dashboard/kanban')) return `Roadmap – ${SITE}`;
  const admin = pathname.match(/^\/dashboard\/admin(?:\/(\w+))?(\/[^/]+)?/);
  if (admin) {
    const section = { errors: admin[2] ? 'Error' : 'Errors', servers: admin[2] ? 'Server' : 'Servers', activity: 'Activity', feed: 'Discord feed' }[admin[1] ?? ''] ?? 'Overview';
    return `Admin · ${section} – ${SITE}`;
  }
  if (pathname.startsWith('/dashboard/settings/notifications')) return `Notifications – ${SITE}`;
  if (pathname.startsWith('/dashboard')) return `Dashboard – ${SITE}`;
  return SITE;
}
