# Crafting Calculator (v1.26.0)

- One screen (`pages/CraftingCalculatorPage.tsx`, both routes): blueprints,
  the selected blueprint (a quality slider per part), and the build list
  (`lib/buildList.ts`, localStorage). Theme B "fabrication bay", scoped to
  `.fab` in `pages/crafting/fabrication.css`; keep other pages on the
  site's normal look.
- One workbench (v1.54.0): Crafting, Blueprints and Mining share the bay
  frame (hazard strip, lettered badge F/B/M, stencil title, count stamp) and
  three columns: a list (search + filter) · the picked item on a riveted
  plate · a working panel. The panel is the build list on Crafting and on
  Blueprints (`BuildListPanel`, exported from `CraftingCalculatorPage.tsx`;
  one shared list) and the scanner on Mining. Keep the three in step; Wikelo
  and Ships keep their own looks.
- Where materials are mined: `packages/shared/src/materialSources.ts`
  (from `scdata.resource_locations`; main ore of each rock only), shipped in
  the crafting data as `materialSources`. When the crafting payload's shape or contents
  change, bump `DATA_VERSION` in `apps/api/src/lib/craftingData.ts` so
  browsers drop their cached copy.
- Place names (v1.26.1): mining places come from the location records, with
  Lagrange points named in full by body (`groupedPlaceName`, never "+N");
  mission places go through `cleanMissionLocations` in `crafting.ts` (rooms
  and sentences dropped, "the clinic inside X" → X, one name per place).
- The website knows its own version (`__APP_VERSION__`, from the root
  `package.json` via Vite) and sends it with error reports, so errors from a
  tab opened before a release can be told apart.
