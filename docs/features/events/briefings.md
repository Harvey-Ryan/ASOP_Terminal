# Mission briefings (v1.36.0)

- One per event: `EventBriefing` (the whole briefing is one JSON document,
  checked by `sanitizeBriefing` in `packages/shared/src/briefing.ts`; image
  links must be our uploads or https, `safeImageUrl`). Routes in
  `routes/briefings.ts`: the host's event creators edit, save, publish and
  delete; anyone who can see the event in the host or an accepting ally, or is
  on its roster, reads it once published. `GET /:guildId/briefings` lists the
  server's past briefings to copy from.
- Website: `pages/events/BriefingPage.tsx` at
  `/dashboard/servers/:guildId/events/:eventId/briefing` (`?mode=edit`,
  `?present=N`): read view, editor with slide preview, present mode (1280×720
  slides scaled to the screen, arrow keys) and Print / PDF (`.brf-print`).
  Slides use ASOP's charcoal and gold, scoped to `.brf-slide`
  (`briefing.css`).
- Ship sections (v1.36.1) hold only the ships the organisers picked
  (`BriefingSection.ships`: a copy of name, crew, count and a note). Never
  fill them in automatically, and don't load the fleet until the organiser
  asks (`ShipChooser`: the signed-up fleets via
  `GET /guilds/:guildId/fleet?eventId=`, or any ship from `/ships`). Readers
  never load the fleet.
- Roster sections (v1.37.0): up to 8 groups on one slide
  (`BriefingSection.groups`), each with a title, an event role (`roleId`;
  the view's `event.roles`, built by `briefingRoles`, lists each role's
  sign-ups, never maybes), typed names, a note and a picture (an upload, or a
  ship's RSI picture). `groupPeople` merges the two lists. Any section can
  have a background picture (`bgUrl`, `bgOpacity`).
- Image sections (v1.39.0) can have a second picture with its own text
  (`imageUrl2`, `body2`): the slide shows picture | text, then text | picture
  (`imageRows`). With one picture the old split layout stays.
- Logos: `GuildSettings.logoUrl` (Bot Settings → Org Logo, picked from the
  server's image library, `components/ServerImagePicker.tsx`); a briefing can
  use its own, and shows accepting allies' logos on joint ops.
- Discord: publishing sets `Event.briefingPublishedAt` / `briefingSummary`
  (the objective), so the roster shows "📋 Briefing ready" and a Briefing link
  button (`buildRoleButtons(…, briefing)`, opened as the server viewing the
  roster), and `/trigger/briefing/:eventId` posts a notice in the host and ally
  threads (`services/briefingService.ts`).
