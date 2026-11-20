<!--
Thanks for contributing! Please read CONTRIBUTING.md first.
One section per pull request; the Guardrails / Scope check lists where each file counts.
-->

**Section:** <!-- one of: events, loot, allies, members, jobs, fleet, activity, trading, game-tools, tournaments, assistant, admin -->

Closes #<!-- issue number -->

## What changed and why

<!-- A few sentences for the reviewer: what you changed, why, and anything to look at closely. -->

## How I tested it

<!-- What you ran or clicked through. Screenshots help for anything on the website or in Discord. -->

## Checklist

- [ ] Changes stay in one section (plus a few lines of wiring if needed)
- [ ] No core files: version, `package.json`, `package-lock.json`, `CLAUDE.md`, `RAILWAY.md`, `prisma/`, `.github/`, `scripts/`
- [ ] No new dependencies
- [ ] `npm run format` run, checks pass locally
- [ ] Feature note in `docs/features/<section>/` updated if behaviour changed
- [ ] Anything new that stores a person is in Your data's export and delete

<!--
Patch notes for players (they become the release notes; see CONTRIBUTING.md, "Patch notes").
Use "Patch notes: none" for refactors, tests and docs. Keep the block last.
-->

Patch notes:
[Feature or Area]
* What players or officers will notice, as a full sentence.
