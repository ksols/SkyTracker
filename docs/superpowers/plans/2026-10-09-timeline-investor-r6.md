# Tidslinjen stage 7 (R6): investor numbers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two numbers investors ask for come straight from the plan and its history: gjennomføringsevne (features delivered inside the span the forum was promised) and målopnåelse (epics closed as nådd / ikke nådd / endret, with the forum's reasons), next to the plan as it stands; exportable as markdown and as one slide.

**Architecture:** `investor.ts` is pure: `planNow` (active epics with måltall, måldato, colour, window), `deliveryAbility` (delivered features in a window, inside or outside their `committedRange`), `goalAttainment` (closed epics with outcome, reason and the `epic.tilstand` / `epic.maldato` events behind them), `investorMarkdown`, `investorHtml` (a 1280×720 slide, inline CSS). One route reads the plan and the epic events and answers JSON, markdown or the slide. The page gets an «Investorer» button and a drawer that shows the same numbers and offers both exports.

**Tech Stack:** as before. No new dependency, no schema change.

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §5 R6, §3 (`committedRange`, `activatedAt`, `deliveredAt`, `outcome`, `closedReason`, `closedAt`), §4.1 (`epic.tilstand`, `epic.maldato`).

## Global Constraints

- Gjennomføringsevne = delivered inside the committed span ÷ delivered with a committed span, over the window (default: the last two quarters up to today); features delivered without a committed span are counted and shown apart, never in the ratio.
- «Inside» means the delivery day is on or before the committed late end (`committedRange.start + late × WEEK`, as a calendar day).
- Målopnåelse counts closed epics by outcome; each line carries the forum's reason (`closedReason`) and the reasons logged on `epic.tilstand` and `epic.maldato` events for that epic.
- Norwegian in everything a person reads; English in code; no schema change; routes untested against Postgres; commits per task, no attribution.

## Review Focus

1. No deliveries in the window: expected «0 av 0» and a dash instead of a percentage, no division by zero (Task 1 test).
2. A feature delivered on the exact committed end day: expected counted inside (Task 1 test).
3. An epic closed before the window with reasons logged after it: expected listed with every reason, the window applies to deliveries only (Task 1).
4. A plan with no closed epic and no active epic: expected the markdown still has its headings with «ingen» lines, the slide renders (Task 1).
5. A reader opens «Investorer»: expected the same numbers, no write (Task 2: the route is GET for any signed-in person).

---

### Task 1: The metrics and the two exports

**Files:** Create `src/features/timeline/investor.ts` (+ `investor.test.ts`).

**Interfaces:**
- Consumes: `epicStatus`, `epicWindowText`, `goalText`, `unitToDate`, `fmtDate`, `WEEK` (epic-tools), `dayText`, `PathEvent` (compare.ts), `REASON_LABEL`.
- Produces: `type InvestorWindow = { since: string; until: string }` (YYYY-MM-DD); `planNow(plan) → { key, name, metric, goal, colour, window }[]` (epics not `avsluttet`, in priority order; colour grønn/gul/rød/venter/uten måldato); `deliveryAbility(plan, window) → { delivered: number; withCommitment: number; inside: number; ratio: number | null; items: { id, label, lane, deliveredAt, committedEnd: string | null, inside: boolean | null }[] }`; `goalAttainment(plan, events) → { counts: { nådd, "ikke nådd", endret }, epics: { key, name, outcome, closedReason, closedAt, reasons: string[] }[] }` (reasons = the events' summaries with their changeset reason, e.g. «Måldato: 15. des → 15. jan — Ekstern dato endret: Telenor flyttet piloten (GO, 6. nov)»); `investorData(plan, events, window) → { window, plan, delivery, goals, generatedAt }`; `investorMarkdown(data) → string`; `investorHtml(data) → string`; `defaultWindow(today: Date) → InvestorWindow` (two quarters back, to today).

- [ ] **Step 1: Failing tests**
```ts
describe("deliveryAbility", () => {
  // fixture: kap delivered 2026-11-20 with committedRange { likely 4, late 6, start: unit of 2026-10-05 } → committed end 2026-11-16 → outside
  //          fil delivered 2026-11-16 with the same committedRange → inside (the exact end day counts)
  //          old delivered 2026-03-01 (before the window) → not counted
  //          free delivered 2026-11-02 without committedRange → counted, not in the ratio
  it("counts deliveries in the window, inside or outside the committed span, with the ones without a span apart", …)  // delivered 3, withCommitment 2, inside 1, ratio 0.5
  it("no deliveries: 0, 0, 0 and ratio null", …)
});
describe("goalAttainment", () => {
  it("counts closed epics by outcome and attaches closedReason and the logged reasons", …)  // Telenor nådd «Pilot i drift» + an epic.maldato event with reason ekstern; Drift ikke nådd; an active epic ignored
});
describe("planNow, defaultWindow, exports", () => {
  it("lists the active epics with måltall, måldato, colour and window in priority order", …)
  it("defaultWindow spans two quarters back to today", () => { expect(defaultWindow(new Date(2026, 9, 9))).toEqual({ since: "2026-04-09", until: "2026-10-09" }); })
  it("the markdown has the four sections and the slide has the numbers", …)  // «# Tidslinjen for investorer», «## Planen nå», «## Gjennomføringsevne», «1 av 2 levert innenfor lovet spenn (50 %)», «## Målopnåelse», «nådd 1 · ikke nådd 1 · endret 0»; html contains "50 %" and the epic names, width 1280
});
```
- [ ] **Step 2: RED** — **Step 3: implement** — **Step 4: GREEN + commit** «timeline: investor numbers (gjennomføringsevne, målopnåelse, the plan now) with markdown and slide exports».

---

### Task 2: The route and the «Investorer» drawer; smoke S21

**Files:** Create `src/app/api/timeline-investor/route.ts`; modify `src/app/timeline/timeline.html`; scratchpad smoke (mock route + S21).

**Interfaces:** `GET /api/timeline-investor?since=&until=&format=json|md|html` (any signed-in person): json → `investorData` + `markdown`; md → `text/markdown`; html → `text/html` (the slide). Events: `timelineEvent` where `code in (epic.tilstand, epic.maldato)` with changesets. Page: top-bar button `#investorBtn`, drawer `#invDrawer` (`#invBody`, `#invExport`, `#invSlide`, `#invClose`), rendered from the json (the plan table, the delivery line with its items, the goal lines with reasons); «Eksporter (markdown)» downloads, «Lysbilde» opens `api/timeline-investor?format=html` in a new tab. Smoke S21: open the drawer → it names Telenor under målopnåelse with «nådd» and «Pilot i drift», shows «Gjennomføringsevne» and the active epics; `GET …?format=md` contains «## Målopnåelse»; `format=html` is HTML with the slide width.

- [ ] **Step 1: Smoke RED** — **Step 2: build** — **Step 3: smokes green + commit** «timeline page: the Investorer drawer and the investor route».

---

### Task 3: Stage gate — suite, tsc, build, smokes, inline review + fix pass, PR text «Stage 7», ledger, memory. Then the whole-branch review (review-branch style, base origin/main), the final PR text and the hand-over with local test steps.
