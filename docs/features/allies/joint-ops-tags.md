# Joint ops: server tags (v1.20.0)

- `EventRsvp.guildId` is the Discord server someone signed up from (website
  viewing server, button's server, the Discord event they clicked Interested
  on; null from a voice-channel join = treated as the host).
- On an event shared with allies (`EventAllianceGuild` rows in the bot,
  accepted `EventGuildShare` in the API), rosters tag everyone with their
  server (`serverLabel`: ally tag, else name) and show a headcount per server
  (`serverHeadcount` / `serverTagOf` in `roster.ts`). Not shared = no tags.
