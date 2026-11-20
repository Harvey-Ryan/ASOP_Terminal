# Blueprints page (v1.27.0)

- `pages/BlueprintsPage.tsx` (`/blueprints` and `/blueprints/:blueprintUuid`):
  the calculator's blueprint list (`pages/crafting/browser.tsx`), then every
  mission that can give the picked blueprint (`pages/crafting/missions.tsx`,
  also the calculator's mission "Details"). Same `.fab` look.
- Mission rewards are only what the game files hold: `rewardItems` (scrip,
  gear), reputation, `enemies` (CombatSummary), `shareable`, `onceOnly`.
  aUEC payouts aren't in the files (the game sets them on accept): never
  estimate them.
- Difficulty words come from `difficultyWords()` in `crafting.ts`; title
  placeholders the game fills in ("[Location]") show as "‹location›".
- Blueprint search (`searchBlueprints`) matches every word in any order
  across name, type, subtype and maker, ignoring quotes.
- Quality curves (v1.28.1): most stats come in pieces (`ValueSegments`:
  0–500 ×0.8→×1.0, then 501–1000 ×1.0→×1.2); `QualityRange`/`ModifierRange`
  only describe the first piece. `adaptModifier()` keeps every piece and
  spans the whole range; read a stat with `statAt()`. `linear_integer_additive`
  curves (Power Pips) add whole numbers (`curve: 'additive'`); modifiers with
  no range and no pieces are dropped.
