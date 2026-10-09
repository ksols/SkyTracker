# Tidslinjen R7: «Hent fra ADO» and «Inntak» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The timeline can pull ADO's existing Epics and Features into the plan without writing to ADO, and SkyTracker gets the intake page where PreSales registers wishes and produktforum decides them with a logged reason.

**Architecture:** R7a adds one client call (WIQL), a pure mapping module `import.ts`, one route and one dialog on the timeline page. R7b adds `wishes` to the plan JSON (merged and versioned like lanes), three events, and a second plain-JS page `/inntak` that uses the same plan API as the timeline.

**Tech Stack:** TypeScript (Next 16 route handlers, vitest), plain JS/HTML pages served by route handlers, Playwright smokes in the scratchpad with the mock API.

**Spec:** `docs/superpowers/specs/2026-10-09-planning-system-r7-r9-design.md` §3–§4 (and §2 for the data model).

## Global Constraints

- No ADO PAT anywhere; every ADO call runs on the signed-in person's Entra token through `adoAuthFor`.
- «Hent fra ADO» never writes to ADO (spec decision 5). Imported items carry `ado.snapshot` equal to ADO's owned fields.
- Norwegian in UI and stored text, English in code and commits, no em dashes.
- Plain-JS pages: `epic-tools.js` exports must match `epic-tools.d.ts`; `TASK_FIELD_GROUPS` = the page's `FV_FIELDS`.
- Every plan change goes through `commitPlan` (optimistic version check) and leaves events; the page applies the returned plan with `applyRemote`.
- No new Prisma migration: `wishes` live in the plan JSON.

## Review Focus

1. An ADO Feature whose parent Epic is neither in the plan nor chosen: it must land on the shelf, never in a lane that does not exist.
2. Two imports in a row: the second listing must not offer ids the first import created (adoId already held).
3. A Discovery feature assigned to someone outside the people map: initials come from the display name, never empty.
4. A wish decided «Utred nå» twice (double click): one task, not two (the wish's `featureId` guards).
5. The intake page as a reader: everything visible, every writer action hidden; PUT refused by the server anyway.

---

### Task 1: `wiql` on the ADO client

**Files:** Modify `src/features/ado/client.ts`; Test `src/features/ado/client.test.ts`.
**Produces:** `AdoClient.wiql(query: string): Promise<number[]>` (POST `${adoProjectUrl()}/_apis/wit/wiql?api-version=7.1`, body `{ query }`, returns `workItems[].id`).

- [ ] Test: a fetch mock records the POST body and returns `{ workItems: [{ id: 4566 }, { id: 4742 }] }`; expect `[4566, 4742]` and the url/body.
- [ ] Run: `npx vitest run src/features/ado/client.test.ts` → FAIL (wiql is not a function).
- [ ] Implement in `createAdoClient` and the `AdoClient` type.
- [ ] Run → PASS. Commit: `ado: wiql queries on the client`.

### Task 2: `import.ts`, the pure mapping

**Files:** Create `src/features/ado/import.ts`, `src/features/ado/import.test.ts`.
**Consumes:** `AdoClient` (wiql, batch), `adoValue`/`OWNED_FIELDS` from plan-mappers, `peopleMap`, `dateToUnit`/`normalizePlan`/`WEEK` from epic-tools.
**Produces:**
```ts
export type ImportCandidate = { id: number; type: "Epic" | "Feature"; title: string; state: string; assignedTo: string | null; assignedEmail: string | null;
  startDate: string | null; targetDate: string | null; parentId: number | null; parentTitle: string | null; description: string; suggested: boolean; mapping: string };
export async function listImportable(plan: Plan, client: AdoClient): Promise<ImportCandidate[]>;
export function importItems(plan: Plan, items: ImportCandidate[], ids: number[], opts: { people: Record<string, string>; now: Date }): { plan: Plan; imported: { kind: "epic" | "feature"; id: string; adoId: number; label: string }[] };
```
- [ ] Tests (fixtures shaped like the 09.10 inventory): (a) listing excludes ids held by lanes/tasks and Closed/Removed states, flags «QA Area …» as not suggested, carries the parent title; (b) New → `ny` on the shelf, kind discovery; (c) Discovery with assignedTo e-mail in the people map → `utredes`, initials THM, end = TargetDate, start = StartDate; without e-mail match → initials from «Tor Håkon Moen» = THM; no dates → start today, end today + 2 weeks; (d) Active with parent epic chosen → `aktiv` in the new lane, range from Start/Target; parent not chosen and not in plan → `klar` on the shelf; (e) Epic Active with TargetDate → lane aktiv with goalDate; Epic New → forslag; (f) every imported item has `adoId` and `ado.snapshot` equal to `adoValue` of its fields, and `planFieldWrites(fields, item, snapshot)` yields no description write when `task.description` holds ADO's text; (g) `normalizePlan` accepts the result (`_backlog` for `ny`).
- [ ] Run → FAIL (module missing). Implement. Run → PASS. Commit: `ado: list and import ADO's epics and features into the plan (pure mapping)`.

### Task 3: events for an import

**Files:** Modify `src/features/timeline/events.ts`; Test `src/features/timeline/events.test.ts`.
- [ ] Test: `diffPlans(before, after, { source: "import" })` on a plan that gained a task with `adoId: 4566` → one `feature.ny` with `cause: "ado"` and summary starting «Hentet fra ADO #4566 · »; same for `epic.ny`.
- [ ] Run → FAIL. Implement (`dc = ado` for import too; summary prefix when `source === "import"` and the item has an adoId). Run → PASS. Commit: `timeline: import events read «Hentet fra ADO #id»`.

### Task 4: `POST /api/ado-import`

**Files:** Create `src/app/api/ado-import/route.ts`.
- [ ] Writers only; `{ list: true }` → `{ items: ImportCandidate[] }`; `{ ids: number[] }` → `importItems` on the stored plan, `commitPlan(note: { source: "import" })`, returns `{ version, data, imported, changesetId }`; 409 on contention; `adoErrorResponse` for ADO failures. The candidate list is re-read from ADO on import (no client-supplied fields are trusted).
- [ ] `npx tsc --noEmit` clean. Commit: `api: ado-import lists and imports ADO's epics and features`.

### Task 5: the «Hent fra ADO» dialog

**Files:** Modify `src/app/timeline/timeline.html`; smoke `hosted-polish-smoke.mjs` (scratchpad) gets the mock route `/api/ado-import` backed by `listImportable`/`importItems` over the fake ADO (seed the fake with #4790 New, #4566 Discovery, #4802 Epic Active, #4406 «QA Area: Chat»).
- [ ] Smoke step R7-1 (RED first): click «Hent fra ADO» → dialog lists 4 rows, «QA Area» unchecked, the others checked; the mapping text for #4566 reads «Utredes · THM»; click «Hent 3» → shelf shows «Registrert (1)» with «Fjernsletting av enhet», «Utredes (1)» with «Message threading and replies», a new epic row «Bedre samhandling i chats»; events contain «Hentet fra ADO #4566».
- [ ] Button `#adoImportBtn` beside `#adoRefreshBtn` (writers, hosted), modal `#importBack` with `#importList`, `#importGo`; after import `applyRemote(j.data, j.version)` and save note «hentet N fra ADO».
- [ ] Smoke → PASS. Commit: `timeline: «Hent fra ADO» brings the ADO backlog onto the shelf and into epics`.

### Task 6: wishes in the plan model

**Files:** Modify `src/features/timeline/merge.ts` (types, merge), `src/features/timeline/epic-tools.js` + `.d.ts` (normalize, `WISH_SOURCES`, `WISH_STATUS_LABEL`, `wishesByStatus`), `src/features/timeline/events.ts` (`onske.*`), `src/features/timeline/compare.ts` (summary count); tests beside each.
- [ ] Tests: merge keeps the higher `v`, tombstone removes, a wish bumped past the tombstone survives; normalize drops malformed wishes and defaults status `ubehandlet`; diffPlans emits `onske.registrert` (new), `onske.besluttet` (status changed, summary per spec §4), `onske.slettet`; summarizeNet counts decided wishes.
- [ ] RED → implement → GREEN. Commit: `timeline: wishes (the intake) in the plan with merge, events and compare counts`.

### Task 7: the `/inntak` page

**Files:** Create `src/app/inntak/route.ts`, `src/app/inntak/inntak.html`; modify `src/app/timeline/timeline.html` (header link «Inntak»), `src/app/page.tsx` (link); smoke steps R7-2..R7-4 in a new `hosted-intake-smoke.mjs` (same mock server, serves `/inntak`).
- [ ] Smoke (RED first): register a wish (title, source kunde, who asked, when) → row with chip «Ubehandlet»; set forum label «Produktforum 5. nov»; «Utred nå» on it with THM and M → the wish shows «Utred nå», the plan has a shelf task `utredes`, `sizeClass: "M"`, assignee THM, end = start + 2 weeks, event «Utred nå: «X» · THM, M · Produktforum 5. nov»; «Senere» on a second wish → task `ny`; «Nei» with reason on a third → no task, event with the reason; as reader: no buttons, list visible.
- [ ] Page: list + filter, «＋ Nytt ønske» dialog, decision dialog (three buttons, owner + class for Utred nå, reason for Nei), forum label field, autosave via PUT with `note: { source: "bruker" }`, polling like the timeline, header with «Tidslinjen» link.
- [ ] Smoke → PASS. `npx tsc --noEmit`, `npx vitest run`, the other smokes. Commit: `inntak: the intake page where PreSales registers wishes and produktforum decides them`.

### Task 8: hand-over

- [ ] PR text section «Trinn 1» and «R7» in `~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body-planning-system.md`; memory updated; ledger closed.
