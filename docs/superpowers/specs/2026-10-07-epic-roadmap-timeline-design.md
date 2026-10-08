# Epic roadmap timeline (/timeline) - design

Date: 2026-10-07. Deadline: management meeting Friday 2026-10-09.
Source: planning handover 05-07.10 and the deck "Et veikart vi kan holde" (slides 20, 22, 23, 24 are the visual spec).

## Goal

The /timeline tool is repurposed (greenfield) to show the development roadmap as **epics**: one lane per epic,
its features as bars, the epic's goal date as a line, and a status per epic that is computed from the
features' estimate range against the goal date. By Friday it holds placeholder epics so GO can show and tell.

Decisions already made (handover, do not re-open): ADO is the source of truth for what exists and its state;
estimates live only on SkyTracker; status is computed, never typed; epics are outcomes owned by PM + CTO;
estimates are ranges (likely + uncertain part); the timeline covers the development department only.

Decisions from GO 07.10 (this session):

- A blocker's **late end** (`end`) pushes the features it blocks (worst case).
- Owner is the label "PM + CTO" only, no person names.
- Workstream B by Friday = design doc only (see `2026-10-07-ado-skytracker-sync-design.md`).
- Placeholder goal dates: Telenor 15 Dec 2026, NSR provisional 1 Feb 2027, the other five have none.

## Data model

The plan is stored as before in `TimelinePlan.data`, but in a **new row `id = "epics"`**. The old row
`default` (the 2026 company plan) is left untouched; a read-only backup also exists in the workspace repo
(`ClaudeReports/planning/roadmap-2.0/backup/timeline-plan-2026-10-07.json`).

```
Plan    { schema: "epics-v1", lanes: Epic[], tasks: Feature[], deleted: Record<id, number> }
Epic    { key, name, owner: "PM + CTO", goalDate?: number, goalProvisional?: boolean, adoId?: number, v?: number }
Feature { id, lane, label, kind: "discovery" | "estimate",
          start, end,                      // end = far end of the bar (= late end for estimates)
          endLikely?,                      // estimate only: start < endLikely <= end
          adoId?: number, deps: string[],  // deps = finish-to-start, ids of blockers
          fv, editedBy?, editedAt? }
```

- Time unit stays **months since 1 Aug 2026** (`merge.ts`, `schedule.ts` and the axis share it). The view
  starts at **Oct 2026** (`VIEW_FROM = 2`) and runs to the end of the 17-month axis (Dec 2027).
- `end` is always the far end, so the existing drag, dependency push, arrows and merge keep working unchanged.
- Field groups in `merge.ts` become `tid` (start, end, endLikely), `label`, `deps`, `meta` (lane, kind, adoId).
  Lanes merge whole-object by `v` as today.

## Computed epic status (`epic-tools.js`)

```
epicStatus(plan, laneKey) ->
  "venter"    if any feature in the lane has kind = "discovery"
  "ingen-mal" if the lane has no goalDate
  "tom"       if the lane has no features
  else likely = max(endLikely), late = max(end) over the lane's estimate features:
     late <= goal  -> "gronn"
     likely > goal -> "rod"
     otherwise     -> "gul"
```

Chip labels (Norwegian, as the deck): gronn "Grønn: holder", gul "Gul: i fare", rod "Rød: sprekker",
venter "Venter på utredning", ingen-mal "Uten måldato", tom "Ingen features ennå".
Goal date text next to the chip: "Måldato 15. des", "Foreløpig mål 1. feb" when `goalProvisional`, or
"Måldato settes etter utredning" when there is no goal date.

`epic-tools.js` is a plain JS module in `src/features/timeline/` (same pattern as the old `plan-tools.js`):
served at `/timeline/epic-tools.js`, imported by the browser and by vitest. It holds `normalizePlan`,
`epicStatus`, `resolveDeps` (push forward on `end`), `rangeWeeks` and the example seed.

## UI (visual spec = deck slides 20, 23, 24)

- **Left column:** epic header row (name, status chip, goal text, "+ Utredning" / "+ Estimert" buttons) and one
  row per feature (name; range text; chips: ADO link `#4742`, dependency count, last-editor initials).
- **Chart:** month axis from Oct 2026; red "I DAG" line; a goal-date line drawn only across the epic's own
  rows; bars: discovery = hatched amber; estimate = dark blue (ocean-5) to `endLikely` + light blue to `end`, with
  the range label ("4–7 uker") right of the bar; dependency arrows as today. Legend as slide 23.
- **Styling:** the page follows SkyTracker's own look (`globals.css` + the board components): Arial, slate greys
  with the ocean/skyblue palette, white cards with slate-300 borders and 4–6 px radii, ocean-5 primary buttons,
  amber/green/red badges, dark mode via `prefers-color-scheme`. The top bar mirrors the board header and has a
  "← SkyTracker" link back to `/`, the signed-in name and a "Lesetilgang" tag for readers.
- **Interactions:** drag a bar to move it (dependents follow); handles: left = start, middle = likely end
  (estimate only), right = end. Snap to 0.25 month. Click a feature name -> editor (name, kind, start date,
  discovery end date or likely/late weeks, ADO id, dependency chips, "Koble avhengighet", delete). Click an
  epic name -> epic editor (name, goal date, provisional, ADO id, delete epic with its features). "+ Epic" in
  the toolbar. Dependency link mode as today (click blocker, then the blocked feature).
- **Persistence:** autosave (900 ms debounce) -> `PUT /api/timeline-plan` with server-side field merge, 10 s
  polling, change log (`TimelineChange`) kept. Readers get the read-only banner and local-only edits.
- **Empty state:** writer sees "Planen er tom" + "Last inn eksempel-epics" (writes the seed, this is the first
  prod write and it is GO's own click); reader sees only the text.
- **Export JSON** stays (download). Import, the Claude package, Hva nå, Dashboard, buffers, cost/revenue,
  presentation mode and the SkyTracker mirror lane are removed from the page.

## Example seed (marked "Eksempel" in the title bar while the plan equals the seed)

The 7 epics from slide 6 with the slide 22-24 situation (today = 7 Oct 2026):

1. En ny organisasjon er i gang fra dag én (goal provisional 1 Feb 2027): IAM: brukerlivsløp (discovery to
   6 Nov), Innmelding med QR-kode #4791 (discovery 9 Nov - 4 Dec), Rollebasert tilgang #4664 (estimate 4-6 weeks,
   blocked by IAM).
2. Samtaler du kan stole på (no goal): Samtaler #4742 (discovery to 20 Nov), Varsler (discovery, 2 weeks after).
3. Telenor kan bygge på oss (goal 15 Dec 2026): API for integrasjoner F-24 (estimate 6-9 weeks from 15 Oct),
   Kapasitet i store grupper #4499 (estimate 4-7 weeks, crossing the goal).
4. Vi består en ekstern sikkerhetsrevisjon (no goal): Sikkerhetsherding, Driftsovervåking, Fjernsletting av enhet #4790 (discovery).
5. Vi ser nedetid før kunden gjør det (no goal): Driftsovervåking og statusvarsel, Infrastruktur og reservedrift (discovery).
6. Filene dine er trygge i Skytale (no goal): FileVault-fanen #4780 (discovery), Fildeling i chat #4492 (estimate).
7. Samarbeid i travle kanaler (no goal): Tråder #4566, @-omtaler, Kontaktkort, Søk #4716 (discovery).

Expected statuses: 3 = gul, 1 = venter, 2 and 4-7 = venter (all have discovery features).

## Files

- `src/app/timeline/timeline.html` - rewritten.
- `src/features/timeline/epic-tools.js` + `.d.ts` + `epic-tools.test.js` - new.
- `src/app/timeline/epic-tools.js/route.ts` - new (serves the module, replaces the plan-tools route).
- `src/features/timeline/merge.ts` (+ test), `plan-delta.ts` (+ test) - field groups trimmed.
- `src/app/api/timeline-plan/route.ts` - row id `epics`, buffer snapshots removed.
- Removed: `plan-tools.js` (+ d.ts, test, route), `claude-instruksjoner.md` (+ route), `guide/`,
  `api/timeline-buffer-history`. Kept: `schedule.ts` + `api/timeline-export` (board bridge for Workstream B).
- Prisma schema unchanged (the `BufferSnapshot` table stays, unused).

## Verification

`npx vitest run`, `npx tsc --noEmit`, `npx next build`, then a manual pass in `npm run dev` against a local
Prisma Postgres (`npx prisma dev`), never against the shared database: empty state, seed, statuses, drag,
dependency push, editors, autosave + reload, read-only role.
