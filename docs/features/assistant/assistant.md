# AI assistant (v1.56.0)

- Members tag the bot with a plain question; the server's own model answers
  with ASOP's lookups. Plan and decisions: the "ASOP Terminal AI Assistant
  Plan" doc. Rules, provider formats (OpenAI-style, Anthropic, Google) and the
  tool list are in `packages/shared/src/assistant.ts` (`ASSISTANT_TOOLS`,
  `pickTools`, `buildModelRequest`/`parseModelResponse`, `callModel`).
- Settings (`AiAssistant`, one row per Discord server): `routes/assistant.ts`,
  `lib/assistant.ts`, page `pages/settings/AssistantSettingsPage.tsx` at
  `/dashboard/servers/:guildId/settings/assistant` (sidebar "AI Assistant").
  Server admins only (`assertGuildManager`); servers outside `AI_SERVER_IDS`
  (default Fleet 919, `*` = all) get 404 and no link.
- Keys are write-only: checked with one tiny call (`KEY_TEST_REQUEST`), then
  stored AES-256-GCM encrypted with `AI_KEY_SECRET` (env only), bound to the
  server id (API `lib/aiKeys.ts`, bot `utils/aiKeys.ts`; keep them in step).
  Never return a key, its cipher text, or put it in logs, errors, the admin
  panel or exports; only `keyLast4`. Changing provider/address drops the key;
  the bot leaving a server deletes it.
- Bot: `services/assistantService.ts` (checks in order: rollout, global off,
  switched on with key, channel, role, limits; then the model loop, at most
  `MAX_MODEL_ROUNDS`/`MAX_TOOL_CALLS`), lookups in `services/assistantTools.ts`
  (only what the asker could see in that server; Discord timestamps for
  times; member-written text passed as quoted data). Only a typed mention
  triggers it (a reply ping doesn't). Answers never ping (`allowedMentions`).
- Stored about people: `AiUsage` (counts per person per server per UTC day),
  `AiFlag` (questions the model flagged via `flag_question`; that server's
  admins only, not platform admins; 90 days), `AiNoticeSeen` (privacy notice
  shown once). All three are in Your data. Questions and answers aren't stored.
- Admin → Modules has the emergency switch (`AdminConfig.aiDisabled`,
  `PUT /api/admin/ai`, needs "TURN OFF AI" typed); each server keeps its own
  setting and key.
- Changes (v1.57.0): `sign_up`, `leave_event` (anyone) and `create_event`
  (from a template), `edit_event`, `cancel_event`, `share_event` (event
  creators: `isEventOfficer` = `canRunEventFromDiscord`; officer tools aren't
  even offered to others). Specs have `action`; runners are
  `ACTION_RUNNERS` in `services/assistantActions.ts`. A runner only checks
  and *prepares* (`prepare()`: one per question, a bot-written preview,
  kept `ACTION_CONFIRM_MS` in memory); the reply shows the preview with
  Confirm/Cancel (`ai:ok:<id>` / `ai:no:<id>`), only the asker can press
  them, and Confirm re-checks permission and runs the same code as the
  buttons and website (`setRosterRole`, `clickWaitlist`, `leaveRoster`,
  `setupDiscordForEvent`, `syncDiscordEvent`, `cancelEvent`,
  `setupDiscordForShare` / `handleShareNotice`). Times the model gives are
  the asker's local time (`parseLocalDateTime`; their member-map pin's zone,
  else the server's) and previews show `<t:…>` timestamps. Cancelling works
  for one-off events too (the website only cancels repeating ones). Loot,
  DKP changes, roles and settings stay out (auction/loot start: next).
  A new lookup goes into `ASSISTANT_TOOLS` (with its topic) and
  `TOOL_RUNNERS`; a new change also gets `action` and an `ACTION_RUNNERS`
  entry that only prepares.
- The model guide on the settings page is general guidance only: no model
  names, prices or recommendations.
- Tiered lookups (v1.65.0): two broad lookups that widen their own search
  replace six narrow ones, so fewer tool descriptions go with each question.
  - `events` (was `upcoming_events`, `find_event`, `my_events`): no `query`
    = the event of the thread the question was asked in, else the next
    events; with a query it stops at the first tier that finds something:
    the name in upcoming and the last 14 days → every word of it in any
    order → the same 14–120 days back (said so in the result) → "no match"
    with what's coming up. `detail: brief` (default: time, counts per role,
    briefing and thread links) or `full` (names per role, description).
    `mine: true` = the asker's own sign-ups and waitlists (personal only
    then: `personalArg`, so other answers can be cached).
  - `game` (was `ship_info`, `where_to_mine`, `blueprint_missions`): one
    name checked against ores, ships and blueprints at once;
    `rankGameKinds` (shared) puts exact names first, then ore, ship,
    blueprint, with an optional `kind` first when it matches. The other
    kinds it matched are named in the result. A new kind of game lookup
    goes here, not into a new tool.
  - Event threads: `threadEventOf` (bot) finds the event whose thread (the
    host's, or an ally's copy) the question is in. Then `pickTools` always
    adds the event tools, the system prompt says so (no event name in the
    prompt: organiser text stays tool data), the changes' `event` argument
    may be left out (`findOpenEvent` uses the thread's event, with the same
    own/visible and open checks), and the answer cache key includes it.
  - No topic word: every lookup and the asker's own changes, but officer
    changes only with an event word (more of those were added: postpone,
    delay, push … back, put me down/in, add me, count me in).
