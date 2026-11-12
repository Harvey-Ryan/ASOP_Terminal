# ASOP Terminal — notes for Claude

## Versioning

ASOP uses semantic versioning, `MAJOR.MINOR.PATCH`, with one version for the
whole app (web, API, bot, workers).

- **Source of truth:** `"version"` in the root `package.json`. The API serves
  it at `/api/health`, the web footer shows it, and the bot's status embed
  shows it with the commit and when it was first deployed.
- **A release is a merge to `master`** (Railway deploys it). Bump the version
  in the same PR, based on everything in it since the last release:
  - `PATCH` (1.1.0 → 1.1.1): only fixes to existing behaviour.
  - `MINOR` (1.1.1 → 1.2.0): any new feature, command, setting or page.
  - `MAJOR` (1.2.0 → 2.0.0): big overhauls, or anything that needs server
    admins to do something (re-invite the bot, reconfigure channels…).
  - Internal-only PRs (`Patch notes: none` throughout) don't bump.
- **Tag** the merge commit `vX.Y.Z` after it deploys, and push the tag.
- History: v1.0.0 = PR #15 (loot fixes, draft queue), the first versioned
  release. Everything before it is unversioned.

## Patch notes in every commit

Every commit carries the patch notes for its change in the commit message, so
announcements can be batched later. Write them for players and officers, not
developers: what changed in what they see or can do, and why it matters.

Put a `Patch notes:` block after the commit body and before any trailers
(`Co-Authored-By:` etc.). Each section is a `[Section Title]` line followed by
`* ` bullets; nest sub-points with three spaces + `* `.

```
feat(loot): per-item add-to-queue button

<technical body as usual>

Patch notes:
[Loot Draft Queue]
* Every unassigned item now has a + button to add it to your draft queue.
* Your queue only lists the items you've queued.

[Bug Fixes]
* Regular members no longer see loot officer buttons they couldn't use.
```

Rules:
- Section titles name the feature or area ("Alliance Share Security",
  "Thread Membership", "Event End — Loot Prompt"). Use `[Bug Fixes]` for
  fixes to existing behaviour. Reuse an existing title when the area matches.
- A bullet is a full sentence. Say what was wrong before when that's the
  point ("Previously it was possible to …").
- Internal-only changes (refactors, tests, CI, deps, docs) get
  `Patch notes: none` on its own line.
- No secrets, internal URLs, guild IDs or user names in patch notes.

## Batching patch notes (only when asked)

When asked for patch notes:

1. Range: from the previous `vX.Y.Z` tag to the release being announced
   (usually the newest tag on `master`), unless told otherwise.
2. Collect the blocks:
   `git log --reverse --format='%H%n%B%n==END==' <range>`
   and take everything between `Patch notes:` and the trailers.
   Skip `Patch notes: none`. For commits with no block, draft notes from the
   commit and diff, and point them out so they can be checked.
3. Merge sections with the same title, drop duplicate or superseded bullets
   (a fix to something added in the same batch isn't a separate bug fix),
   and put `Bug Fixes` last.
4. Output in this format, titled with the version and the release date:

```
Patch Notes — v1.1.0 — November 10
 Loot Draft Queue

* …

 Bug Fixes

* …
```

5. Versions are tagged when released (see Versioning), so no extra tag is
   needed for announcements.

## Errors and the admin panel (v1.13.0)

- Errors are stored in `ErrorEvent` (90 days) by `ErrorRecorder`
  (`packages/shared/src/errorLog.ts`): API `lib/errorLog.ts`, bot
  `utils/errorLog.ts`, browsers via `POST /api/client-errors`
  (`apps/web/src/lib/reportError.ts`). `console.error`/`console.warn` are
  recorded automatically, so log failures with them; don't swallow errors
  silently. Each API request and bot interaction has a ref (shown to users as
  "Ref XXXXXX"; `X-Request-Id`, `withRef()` in the bot).
- The admin panel is `/dashboard/admin` (web `pages/admin/`, API
  `routes/admin.ts`), for `PLATFORM_ADMIN_DISCORD_IDS` only (404 for everyone
  else). Admin setting changes go through `lib/guildSettings.ts`, the same code
  as the servers' own settings pages, and are written to `AdminLog`.
- The admin Discord feed (`AdminConfig`) is posted by the bot
  (`services/adminFeedService.ts`): joins/leaves, alerts for new or returning
  kinds of error, and a daily digest. A new kind of thing to report there
  goes into `AdminLog` with a new `kind` (add it to `ADMIN_LOG_KINDS`).

## Checks

- `.github/workflows/ci.yml` runs on every push and pull request: shared
  build and tests, `lint` (type-check) of api, bot, web and sc-data, the API
  tests against Postgres, and the website build. Wait for it to pass before
  merging a pull request.
- The API tests build their database with `prisma db push` (like production),
  not the migrations folder, which stopped being updated at v1.21.0.

## Railway

- Settings live in the Railway dashboard, not in the repo. Don't add a
  `railway.toml` / `railway.json`: Railway stopped supporting them for new
  services, stops reading them on 2026-12-01, and a root one is applied to
  every service from this repo (it once made the sc-data service build the
  main app). Per-service setup is in `RAILWAY.md`.
- The main Dockerfile runs `prisma db push --accept-data-loss` on start, which
  drops tables in `public` that `schema.prisma` doesn't model. Anything the app
  writes outside Prisma in `public` needs a matching model (see `Session`).
  The start command refuses to run without `DISCORD_TOKEN` and `SESSION_SECRET`.
- Because `db push` runs before any app code, data has to be moved out of a
  table one release before the release that removes its model (the old
  alliances: converted at start-up, then dropped in a later release).

## Star Citizen game data (`apps/sc-data`)

- Our copy of StarCitizenWiki/scunpacked-data lives in Postgres schemas
  `scdata` (clean tables; use these in the app) and `scdata_raw` (every
  upstream file + sync history). Details: `apps/sc-data/README.md`.
- These schemas are owned by the sc-data worker's own migrations, not Prisma.
  The API starts with `prisma db push --accept-data-loss`, which drops anything
  Prisma manages but doesn't see in `schema.prisma`. So:
  - read them with `prisma.$queryRaw` (or a small typed helper), or
  - if they're ever added to Prisma (`multiSchema`), list only `scdata`, model
    every table exactly as it exists, and never add `scdata_raw`.
- Filter `items.is_placeholder = false` for anything players see.
- The older `Sc*` Prisma tables (a copy of scunpacked in `public`) were
  removed from `schema.prisma` after v1.11.2, so `db push` dropped them. Don't
  bring them back; read `scdata`.
- Everything that shows game data reads `scdata` (v1.11.2): the bot's
  `/blueprint`, `/item` and `/material`, the SC Database page, and the
  Blueprints and Crafting Calculator pages (via `GET /api/game-data/crafting`,
  built by `packages/shared/src/crafting.ts`). The frozen JSON snapshot
  (`packages/shared/src/Filtered Data/`) is gone; don't bring it back.

## Role waitlists (v1.14.0)

- A full role gets a waitlist (`EventWaitlist`, one line per person per event,
  line order = id). People waiting stay on the roster with their current role.
- Rules are in `packages/shared/src/roster.ts` (`planWaitlistMoves`). Every
  roster change runs `fillFromWaitlist` inside the transaction that holds the
  event row (`lockEvent`): API `lib/waitlist.ts`, bot
  `services/waitlistService.ts` (keep the two in step). The bot DMs whoever
  moved in; the API asks it to with `/trigger/waitlist-moved/:eventId`.

## Setup checklist (v1.15.0)

- What a server still needs is decided in `packages/shared/src/setup.ts`
  (`setupChecklist`), including the bot's Discord permissions in the channels
  it was given (`channelPermissions`). The admin panel's "looks unfinished"
  list is the same checklist without the Discord checks (`setupProblems`).
- Officers see it via `GET /api/guilds/:guildId/setup` (null for others): a
  card on the server page until hidden (`GuildSettings.setupHidden`), and on
  Module Settings. Once the required steps are done it shows nowhere (v1.22.1);
  every successful mutation re-checks it (`MutationCache.onSuccess` in
  `main.tsx`). A new channel setting the bot needs belongs
  in the checklist too.
- When the bot joins a server it DMs "Welcome to ASOP!" to whoever added it
  (`services/welcomeService.ts`).
- Easier setup (v1.29.0):
  - The invite asks for `BOT_PERMISSIONS` (`setup.ts`, `botInviteUrl()`),
    not Administrator. A feature that needs a new Discord permission adds it
    there (and to RAILWAY.md's invite table), and to the checklist if it can
    be missing.
  - A server new to ASOP starts with DKP and Tournaments off (bot
    `GuildCreate` creates its settings row); existing rows are untouched.
  - Channel steps in `CREATABLE_CHANNELS` get `create` and a "Create it"
    button: `POST /api/guilds/:guildId/setup/create/:key` makes the channel
    with the bot token (`discordPost`, never retried) and saves it through
    `applySettingsPatch`.

## Calendar feed (v1.16.0)

- Each person's events (the ones they're on the roster for, from 30 days ago
  on, not cancelled) are an iCalendar feed at `/api/calendar/<token>.ics`
  (`routes/calendar.ts`, built by `packages/shared/src/ics.ts`). Calendar apps
  fetch it without signing in, so `User.calendarToken` is the key: keep it out
  of logs (the request log masks it) and let people reset it (Notification
  Settings).

## Maybe sign-ups (v1.17.0)

- `EventRsvp.tentative` = "Maybe": on the roster, always without a role, so a
  maybe never takes a slot. Picking a role or Unassigned (or joining a
  waitlist) makes it a yes; saying maybe leaves any waitlist. Maybes get the
  reminder DM (worded for them) and show as tentative in the calendar feed.

## Member history (v1.18.0)

- `GET /api/guilds/:guildId/members` (officers who can create events) and
  `/members/:userId` (them, or anyone for `me`): `routes/members.ts`, rules in
  `packages/shared/src/memberHistory.ts`. Only the server's own events count.
- `?from=&to=` (ISO moments, `parseHistoryRange` / `rangeWhere`) limit the list
  and a member's history to a date range (v1.23.0): events by start time, loot,
  DKP changes and tournaments by date; the DKP balance is always today's. The
  website keeps the range in the URL (`DateRangeFilter.tsx`) in the viewer's
  own days.
- Attendance counts only where it was recorded: `confirmedAttendees` (the
  check after an event), else `vcAttendees` if anyone was in voice. Events
  with neither are "not recorded", never no-shows; maybes are never no-shows.

## After-action notes (v1.19.0)

- `Event.aarOutcome` (SUCCESS | PARTIAL | FAILED) and `aarNotes`, written by
  the host's event creators once an event has ended (on the attendance check
  or later: `PUT …/after-action`). Shown on the event and in the final
  summary embed in Discord (`/trigger/after-action/:eventId` redoes it).
- `EventComment`: one comment per person who attended (or signed up, where
  attendance wasn't recorded: `canComment` in `memberHistory.ts`); officers
  can remove any.

## Joint ops: server tags (v1.20.0)

- `EventRsvp.guildId` is the Discord server someone signed up from (website
  viewing server, button's server, the Discord event they clicked Interested
  on; null from a voice-channel join = treated as the host).
- On an event shared with allies (`EventAllianceGuild` rows in the bot,
  accepted `EventGuildShare` in the API), rosters tag everyone with their
  server (`serverLabel`: ally tag, else name) and show a headcount per server
  (`serverHeadcount` / `serverTagOf` in `roster.ts`). Not shared = no tags.

## Job board (v1.21.0)

- `Job` / `JobCrew` (`routes/jobs.ts`, rules in `packages/shared/src/jobs.ts`):
  any member posts; a job is seen by its server (SERVER), its allies too
  (ALLIES) or every ASOP server (GLOBAL); taking is checked with the job row
  held so crews never overfill; the poster closes it (DONE/CANCELLED), the
  home server's managers can take it down; open jobs expire after 7 days
  (bot `expireJobs`).
- The bot posts jobs in `GuildSettings.jobsChannelId` (optional) of the home
  server and, for ALLIES/GLOBAL jobs, of its allies (never unrelated servers;
  they see GLOBAL jobs on the website). `/trigger/job/:id` re-syncs the posts
  (`Job.messages`) and, with `{ taken }`, DMs the poster.

## Module audit (v1.21.1)

- Every `/api/guilds/:guildId/...` route checks the person against that
  server, not only "signed in": readers need `assertEventViewer`, officers
  `assertEventCreator`, settings `assertModuleEditor` (`lib/`). Activity
  (`routes/rolecall.ts` passes on only whitelisted parameters), the Member Map
  and Tournaments (one middleware on `/:guildId/tournaments`) were fixed here.
  A new route gets the same check.
- Request logging (`RequestLog`) is off unless `REQUEST_LOG=on`; the table
  stays modelled and pruned, and its numbers show on the admin overview (the
  old Traffic page was removed in v1.28.3). The admin overview's
  "people signed in" counts live sessions.
- Nominatim (member map search) goes through `nominatim()` in
  `routes/memberPins.ts`: one request at a time, ≥1.1 s apart, cached a day.
- Platform-admin-only things use `isPlatformAdminId` / `useAuth().isPlatformAdmin`
  (roadmap board, the tournament Lifecycle Test); never a hard-coded id.

## Times and time zones (v1.21.2)

- Show times in each person's own time zone: Discord timestamps (`<t:…>`) in
  the bot, the browser's zone on the website. Never print a UTC time as
  text; where a time can't be a timestamp (an image, a select menu), put it
  in the message as a timestamp or say it relatively ("Started 2 h ago").
- `datetime-local` inputs: fill and read them with `toLocalInputValue` /
  `fromLocalInputValue` (`apps/web/src/lib/localDateTime.ts`), never
  `toISOString().slice(0, 16)` (that's UTC and shifts the time on save).
- `GuildSettings.timezone` is only the fallback for repeating events without
  `recurTimezone` (made before v1.12); it isn't a setup step.

## Loot results and the event thread (v1.22.0)

- Every way a loot session completes goes through `completeLootSession()` in
  `routes/loot.ts` (sets `LootSession.completedAt`, triggers `/trigger/loot`
  and `/trigger/loot-complete`). Don't set `status: 'COMPLETED'` directly.
- Event loot posts in the event's thread (and ally threads), which stay open
  until every winner is marked delivered or 72 h after `completedAt`
  (`closeLootThreadIfDone` / `checkLootThreadHolds` in the bot's
  `lootService.ts`; `threadClosedAt` marks it done). Nothing else should
  archive an event thread while that hold is running (see `checkAutoComplete`).
- Standalone sessions post in `GuildSettings.lootChannelId`, which is
  optional and not a setup step.

## Activity heat maps (v1.24.0)

- Activity (RoleCall, its heat maps included) exists only for the servers in
  `ACTIVITY_SERVER_IDS` (default: Fleet 919), via `activityAvailable()` in
  `apps/api/src/lib/activityAvailable.ts` (v1.25.0). Elsewhere
  `my-permissions` says `activityEnabled: false, activityAvailable: false`, the
  module is off in `assertModuleEnabled`, and the RoleCall proxy and the event
  heat map answer 404 (settings included). The website hides the link and the
  Module Settings tile, and asks RoleCall nothing until availability is known.

- Week × hour grids (row 0 = Sunday) in the viewer's time zone (default: the
  browser's). Server and member maps come from RoleCall (no unit: read them
  relative to the busiest hour); the event map is ours:
  `buildEventHeatmap` in `packages/shared/src/heatmap.ts`, with the
  member-history rules (recorded attendance only, average per event, show-up
  rate over sign-ups). `bestTimes` makes the "Busiest: …" lines.
- `HeatMap.tsx` takes `describe` (words for a square, shown on hover or tap)
  and `legend`; in ratio mode null = no events (grey), 0 = a real 0%.

## Your Discord servers (v1.25.1)

- A person's server list (`GET /users/@me/guilds`, tightly rate-limited per
  person) comes only from `getUserGuilds()` in `apps/api/src/lib/userGuilds.ts`:
  one cache, one Discord call per person at a time, short 429s waited out and
  retried, long ones served from the last list. `/auth/me` (2 min) and
  `assertGuildManager` (30 min, plus the session copy) both use it; never call
  `fetchDiscordGuilds` directly. If nothing is cached and Discord says wait,
  `assertGuildManager` marks the request so its 403 becomes a 503 "try again".

## Crafting Calculator (v1.26.0)

- One screen (`pages/CraftingCalculatorPage.tsx`, both routes): blueprints,
  the selected blueprint (a quality slider per part), and the build list
  (`lib/buildList.ts`, localStorage). Theme B "fabrication bay", scoped to
  `.fab` in `pages/crafting/fabrication.css`; keep other pages on the
  site's normal look.
- Where materials are mined: `packages/shared/src/materialSources.ts`
  (from `scdata.resource_locations`; main ore of each rock only), shipped in
  the crafting data as `materialSources`. When the crafting payload's shape or contents
  change, bump `DATA_VERSION` in `apps/api/src/lib/craftingData.ts` so
  browsers drop their cached copy.
- Place names (v1.26.1): mining places come from the location records, with
  Lagrange points named in full by body (`groupedPlaceName`, never "+N");
  mission places go through `cleanMissionLocations` in `crafting.ts` (rooms
  and sentences dropped, "the clinic inside X" → X, one name per place).
- The website knows its own version (`__APP_VERSION__`, from the root
  `package.json` via Vite) and sends it with error reports, so errors from a
  tab opened before a release can be told apart.


## Blueprints page (v1.27.0)

- `pages/BlueprintsPage.tsx` (`/blueprints` and `/blueprints/:blueprintUuid`):
  the calculator's blueprint list (`pages/crafting/browser.tsx`), then every
  mission that can give the picked blueprint (`pages/crafting/missions.tsx`,
  also the calculator's mission "Details"). Same `.fab` look.
- Mission rewards are only what the game files hold: `rewardItems` (scrip,
  gear), reputation, `enemies` (CombatSummary), `shareable`, `onceOnly`.
  aUEC payouts aren't in the files (the game sets them on accept): never
  estimate them.
- Difficulty words come from `difficultyWords()` in `crafting.ts`; title
  placeholders the game fills in ("[Location]") show as "‹location›".
- Blueprint search (`searchBlueprints`) matches every word in any order
  across name, type, subtype and maker, ignoring quotes.
- Quality curves (v1.28.1): most stats come in pieces (`ValueSegments`:
  0–500 ×0.8→×1.0, then 501–1000 ×1.0→×1.2); `QualityRange`/`ModifierRange`
  only describe the first piece. `adaptModifier()` keeps every piece and
  spans the whole range; read a stat with `statAt()`. `linear_integer_additive`
  curves (Power Pips) add whole numbers (`curve: 'additive'`); modifiers with
  no range and no pieces are dropped.

## Modules hidden for every server (v1.28.0)

- The module list is `PLATFORM_MODULES` in `packages/shared/src/modules.ts`
  (each module's `GuildSettings` switch and its label). A new module goes
  there.
- Admin → Modules (`/dashboard/admin/modules`, `GET`/`PUT /api/admin/modules`)
  hides a module for every server: `AdminConfig.hiddenModules` (JSON list),
  logged as `admin.modules`. Servers keep their own switch, so showing it
  again restores their choice.
- Read it with `hiddenModules()`: API `lib/hiddenModules.ts` (15 s cache,
  cleared on change), bot `utils/hiddenModules.ts` (1 min). A hidden module
  is off in `assertModuleEnabled`, `my-permissions` (its `*Enabled` false,
  plus `hiddenModules`), the setup checklist (`withHiddenModules`), the
  bot's /help and job posts. The website hides its menu link and settings
  tile, and `ModuleGate` (in `App.tsx`) answers its routes with "isn't
  available" (event pages too since v1.28.3: new event and the audit page
  by the Event Bot, an event's loot page by Loot). A new module page or
  check gets the same treatment.

## Live updates (v1.30.0)

- Pages that used to poll every few seconds (loot sessions, DKP auctions,
  trade chat, the loot list and draft picks) keep one stream open instead:
  `GET /api/live?topics=…` (`routes/live.ts`), and refetch when told a
  topic changed (`useLiveQueries` in `apps/web/src/lib/live.ts`). While the
  stream is up they poll only every `LIVE_SAFETY_MS`; without it, at their
  old pace.
- Topics come from writes, not from route code: `installLiveUpdates`
  (`packages/shared/src/live.ts`) is a Prisma `$use` middleware in both the
  API and the bot that turns writes to `LIVE_MODELS` into topics and sends
  them with `pg_notify`; the API LISTENs on one extra Postgres connection
  (`lib/live.ts`). A new live page adds its models/topics to `LIVE_MODELS`
  (and `isLiveTopic`); server-wide topics (`liveTopicGuild`) are only given
  to people in that server. `$use` is gone in Prisma 6: moving there means
  a query extension instead.
- Notices say what changed, never the data; the page fetches it through
  the normal, access-checked routes.

## Your data (v1.31.0)

- Notification Settings → Your data: `GET /api/me/data` downloads
  everything about the signed-in person (every server, no tokens or calendar
  secret); `POST /api/me/delete { confirm: <Discord username> }` deletes it
  and signs them out everywhere (`routes/myData.ts`, `lib/myData.ts`).
- Delete removes what is only theirs and anonymises what other people's
  records rely on (loot handed out, DKP ledger, past attendance, auctions,
  trades, tournaments, jobs) to a one-off `deleted-…` id and
  "Deleted member". The User row stays as that tombstone (its discordId
  becomes the `deleted-…` id), so a new sign-in is a new person. Upcoming
  sign-ups are removed through the waitlist (`fillFromWaitlist`).
- **A new model or column that stores a person** (Discord id, User id,
  username, or ids inside a JSON column) must be added to both
  `exportMyData` and `deleteMyData`, and to `myData.test.ts`.
- Not covered: messages already posted in Discord, and RoleCall's activity
  data (a separate service).

## Fleets (v1.32.0)

- One fleet per person (`FleetOwner` by Discord id, `FleetShip` rows), shown
  in every ASOP server they're in (members from `getGuildMemberList()`),
  except servers in `hiddenGuildIds`; ships marked `available: false` never
  show to officers. Website: `routes/fleet.ts` (`/api/me/fleet…`,
  `/api/guilds/:guildId/fleet`, `/api/ships`), `pages/FleetPage.tsx`
  (`/dashboard/servers/:guildId/fleet` and `/dashboard/fleet`). Bot: `/fleet
  add | remove | mine | search` (`commands/fleet.ts`, `services/fleetService.ts`).
- The ship list is the `Ship` table: RSI's Ship Matrix (images, role, crew),
  refreshed at API start-up and daily by `refreshShipCatalog()`
  (`lib/shipCatalog.ts`); with RSI unreachable and no list, the game files
  (`scdata.ships`, no images) stand in. Ships RSI drops are `retired`, never
  deleted. After each refresh, `rematchFleetShips()` moves unmatched or
  game-file ships to RSI's entries.
- Names → ships, imports (Hangar Export / hangar.link JSON, FleetViewer
  layouts (`canvasItems` of type SHIP, v1.32.1), RSI hangar lists (Hangar
  XPLOR style: `ship_name` → nickname when `isCustomShipName`, `ship_code`
  tried when `name` doesn't match, v1.33.2), FleetYards-style JSON, plain text) and the check-in rule are in
  `packages/shared/src/ships.ts` (`matchShip`, `parseFleetImport`,
  `fleetCheckDue`). Unmatched imports are kept as `customName` for the owner
  to fix; they don't count in a server's fleet.
- Every change (or "Still correct") sets `checkedAt`. The bot DMs a
  "Still flying these?" check-in at most every `FLEET_CHECK_DAYS`
  (`checkFleetNudges`, posting loop, hourly); `FleetOwner.nudges` turns it
  off (Notification Settings, or the DM's "Stop asking").
- FleetYards linking is gone. `FleetEntry` (old per-server fleets) and
  `FleetyardsLink` are converted / emptied at start-up by
  `migrateOldFleets()` (`lib/fleetMigration.ts`); drop both models in the
  next release.
- Fleets for one event (v1.33.0): `GET /api/guilds/:guildId/fleet?eventId=`
  (the event must be the server's own or shared into it) and `/fleet search
  … event:` count the people signed up, allies included, never maybes, minus
  fleets hidden from the server each signed up from (`eventFleetPeople` in
  `ships.ts`). The website keeps the choice in `?event=`. Deliberately not on
  the event page or its Discord posts (fleets are too long there).
- Ship images load from `media.robertsspaceindustries.com` (allowed in the
  CSP `imgSrc`), credited on the page.

