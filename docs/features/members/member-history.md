# Member history (v1.18.0)

- `GET /api/guilds/:guildId/members` (officers who can create events) and
  `/members/:userId` (them, or anyone for `me`): `routes/members.ts`, rules in
  `packages/shared/src/memberHistory.ts`. Only the server's own events count.
- `?from=&to=` (ISO moments, `parseHistoryRange` / `rangeWhere`) limit the list
  and a member's history to a date range (v1.23.0): events by start time, loot,
  DKP changes and tournaments by date; the DKP balance is always today's. The
  website keeps the range in the URL (`DateRangeFilter.tsx`) in the viewer's
  own days.
- Attendance counts only where it was recorded: `confirmedAttendees` (the
  check after an event), else `vcAttendees` if anyone was in voice. Events
  with neither are "not recorded", never no-shows; maybes are never no-shows.
