# UEX prices and routes (v1.42.0)

- UEX Corp (uexcorp.space, API 2.0 at `api.uexcorp.uk/2.0`) is
  community-reported prices and trade routes. Types and the pure rules
  (best places to sell/buy, best routes, search, wording) are in
  `packages/shared/src/uex.ts`; always say the data is player-reported
  and how old it is (reports older than `UEX_MAX_AGE_DAYS` are left out).
- The bot's client is `services/uexService.ts`: `UEX_KEY` (on the main ASOP
  service: the bot runs in the API's container) as a
  Bearer token, answers cached as long as UEX caches them (prices/routes
  30 min, commodities 1 h, terminals 12 h, star systems 1 day), at most 100
  requests a minute (UEX allows 120), and the last copy served when UEX is
  busy or failing. Autocomplete only reads the cache (`peek…`); the lists are
  warmed when the bot starts.
- Commands: `/price <commodity> [system]` (raw ores use
  `commodities_raw_prices`), `/route find [commodity] [from] [budget]`
  (UEX's routes) and `/route best [scu] [budget] [system] [cross_system]`
  (v1.43.0): every price at every terminal in one request
  (`commodities_prices_all`), ranked by `uexBestRuns`: one run per
  commodity, profit for the load = margin × the least of hold, stock for
  sale, the buyer's demand and what the budget buys (margin per SCU without
  a hold or budget); same system unless `cross_system`.
- Earmarked, not built: mining/briefing data (refinery yields, ore prices,
  routes for ops) and importing a player's UEX fleet with their own UEX
  secret key (which would need storing encrypted and covering in Your data).
