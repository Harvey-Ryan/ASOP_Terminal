# Wikelo (v1.34.0)

- Wikelo's missions (scdata.contracts, mission giver "Wikelo"): reward and
  turn-in list built by `packages/shared/src/wikelo.ts` (`buildWikeloMissions`;
  turn-in keys are item uuids, SCU for resources). The API serves them at
  `GET /api/wikelo` (`routes/wikelo.ts`, cached per sc-data commit, base-ship
  pictures from the ship list); the bot's `/wikelo` reads the same
  (`services/wikeloService.ts`).
- A module like any other (`wikeloEnabled`): page `pages/WikeloPage.tsx` at
  `/dashboard/servers/:guildId/wikelo[/:missionId]`, its own look scoped to
  `.wk` (`pages/wikelo/wikelo.css`). The page's words are plain; Wikelo's own
  text appears only as the mission's "Mission text".
- Checklists: `WikeloProgress` (one row per person per mission, by Discord id),
  `GET /api/me/wikelo`, `PUT /api/me/wikelo/:missionId { ticked, completed }`.
  Private to the person, and never filter or reorder what anyone is shown
  (the "Mine" tab is the only place they narrow the list). In "Your data"
  export and delete.
