# Contributing to ASOP Terminal

Thanks for helping. ASOP is live: every merge to `master` deploys to the
servers that use it, so a few rules keep changes small, reviewable and safe.
Most of them are checked automatically on your pull request.

## The short version

1. **Pick or open an issue first**, and say which section it's in. Comment on
   it to claim it, so two people don't build the same thing.
2. **One section per pull request.** Fix the loot page *or* the fleet page,
   not both.
3. **Don't touch core files** (below). If your change needs one, say so in
   the issue and a maintainer will do that part.
4. **Don't change the version, `package.json`, `package-lock.json`,
   `CLAUDE.md` or `RAILWAY.md`.** The maintainer handles releases.
5. **Write patch notes** in the pull request description (the template shows
   how).
6. **Run the checks locally** before you push (see "Checks").

## Sections

The code is split by layer (`apps/api`, `apps/web`, `apps/bot`,
`packages/shared`), but a feature lives in all of them: the loot section is
`routes/loot.ts`, `pages/LootModulePage.tsx`, `services/lootService.ts`,
`commands/loot.ts` and so on. So a **section is a feature**, across every app:

| Section | What's in it |
| --- | --- |
| `events` | Events, sign-ups, waitlists, briefings, templates, calendar feed |
| `loot` | Loot sessions, DKP, auctions |
| `allies` | Allies and shared events (joint ops) |
| `members` | Member history, RSI verification, personal settings, Your data page |
| `jobs` | Job board |
| `fleet` | Fleets and the ship list |
| `activity` | Activity, heat maps, member map |
| `trading` | Marketplace, exchange, UEX prices and routes |
| `game-tools` | Ships, mining, refinery, crafting, blueprints, Wikelo, StarStrings, corrections, `apps/sc-data` |
| `tournaments` | Tournaments, brackets, ratings |
| `assistant` | The AI assistant |
| `admin` | Admin panel, setup checklist, bot settings, uploaded images, errors |

The exact map is `scripts/sections.config.mjs`. To see where a file belongs:

```sh
node scripts/sections.mjs which apps/web/src/pages/FleetPage.tsx
node scripts/sections.mjs report          # every file
```

A file's section comes from its name (`lootService.ts` → loot) or its folder
(`pages/tools/` → game-tools). **Name new files after their feature** so they
land in the right section. A file no rule claims counts as core.

Each section's notes are in `docs/features/<section>/`. If your change alters
how a feature works, update its note in the same pull request.

## One section per pull request

The **Guardrails / Scope** check fails a pull request that:

- changes files in **more than one section**,
- changes any **core** file,
- changes more than its allowance in a **wiring** file, or
- changes **more than 30 files**.

Its summary lists every file with the section it counted it under.

**Wiring files** are the shared places every feature registers itself: the
route list (`apps/web/src/App.tsx`), the sidebar (`DashboardLayout.tsx`), the
API's route table (`apps/api/src/server/app.ts`), the bot's command and
button routing (`apps/bot/src/index.ts`, `deploy.ts`, `commands/help.ts`),
the shared exports (`packages/shared/src/index.ts`), the module list
(`modules.ts`), the setup checklist (`setup.ts`), Your data (`myData.ts`) and
a few more. You may change a few lines in them (usually 25, some 40–80) to
plug your feature in: add a route, a link, an export. Anything bigger is a
change to the wiring itself, which is the maintainer's.

If a change really has to span more (a bug that crosses two features, a
rename), say so in the pull request and the maintainer can add the
`scope-override` label. Expect to be asked to split it first.

## Core files (maintainer only)

- Everything in the repo root (`package.json`, `CLAUDE.md`, `Dockerfile`, …),
  `.github/`, `scripts/`, every `package.json` and `tsconfig*.json`
- The database schema, `apps/api/prisma/`
- App infrastructure: start-up, sign-in, sessions, permission checks
  (`apps/api/src/lib/assert*.ts`), live updates, the shared UI components in
  `components/ui/`, build config

**No new dependencies** without asking in the issue first: adding one changes
`package.json` and `package-lock.json`, which are core.

## Database changes

`apps/api/prisma/schema.prisma` is core. In production it's applied with
`prisma db push --accept-data-loss` the moment a merge deploys, so a removed
field is a deleted column with its data, at once.

If your feature needs a new table or column, describe it in the issue. The
**Guardrails / Schema safety** check fails any schema change that drops or
retypes data, adds a required column without a default, removes enum values
or adds a unique index to an existing table, until a maintainer has planned
it and added the `schema-reviewed` label. Removing anything takes two
releases: move the data out first, drop the model in a later release.

Anything that stores a person (a Discord id, user id or username) must also go
into Your data's export and delete (`apps/api/src/lib/myData.ts`); see
`CLAUDE.md`, "Your data".

## Patch notes

Players read these. Put them in the pull request description, in this format
(the template has it):

```
Patch notes:
[Fleet Import]
* FleetViewer layouts with custom ship names now import correctly.

[Bug Fixes]
* The fleet page no longer shows retired ships in the picker.
```

A section title names the feature; fixes go under `[Bug Fixes]`; each bullet
is a full sentence about what players see. For refactors, tests and docs,
write `Patch notes: none`. No server ids, user names or internal links.

Your pull request is squash-merged, so its title and description become the
commit on `master`; the release script collects the notes from there.

## Code style

- Prettier formats the code (`.prettierrc.json`, width 120). Run
  `npm run format` before you commit; CI runs `npm run format:check`.
- TypeScript everywhere; `npm run lint -w @dem/<app>` type-checks an app.
- Show times in each person's own time zone (Discord timestamps in the bot,
  the browser's zone on the website); never print UTC as text.
- Every `/api/guilds/:guildId/...` route checks the person against that
  server (`assertEventViewer`, `assertEventCreator`, `assertModuleEditor`).
- Log failures with `console.error` / `console.warn` (they're recorded); don't
  swallow errors.
- `CLAUDE.md` holds the rest of the project's rules; read the parts for the
  area you're changing.

## Checks

Every pull request runs:

- **Checks**: formatting, shared build and tests, type-checks of every app,
  the API tests against Postgres, the website build
- **Guardrails / Scope** and **Guardrails / Schema safety** (above)

All must pass, and a maintainer must approve (`.github/CODEOWNERS`) before
anything merges. To run the main ones locally:

```sh
npm ci
npm run format:check
npm run build -w @dem/shared && node --test packages/shared/test/*.test.mjs
npm run lint -w @dem/api && npm run lint -w @dem/bot && npm run lint -w @dem/web
docker compose up -d postgres_test && npm test -w @dem/api
```

## Security

Don't open a public issue for a security problem (a way to see another
server's data, act as an officer, or reach someone's API key). Contact the
maintainer privately through GitHub instead.
