# Tidslinjen R9: the feature board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The board at `/` shows the plan's features as a Kanban over the lifecycle, with the same transitions as the timeline; features gain the four attributes from the old board (description, type, fixed date, areas); the old cards can be imported once; the user-story push is gone.

**Architecture:** The board is a plain-JS page like the timeline and the intake (`src/app/board.html` served by `src/app/route.ts`), on the same plan API. The attributes live in the plan JSON (`type`, `areas`, `fixedEnd`, `description` from R7). `fixedEnd` makes the queue skip the feature (it still counts for the ones after it); moving its end asks with reason «ekstern». Areas push to `System.Tags` as an owned field. The old React board, its server actions, the schedule bridge, the export route and the card→user-story mappers are deleted; the Prisma models stay for the one-time import.

**Spec:** `docs/superpowers/specs/2026-10-09-planning-system-r7-r9-design.md` §6 (and §2).

## Global Constraints

- Everything the board pushes to ADO is an Epic or a Feature (decision 1); the discovery story (R3) stays a User Story.
- The Prisma schema is untouched (no migration); `Card`, `Column`, `Dependency` are read by the import only.
- Norwegian in UI, English in code; `epic-tools.js` exports = `.d.ts`; `TASK_FIELD_GROUPS` unchanged (the new props join `meta` and `tid`).

## Review Focus

1. A dropped card whose transition dialog is cancelled stays in its column: nothing saved, nothing logged.
2. Dropping into «Levert» or back into «Registrert» is refused with a note; «Aktiv → Klar for veikart» is the one backward move.
3. A card imported from a completed old card is `levert` with its date and never pushed to ADO (no adoId).
4. A fixed-end feature dragged by its start keeps its end; the queue never shifts it; it still delays the owner's later features.
5. Areas typed in a different case or order compare equal to ADO's tags (no false conflict).

---

### Task 1: attributes, events, the fixed end in the queue, tags to ADO
- [ ] Tests (RED): normalizePlan keeps `type` (feature|teknisk|vedlikehold), `areas` (the six, deduplicated, canonical case), `fixedEnd`; merge groups; events `feature.beskrivelse`, `feature.type`, `feature.flater`, `feature.fastdato`; queue: a fixed-end feature is not shifted but delays the next; plan-mappers: `tags` owned field, `adoValue` normalises «Backend; frontend» → «Backend; Frontend», `featureFields` carries the areas, no conflict on reordered tags.
- [ ] GREEN, suite green. Commit: `timeline: feature attributes (type, areas, fixed end), their events, the fixed end in the queue, areas as ADO tags`.

### Task 2: the timeline editor
- [ ] Smoke P8 (RED): the editor shows Beskrivelse, Type, Flater, Fast dato; saving writes them and logs «Flater: Backend, iOS»; dragging the end of a fixed-end feature opens «Hvorfor?» with «Ekstern dato endret» preselected; the queue chip never appears on it.
- [ ] GREEN. Commit: `timeline: the editor edits description, type, areas and a fixed end`.

### Task 3: the board page
- [ ] Smoke `hosted-board-smoke.mjs` (RED): `/` shows five columns with counts from the seed; a card shows epic, owner, class or range, ADO chip; dragging a Registrert card to Utredes opens «Start utredning», saving moves it and logs; Utredes → Klar for veikart asks weeks; Klar → Aktiv asks for the epic and preselects «Prioritert om i produktforum»; a drop on Levert is refused; cancel leaves the card; the card modal edits title, owner, description, type, areas, fixed date; a reader sees the board without drag or buttons.
- [ ] Page + route; `page.tsx` removed. GREEN. Commit: `board: the feature board over the plan replaces the card board`.

### Task 4: the one-time card import
- [ ] Tests (RED) on `src/features/board/import.ts` with Card-shaped fixtures: title, description, taskType → type, WEEKS → range (likely = late), HARD_DATE → fixedEnd + end, tags → areas, completedAt → levert, dependencies → deps, `adoWorkItemId` noted in the description, `cardId` kept for idempotence.
- [ ] Route `POST /api/board-import` (writers): reads cards + dependencies, skips cards already imported, commits with `source: "import"`. Board button «Importer kortene fra det gamle brettet (N)» when N > 0. GREEN. Commit: `board: import the old cards as features, once`.

### Task 5: retire the old board
- [ ] Delete `src/components/board/*`, `SignOutButton.tsx`, `features/board/{actions,queries,types,dates,completion,deplines-geometry}.ts` and tests, `features/timeline/schedule.ts` + test, `api/timeline-export`, `features/ado/mappers.ts` + test, the board helpers in `client.ts` + their tests, the `@dnd-kit` dependencies. `npx tsc --noEmit`, `npx eslint`, `npx vitest run`, all smokes. Commit: `board: the old card board, its actions, the schedule bridge and the user-story push are gone`.

### Task 6: hand-over
- [ ] PR text (Trinn 1–4), CLAUDE.md of SkyTracker (board section), memory, ledgers.
