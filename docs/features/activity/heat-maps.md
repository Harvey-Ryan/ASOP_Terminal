# Activity heat maps (v1.24.0)

- Activity (RoleCall, its heat maps included) exists only for the servers in
  `ACTIVITY_SERVER_IDS` (default: Fleet 919), via `activityAvailable()` in
  `apps/api/src/lib/activityAvailable.ts` (v1.25.0). Elsewhere
  `my-permissions` says `activityEnabled: false, activityAvailable: false`, the
  module is off in `assertModuleEnabled`, and the RoleCall proxy and the event
  heat map answer 404 (settings included). The website hides the link and the
  Module Settings tile, and asks RoleCall nothing until availability is known.

- Week × hour grids (row 0 = Sunday) in the viewer's time zone (default: the
  browser's). Server and member maps come from RoleCall (no unit: read them
  relative to the busiest hour); the event map is ours:
  `buildEventHeatmap` in `packages/shared/src/heatmap.ts`, with the
  member-history rules (recorded attendance only, average per event, show-up
  rate over sign-ups). `bestTimes` makes the "Busiest: …" lines.
- `HeatMap.tsx` takes `describe` (words for a square, shown on hover or tap)
  and `legend`; in ratio mode null = no events (grey), 0 = a real 0%.
