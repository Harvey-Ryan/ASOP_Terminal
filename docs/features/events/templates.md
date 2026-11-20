# Event templates (v1.41.0)

- `EventTemplate` rows come in two kinds (`curated`): Repeat's own (made
  silently by Repeat, keyed on `sourceEventId`, refreshed from each event made
  from them) and curated ones (made or edited on the Templates page, or with
  "Save as template"), which nothing overwrites except someone editing them.
  Deleting is soft (`isActive = false`).
- Routes: `routes/eventTemplates.ts` (event creators, `assertEventCreator`),
  rules in `lib/eventTemplates.ts`. Website: `pages/events/EventTemplatesPage.tsx`
  (`/dashboard/servers/:guildId/templates`, and `…/templates/:id/briefing` for
  a template's briefing, using `BriefingPage`'s `Editor` with the template
  standing in for an event). "Use" opens the new-event form via `?newFrom=`.
- `EventTemplate.briefing` (BriefingContent JSON) is copied into every event
  made from the template as an unpublished draft (`applyTemplateToNewEvent`;
  the bot's `copyTemplateBriefing` does the same for repeating events'
  next occurrence). `Event.templateId` records the template. Roster groups
  point at roles by id, so moving a briefing between a template and an event
  goes through `remapBriefingRoles` (by id, then by name).
- The event briefing editor's "Save to template" puts a briefing on a
  template (`PUT …/event-templates/:id/briefing` with `fromEventId`).
