# StarStrings (v1.35.0)

- MrKraken's StarStrings (community text fixes for Star Citizen) republishes
  its rolling `latest` release (the LIVE build) every patch. The bot reads it
  from GitHub's public API at most every 30 min with the last ETag
  (`services/starStringsService.ts`; optional `GITHUB_TOKEN` raises the
  limit), parsing in `packages/shared/src/starStrings.ts`.
- Servers choose `GuildSettings.starStringsChannelId` (Bot settings, optional;
  in the setup checklist only when the bot can't use it). The posting loop
  (`announceStarStrings`) posts each new build where
  `starStringsPosted` isn't `"<channel>|<build key>"`, so a newly chosen
  channel gets the current build (`/trigger/starstrings`). In an announcement
  channel the post is also crossposted. `/starstrings` shows the current build.
- We only link to their GitHub (download, release notes); never re-host the
  files.
