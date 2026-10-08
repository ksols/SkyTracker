# SkyTracker as the planning system: design and build plan

Date: 2026-10-08. Status: approved by GO on 08.10.2026 (the design and all eight recommendations in §6). The HLD that
GO signs before the build starts is the artifact «Tidslinjen som planleggingssystem»; its link and the kick-off prompt
for the build session are in `~/Skytale/ClaudeReports/planning/roadmap-2.0/build-prompt.md`.
Scope: not the Friday demo. This is the system the company plans from after Friday, built in SkyTracker.

## 0. Mandate (GO's words, verbatim)

08.10.2026, after the gap analysis `alignment-process-vs-timeline.md`:

> This is not just the scope of friday, this is the system we are going to use to work from... right... so Lets make a
> proper plan to build from Skytracker and the timeline also needs a diff log so we can show historical movements so we
> can understand why something got shifted. If a goal changed or if something got dragged out in estimate or if a
> priority was shifted.

08.10.2026, on the decisions in §6 and the first plan: «ok go with your recommendations, write the R1a plan».

08.10.2026, on how it is built:

> So you say may original promt was 30 days. I think you need to save my promt refer to this plan. Ill start a session
> in cux. And youll build from start to finish. THe tool we need. But first youll draw the HLD in an artifact so I can
> sign of on it. I dont think its 30 days. more like a full day where you build it.

> Per the specification to the process you have been a part of creating

What that means for this document:

- The tool is built per the process: PROS-PLAN-01 rev A «Fra ønske til levert», PROS-DISC-01 rev B, PROS-SPRINT-01
  rev A and the deck «Et veikart vi kan holde». Where this document and the process disagree, the process wins and this
  document is corrected.
- Build mode: one continuous session builds every release in §5, in order, start to finish, after GO has signed the HLD.
  The «build days» in §5 were per-release estimates for a developer, not a schedule. Each release keeps its «done when»
  gate and its verification. One branch, one PR, one commit per task. Release R1a has its plan written
  (`docs/superpowers/plans/2026-10-08-timeline-history-r1a.md`); the plans for R1b–R6 are written in the session from this
  document, one at a time, and executed the same way.
- The three questions the history must always answer: a goal changed (who, when, from what to what, why); an estimate
  was dragged out (which feature, how many weeks, by a person or by which dependency); a priority was shifted (which
  epic or feature, from which place to which, in which forum, with which reason).
Sources: the deck «Et veikart vi kan holde» (s9 journey, s11 estimate, s20 funnel, s21 hold/bust, s22 tools,
s25 dependencies, s26 investors, s27 cadence, s29 action plan), PROS-PLAN-01 rev A, PROS-DISC-01 rev B,
PROS-SPRINT-01 rev A, `ClaudeReports/planning/roadmap-2.0/handover-v2-ownership.md` (ownership table), the gap
analysis `ClaudeReports/planning/roadmap-2.0/alignment-process-vs-timeline.md` (gaps A–K, referenced below), and
the two existing specs in this folder (`2026-10-07-epic-roadmap-timeline-design.md`,
`2026-10-07-ado-skytracker-sync-design.md`). Where this document and the sync design differ, this one wins.

## 1. What the system is

SkyTracker is where the plan lives and where produktforum works. ADO mirrors the plan and owns execution (stories,
sprints, Resolved/Closed). Skytale.Specs holds specs, stories with points and the raw estimate. The timeline is the
one view: it shows the plan, how the plan has moved, and why.

Three audiences, one data set:

| Who | Needs | Gets it from |
|---|---|---|
| Ledelsen and PM (produktforum, monthly; «varsel samme uke») | Epics with måltall and måldato, colour, what moved since last time and why, the price of a decision before it is taken | The timeline, the history, the compare mode, the forum shelf |
| The dev team (sprints, demo every two weeks) | Discoveries with owner and end date, features with ranges, the sprint ruler, progress against the range | The timeline, the ADO mirror, the sprint report draft |
| Investors (quarterly) | Plan, gjennomføringsevne (delivered inside the range), målopnåelse (epics that reached their måltall, and which were changed on purpose) | Snapshots and events, later an investor view |

The loop the tool supports: wish → produktforum → discovery (end date) → estimate (range) → epic (goal date) →
sprints (progress) → delivered. Every step leaves a record.

## 2. Principles

1. **One owner per field.** The ownership table in `handover-v2-ownership.md` stands: SkyTracker owns epics, features,
   state up to Active, estimates, dependencies, priority; ADO owns stories, sprints, Resolved/Closed.
2. **Status is computed, never typed.** Colour comes from the range, the goal date and (later) progress.
3. **Every movement is recorded with who, when, what and why.** The server derives *what* from the saved plan, so
   nothing is missed; the client adds *why* (the reason) and the cause (a dependency, a merge, a sync). Nothing is
   overwritten silently: the field merge keeps concurrent edits, the history keeps the past.
4. **The plan can be compared with any earlier point:** a named baseline (a forum, a sprint start) or a date.
5. **Writes to ADO are explicit** (a button per action); reads from ADO are a refresh, later a cron.
6. **One view.** The forum works in the timeline (a shelf of features ready for the roadmap, drag into an epic with
   the price shown first). A separate forum page is not built unless the shelf proves too small.
7. **Each release is usable on its own**, behind the same login and roles as today, with its migration shipped by
   `vercel-build` (`prisma migrate deploy`). No step depends on a later one to be useful.

## 3. Target data model

The plan stays one JSON document in `TimelinePlan` row `epics` with the field merge in `merge.ts` (per-group
versions on features, whole-object versions on epics). The columns «group» and «release» say how a field merges
and when it arrives. Fields marked R0 exist today.

### Epic (lane)

| Field | Type | Meaning | Release |
|---|---|---|---|
| `key`, `name`, `owner` («PM + CTO») | | | R0 |
| `goalDate`, `goalProvisional` | unit, bool | Måldato; «Foreløpig mål» | R0 |
| `adoId` | number | ADO Epic id once pushed | R0 (field), R3 (push) |
| `v` | number | version for the merge | R0 |
| `priority` | number | Order on the timeline, 1 = top. A **priority shift** is a change of this number | R1a |
| `metric` | text | Måltall, shown under the name | R1a |
| `externalDate` | bool | «Ekstern dato» badge; darker header (NSR, Telenor, revisjon) | R1a |
| `state` | `forslag` \| `aktiv` \| `avsluttet` | Proposal until produktforum chooses it; summary «2 aktive av 7», soft warning above 3 | R2 |
| `closedReason`, `closedAt`, `outcome` | text, ISO, `nådd` \| `ikke nådd` \| `endret` | The «nei» case and the investor's målopnåelse | R2 (fields), R6 (reports) |
| `ado` | `{ pushedAt, snapshot }` | What the last push wrote (conflict detection) | R3 |

### Feature (task)

| Field | Group | Meaning | Release |
|---|---|---|---|
| `id`, `label`, `lane`, `kind` (`discovery` \| `estimate`), `start`, `end`, `endLikely`, `adoId`, `deps[]`, `fv`, `editedBy`, `editedAt` | tid / label / deps / meta | As today. `end` is always the far end; estimates add `endLikely` | R0 |
| `order` | meta | Position inside the epic (priority within the epic). Moving to another epic sets `lane` and `order` together, which is why they share a group | R1a |
| `state` | state (new group) | `ny` (registered, no estimate) → `utredes` (discovery, end date) → `klar` (estimate, not in an epic) → `aktiv` (in an epic) → `levert` (ADO Closed). `kind` keeps driving the drawing | R2 |
| `assignee` | meta | The one developer who owns a discovery (initials on the bar) | R2 |
| `raw`, `bufferWeeks` | est (new group) | `raw = { likely, late, source, pulledAt }` is what discovery said; `likely`/`late` on the bar is the planned range incl. forum buffer. Label «4–6 uker + 1 uke buffer» | R2 |
| `committedRange`, `activatedAt`, `deliveredAt` | state | Snapshot of the range when the feature went `aktiv`; delivery date from ADO Closed. Gjennomføringsevne = delivered inside `committedRange` | R2 (fields), R4 (`deliveredAt` from ADO), R6 (reports) |
| `progress` | progress (new group) | `{ pointsDone, pointsTotal, sprint, at, source: "manuell" \| "ado" }`; drawn as a fill inside the likely segment | R4 |
| `ado` | ado (new group) | `{ pushedAt, snapshot, storyId }` for the feature and its discovery story | R3 |

Features not yet placed in an epic live in the reserved lane `_backlog` (hidden on the chart, shown on the shelf).

### History tables (new in R1a, one migration; R1b adds no schema)

```
TimelineChangeset { id, at, editor, source: "bruker" | "seed" | "ado" | "import" | "system",
                    reason?, reasonCode?, planVersion, eventCount }
TimelineEvent     { id, changesetId, at, editor,
                    targetType: "epic" | "feature", targetId, targetLabel, laneKey,
                    code,                 // vocabulary in §4.1
                    from Json?, to Json?, // the changed values only
                    cause: "bruker" | "avhengighet" | "flette" | "ado" | "system",
                    causeRef?,            // e.g. the blocker's id for cause = avhengighet
                    summary }             // the Norwegian sentence, rendered once on write
TimelineSnapshot  { id, at, kind: "dag" | "baseline" | "sprint", label?, planVersion, data Json, createdBy? }
```

`TimelineChange` (the table from August) stays as is, unused, like `BufferSnapshot`; it is dropped in a later
clean-up. `/api/timeline-changes` is rewritten to serve events.

## 4. The history: «Historikk»

GO's requirement: the timeline needs a diff log that shows historical movements, so that anyone can see why
something shifted: a goal date changed, an estimate was dragged out, a priority was moved. The design has two
halves that use the same diff function: the **event log** (the path, with reasons) and **baselines** (the net
movement since a chosen point, drawn on the chart).

### 4.1 Events: what is recorded

One row per semantic change, not per field group. The server computes them by diffing the stored plan against
the merged plan on every save (`diffPlans(before, after, annotations)` in `src/features/timeline/events.ts`,
which replaces `plan-delta.ts`). Epics are included; today only features are logged.

| Code | Fires when | `from` → `to` | Sentence (summary) |
|---|---|---|---|
| `epic.ny` / `epic.slettet` | lane added / removed | | «Ny epic» / «Epic slettet (med 3 features)» |
| `epic.navn`, `epic.maltall`, `epic.eier` | text fields | old → new | «Navn: … → …» |
| `epic.maldato` | `goalDate` or `goalProvisional` | `{date, provisional}` | «Måldato: 15. des → 15. jan» · «Foreløpig mål satt: 1. feb» · «Måldato fjernet» |
| `epic.ekstern` | `externalDate` | | «Merket som ekstern dato» |
| `epic.prioritet` | `priority` | 3 → 1 | «Prioritet: 3 → 1 (over Telenor)» |
| `epic.tilstand` | `state` (R2) | forslag → aktiv | «Valgt i produktforum» · «Avsluttet: nådd» |
| `feature.ny` / `feature.slettet` | task added / removed | | «Ny utredning» · «Feature slettet» |
| `feature.navn` | `label` | | |
| `feature.flyttet` | `start` changes | `{start}` + `deltaWeeks` | «Flyttet 2 uker senere: start 2. nov → 16. nov» |
| `feature.spenn` | `endLikely − start` or `end − start` changes (a plain drag gives only `flyttet`, a right-handle drag only `spenn`, a left-handle drag both) | `{likely, late}` in weeks | «Spenn: 4–7 → 6–9 uker (utvidet 2 uker)» |
| `feature.utredning-slutt` | discovery `end` changes | dates | «Utredning slutt: 6. nov → 20. nov» |
| `feature.estimert` | `kind` discovery → estimate | | «Utredet: estimat 4–6 uker» |
| `feature.epic` | `lane` changes | lane names | «Flyttet fra «Samtaler» til «Telenor»» |
| `feature.prioritet` | `order` changes inside the epic | 4 → 1 | «Prioritet i epicen: 4 → 1» |
| `feature.avhengighet` | `deps` changes | added/removed ids | «Blokkeres nå av IAM» · «Avhengighet til IAM fjernet» |
| `feature.tilstand`, `feature.eier`, `feature.estimat-hentet`, `feature.fremdrift`, `feature.levert` | R2–R4 fields | | «Klar for veikart» · «Eier: THM» · «Estimat hentet fra utredningen: 4–6 (uendret buffer 1 uke)» · «Fremdrift: 13 av 21 poeng» · «Levert 3. des» |
| `plan.seed`, `plan.baseline`, `ado.push`, `ado.konflikt`, `ado.lest` | system events | | «Eksempel lastet» · «Baseline «Produktforum 5. nov»» · «Pushet til ADO #4791» |

A drag that moves the start and widens the range produces two events. A save by the example seed produces one
`plan.seed` event, not 25 «ny» rows (the changeset's `source` collapses it).

### 4.2 Changesets, reasons and causes

- **Changeset = one save.** The page autosaves 900 ms after the last edit, so one drag, or one editor dialog, is
  one changeset. The reason belongs to the changeset; its events inherit it. The history panel groups by changeset.
- **Reason codes** (preset, Norwegian, plus free text): `utredning` «Utredningen viste mer/mindre arbeid» ·
  `avhengighet` «En avhengighet flyttet seg» · `kapasitet` «Kapasitet: annet gikk foran» · `prioritering`
  «Prioritert om i produktforum» · `ekstern` «Ekstern dato endret» · `omfang` «Omfanget endret» · `rydding`
  «Retting / rydding» · `annet` «Annet». Free text is the sentence management will read, so the dialog asks for it
  when the code is `annet` and allows it always.
- **When the page asks** (the reason dialog opens right after the edit, before the save goes out):

  | Change | Asks? |
  |---|---|
  | Goal date changed after it was first set; provisional → firm | yes |
  | Estimate range widened (likely or late up); estimate start moved later by ≥ 1 week | yes |
  | Discovery end date moved later | yes (PROS-DISC-01: «ny sluttdato gis før den passerer») |
  | Feature moved to another epic; epic priority changed; epic state changed; estimate feature deleted | yes |
  | New item, name edit, move earlier, range narrowed, discovery end earlier, dependency edit | no (logged, no dialog) |
  | Moves caused by a dependency push, a merge, the seed, the sync | never (cause recorded automatically) |

  The rule lives in one constant (`ASK_REASON_FOR` in the page) so GO can tune it after two weeks of use.
- **The dialog never blocks the save.** While it is open the autosave waits; «Lagre uten begrunnelse» sends the
  changeset with `reasonCode: "ingen"`. Those show as «Begrunnelse mangler» in the history and in the compare
  summary, and a writer can add the reason later from the panel (`PATCH`, see §4.6). Nagging, not blocking, so the
  tool stays fast in the forum.
- **Causes.** `resolveDeps` returns `{ id, by }` instead of ids; the page sends `causes: { [taskId]: "dep:<blocker>" }`
  with the save, and the server marks those events `cause: avhengighet`, `causeRef: <blocker>`, summary «Flyttet 2
  uker av avhengighet IAM». Today these pushes are logged as if the editor had dragged them, which is exactly the
  confusion GO wants gone. A field the merge took from another client is `cause: flette`; sync writes are `ado`.

### 4.3 Capture: the save path

```
PUT /api/timeline-plan  body { data, note?: { reason, reasonCode, causes } }
  stored  = row epics                           (as today)
  merged  = mergePlans(stored, incoming)        (as today)
  write merged with the version guard           (as today)
  events  = diffPlans(stored.data, merged, { editor, causes })
  if events.length:
     if no snapshot kind "dag" exists for today: insert TimelineSnapshot(kind "dag", data = stored.data)
     insert TimelineChangeset(source, reason, reasonCode, planVersion, eventCount)
     insert TimelineEvent[] (changesetId)
  respond { version, data: merged, changesetId }
```

The log write stays best-effort (a failed log never fails the save), but the response carries `changesetId` so the
page can attach a late reason. The daily snapshot stores the plan *as it was at the first change of the day*, so
«the plan on 5 November» is answerable for any date with ≤ 1 row per day (the plan is a few tens of KB).

### 4.4 Baselines and the compare mode

- **Baselines** are snapshots with a label: a writer clicks «Merk baseline…» (default label «Produktforum 5. nov»
  or «Sprint 72 start»); R3 adds automatic ones at every sprint start from the sprint ruler. Daily snapshots make
  any date a baseline too.
- **Compare mode** («Sammenlign med ▾» in the top bar: last baseline, sprint start, date picker): the page fetches
  the baseline plan and draws **ghost bars** (the baseline position, faint, behind the current bar), a dashed ghost
  goal marker where a goal date moved, «ny» on features that did not exist, and struck-through label rows for
  deleted ones. A summary strip reads: «Siden produktforum 5. nov: 2 måldatoer flyttet · 3 spenn utvidet · 1
  feature byttet epic · 2 prioriteringer · 4 begrunnelser mangler».
- **«Siden sist» list**: under the strip, the events since the baseline grouped per epic, each with its reason and
  cause. This is the «hva har flyttet seg og hvorfor» page for the forum and the first draft of the sprint report
  (PROS-SPRINT-01 day 10: «spenn som endret seg»). **Export** copies it as text/markdown with the sections Måldatoer ·
  Spenn · Flyttet · Prioritet · Nye og fjernet · Begrunnelser mangler.
- Net movement (baseline vs now) and the path (events in between) come from the same `diffPlans`; the server
  computes both in `GET /api/timeline-compare` so there is one implementation.

### 4.5 UI

- **Historikk drawer** (button «Historikk» in the top bar; right-hand drawer like the help panel): newest first,
  grouped by changeset (time · editor · reason chip), one line per event, filter by epic, search by text, «Last
  flere». Readers can open it; writers see «Legg til begrunnelse» on changesets without one.
- **Per epic**: «Historikk» in the epic editor shows the epic's own events and its features' events.
- **Per feature**: a history tab in the feature editor.
- **Reason dialog**: lists what the changeset contains («Måldato Telenor: 15. des → 15. jan»), the code buttons,
  a text field, «Lagre» / «Lagre uten begrunnelse».
- **Compare bar** under the top bar when compare mode is on, with the summary strip and «Avslutt sammenligning».
- **Badge** on the Historikk button: the number of changesets without a reason in the last 14 days.

### 4.6 API

| Route | Who | Does |
|---|---|---|
| `PUT /api/timeline-plan` | writer | As today plus `note` in the body and `changesetId` in the response |
| `GET /api/timeline-changes?lane=&target=&since=&until=&before=&limit=` | any | Events with their changeset (reason, source); newest first; paged |
| `PATCH /api/timeline-changes` body `{ changesetId, reason, reasonCode }` | writer | Adds or edits a reason; logged as `system` event «Begrunnelse lagt til» |
| `GET /api/timeline-snapshots` · `POST { label }` | any · writer | List baselines; create a named baseline from the current plan |
| `GET /api/timeline-compare?from=<snapshotId \| YYYY-MM-DD>` | any | `{ baseline: { at, label, data }, net: Event[], path: Event[] (with reasons) }` |

### 4.7 What it answers

| GO's case | Where it shows |
|---|---|
| «A goal changed» | `epic.maldato` event with reason; dashed ghost goal line in compare mode; the epic's history |
| «Something got dragged out in estimate» | `feature.spenn` («utvidet 2 uker») and `feature.flyttet` with reason; or `cause: avhengighet` naming the blocker; ghost bar shows the old range |
| «A priority was shifted» | `epic.prioritet`, `feature.prioritet`, `feature.epic`, `epic.tilstand` with reason «Prioritert om i produktforum» |
| «Why did Telenor go red?» | The epic's history, newest first, is the chain: Kapasitet widened (reason: utredning) → pushed Rollebasert (dependency) → goal unchanged |

## 5. Releases

Calendar weeks follow the deck's action plan: discoveries start in week 43, «tidslinjen satt opp fra SkyTracker» in
week 44, sprint report every two weeks from then. Effort is build days for one developer with GO reviewing and
merging; each release is one PR, or two where marked, cut from `origin/main`.

| Release | Name | Target | Builds on | Done when |
|---|---|---|---|---|
| R0 | Epic timeline (PR #11, #12) | merged 07–08.10 | | |
| R1a | Historikk: events, reasons, priority | week 42 (by 16.10) | R0 | Every goal, range, order and epic move has an event with who/when/what/why; dependency pushes name the blocker |
| R1b | Baselines and compare | week 43 (by 21.10) | R1a | «Siden produktforum …» shows ghost bars, the summary strip and an exportable list |
| R2 | Lifecycle and the forum shelf | week 43–44 | R1a | A feature goes ny → utredes → klar → aktiv in the tool; the forum places from the shelf with the price shown first; raw estimate and buffer are separate |
| R3 | ADO mirror and sprint ruler | week 44–46 | R2 | Epics, features, states, dates, deps and the discovery story exist in ADO from a button; conflicts are listed, never overwritten; sprints are drawn on the axis |
| R4 | Progress, traffic light, reports | week 46–48 | R3 | Progress fills the bars (manual on day 10, then read from ADO); «Levert» comes from Closed; the sprint report and the same-week notice are generated |
| R5 | Queue and capacity | week 48–50 | R2, R4 | A feature's start follows its blockers and its developer's earlier work; what-if preview on the shelf |
| R6 | Investor numbers | Q1 2027 | R2, R4 | Gjennomføringsevne and målopnåelse computed from snapshots and events; investor view |

### R1a: Historikk — events, reasons, priority (about 3.5 build days)

Scope
1. `events.ts`: `diffPlans(before, after, { editor, causes })` → `Event[]` for epics and features, with the
   vocabulary in §4.1 and the summaries. Replaces `plan-delta.ts`; its tests move over.
2. Migration `add_timeline_history`: `TimelineChangeset`, `TimelineEvent`, `TimelineSnapshot`.
3. `PUT /api/timeline-plan`: `note` in, `changesetId` out, daily snapshot, changeset + events (§4.3).
4. `GET /api/timeline-changes` rewritten for events; `PATCH` for late reasons.
5. Page: `resolveDeps` returns `{ id, by }`; the save sends `causes`; the reason dialog with `ASK_REASON_FOR`; the
   Historikk drawer; per-epic and per-feature history; the missing-reason badge.
6. Priority: `priority` on epics (drag handle on the epic row in the label column, plus ▲▼ in the epic editor),
   `order` on features (drag within and between epics in the label column). Lanes sort by `priority`, tasks by
   `order`; both survive the merge because they are data, not array order. Events `epic.prioritet`, `feature.prioritet`,
   `feature.epic`.
7. From the gap analysis, cheap and visible: `metric` and `externalDate` on epics (A), the delivery-window text
   «4–7 uker → uke 49–51» per feature and «Leveres uke 49–51 · Måldato 15. des» per epic (D), the «Utredning
   forsinket» chip when a discovery's end date has passed (C).

Verification: vitest for `diffPlans` (every code in §4.1 has a case; a drag that moves and widens gives two events;
seed gives one `plan.seed`; dependency push gives `cause: avhengighet` with the blocker); the hosted smoke
(`scratchpad/hosted-smoke.mjs`) extended with a mock that records `note` and serves events: drag the goal date →
dialog → reason saved → drawer shows the sentence; dependency push shows the blocker; reorder epics → event; `npx
tsc --noEmit`, `npx next build`, `prisma migrate dev` against a local Postgres only.

### R1b: Baselines and compare (about 2.5 build days)

Scope: `POST/GET /api/timeline-snapshots`, `GET /api/timeline-compare`; «Merk baseline…»; «Sammenlign med ▾» with
ghost bars, ghost goal markers, «ny» and deleted rows, the summary strip, the «Siden sist» list with reasons, the
text export; `plan.baseline` event. Verification: vitest on the net diff of two plans; smoke: seed → baseline → move
a goal and widen a range → compare shows 1 måldato, 1 spenn, ghost bar at the old place, export contains both lines.

### R2: Lifecycle and the forum shelf (about 5 build days; gaps B, A state, C assignee, E, I)

Scope: `state` on features with the transitions and the actions «Start utredning» (asks for `assignee` and end
date), «Klar for veikart» (sets the range; discovery → estimate), «Legg i epic» (sets `lane`, `order`, `state:
aktiv`, writes `committedRange` and `activatedAt`); the `_backlog` lane drawn as a collapsible shelf under the chart
(«Klar for veikart»: range, spec link, dependencies) with drag into an epic and a **price preview** (the target
epic's new colour and the features that move, computed on a cloned plan before the drop is confirmed); epic
`state` forslag / aktiv / avsluttet with `closedReason` and `outcome`, summary «2 aktive av 7»; `raw` + `bufferWeeks`
with the label «4–6 uker + 1 uke buffer» and the editor field «Buffer (uker)»; «Hent estimat fra utredningen»
button wired to a stub that shows old → new (the Specs reader lands in R3); S/M/L/XL class from the discovery's
duration; new merge groups `state`, `est`. Every transition is an event (`feature.tilstand`, `feature.estimert`,
`epic.tilstand`) and the «Legg i epic» decision asks for a reason by default (`prioritering`).
Verification: vitest on `normalizePlan` (state ↔ kind rules, `_backlog`), `mergePlans` with the new groups,
`epicStatus` ignoring `_backlog`; smoke of the full path ny → utredes → klar → aktiv with the shelf and the preview.

### R3: ADO mirror and sprint ruler (about 7 build days; sync design «Mechanics» 1–2, gap K)

Scope: `POST /api/ado-push { kind, id }` (create or update Epic / Feature: title, description, state, parent,
TargetDate, dependency links, and the discovery story under the feature with `assignee` and end date when the state
is `utredes`); `ado.snapshot` per item; `POST /api/ado-refresh` (read fields and relations, list conflicts on
SkyTracker-owned fields, write read-back fields: child stories, points, iteration, Resolved/Closed → `state: levert`,
`deliveredAt`); conflicts shown at the top of the page; the sprint ruler (iteration paths and dates read from ADO,
cached in the plan as `sprints[]`), «Sprint 71 · dag 4» on the today line, current sprint goal next to the legend,
automatic baseline at sprint start; `client.ts` generalised to a work-item-type argument (hard-wired to «User
Story» today); `SKYTRACKER_ADO_PAT` in Vercel; the Skytale.Specs reader for «Hent estimat fra utredningen» (file
format = GO's decision 3 below). Estimate fields in ADO only after GO's decision 4; until then the push writes
everything else. Events `ado.push`, `ado.konflikt`, `ado.lest`.
Verification: vitest on the patch builders and the conflict detection with recorded ADO responses; a dry-run mode
(`?dry=1`) that returns the patches without sending; first live push on one test Feature in ADO agreed with GO.

### R4: Progress, traffic light and reports (about 5 build days; gaps G, H, K)

Scope: `progress` on features: manual entry on day 10 («Fremdrift» in the editor: points done / total, or %)
drawn as a fill inside the likely segment, replaced by the ADO read-back from R3 when stories exist; the v3.1
progress rule as a **second signal** next to the range colour (not mixed into the epic colour until GO has seen it
for two sprints); «Levert» from Closed; the **sprint report**: «Siden sprintstart» export from R1b plus progress
per feature and the discoveries that moved on, as markdown for utviklingsleder's day-10 report; the **same-week
notice**: when a save turns an epic yellow or red, the server posts to a Slack channel (the existing Slack MCP, or
a webhook) with the epic, the new window and the reasons from the changeset; a weekly digest from the same data.
Verification: vitest on the progress rule and on the digest text; smoke on the fill; one notice to a test channel.

### R5: Queue and capacity (about 4 build days; gap F)

Scope: a feature's start is computed, not dragged, once it is `aktiv`: after its blockers' late end and after the
same developer's earlier `aktiv` features (the `assignee` sequencing rule); manual override allowed and logged
(`feature.flyttet` with `cause: bruker`); the sprint mix (transition 55/35/10, normal 60/15/15/10) as a factor on
elapsed time, stated in the help panel; the shelf preview from R2 upgraded to show the computed delivery window
of the dropped feature and of everything it pushes. The board bridge (`schedule.ts`, `/api/timeline-export`) is
retired if the assignee rule is enough; GO decides after R4 (decision 6).
Verification: vitest on the sequencing with fixtures (two developers, three features, one blocker); smoke on the
preview.

### R6: Investor numbers (about 3 build days; gap I)

Scope: a report route and a page section («Investorer») with: the plan (active epics with måltall, måldato,
colour), gjennomføringsevne (features delivered inside `committedRange` ÷ delivered, over the last two quarters),
målopnåelse (epics closed as `nådd` / `ikke nådd` / `endret`, with the `epic.tilstand` and `epic.maldato` events
that carry the forum's reasons). Export as markdown and a slide-sized HTML. Verification: vitest on the metrics with
fixtures; a sample report from the first real quarter.

## 6. Decisions for GO (recommendation in brackets)

1. Reason policy: ask on the changes in §4.2 and allow «uten begrunnelse», or require a reason for goal and range
   changes? [ask, allow skipping, show what is missing; tighten after two weeks if reasons are skipped]
2. Priority: is epic order on the timeline the priority produktforum sets, and feature order inside an epic the
   dev team's build order? [yes to both; both logged, only the epic order asks for a reason]
3. Where discovery writes the raw estimate in Skytale.Specs. [`estimate.yaml` beside `spec.md`: `likely_weeks`,
   `late_weeks`, `points`, `estimated_by`, `date`]
4. The two read-only estimate fields in the ADO process (`Custom.EstimateLikelyWeeks`, `Custom.EstimateLateWeeks`).
   [yes; the push works without them until then]
5. Push to ADO: a button per action to start, automatic later? [button; revisit after R4]
6. Capacity in R5: the assignee rule or the board bridge? [assignee rule; decide after R4 with real data]
7. The same-week notice channel: Slack channel or mail? [Slack, the MCP exists; mail later if ledelsen wants it]
8. Wording: «Tidslinjen» everywhere (page title, board link, deck, PROS-PLAN-01). [yes, in R1a]

Documents on GO's side that still contradict the ownership flip (deck s14 notes and s26 «Kilde: epicene i ADO»,
PROS-PLAN-01 «Tidslinjen: epics fra ADO» and step 5, PROS-DISC-01 «ADO Feature: arbeidsflyt og tilstand» and
step 4) are listed in the gap analysis §3; they are not changed by this plan.

## 7. How the work runs

- One worktree (`~/Skytale/SkyTracker-wt-epics`), one branch per release cut from `origin/main` (main is squash
  merged, never stack on a merged branch), one PR per release (R1a and R1b separately). GO pushes the branch and
  merges; the Vercel build applies the migration.
- Each release gets its implementation plan in `docs/superpowers/plans/` before coding starts, written from this
  document, and a `/review-branch` pass before the PR. Commits per task, no Claude attribution.
- Tests: vitest for every rule, `tsc` and `next build`, and the Playwright smokes from the scratchpad for the page
  (file:// mode and the hosted mock with the real `mergePlans`). Never against the shared database; migrations are
  tried on a local Postgres (`npx prisma dev`).
- Data safety: every migration is additive (new tables, nullable columns); the plan JSON only gains fields, and
  `normalizePlan` tolerates their absence, so an older page and a newer server can coexist during a deploy.
- The help panel is updated in every release with the words the process uses (PROS-PLAN-01, PROS-SPRINT-01).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Reasons are skipped and the history becomes «what» without «why» | The dialog is one click for the common codes; missing reasons are counted and listed in the forum summary; GO tightens the policy in one constant |
| Autosave batches two unrelated edits into one changeset with one reason | The dialog lists the events it covers; a late `PATCH` can split nothing, so the rule is: one edit, pause, next edit. Acceptable for a planning tool, revisit if it bites |
| The ADO process change (estimate fields) waits on an admin | The push works without the fields; the estimate stays visible in the Feature description as text until then |
| Progress from ADO needs stories with points, which need the discovery process to run | R4 starts with the manual field on day 10, so the traffic light works from the first sprint |
| Plan JSON grows (snapshots per day) | ≤ 1 daily snapshot of a few tens of KB; named baselines on demand; a yearly clean-up of daily snapshots older than 12 months if ever needed |
| Two editors in the forum at once | The field merge is unchanged; the history records `cause: flette` where a field came from the other client, so nothing silent happens |
