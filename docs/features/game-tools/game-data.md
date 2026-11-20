# Star Citizen game data (`apps/sc-data`)

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
- The API can't start the worker (it's a Railway cron job). "Check now"
  (v1.38.0, `POST /api/game-data/check`, `lib/gameDataCheck.ts`) asks GitHub
  for the head commit and compares it with `scdata_raw.state`, downloading and
  writing nothing; a moved head is synced by the next scheduled run anyway.
  "Full re-sync" queues a forced run (`sync_request`); `DELETE
  /api/game-data/sync` cancels it before it starts.
- The older `Sc*` Prisma tables (a copy of scunpacked in `public`) were
  removed from `schema.prisma` after v1.11.2, so `db push` dropped them. Don't
  bring them back; read `scdata`.
- Everything that shows game data reads `scdata` (v1.11.2): the bot's
  `/blueprint`, `/item` and `/material`, the SC Database page, and the
  Blueprints and Crafting Calculator pages (via `GET /api/game-data/crafting`,
  built by `packages/shared/src/crafting.ts`). The frozen JSON snapshot
  (`packages/shared/src/Filtered Data/`) is gone; don't bring it back.
