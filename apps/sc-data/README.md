# sc-data worker

Keeps our own copy of [StarCitizenWiki/scunpacked-data](https://github.com/StarCitizenWiki/scunpacked-data)
(the wiki's extract of the Star Citizen game files) in Postgres, so the app can
build on all of it.

## What a run does

Railway runs it on the cron schedule set in the service's dashboard settings
(RAILWAY.md §4.5; currently daily, minimum every 5 minutes). Upstream is a repo
we don't own, so it can't send us a webhook; a run where nothing changed is one
tiny request. The web status card and the Discord status embed work out the
schedule from the gaps between recent runs, so changing it needs no code change.
"Check now" (SC Database page, platform admins) asks GitHub straight away
whether there's newer data, without downloading anything (`apps/api/src/lib/gameDataCheck.ts`);
a "Full re-sync" request (`scdata_raw.sync_request`, cancellable until it
starts) is picked up by the next scheduled run.

1. Applies its own schema migrations (`src/migrations.ts`).
2. Picks up any "Sync now" request from the web app (`scdata_raw.sync_request`);
   that forces step 4 even if upstream hasn't moved.
3. Reads the upstream head commit. Same commit as last time and no request →
   logs `no_change` and exits (about a second).
4. New commit → in **one transaction**:
   - streams the commit's tarball and writes only files whose bytes changed
     to `scdata_raw.file` (JSON is parsed by Postgres, not Node);
   - deletes files that disappeared upstream (refuses if that's more than 25%
     of our copy — a broken download must not wipe it);
   - rebuilds every clean `scdata.*` table from the raw files;
   - records the commit and build.

   Any error rolls everything back, so the app only ever sees a complete build.
   Readers are never blocked and never see empty tables mid-sync.

Only one run can happen at a time (Postgres advisory lock).

## Where the data lives

Two schemas, deliberately **not** `public`. The API container runs
`prisma db push --accept-data-loss` on start, which drops tables in `public`
that aren't in `schema.prisma`; Prisma leaves other schemas alone.

| Schema | Tables | Use |
|---|---|---|
| `scdata_raw` | `file` | Every upstream `.json` file as published (`content` jsonb), with sha256 and the commit it last changed in |
| | `file_change` | Per-commit history: which files were added / changed / removed |
| | `sync_run` | Every run: status, counts, invalid files, new upstream files that have no clean table yet. `no_change` rows are kept for 7 days |
| | `sync_request` | "Sync now" requests from the web app (platform admins only) |
| | `state` | The commit and build we hold |
| `scdata` | `items` | All 22k items (FPS + ship + everything else). `is_fps`, `is_ship_item`, `is_placeholder` flags; `raw_path` points at the item's full game entity in `scdata_raw.file` |
| | `ships`, `blueprints`, `contracts`, `factions`, `manufacturers` | |
| | `commodities`, `resources`, `resource_locations`, `commodity_trade_locations`, `trade_locations` | |
| | `starmap`, `starmap_positions`, `starmap_connections` | |
| | `tags`, `labels` | Tag tree and in-game text |
| | `source` | Commit / build of the data currently in the clean tables |

Every clean table keeps the full upstream record in `data` (jsonb); the other
columns are typed copies of the commonly used fields.

Upstream quirks handled here:

- About 7,000 items are named `<= PLACEHOLDER =>`. They're kept, flagged
  `is_placeholder`. Filter them out for anything players see.
- `starmap_positions` reuses one uuid for many positions (asteroid clusters,
  mining bases), so it is keyed by `idx` (position in the file).
- `labels.json` has a byte-order mark inside its first key; stripped.
- About 955 contracts are flagged `not_for_release` in the game files.

## Adding to it

- **New clean table or column:** add a new entry to `migrations.ts` (never
  edit one that has shipped) and an INSERT in `clean.ts`. Next run rebuilds it.
  To rebuild without waiting for a new upstream build, run once with
  `SC_DATA_FORCE=1`.
- **New upstream files** are stored raw automatically and listed in
  `sync_run.unmapped_paths` until a clean table covers them.

## Status

`packages/shared/src/gameData.ts` has the one query that reads the worker's
status. The API serves it at `GET /api/game-data/status` (shown on Settings →
SC Data, with the **Sync now** button for platform admins:
`PLATFORM_ADMIN_DISCORD_IDS` on the API) and the bot shows it in each
server's status channel embed.

## Env

| Variable | |
|---|---|
| `DATABASE_URL` | required (`${{Postgres.DATABASE_URL}}`) |
| `GITHUB_TOKEN` | optional; only used to read the build name of a new commit |
| `SC_DATA_FORCE=1` | re-check every file even if upstream hasn't moved |
| `SC_DATA_ALLOW_MASS_DELETE=1` | allow one run to remove more than 25% of files |
| `SC_DATA_REPO`, `SC_DATA_BRANCH` | default `StarCitizenWiki/scunpacked-data`, `master` |
| `SC_DATA_TARBALL_FILE`, `SC_DATA_COMMIT`, `SC_DATA_BUILD` | testing only: use a local tarball |

## Sizes (build 4.10.2-LIVE, Nov 2026)

29,593 files. First load ≈ 2 minutes, peak memory ≈ 500 MB, database
≈ 790 MB (≈ 570 MB raw, ≈ 210 MB clean). Later builds only write what changed.

## Running locally

```
DATABASE_URL=postgresql://... npm run dev --workspace @dem/sc-data
```
