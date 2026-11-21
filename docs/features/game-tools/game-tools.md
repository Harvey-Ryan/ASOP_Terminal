# Game Tools (v1.44.0, ship-first since v1.45.0, in the dashboard since v1.46.0)

- The tools (Ships, Crafting, Blueprints, Wikelo) live in two places, and
  every page builds its links with `useToolsPaths()` (`lib/toolsPaths.ts`) so
  people stay where they are:
  - Inside a server's dashboard, under the sidebar's Tools group: Ships at
    `/dashboard/servers/:guildId/ships[/:className]` (wrapped in
    `DashboardToolsFrame`: theme menu, "Open on its own page"), and the
    existing module pages for Crafting, Blueprints and Wikelo.
  - The public site at `/tools` (`ToolsLayout`): Ships needs no sign-in;
    `/tools/crafting`, `/tools/blueprints`, `/tools/wikelo` ask people to sign
    in (`SignInForTool`; sign-in may return to `/tools…`, `safeReturnPath`).
    Their tabs hide when a platform admin hid the module for every server
    (`GET /api/game-tools/hidden`, public).
- Ship pages (`apps/web/src/pages/tools/`, their own look scoped to `.gt` in
  `tools.css`, maker-inspired themes in a menu, saved in the browser):
  - Home: the ship picker (`ShipSearch`), recently viewed (this browser),
    common ships and a sortable list of every ship (`ShipsHomePage`).
  - One ship (`ShipPage`), Erkul-style since v1.47.0: a summary bar that
    stays on screen (`SummaryBar`), cards grouped by system (`LoadoutCards`:
    Armament with each gun's mount, Ordnance, Components), the ship's
    Defense / Flight / Hull / Quantum panels (`ShipPanels`) and what it can
    kill (`KillTable`). Clicking a card opens the swap window for that slot
    (`SwapWindow.tsx`, wrapped per kind by `Swap` in `ShipLoadout.tsx`):
    every stat as a sortable column (shift-click adds a second sort),
    filters, search and "vs fitted". The loadout is in the address
    (`?s0=<gun>`, `?sk0=<component>`, `?sm0=<missile>`). Compare
    (`?vs=<className>`, its loadout `c0`/`ck0`/`cm0`) puts a second ship
    beside it (narrow cards, `SummaryGrid`), with one kill table that has a
    column per ship.
  - Switching ships (v1.48.0): a `ShipSearch` bar at the top of the ship
    page, and "Change ship" on each side when comparing (`switchShip`; the
    compared ship and its loadout stay). Search results rank the exact name,
    then names starting with what was typed, then shorter names.
  - Old `/tools/loadout/:c` and `/tools/optimizer/:c` links open the ship page.
    The Optimizer page is hidden until its scoring accounts for rate of fire,
    projectile speed and ammo; `bestGunFits` stays in `combat.ts` with tests.
  - No "Add ASOP to your server" pitch until we go public.
- Data: `GET /api/game-tools/data` (`routes/gameTools.ts`), every flying ship
  and ship gun from `scdata`, built once per sc-data commit, sent gzipped with
  an ETag, rate-limited per IP. Building it (and the Mining data) takes
  several seconds, so nobody waits on it (v1.51.1): `warmGameTools()` builds
  both at start-up and after each ship-list refresh, and a moved sc-data
  commit (checked at most once a minute) or a day-old copy is rebuilt in
  the background while the old copy is served. Only a request before the
  very first build waits. Skins with identical numbers are grouped
  (`dedupeGuns`, `variants`) and stock guns point at the shown gun.
- The maths is `packages/shared/src/combat.ts`, run in the browser:
  `killTime` (shields absorb/resist per damage type, ballistic passes through,
  armour multiplier, a pellet at or below the armour's deflection does no hull
  damage, main body = the part named "body", else the biggest), `killVerdict`,
  `bestGunFits`. Every page that shows a kill time states the assumptions
  (the share of shots hitting, burst then sustained fire, no shield regen, no
  range falloff, armour as one pool, the deflection reading still to be
  confirmed in game). Comparisons are computed from numbers, never written by AI.
- Kill times closer to a fight (v1.60.0, target stats and 45 s colours v1.61.0): `killTime(guns, ship, mode, { accuracy })`.
  Mode `real` fires each gun at its burst rate for `burstSeconds`
  (`gunBurstSeconds`: the files' `Heat.TimeToOverheat` for ballistics,
  capacitor shots ÷ rate of fire for energy guns; null = burst throughout),
  then at its sustained rate; `burst`/`sustained` keep one rate throughout
  (the Optimizer's `bestGunFits` still ranks on those). Damage past the
  shields wears down `armourHp` (the armour's `Health`) as one pool, with the
  armour multiplier, before the main body: in game armour is worn down per
  section where the shots land, and the page says it's simplified.
  `KillResult` has `armourSeconds` and `firstSlowdown`. The kill table uses
  `real` at the viewer's share of shots hitting (20/35/50/75/100%, default
  `DEFAULT_ACCURACY` 35%, kept in the browser as `asop.ttkAccuracy`) and shows
  "Every shot hits" (`real` at 100%) beside it. No verdict words: each time is
  coloured (`killBand`: easy under 45 s green, workable to 2 min gold, not
  worth it beyond that or impossible red), with a key above the table. Each
  target row shows its stock shields, armour, hull and deflection
  (physical / energy). Under the table:
  "These are simulation values. Hover for more info." with every assumption
  in a hover/focus pop-up (`.gt-tip`).
- Bespoke guns (the Wolf's L-21/L-22, Vanguard noses…): `gunFitsSlot` checks the port's
  RequiredTags against the gun's tags, and the gun's RequiredTags against the
  PortTags of the port, its mounts and the ship. Use it for every "what fits".
- Records players can't get are left out by `UNAVAILABLE_GUNS` / `isUnavailableGun`
  (`combat.ts`, each with its reason; e.g. the untagged copy of the Nova's
  Slayer Cannon). There's no reliable automatic rule: many real guns aren't
  stock on any ship, so wait for shop data (UEX) before filtering on that.
- Pilot guns only (turret guns are listed, not counted). Turret-only copies
  of guns (class name ending `_Turret`, e.g. a second Attrition-4) never fit
  pilot slots (`gunFitsSlot`). Gun extras for the swap window (family,
  penetration, spread, power, EM, ammo/capacitor, HP) are on `CombatGun`.
- Missiles (v1.47.0, `packages/shared/src/missiles.ts`): every missile
  (grouped like guns) and each ship's racks (`missileRacks`). Racks stay as
  the ship comes with them (rack names are reused across racks that hold
  different missiles, so swapping racks would mislead); the missiles in a
  rack swap for any missile of its size, and identical racks show as one
  card and swap together. Countermeasures are counted from the launchers'
  items (Flare = decoy, Chaff = noise). Ship panels: `flight` (speeds,
  turn rates, 0→SCM/top, hydrogen), `hull` (every part's HP added up:
  Erkul's "hull"), `armourHp`, `distortion`. Checked against Erkul's M80.
- Mining tab (v1.49.0): `/tools/mining` and `/dashboard/servers/:id/mining`
  (sidebar Tools → Mining), `pages/tools/MiningPage.tsx`, data from public
  `GET /api/game-tools/mining` (built per game build, gzipped). Rules in
  `packages/shared/src/mining.ts`: the ore finder lists only rocks where the
  ore is the main ore (side ores are left out, as asked), with both quality
  bands (small share at high quality, large share at low), the rock's spawn
  chance, signature and cluster size; places are named by `resourcePlace`
  (`materialSources.ts`). Scanner lookup: signature = one rock × cluster
  size (`matchSignature`). Lasers leave out template/test copies and the
  MPUV arm.
- Mining in the bay (v1.54.0): `MiningPage` renders its own `.fab.gt`
  frame (no `DashboardToolsFrame`; in the dashboard it carries the build
  badge, the Corrected/Game files toggle and "Open on its own page").
  `.fab.gt` in `fabrication.css` maps the `--gt-*` colours to the bay so the
  sortable tables, the scanner and `<Fix>` keep working. Ore finder = ore
  list (`OreList`) · ore plate · scanner panel (on a phone a picked `?ore=`
  hides the list, "All ores" brings it back); the other views are plates
  around their sortable tables.
- RockCrawler download (v1.55.0): a strip under the Mining header links to
  `releases/latest/download/RockCrawler-Setup.exe` in the public
  Harvey-Ryan/ASOP_RockCrawler repo (its release workflow always uploads the
  installer under that name), plus "How it works" and "What's new". Keep the
  file name in step if that workflow changes.
- Scanner accuracy (v1.52.0): each `RockSignature` carries `maxCluster` (the
  biggest `Clustering.MaxSize` of that rock anywhere: ship ores 2–6 by
  rarity, ROC/hand gems 21–25) and `places`. `matchSignature` never counts
  more rocks than `maxCluster`, which leaves exactly one answer for every
  ship-ore reading; rock types sharing a signature (ROC gems, hand gems) are
  one `ScanHit`. With a place (`?at=` on the Mining page) rocks not found
  there are dropped and the rest ranked by spawn chance. Salvage signatures
  (`method: 'salvage'`) come from every provider's `Salvage_*` groups.
  ASOP RockCrawler (the desktop overlay) reads `maxCluster` and `places`
  from `/api/game-tools/mining` and must keep the same rule (its `core.py`).
- Inert filter (v1.52.0): the game files have one `filterModifier` per laser
  or module; scunpacked writes it twice (`AllChargeRates` and
  `InertMaterials`, with opposite signs for lasers and modules). `filterFix`
  turns the pair into one `InertMaterials` change (negative = less inert
  collected). There is no all-charge-rates stat; don't bring it back.
- Size 0 (ROC/hand) lasers and gadgets (`miningGadgetFromItem`,
  `Mining_Gadget_*`, numbers from `MiningModule.Modifiers`, which can differ
  from the item's description text) are on the Mining page (v1.52.0); ship
  pages still only take size 1+ lasers. `OreSpot.groupChance` is the
  group's `GroupProbability` (how often a place spawns that method's rocks). Modules are
  `Mining_Modules_(Active|Passive)_…` (Deluge, Overrun and Clearcut have no
  item type in the files: may not be sold). Lower resistance, instability,
  inert, overcharge and shatter are good for the miner.
- Mining loadouts on ship pages (v1.50.0): `shipMiningHeads` (`mining.ts`)
  finds each laser mount of size 1+ (Mole crew turrets, Prospector/Golem
  arm); a head is `locked` when a port between the ship's hardpoint and the
  laser can't change (the Golem). Lasers needing a ship tag (`bespokeFor`,
  the Pitman) fit only where they're stock (`laserFitsHead`). Lasers and
  modules ride in the game-tools data (`miningLasers`, `miningModules`).
  Address: `?sl0=<laser>`, `?sd0_1=<module>` (`cl`/`cd` when compared); no
  ship comes with modules, so empty = stock. `miningHeadTotals` multiplies
  laser power by module power and combines percent changes as
  (1+a)(1+b)−1 with active modules on: still to be checked against
  Regolith, and the page says so. "What this loadout can break" is a
  placeholder until that check.
- Salvage and refuelling (v1.51.0, `packages/shared/src/industry.ts`):
  `shipSalvageHeads` lists each salvage head and its module slots (a slot
  holding the ReadyGrip/typed `SalvageModifier_TractorBeam` is the tractor
  slot, fixed; the rest take any scraper module, `salvageModuleFitsSlot`).
  Heads aren't swapped (Baler and Salvation heads hold different numbers of
  modules). Scraper figures are `SalvageModifier` (radius, speed,
  efficiency); one scraper works at a time, so nothing is added up.
  Fuel pods: `shipFuelPodSlots` (Starfarer, Starlite) and `fuelPodFromItem`,
  one per pod (filled copies, AI/template pods and the Eriesium cargo pods
  left out; a ship's filled copy points at the plain pod by name). Capacity,
  flow and integrity come from the pod's description: the files'
  `ResourceContainer` size disagrees with it for every pod. Address:
  `?sv0_1=<scraper>`, `?sf0=<pod>` (`cv`/`cf` when compared).
- Refinery calculator (v1.58.0): Mining → Refinery (`?view=refinery`,
  `pages/tools/RefineryView.tsx`; shared bay pieces in `bay.tsx`). Rules in
  `packages/shared/src/refinery.ts`: refined cSCU = ore cSCU × 0.85 ×
  (1 + refinery bonus %) × method yield (1 / 0.85 / 0.7), rounded
  (`refinedCscu`; Regolith's formula, checked against UEX's reported work
  orders in the tests). `REFINERY_METHODS` carries UEX's codes and CIG's
  relative time/cost via Regolith (MIT). Fees and timers have no formula that
  matches reports, so the page takes the terminal's quoted fee and never
  estimates them. Data: public `GET /api/game-tools/refinery`
  (`lib/refineryData.ts`: UEX `commodities` (raw ↔ refined by `id_parent`),
  `refineries_yields`, `commodities_prices_all`, `commodities_raw_prices_all`,
  `terminals`; joined by `buildRefineryData`, reports older than
  `REFINERY_MAX_AGE_DAYS` dropped; refreshed every 30 min, last copy served
  when UEX fails). The order is in the address (`o=<oreId>:<SCU>,…`, `r`,
  `m`, `sell`, `fee`). Always say the bonuses and prices are player-reported.
- Next: tractor beams. Power pips are on hold.
