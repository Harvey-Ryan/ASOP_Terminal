# Community corrections (v1.53.0)

- Members fix numbers the game files get wrong; corrections never change
  `scdata`. Rules and the lifecycle are in `packages/shared/src/corrections.ts`
  (`CORRECTION_KINDS` = the only stats that can be corrected, with ranges;
  `correctionActions` = who may do what; `recheckOnNewBuild`). Models:
  `DataCorrection`, `CorrectionConfirmation`, `CorrectionEvent` (every
  action, in order), `DataReviewer`. API: `routes/corrections.ts`, helpers in
  `lib/corrections.ts`; reviewers in `routes/admin.ts` (`/api/admin/reviewers`).
- Checks and balances: submit needs ASOP membership, an uploaded screenshot
  (`/uploads/corrections/…`, re-encoded like every upload) and a note; the
  game value is read by the server (`gameDataFor`), never sent by the
  browser; `CONFIRMATIONS_NEEDED` (2) other members confirm; then a data
  reviewer (or platform admin) who is neither the submitter nor a confirmer
  approves (big changes, `isBigChange`, need `acknowledgeBigChange`). Reject,
  dispute and revert need a reason. One applied correction per stat (approving
  supersedes the old one). Daily limits per person. Each action holds the row
  (`FOR UPDATE`). Ready / approved / disputed / reverted / re-check / retired
  go to the admin Discord feed.
- New game build: `recheckForBuild()` (run by `GET /api/corrections/live`)
  retires a correction the files now agree with (credit kept) and sends one
  whose game value moved to RECHECK (not shown until re-approved, which makes
  the new game value the baseline).
- Website: `pages/tools/corrections.tsx` — `<Fix>` wraps a correctable stat
  (dotted underline + credit when corrected, a hover ✎ to submit),
  `CorrectionsProvider`, `DataViewToggle` ("Corrected · Game files", kept in
  the browser, default Corrected; `useDataView`) and `BuildBadge` (`GET
  /api/game-tools/build`, amber when newer data is waiting upstream) in the
  tools header. Pages apply corrections with `applyCorrections` before sorting
  or matching. Queue: `/tools/corrections` (`CorrectionsPage.tsx`), with the
  reviewer list for platform admins. Wired into Mining (lasers, modules,
  gadgets, rock signatures); a new correctable stat goes into
  `CORRECTION_KINDS` and `findGameRecord` (`lib/corrections.ts`).
- Credit is the submitter's Discord display name unless they untick it.
  Corrections are in Your data: export lists them; delete keeps the
  corrections but drops who sent, confirmed or reviewed them.
- Components (v1.46.0): shields, power plants, coolers, quantum drives and
  radars (`packages/shared/src/components.ts`; `componentSlots` on each ship,
  `components` in the data, `?sk0=` / `?ck0=` in the address). Base stats
  only (= crafted quality 500). Only parts with a class and an A–D grade can
  be swapped in; bespoke and placeholder parts show only where a ship comes
  with them, and `Editable: false` slots are fixed. Rules checked against
  Erkul: only the two strongest shields are up (every ship's shield pool is
  2; `ACTIVE_SHIELDS`); quantum range = tank (mSCU) ÷ the drive's
  `FuelRequirement10GM` × 100 (the ships file's own `Range` uses an older
  formula); a power plant's output depends on pips, so there's no ship
  "total power" figure.
- Gun mounts (v1.64.0): who fires a ship's turret or gun mount (`gun-mount`,
  record key `gunMountKey(<ship class>, <mount group>)`, field `role`) is a
  `choice` stat stored as a number (`GUN_ROLE_CODES`: pilot 0, takeover 1,
  crew 2, auto 3; never renumber). Same lifecycle as every correction; a
  choice is never a big change, and values read as words everywhere
  (`formatCorrectionValue`). The game value is the files' role
  (`gunMountRecord`, from the ship data); `findGameRecord` takes both kinds
  of data (`CorrectableData`), and `recheckForBuild` skips a kind whose data
  isn't loaded yet instead of sending it for a re-check. Ship pages wrap
  their content in `CorrectionsProvider`, apply live ones with
  `applyGunMountCorrections` (slots get `roleCorrected`), and put `<Fix>` on
  "Fired by the pilot" (Armament) and each turret's role (Turrets).

