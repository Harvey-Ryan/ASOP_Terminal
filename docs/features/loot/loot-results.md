# Loot results and the event thread (v1.22.0)

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
- The end-of-event "Start Loot / No Loot" buttons (bot `event_loot_*`) follow
  the website's event-creator rule via `canRunEventFromDiscord` (`roster.ts`,
  v1.40.1): the event's creator, or in the host server the owner, Manage
  Server / Administrator, or an event creator role. Don't use the old
  `GuildMember.role` for permissions.
