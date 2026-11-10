# ASOP Terminal — notes for Claude

## Patch notes in every commit

Every commit carries the patch notes for its change in the commit message, so
announcements can be batched later. Write them for players and officers, not
developers: what changed in what they see or can do, and why it matters.

Put a `Patch notes:` block after the commit body and before any trailers
(`Co-Authored-By:` etc.). Each section is a `[Section Title]` line followed by
`* ` bullets; nest sub-points with three spaces + `* `.

```
feat(loot): per-item add-to-queue button

<technical body as usual>

Patch notes:
[Loot Draft Queue]
* Every unassigned item now has a + button to add it to your draft queue.
* Your queue only lists the items you've queued.

[Bug Fixes]
* Regular members no longer see loot officer buttons they couldn't use.
```

Rules:
- Section titles name the feature or area ("Alliance Share Security",
  "Thread Membership", "Event End — Loot Prompt"). Use `[Bug Fixes]` for
  fixes to existing behaviour. Reuse an existing title when the area matches.
- A bullet is a full sentence. Say what was wrong before when that's the
  point ("Previously it was possible to …").
- Internal-only changes (refactors, tests, CI, deps, docs) get
  `Patch notes: none` on its own line.
- No secrets, internal URLs, guild IDs or user names in patch notes.

## Batching patch notes (only when asked)

When asked for patch notes:

1. Range: from the most recent `patch-notes/*` tag to `HEAD` on the branch
   that's deployed (`master`), unless told otherwise. With no tag yet, ask
   where to start.
2. Collect the blocks:
   `git log --reverse --format='%H%n%B%n==END==' <range>`
   and take everything between `Patch notes:` and the trailers.
   Skip `Patch notes: none`. For commits with no block, draft notes from the
   commit and diff, and point them out so they can be checked.
3. Merge sections with the same title, drop duplicate or superseded bullets
   (a fix to something added in the same batch isn't a separate bug fix),
   and put `Bug Fixes` last.
4. Output in this format, titled with the date of the newest commit:

```
Patch Notes — November 10
 Loot Draft Queue

* …

 Bug Fixes

* …
```

5. After the notes have been announced, and only when told to, tag the last
   included commit: `git tag patch-notes/YYYY-MM-DD <sha>` (and push the tag
   if asked).
