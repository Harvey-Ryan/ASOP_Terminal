// The map of ASOP's sections: which files belong to which feature, which are
// core (maintainer-only), and which are shared "wiring" files a feature may
// touch a little. Read by scripts/sections.mjs (the PR scope check and the
// CODEOWNERS generator) — see CONTRIBUTING.md, "One section per pull request".
//
// How a file is placed, first rule that matches wins:
//   1. WIRING   — shared registration files; a PR may change a few lines.
//   2. CORE     — everything only the maintainer changes.
//   3. a section's `files`    (exact paths)
//   4. a section's `keywords` (case-insensitive, matched against the file name;
//                              earlier sections win ties)
//   5. a section's `dirs`     (folder globs)
//   6. anything else is CORE, so a new, unmapped file needs the maintainer.
// Every section also owns docs/features/<id>/**.
//
// Globs: `*` = anything but `/`, `**` = any number of folders.
// After editing, run `node scripts/sections.mjs codeowners` to regenerate
// .github/CODEOWNERS, and `node scripts/sections.mjs report` to check the map.

/** Default owner of everything; also the owner of CORE and WIRING. */
export const MAINTAINERS = ['@Harvey-Ryan'];

export const LIMITS = {
  /** A PR may touch at most this many files (labels can override). */
  maxFiles: 30,
  /** Default lines (added + removed) a PR may change in one WIRING file. */
  wiringLines: 25,
};

export const LABELS = {
  /** Maintainer-only: lets a PR span sections, touch core, or exceed limits. */
  override: 'scope-override',
  /** Maintainer-only: accepts a schema change that can lose data or fail the deploy. */
  schemaReviewed: 'schema-reviewed',
};

/** Shared files every feature registers itself in. `lines` overrides LIMITS.wiringLines. */
export const WIRING = [
  { path: 'apps/web/src/App.tsx', lines: 40 },
  { path: 'apps/web/src/layouts/DashboardLayout.tsx' },
  { path: 'apps/web/src/components/HelpPanel.tsx', lines: 40 },
  { path: 'apps/web/src/pages/DashboardPage.tsx' },
  { path: 'apps/web/src/pages/ServerPage.tsx', lines: 40 },
  { path: 'apps/web/src/pages/settings/ModuleSettingsHubPage.tsx' },
  { path: 'apps/web/src/api/settings.ts' },
  { path: 'apps/api/src/server/app.ts' },
  { path: 'apps/api/src/server/routes/settings.ts', lines: 40 },
  { path: 'apps/api/src/__tests__/settings.test.ts', lines: 40 },
  { path: 'apps/api/src/lib/guildSettings.ts' },
  { path: 'apps/api/src/lib/myData.ts', lines: 60 },
  { path: 'apps/api/src/__tests__/myData.test.ts', lines: 80 },
  { path: 'apps/bot/src/index.ts', lines: 40 },
  { path: 'apps/bot/src/deploy.ts' },
  { path: 'apps/bot/src/internal.ts', lines: 40 },
  { path: 'apps/bot/src/scheduler.ts' },
  { path: 'apps/bot/src/commands/help.ts', lines: 40 },
  { path: 'apps/bot/src/services/commandService.ts' },
  { path: 'packages/shared/src/index.ts', lines: 40 },
  { path: 'packages/shared/src/modules.ts' },
  { path: 'packages/shared/src/setup.ts', lines: 40 },
  { path: 'packages/shared/test/setup.test.mjs', lines: 40 },
];

/** Maintainer-only: build, deploy, database, CI, docs for Claude, and app infrastructure. */
export const CORE = [
  // Repo, build and deploy
  '*', // every file in the repo root (package.json, CLAUDE.md, Dockerfile, …)
  '.github/**',
  'scripts/**',
  '**/package.json',
  '**/Dockerfile',
  '**/tsconfig*.json',
  '**/.env.example',
  '**/.gitignore',
  'apps/web/*', // vite, tailwind, postcss, index.html, components.json
  'apps/api/vitest.config.ts',
  // Database
  'apps/api/prisma/**',
  // API infrastructure, sign-in and permission checks
  'apps/api/src/index.ts',
  'apps/api/src/types/**',
  'apps/api/src/server/asyncErrors.ts',
  'apps/api/src/server/middleware/**',
  'apps/api/src/server/routes/auth.ts',
  'apps/api/src/server/routes/live.ts',
  'apps/api/src/lib/assert*.ts',
  'apps/api/src/lib/appVersion.ts',
  'apps/api/src/lib/discord-oauth.ts',
  'apps/api/src/lib/discordRest.ts',
  'apps/api/src/lib/live.ts',
  'apps/api/src/lib/memberRoles.ts',
  'apps/api/src/lib/platformAdmin.ts',
  'apps/api/src/lib/prisma.ts',
  'apps/api/src/lib/requestLogger.ts',
  'apps/api/src/lib/token-helpers.ts',
  'apps/api/src/lib/triggerBot.ts',
  'apps/api/src/lib/userGuilds.ts',
  'apps/api/src/lib/validate.ts',
  'apps/api/src/__tests__/factories.ts',
  'apps/api/src/__tests__/globalSetup.ts',
  'apps/api/src/__tests__/setup.ts',
  'apps/api/src/__tests__/health.test.ts',
  'apps/api/src/__tests__/authReturn.test.ts',
  'apps/api/src/__tests__/live.test.ts',
  'apps/api/src/__tests__/discordRest.test.ts',
  'apps/api/src/__tests__/userGuilds.test.ts',
  // Bot infrastructure
  'apps/bot/src/appVersion.ts',
  'apps/bot/src/client.ts',
  'apps/bot/src/db.ts',
  'apps/bot/src/commands/login.ts',
  'apps/bot/src/utils/embeds.ts',
  'apps/bot/src/utils/time.ts',
  // Website infrastructure
  'apps/web/@/**',
  'apps/web/src/main.tsx',
  'apps/web/src/index.css',
  'apps/web/src/globals.d.ts',
  'apps/web/src/api/auth.ts',
  'apps/web/src/api/client.ts',
  'apps/web/src/hooks/useAuth.ts',
  'apps/web/src/hooks/useDebounce.ts',
  'apps/web/src/components/ui/**',
  'apps/web/src/components/settings/**',
  'apps/web/src/components/CrashScreen.tsx',
  'apps/web/src/components/HoverPopover.tsx',
  'apps/web/src/components/LoadingScreen.tsx',
  'apps/web/src/components/ModuleGate.tsx',
  'apps/web/src/components/ProtectedRoute.tsx',
  'apps/web/src/lib/displayName.ts',
  'apps/web/src/lib/lazyPage.ts',
  'apps/web/src/lib/live.ts',
  'apps/web/src/lib/localDateTime.ts',
  'apps/web/src/lib/pageTitle.ts',
  'apps/web/src/lib/shade.ts',
  'apps/web/src/lib/utils.ts',
  'apps/web/src/pages/LoginPage.tsx',
  // Shared infrastructure
  'packages/shared/src/live.ts',
  'packages/shared/test/live.test.mjs',
  'packages/shared/test/returnPath.test.mjs',
];

/**
 * Feature sections, in priority order for keyword ties (more specific first).
 * `owners` are reviewers in CODEOWNERS besides the maintainers; empty = maintainers only.
 */
export const SECTIONS = [
  {
    id: 'assistant',
    name: 'AI assistant',
    owners: [],
    keywords: ['assistant', 'aikeys'],
  },
  {
    id: 'tournaments',
    name: 'Tournaments',
    owners: [],
    keywords: ['tournament', 'bracket', 'matchcard'],
    files: ['apps/api/src/lib/eloCalculator.ts'],
  },
  {
    id: 'activity',
    name: 'Activity, heat maps and member map',
    owners: [],
    keywords: ['rolecall', 'heatmap', 'activity', 'orghealth', 'membermap', 'memberpin'],
  },
  {
    id: 'allies',
    name: 'Allies and shared events',
    owners: [],
    keywords: ['allies', 'ally', 'alliance', 'shares', 'sharenotice', 'jointops'],
  },
  {
    id: 'jobs',
    name: 'Job board',
    owners: [],
    keywords: ['job'],
  },
  {
    id: 'fleet',
    name: 'Fleets',
    owners: [],
    keywords: ['fleet'],
    files: [
      'apps/api/src/lib/shipCatalog.ts',
      'packages/shared/src/ships.ts',
      'packages/shared/test/ships.test.mjs',
    ],
  },
  {
    id: 'loot',
    name: 'Loot, DKP and auctions',
    owners: [],
    keywords: ['loot', 'dkp', 'auction', 'wallet'],
    files: ['apps/bot/src/commands/bid.ts'],
  },
  {
    id: 'trading',
    name: 'Marketplace, exchange and UEX prices',
    owners: [],
    keywords: ['marketplace', 'exchange', 'uex', 'whohas'],
    files: ['apps/bot/src/commands/price.ts', 'apps/bot/src/commands/route.ts'],
  },
  {
    id: 'game-tools',
    name: 'Game Tools and game data (ships, mining, crafting, blueprints, Wikelo, corrections)',
    owners: [],
    keywords: [
      'gametools', 'gamedata', 'scdata', 'combat', 'missile', 'components', 'mining', 'refinery',
      'industry', 'crafting', 'blueprint', 'material', 'catalog', 'item', 'wikelo', 'starstring',
      'correction', 'killtable',
    ],
    files: [
      'apps/api/src/server/routes/sc.ts',
      'apps/web/src/api/sc.ts',
      'apps/web/src/lib/buildList.ts',
      'apps/web/src/lib/toolsPaths.ts',
      'apps/bot/src/utils/scUtils.ts',
    ],
    dirs: [
      'apps/sc-data/**',
      'apps/web/src/pages/tools/**',
      'apps/web/src/pages/crafting/**',
      'apps/web/src/pages/wikelo/**',
    ],
  },
  {
    id: 'events',
    name: 'Events, sign-ups, waitlists, briefings and templates',
    owners: [],
    keywords: [
      'event', 'rsvp', 'waitlist', 'briefing', 'template', 'calendar', 'recurrence', 'roster',
      'afteraction', 'tentative',
    ],
    files: [
      'packages/shared/src/ics.ts',
      'packages/shared/test/ics.test.mjs',
      'apps/bot/src/utils/setupRetry.ts',
    ],
    dirs: ['apps/web/src/pages/events/**'],
  },
  {
    id: 'members',
    name: 'Members, member history, RSI and personal settings',
    owners: [],
    keywords: ['member', 'rsi', 'notification', 'mydata', 'daterange'],
    files: ['apps/web/src/pages/RosterPage.tsx', 'apps/api/src/server/routes/rsiRoster.ts'],
  },
  {
    id: 'admin',
    name: 'Admin panel, setup, settings, images and errors',
    owners: [],
    keywords: [
      'admin', 'error', 'image', 'upload', 'setup', 'settings', 'hiddenmodules', 'kanban', 'welcome',
      'status', 'permissions',
    ],
    files: ['apps/web/src/pages/admin/AdminActivityPage.tsx'],
    dirs: ['apps/web/src/pages/admin/**', 'apps/web/src/pages/settings/**'],
  },
];
