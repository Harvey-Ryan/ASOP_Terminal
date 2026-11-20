# After-action notes (v1.19.0)

- `Event.aarOutcome` (SUCCESS | PARTIAL | FAILED) and `aarNotes`, written by
  the host's event creators once an event has ended (on the attendance check
  or later: `PUT …/after-action`). Shown on the event and in the final
  summary embed in Discord (`/trigger/after-action/:eventId` redoes it).
- `EventComment`: one comment per person who attended (or signed up, where
  attendance wasn't recorded: `canComment` in `memberHistory.ts`); officers
  can remove any.
