# Tidslinjen R7–R9: intake, the ADO backlog, size classes, one queue per person, the feature board

Amendment to `2026-10-08-planning-system-design.md`. Decided with GO in the local test session on 09.10.2026
(afternoon), after the first walkthrough of R1a–R6 on his machine. Everything below is built on `feat/planning-system`
in the same PR; the stages run in the order R7a, R7b, R8, R9.

## 0. What the test showed (GO's words, condensed)

- «Jeg savner en quick option i Endringsbegrunnelse når noe er helt nytt» → fixed as polish (a new item is saved once,
  when its editor closes; no «Hvorfor?»). Done 09.10, commit 8fb19d1, together with the shelf in three sections, the
  «i kø bak» chip on the bar and the axis reaching back in time.
- «Vi har mange oppgaver som allerede ligger i ADO som features som er New og under utredning … hvordan ser
  tidslinjeverktøyet disse?» → it does not. Nothing reads ADO's existing Epics and Features into the plan (R7a).
- «Det er nok en latent feil at kortene i SkyTracker blir user stories. De burde heller bli features.» and «Klar for
  veikart-listen burde vise disse om de ikke ligger under en epic» → one feature set for the board and the timeline (R9).
- The process (PROS-PLAN-01 rev A) separates an untreated wish (PreSales' list) from a decided feature. «Vi må kunne i
  produktforum ha en egen side for inntak» → the intake page with the decision log (R7b).
- «Utredning … S, M, L og XL» from the deck: the forum picks the size, the date follows (R8).
- «Oppgaver som er til utredning binder opp en ressurs som ellers ville jobbet på selve løsningen» → one queue per
  person across discoveries and active features, and a per-person view (R8).

## 1. Decisions (GO 09.10 unless marked *assumed*; an assumed one is GO's to overturn before the PR)

| # | Decision |
|---|---|
| 1 | Everything SkyTracker pushes to ADO is an Epic or a Feature. The board's user-story push is retired (R9). |
| 2 | The intake is its own page, `/inntak`, inside SkyTracker. PreSales registers there; the forum decides there. |
| 3 | Size classes: S = 1 week, M = 2, L = 4, XL = 6 (*assumed* for XL: the deck says «over 4 uker»). The date stays editable. |
| 4 | A discovery with an owner occupies that owner full-time from start to end (*assumed*). The pin overrides, as for features. |
| 5 | «Hent fra ADO» never writes to ADO. Imported items carry a snapshot equal to ADO's values, so the next push only writes what someone changed in the tool afterwards. |
| 6 | «QA Area» features in ADO are containers, not wishes: listed, unchecked by default. |
| 7 | PROS-PLAN-01 gets revision B (PreSales registers in SkyTracker; «utviklingsleder legger inn i ADO» becomes the push). GO's document; not changed by this branch. |

## 2. Data model additions (plan JSON, no migration)

```
PlanTask +  description?: string          // free text (R7a from ADO, editable from R9); pushed before the generated lines
            sizeClass?: "S"|"M"|"L"|"XL"  // the class the forum promised at «Start utredning» (R8)
            type?: "feature"|"teknisk"|"vedlikehold"   // R9, from the board's taskType
            fixedEnd?: boolean            // R9: a hard date; the queue never moves it; moving it asks for «ekstern»
            areas?: string[]              // R9: Backend · Frontend · iOS · Android · Desktop · Admin
Plan     +  wishes?: Wish[]               // R7b, the intake
            deletedWishes?: Record<string, number>
Wish     =  { id, v, title, note?, source: "egen-plan"|"investor"|"kunde"|"ledermote"|"annet", askedBy?, askedOn? (YYYY-MM-DD),
              registeredBy, registeredAt (ISO), status: "ubehandlet"|"utred"|"senere"|"nei", decidedAt?, decidedBy?, forum?, reason?, featureId? }
```

Merge: wishes merge like lanes (by id, the higher `v` wins, tombstones in `deletedWishes`). Field groups on tasks:
`description` and `type`/`areas` → `meta`; `sizeClass` → `tid`; `fixedEnd` → `tid`.

## 3. R7a «Hent fra ADO» (about 1 build day)

- `AdoClient.wiql(query)` → ids. `src/features/ado/import.ts`:
  `listImportable(plan, client)` → every Epic and Feature in the project whose state is not Closed/Removed and whose
  id the plan does not hold, with title, state, assignedTo, StartDate, TargetDate, parent id/title, description, and a
  `suggested` flag (false for titles starting with «QA Area»).
  `importItems(plan, items, chosen ids, { people, now })` → a new plan. Mapping:

  | ADO | Plan |
  |---|---|
  | Epic, New | lane `state: forslag`, `goalDate` = TargetDate if set |
  | Epic, Active | lane `state: aktiv`, `goalDate` = TargetDate if set |
  | Feature, New | task `kind: discovery`, `state: ny` on the shelf |
  | Feature, Discovery | task `kind: discovery`, `state: utredes`; `assignee` = initials (people map by e-mail, else from the display name); `start` = StartDate or today; `end` = TargetDate or start + 2 weeks; in the parent epic's lane when that epic is in the plan or chosen, else on the shelf |
  | Feature, Active | task `kind: estimate`; `start` = StartDate or today; `end` = TargetDate or start + 6 weeks, `endLikely` = end when TargetDate is set, else start + 4 weeks; `aktiv` in the parent epic's lane, or `klar` on the shelf |
  | Feature, Resolved/Closed (not listed) | — |
  | description | `task.description` = ADO's text without markup |
  | id | `adoId`; `ado = { pushedAt: now, snapshot: ADO's current owned fields }` (decision 5) |

- `POST /api/ado-import` (writers): `{ list: true }` → `{ items }`; `{ ids }` → import + `commitPlan(note: { source: "import" })`.
  `diffPlans` with `source: "import"` marks the new items `cause: "ado"` and prefixes the summary «Hentet fra ADO #id».
- Page: «Hent fra ADO» next to «Oppdater fra ADO»; a dialog listing the candidates (type, #id, title, state, parent,
  the mapping in words), checkboxes, «Hent N»; the plan is applied like a refresh; the save note shows the count.

## 4. R7b «Inntak» (about 2 build days)

- `/inntak`: a plain-JS page like the timeline, served by `src/app/inntak/route.ts`, sharing `epic-tools.js` and the
  plan API (`GET/PUT /api/timeline-plan`, merge on the server). Link «Inntak» in the timeline header and on the board.
- The list: one row per wish (title, source, who asked, when, registered by), newest first, with the status chip
  Ubehandlet · Utred nå · Senere · Nei. A filter for untreated. «＋ Nytt ønske» (title, source, who asked, when, note).
- The forum's decision per wish (writers): **Utred nå** (owner initials + size class S/M/L/XL, end date computed,
  editable) → a task on the shelf, `kind: discovery`, `state: utredes`, `sizeClass`, `assignee`, `end`; **Senere** →
  a task on the shelf, `state: ny`; **Nei** (reason required) → status `nei`, nothing in the plan. The forum label
  («Produktforum 5. nov») is typed once per session and kept on every decision taken in it.
- Events: `onske.registrert`, `onske.besluttet` (summary «Utred nå: «X» · THM, M · Produktforum 5. nov», «Senere: «X»»,
  «Nei: «X» – reason»), `onske.slettet`; `targetType: "onske"`. The history panel on the timeline lists them under the
  plan. The compare summary gains «N ønsker behandlet (a utred, b senere, c nei)».

## 5. R8 size classes and one queue per person (about 2 build days)

- «Start utredning» (timeline and intake): owner + class buttons S/M/L/XL; the end date is start + 1/2/4/6 weeks,
  editable. `sizeClass` is stored as the promise; `sizeClass(task)` returns the stored class when present, else the
  derived one. A discovery that runs past its class shows «M, nå L» on the shelf and the bar.
- Queue: `queueOrder(plan)` = discoveries with an owner (by start, then order) followed by active estimates in epic
  priority order. `floorOf` already sequences same-assignee work; discoveries now take part on both sides: a later
  discovery or feature of the same owner starts after the earlier discovery's end. The event summary reads «i kø bak
  utredning «X» (THM)». The pin overrides. Decision 4.
- Per-person view: a toggle «Per person» in the header draws one row per owner (initials, the people map's names when
  known) with that person's discoveries and features from every epic and the shelf, in queue order, read-only (drag
  and edit happen in the epic view). Rows without an owner are summed in «Uten eier».

## 6. R9 the feature board (about 3 build days)

- `/` (the board) becomes a Kanban over the plan's features: columns Registrert · Utredes · Klar for veikart · Aktiv ·
  Levert; a card shows title, epic, owner, class or range, ADO id chip, type and areas. Dragging a card to the next
  column runs the same transitions and dialogs as the timeline (Start utredning, Klar for veikart, Legg i epic; Levert
  is read from ADO only). Writers only; readers see the board.
- The old `Card`/`Column`/`Dependency` tables stay in the schema (no migration) but the UI, the server actions and the
  user-story push are retired. A one-time «Importer kortene» (writers) turns the prod board's cards into features:
  title, description, taskType → type, estimateWeeks → range (likely = late), HARD_DATE → `fixedEnd` + end, tags →
  areas (applicable ones), completedAt → `levert`, card dependencies → `deps`; `adoWorkItemId` is a user story and is
  not carried over (noted in the description).
- The four attributes in the feature editor: Beskrivelse (textarea), Type (segmented), Fast dato (checkbox: the queue
  skips it, the start can still be dragged, moving the end asks with reason «ekstern»), Flater (chips).
- The push: a feature or epic with its own `description` sends that text as the ADO description (no generated lines), so an
  untouched import writes nothing on the next push (decision 5); items without one keep the generated lines. Areas go to `System.Tags`.

## 7. Verification

- vitest: `import.ts` mapping (fixtures shaped like the ADO inventory of 09.10), `wishes` merge + events, queue with
  discoveries (two owners, discovery + feature + blocker), `sizeClass` stored vs derived, board import mapping.
- Playwright smokes in the scratchpad: `hosted-polish-smoke.mjs` (Trinn 1, P1–P4), R7 steps (import dialog with a
  fake WIQL; the intake page's three decisions and their events), R8 steps (class buttons; per-person row order), R9
  steps (the board's columns from the plan; a drag that opens «Start utredning»).
- Against the real ADO: «Hent fra ADO» in dry listing only, then one import of #4566 on GO's machine.
