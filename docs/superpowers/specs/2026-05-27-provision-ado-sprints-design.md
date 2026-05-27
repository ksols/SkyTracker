# Design: Provision future ADO sprints

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Related:** follow-on to the ADO work-item creation feature (so future sprint numbers resolve when cards are synced).

## Goal

A re-runnable command-line script that creates upcoming 2-week sprints in Azure
DevOps — both the iteration classification node (with dates) and its
registration as a **Dev Team** backlog iteration — continuing the existing
cadence, with a dry-run preview and explicit break-week control.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Trigger | **Re-runnable script** in `scripts/`. Not auto-on-demand, not in-app. |
| Date logic | **Continue the 2-week cadence; user confirms and can skip weeks.** |
| Credential | `ADO_PAT` (broader scope), read from `.env`. Distinct from the app's `SKYTRACKER_ADO_PAT`. |

## Verified ADO facts (live, 2026-05-27)

- Project `Skytale`, team **`Dev Team`**, `api-version=7.1`.
- Sprints are Monday → second Friday (start + 11 days). Latest is `Sprint 65`
  (2026-05-18 → 2026-05-29). Sprint dates carried in node `attributes`
  (`startDate`/`finishDate`, ISO `…T00:00:00Z`).
- Create node: `POST {org}/Skytale/_apis/wit/classificationnodes/iterations`
  with `{ name, attributes: { startDate, finishDate } }` → returns `identifier` (GUID).
- Register with team: `POST {org}/Skytale/Dev Team/_apis/work/teamsettings/iterations`
  with `{ id: <identifier GUID> }`.
- Cadence has real gaps (a ~1-week break before Sprint 65), so date math must
  allow inserting break weeks rather than assuming unbroken back-to-back sprints.

## Behaviour

### Invocation
- `npx tsx scripts/provision-sprints.ts` → **dry run**. Reads existing iterations,
  computes the next N sprints, prints a table (name + start + finish). Writes nothing.
- `--count <n>` — how many sprints to propose (default 6).
- `--skip <YYYY-MM-DD>[,…]` — Mondays that are break weeks. When a computed start
  Monday is in this set, it is pushed one week later (and re-checked), inserting a
  one-week gap. This is how planned breaks (like the May skip) are honoured.
- `--apply` — actually create + register the proposed sprints.

### Cadence computation (pure, testable)
1. Read existing `Sprint <n>` iteration nodes; take the max number and its
   `finishDate` as the anchor.
2. First candidate start = the first Monday strictly after the anchor finish.
3. For each of N sprints: while the candidate Monday is in the skip set, add 7
   days. Then `finish = start + 11 days`; the sprint's number is `max + i`.
   Next candidate = `finish + 3 days` (the following Monday).

### Creation (only with `--apply`)
For each proposed sprint, in order:
1. Create the iteration classification node with its dates → capture `identifier`.
2. Register that `identifier` as a Dev Team backlog iteration.

### Append semantics (NOT idempotent)
The plan always anchors on the **latest existing** sprint and projects forward,
so each `--apply` **appends N new sprints beyond the latest** — running it again
appends N more. It is *not* idempotent: `--count 6 --apply` run twice yields 12
new sprints. The safety mechanism is the **dry-run-first workflow** — you always
see the exact list of sprints (names + dates) that will be created before passing
`--apply`. The existing-name skip-filter remains only as a guard against a manual
out-of-band collision (e.g. someone created the next sprint by hand); in the
normal forward-only flow it never fires.

## Error handling
- Missing `ADO_PAT` → clear error, exit non-zero.
- A failed node-create aborts that sprint and continues to the next (logged);
  the script exits non-zero if any sprint failed so failures are noticeable.
- A node created but team-registration failing is reported explicitly (the node
  exists but isn't planable) so it can be retried/fixed.

## Testing
- Pure cadence logic (`computeSprintPlan`, `nextMondayAfter`) is unit-tested
  with vitest — including the skip-week and idempotency-filter behaviour.
- The ADO HTTP calls are verified manually via a dry run + a single `--apply`
  against the live project, then confirmed in the ADO sprints UI.

## Out of scope (YAGNI)
- Editing or deleting existing sprints/iterations.
- Non-`Sprint N` iteration names.
- Any SkyTracker DB or UI change (this is an ADO admin tool only).
- Registering iterations to teams other than Dev Team.
