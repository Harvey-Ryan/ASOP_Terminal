# Role waitlists (v1.14.0)

- A full role gets a waitlist (`EventWaitlist`, one line per person per event,
  line order = id). People waiting stay on the roster with their current role.
- Rules are in `packages/shared/src/roster.ts` (`planWaitlistMoves`). Every
  roster change runs `fillFromWaitlist` inside the transaction that holds the
  event row (`lockEvent`): API `lib/waitlist.ts`, bot
  `services/waitlistService.ts` (keep the two in step). The bot DMs whoever
  moved in; the API asks it to with `/trigger/waitlist-moved/:eventId`.
