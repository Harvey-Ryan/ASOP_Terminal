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
- The older `Sc*` Prisma tables are no longer read or synced (v1.11.1: the
  SC Database page reads `scdata`; the weekly download was removed). They're
  still in `schema.prisma` so `db push` keeps them until a clean-up release
  drops them. The frozen `packages/shared/src/Filtered Data/` JSON still
  exists; features are being moved over to `scdata` one at a time.
