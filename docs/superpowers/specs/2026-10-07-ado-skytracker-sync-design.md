# SkyTracker <-> ADO sync - design (v2, ownership flipped)

Date: 2026-10-07 (v2 evening). Status: design only (GO 07.10); nothing in this document is built yet.
Source: `ClaudeReports/planning/roadmap-2.0/handover-v2-ownership.md` (replaces the morning's "ADO is the source
of truth for the work" and "time never flows back into ADO").
Companion: `2026-10-07-epic-roadmap-timeline-design.md` (the epic timeline for Friday; unchanged by this).

## Principle

SkyTracker is the **planning interface used in produktforum**. Features and epics are created and steered there and
**pushed to ADO**. SkyTracker owns **estimates and dependencies**; ADO **mirrors** them. ADO owns **stories and
sprints**, because that is where the team plans and does the work. Sprint progress in ADO is what turns the traffic
light for the goals that are set.

## Ownership (one owner per field)

| What | Owner (writes) | Mirror (reads) | How it is mirrored |
|---|---|---|---|
| Epic: title, goal, target metric, goal date | SkyTracker | ADO | Create/update ADO Epic; goal date -> `Microsoft.VSTS.Scheduling.TargetDate` |
| Feature: created, title, description | SkyTracker | ADO | Create ADO Feature when the feature is added in SkyTracker (after produktforum says yes) |
| Feature -> Epic (parent) | SkyTracker | ADO | `System.LinkTypes.Hierarchy-Reverse` |
| Feature state New / Discovery / Active | SkyTracker | ADO | `System.State` |
| Discovery end date | SkyTracker | ADO | Feature `TargetDate` while in Discovery |
| Estimate range (likely / late, weeks) | SkyTracker | ADO | Read-only custom fields on Feature (see "ADO fields") |
| Dependencies (blocker -> blocked) | SkyTracker | ADO | `System.LinkTypes.Dependency` (Predecessor/Successor; `addPredecessorLink` in `ado/client.ts` already does this) |
| Stories under a feature | ADO | SkyTracker | Read: count, state, story points |
| Sprints, sprint membership | ADO | SkyTracker | Read: iteration path + dates |
| Feature state Resolved / Closed | ADO | SkyTracker | Read (delivery happens in ADO) |
| Traffic light per feature and epic | computed in SkyTracker | (ADO optional) | From ADO sprint progress + SkyTracker estimate + epic goal date |

Rules:
- The other side shows an owned field read-only. If someone edits a SkyTracker-owned field in ADO, the next sync does
  NOT overwrite it silently: it is listed as a conflict in the forum view and GO picks a side.
- Push SkyTracker -> ADO is **explicit** (a button or an action such as "legg i epic"), not a background job, until
  GO says otherwise. Reading from ADO (stories, sprints, Resolved/Closed) is a refresh button now, a cron later.
- Every write to ADO is logged in `TimelineChange` (who, what, old -> new, ADO id).

## Feature lifecycle

1. Produktforum says yes -> feature created in SkyTracker -> pushed to ADO as **New** ("venter på utredning").
2. Discovery starts -> SkyTracker sets **Discovery** with an end date -> pushed.
3. Spec signed -> estimate set in SkyTracker (optionally pulled on demand from Skytale.Specs) -> state back to
   **New**, now with an estimate = "klar for veikart".
4. Produktforum puts it in an epic -> SkyTracker sets parent + **Active** -> pushed. The team writes stories under it
   and plans sprints in ADO.
5. Stories done -> feature **Resolved/Closed** in ADO -> read back into SkyTracker.

"New" means two things in ADO; SkyTracker tells them apart by whether the estimate is set.

## Data model additions (after Friday)

The timeline plan (`TimelinePlan` row `epics`, see the timeline design) is the store. Additions:

- Task: `state: "new" | "discovery" | "active" | "resolved" | "closed"` (owned here up to `active`; `resolved`/`closed`
  read from ADO), `adoId` (exists), and a sync-owned group `ado` = `{ pushedAt, snapshot: {title, state, parentId,
  targetDate, likelyWeeks, lateWeeks, deps[]}, progress: {stories, points, pointsDone, sprint, refreshedAt} }`.
  `snapshot` is what the last push wrote, used to detect edits made in ADO; `progress` is the read-back.
- Lane: `adoId` (exists), `ado: { pushedAt, snapshot: {title, targetDate} }`.
- Features not yet placed in an epic live in the reserved lane `_backlog` (hidden on the timeline, the first three
  forum columns read from it). `kind` keeps driving the drawing: `state = discovery` <-> `kind = discovery`;
  everything else is drawn as an estimate once the range is set.
- `merge.ts`: new field groups `state` (`state`) and `ado` (`ado`), both versioned like the others, so a push on one
  client and an edit on another merge per group as today.

Ids: items created in SkyTracker keep their local ids and gain `adoId` on push. Existing ADO Features that are
adopted (4789-4793 and the discovery features) are linked by setting `adoId`; `title-match.ts` from
`feat/reconcile-ado-cards` can propose the links.

## Mechanics

1. **Push** `POST /api/ado-push` body `{ kind: "epic" | "feature", id }`, writers only. Builds the work item patch
   from the lane/task (title, description, state, parent, TargetDate, estimate fields if present, dependency links),
   creates or updates it through `src/features/ado/client.ts` (generalise `createWorkItem` with a work-item-type
   argument; it is hard-wired to "User Story" today), stores `adoId` + `ado.snapshot` on the item, logs a
   `TimelineChange` row (`kind: "ado-push"`, `after.adoId`). Actions that push: "Opprett i ADO" on epic and feature,
   "Start utredning", "Klar for veikart", "Legg i epic" (parent + Active).
2. **Refresh** `POST /api/ado-refresh`: for every item with `adoId`, read the work item (fields + relations), compare
   the SkyTracker-owned fields with `ado.snapshot`; differences -> conflict entries (`{id, field, ours, theirs}`)
   returned to the page and shown at the top of the forum view, never applied. Read-back fields (child stories, story
   points done/total, iteration, Resolved/Closed) are written into `ado.progress` and `state` when ADO moved the
   feature to resolved/closed.
3. **Estimate pull** "Hent estimat fra utredningen": reads the feature's folder in Skytale.Specs (ADO repo `971ee73e`;
   the file, `spec.md` front matter or `estimate.yaml`, is GO's call), shows old -> new, applies only on confirm,
   logs. Never automatic, so a buffer added in produktforum is not overwritten.
4. **Auth**: server-side `SKYTRACKER_ADO_PAT` (`src/features/ado/config.ts`); the Vercel env needs a live PAT (the
   personal one in `.env` has expired). Locally, `az account get-access-token --resource
   499b84ac-1321-427f-aa17-267ca6975798` works for experiments.

## Traffic light

- **Friday:** the timeline's current rule only (estimate range vs goal date; "Venter på utredning" while any feature
  is in discovery). See the timeline design.
- **After the ADO read-back (rule from Skytale DevOps v3.1, to confirm with GO):** green = story-point progress keeps
  up with elapsed time inside the range; amber = the trend leaves the range, or a named blocker; red = the range is
  broken -> new range and a notice the same week. The epic takes the worst colour of its features.

## ADO fields (needs GO's explicit OK; changes the process for every project on it)

Process "SkytaleAS Agile" (inherited, id `79c72108-bf5f-4125-8a1f-2815708022d8`), type `SkytaleASAgile.Feature`.
Planning group today: Release, Priority, Risk, Effort, Business Value, Time Criticality, Start Date, Target Date.
Proposed: `Custom.EstimateLikelyWeeks` and `Custom.EstimateLateWeeks` (decimal), in Planning after Effort, written
only by the sync. Until they exist, the push writes everything except the estimate.

## Workstream C: forum view (design; not for Friday unless GO asks)

Route `/forum` in SkyTracker, same login and roles as `/timeline`:
- Columns: Venter på utredning (state new, no estimate) · Under utredning (discovery; end date, owner, spec link) ·
  **Klar for veikart** (new + estimate; range, spec link, dependencies) · I veikartet (active; epic, delivery range
  from the timeline, colour).
- Epic panel: epics with goal date and colour; "Ny epic" creates it here and pushes to ADO.
- Drag a "klar" feature into an epic -> the timeline previews the price (what moves, which epics change colour) ->
  confirm -> parent + Active pushed to ADO, decision logged (`TimelineChange`, `kind: "forum-decision"`).
- Conflicts from the refresh are listed at the top.
- PreSales' list (wishes not yet in ADO) is out of scope.

The preview reuses the timeline page's rendering: the forum page embeds the same `epic-tools.js` and computes
`epicStatus` on a cloned plan with the feature moved, before anything is saved.

## Existing code to build on

- `src/features/ado/{client,config,mappers}.ts`: work item creation, iteration lookup, predecessor links.
- `Card.adoWorkItemId` (migration 20260527) and the card modal's "create in ADO".
- `feat/provision-ado-sprints` (May): sprint provisioning, useful for the sprint read-back.
- `feat/reconcile-ado-cards` (unmerged): `scripts/lib/title-match.ts` for adopting existing ADO items.

## Open questions for GO (recommendation in brackets)

1. Push SkyTracker -> ADO: a button per action, or automatic? [button per action to start]
2. Traffic light rule after the read-back: the v3.1 progress rule, or simpler first? [range vs goal first, progress
   as a second signal shown next to it, not mixed into the colour until the read-back has run for a sprint or two]
3. Where discovery writes the estimate in Skytale.Specs. [`estimate.yaml` beside `spec.md`: `likely_weeks`,
   `late_weeks`, `estimated_by`, `date`; easy to parse and to diff]
4. OK to add the two read-only estimate fields to the ADO process? [yes, named as above; the push works without them
   until then]
5. Anything for the forum view by Friday? [no; the timeline with placeholders and the deck carry the meeting]

## First step after Friday

Push of epics and features (create/update in ADO, parent, state, TargetDate) plus the refresh with conflict listing.
The forum view comes after that, on top of the same plan store.
