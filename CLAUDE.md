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
  card on the server page until done or hidden (`GuildSettings.setupHidden`),
  and always on Module Settings. A new channel setting the bot needs belongs
  in the checklist too.
- When the bot joins a server it DMs "Welcome to ASOP!" to whoever added it
  (`services/welcomeService.ts`).

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
