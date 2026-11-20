# ASOP Terminal — notes for Claude

## Versioning

ASOP uses semantic versioning, `MAJOR.MINOR.PATCH`, with one version for the
whole app (web, API, bot, workers).

- **Source of truth:** `"version"` in the root `package.json`. The API serves
  it at `/api/health`, the web footer shows it, and the bot's status embed
  shows it with the commit and when it was first deployed.
- **Only the maintainer changes the version** (it's a core file; see
  "Contributions and sections"). Bump it with
  `npm run version:bump -- <patch|minor|major>` (root `package.json` and
  `package-lock.json` together), based on everything merged since the last
  release:
  - `PATCH` (1.1.0 → 1.1.1): only fixes to existing behaviour.
  - `MINOR` (1.1.1 → 1.2.0): any new feature, command, setting or page.
  - `MAJOR` (1.2.0 → 2.0.0): big overhauls, or anything that needs server
    admins to do something (re-invite the bot, reconfigure channels…).
  - Internal-only changes (`Patch notes: none` throughout) don't bump.
- **Where the bump goes:** in the maintainer's own feature PR, as before; for
  contributors' PRs, in the next release PR (or the maintainer's next PR)
  after merging them. Every merge to `master` deploys (Railway), so merged
  contributor work runs under the previous version number until that bump;
  its patch notes are collected into the next release automatically.
  Contributors never edit `package.json`, `package-lock.json` or this file.
- **Tags and Releases are automatic** (after v1.55.0): `.github/workflows/release.yml`
  runs `scripts/release.mjs` on every push to `master`. Each version from
  v1.28.1 on that lacks its tag or its GitHub Release gets both: the tag on
  the commit where the version first appeared, the Release titled
  "Patch Notes — vX.Y.Z — <date>" with the patch notes of every commit since
  the version before, collected by the batching rules below
  (`scripts/releaseNotes.mjs`, tested in `scripts/test/`). Commits with no
  block are listed for checking. Don't tag by hand;
  `node scripts/release.mjs --dry-run` shows what it would do, and
  re-running the workflow from the Actions tab finishes a partial run.
- History: v1.0.0 = PR #15 (loot fixes, draft queue), the first versioned
  release. Everything before it is unversioned.

## Contributions and sections

The repo is open to contributors; the rules for them are in `CONTRIBUTING.md`
and are checked on every pull request to `master` (`.github/workflows/guardrails.yml`).

- **Sections:** `scripts/sections.config.mjs` maps every file to one of the
  feature sections (loot, events, game-tools, …), to **core** (maintainer
  only: root files, `.github/`, `scripts/`, `package.json`s, `prisma/`, app
  infrastructure, sign-in and permission checks) or to **wiring** (shared
  registration files such as `App.tsx`, `server/app.ts`, the bot's `index.ts`,
  `shared/src/index.ts`, `myData.ts`, where a feature may change a few
  lines). `node scripts/sections.mjs report` lists where everything goes;
  `which <file>` checks one file.
- **Scope check** (`Guardrails / Scope`): one section per PR, no core files,
  wiring within its allowance, at most 30 files. The maintainer's
  `scope-override` label accepts a PR that has to do more (most of the
  maintainer's own feature work, schema changes, refactors).
- **Schema safety** (`Guardrails / Schema safety`): diffs `schema.prisma`
  with `prisma migrate diff` and fails on anything that drops or retypes data
  or would fail on a table with rows, until the `schema-reviewed` label is
  added. Production runs `db push --accept-data-loss` (see Railway), so that
  label means "the data has been moved first".
- **A new file** gets its section from its name (keywords) or folder; a file
  no rule claims is core. Name new files after their feature, and add new
  areas to `sections.config.mjs`.
- **CODEOWNERS** is generated from the same map: after changing
  `sections.config.mjs`, run `node scripts/sections.mjs codeowners` (CI
  fails if it's stale). Add a section's reviewers in its `owners`.
- **Feature notes** live in `docs/features/<section>/` (imported below), so a
  feature PR documents itself without touching this file. Keep this file for
  rules that apply across sections.
- **Formatting:** Prettier (`.prettierrc.json`, width 120). `npm run format`
  formats, `npm run format:check` is part of CI. The one-time formatting
  commit is listed in `.git-blame-ignore-revs`.

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
- Contributors put the block in the pull request description (the template
  asks for it). Merge their PRs with **Squash and merge**: the squash commit
  message is the PR title and description, so the block lands in `master`'s
  history where the release script finds it.

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

5. Each version's GitHub Release already holds these notes (see
   Versioning), so a single release can be copied from there; batch by hand
   only when several releases go out in one announcement.

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

- `.github/workflows/ci.yml` runs on every push and pull request: formatting
  (`npm run format:check`), shared build and tests, the scripts' tests,
  `lint` (type-check) of api, bot, web and sc-data, the API tests against
  Postgres, and the website build. Wait for it to pass before merging a pull
  request. Pull requests also run the Guardrails (see "Contributions and
  sections").
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

## Your Discord servers (v1.25.1)

- A person's server list (`GET /users/@me/guilds`, tightly rate-limited per
  person) comes only from `getUserGuilds()` in `apps/api/src/lib/userGuilds.ts`:
  one cache, one Discord call per person at a time, short 429s waited out and
  retried, long ones served from the last list. `/auth/me` (2 min) and
  `assertGuildManager` (30 min, plus the session copy) both use it; never call
  `fetchDiscordGuilds` directly. If nothing is cached and Discord says wait,
  `assertGuildManager` marks the request so its 403 becomes a 503 "try again".

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

## Feature notes

One file per feature, by section (imported, so they load with this file).

### Events
- Role waitlists (v1.14.0): @docs/features/events/waitlists.md
- Calendar feed (v1.16.0): @docs/features/events/calendar-feed.md
- Maybe sign-ups (v1.17.0): @docs/features/events/maybe-sign-ups.md
- After-action notes (v1.19.0): @docs/features/events/after-action.md
- Mission briefings (v1.36.0): @docs/features/events/briefings.md
- Event templates (v1.41.0): @docs/features/events/templates.md

### Loot
- Loot results and the event thread (v1.22.0): @docs/features/loot/loot-results.md

### Allies
- Joint ops: server tags (v1.20.0): @docs/features/allies/joint-ops-tags.md

### Members
- Member history (v1.18.0): @docs/features/members/member-history.md

### Job board
- Job board (v1.21.0): @docs/features/jobs/job-board.md

### Fleets
- Fleets (v1.32.0): @docs/features/fleet/fleets.md

### Activity
- Activity heat maps (v1.24.0): @docs/features/activity/heat-maps.md

### Trading
- UEX prices and routes (v1.42.0): @docs/features/trading/uex.md

### Game Tools and game data
- Star Citizen game data (`apps/sc-data`): @docs/features/game-tools/game-data.md
- Crafting Calculator (v1.26.0): @docs/features/game-tools/crafting-calculator.md
- Blueprints page (v1.27.0): @docs/features/game-tools/blueprints.md
- Wikelo (v1.34.0): @docs/features/game-tools/wikelo.md
- StarStrings (v1.35.0): @docs/features/game-tools/starstrings.md
- Game Tools (v1.44.0, ship-first since v1.45.0, in the dashboard since v1.46.0): @docs/features/game-tools/game-tools.md
- Community corrections (v1.53.0): @docs/features/game-tools/corrections.md

### AI assistant
- AI assistant (v1.56.0): @docs/features/assistant/assistant.md

### Admin
- Uploaded images (v1.40.0): @docs/features/admin/uploaded-images.md
