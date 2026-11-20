# Job board (v1.21.0)

- `Job` / `JobCrew` (`routes/jobs.ts`, rules in `packages/shared/src/jobs.ts`):
  any member posts; a job is seen by its server (SERVER), its allies too
  (ALLIES) or every ASOP server (GLOBAL); taking is checked with the job row
  held so crews never overfill; the poster closes it (DONE/CANCELLED), the
  home server's managers can take it down; open jobs expire after 7 days
  (bot `expireJobs`).
- The bot posts jobs in `GuildSettings.jobsChannelId` (optional) of the home
  server and, for ALLIES/GLOBAL jobs, of its allies (never unrelated servers;
  they see GLOBAL jobs on the website). `/trigger/job/:id` re-syncs the posts
  (`Job.messages`) and, with `{ taken }`, DMs the poster.
