# Fleets (v1.32.0)

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
- FleetYards linking is gone. The old per-server `FleetEntry` and
  `FleetyardsLink` tables were converted in v1.32.0 and dropped in v1.35.1.
- Fleets for one event (v1.33.0): `GET /api/guilds/:guildId/fleet?eventId=`
  (the event must be the server's own or shared into it) and `/fleet search
  … event:` count the people signed up, allies included, never maybes, minus
  fleets hidden from the server each signed up from (`eventFleetPeople` in
  `ships.ts`). The website keeps the choice in `?event=`. Deliberately not on
  the event page or its Discord posts (fleets are too long there).
- Ship images load from `media.robertsspaceindustries.com` (allowed in the
  CSP `imgSrc`), credited on the page.
