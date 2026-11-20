# Download counts (v1.59.0)

- Clicks on download buttons are counted per item, UTC day and page
  (`DownloadClick`: `item`, `day`, `source`, `count`). Nothing about the
  person is stored, so it isn't part of Your data. Items are
  `DOWNLOAD_ITEMS` (`rockcrawler`); pages are `DOWNLOAD_SOURCES` (`tools` =
  the public /tools site, `dashboard` = inside a server), both in
  `packages/shared/src/admin.ts`.
- The button calls `trackDownload(item, source)` (`apps/web/src/lib/gameTools.ts`):
  `sendBeacon` (fetch with `keepalive` as a fallback) to the public
  `POST /api/game-tools/downloads/:item { source }` (`routes/gameTools.ts`,
  under the `/api/game-tools` rate limit). It never waits for an answer, and
  the API answers 204 even if the count couldn't be written: a missed count
  must never get in the way of the download. Today only the RockCrawler
  button on the Mining page uses it.
- The same visitor clicking the same item again within 10 minutes counts
  once. That memory is a hashed address held in the API process only (lost on
  restart), never written to the database.
- Admin → Overview → RockCrawler downloads: today, 7 and 30 days, all time
  and a 30-day chart by page (`GET /api/admin/downloads/:item`, summed by
  `summariseDownloads`).
- These are clicks on our button, not installs: GitHub downloads from the
  RockCrawler repo directly, and RockCrawler's own updates, aren't counted.
  A new download button adds its item to `DOWNLOAD_ITEMS` and calls
  `trackDownload`; the admin section takes the item.
