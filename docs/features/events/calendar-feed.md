# Calendar feed (v1.16.0)

- Each person's events (the ones they're on the roster for, from 30 days ago
  on, not cancelled) are an iCalendar feed at `/api/calendar/<token>.ics`
  (`routes/calendar.ts`, built by `packages/shared/src/ics.ts`). Calendar apps
  fetch it without signing in, so `User.calendarToken` is the key: keep it out
  of logs (the request log masks it) and let people reset it (Notification
  Settings).
