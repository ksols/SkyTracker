# Timeline History R1a Implementation Plan

> **For agentic workers:** This repo forbids subagents (hard rule in `~/Skytale/CLAUDE.md`). Use superpowers:executing-plans inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every goal, range, order and epic move on `/timeline` becomes an event with who / when / what / why; dependency pushes name the blocker; priority is data; the page shows the history and asks for a reason on significant moves.

**Architecture:** The server keeps diffing the stored plan against the merged plan on every save, but through a new `events.ts` that emits semantic events for epics and features (replacing `plan-delta.ts`). One `TimelineChangeset` per save carries the reason; `TimelineEvent` rows hang off it; `TimelineSnapshot` stores one pre-change plan per day. The page sends a `note` (reason, causes, source) with each PUT, opens a reason dialog after significant edits, reorders epics/features through `priority`/`order` fields, and renders a history drawer from `GET /api/timeline-changes`.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (one additive migration), vanilla HTML/CSS/JS in `timeline.html`, plain-JS `epic-tools.js` shared with vitest, Playwright from `~/ptt-e2e` for the page smokes.

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §3 (data model), §4 (history), §5 R1a. Release R1b (baselines, compare) is NOT in this plan.

## Global Constraints

- **Never run a Prisma migrate/db command with the worktree's `.env`.** `.env` points at the shared database. Every `prisma migrate`/`prisma db` invocation in this plan is prefixed with an explicit `DATABASE_URL="$LOCAL_DB"` from `npx prisma dev`; dotenv does not override an env var that is already set. `npx prisma generate` and `npx prisma validate` need no database.
- Work in `~/Skytale/SkyTracker-wt-epics` on branch `feat/planning-system` (cut from `origin/main` 1141af9). Commit per task, Norwegian or English message, **no Claude co-author or attribution** (SkyTracker rule). This plan is **stage 1 of 7** in one build session (spec §0, `~/Skytale/ClaudeReports/planning/roadmap-2.0/build-prompt.md`): one branch, one PR after stage 7.
- Time unit stays months since 1 Aug 2026, `WEEK = 0.25`. `end` is the far end; estimates carry `endLikely`.
- Plan row id `epics`, schema `epics-v1`. New fields are optional and `normalizePlan` tolerates their absence (an old page and a new server coexist).
- Norwegian UI copy. Reason codes and labels exactly: `utredning` «Utredningen viste mer/mindre arbeid», `avhengighet` «En avhengighet flyttet seg», `kapasitet` «Kapasitet: annet gikk foran», `prioritering` «Prioritert om i produktforum», `ekstern` «Ekstern dato endret», `omfang` «Omfanget endret», `rydding` «Retting / rydding», `annet` «Annet», `ingen` = skipped.
- Event vocabulary as in spec §4.1 plus `epic.ado`, `feature.utredning` (estimate → discovery), `plan.begrunnelse` (late reason). Cause values: `bruker | avhengighet | ado | system` (`flette` from the spec is dropped: a merge never produces a difference against the stored plan).
- Verify with `npx vitest run`, `npx tsc --noEmit`, `npx next build`, and the Playwright smokes in the scratchpad (`ui-smoke.mjs` file://, `hosted-smoke.mjs` and the new `hosted-history-smoke.mjs` behind a mock API that runs the real `mergePlans` + `diffPlans`).
- No research/analysis `.md` in the PR besides this plan and the spec (both already the convention in `docs/superpowers/`).

## Review Focus

1. Concurrent reorders give two lanes the same `priority`: `normalizePlan` must keep a stable order and `moveLane` must renumber densely. Test in Task 1 («duplicate priorities keep array order»).
2. A save that only bumps `fv` / `editedBy` / `example` must produce no changeset. Test in Task 3 («fv bumps and editor stamps are not events»).
3. A dependency push must never be logged as the editor's own drag: `causes` from the client → `cause: avhengighet` with the blocker. Test in Task 3 and smoke S3 in Task 6.
4. The first-ever save (row created) must log against an empty plan, so the seed gets its `plan.seed` event in production too. Task 5 code + smoke S1 (mock mirrors the route).
5. A feature moved to another epic must not also be reported as reordered inside the old epic. Test in Task 3 («lane change gives feature.epic only»).

---

### Task 1: `epic-tools.js`: priority/order, lane fields, `resolveDeps` with the blocker, week windows, overdue

**Files:**
- Modify: `src/features/timeline/epic-tools.js`
- Modify: `src/features/timeline/epic-tools.d.ts`
- Test: `src/features/timeline/epic-tools.test.ts`

**Interfaces:**
- Produces: `normalizePlan` assigns `lane.priority` (1-based, missing ones appended after the max) and sorts lanes by it; strips empty `lane.metric`, false `lane.externalDate`; assigns `task.order` per lane (missing ones appended) and sorts tasks by (lane position, order). `resolveDeps(plan): { id, by }[]` where `by` is the blocker whose late end forced the shift. New: `isoWeek(d: Date): number`, `weekSpan(u1, u2): string` («uke 49–51»), `windowLabel(task): string` («uke 49–51» for estimates, «» otherwise), `epicWindowText(plan, laneKey): string` («Leveres uke 49–51» or «»), `discoveryOverdue(task, todayUnit): boolean`.

- [ ] **Step 1: Write the failing tests** (append to `epic-tools.test.ts`; also change the three `resolveDeps` expectations)

Change in the existing `resolveDeps` tests:
```ts
    expect(resolveDeps(p)).toEqual([{ id: "b", by: "a" }]);      // was ["b"]
    expect(resolveDeps(p)).toEqual([{ id: "c", by: "b" }]);      // was ["c"]
```
Add to the import list: `isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue`. Append:

```ts
describe("priority and order", () => {
  it("assigns priority 1..n in array order when none is set, and order 1..n per lane", () => {
    const p = normalizePlan({
      lanes: [{ key: "a", name: "A" }, { key: "b", name: "B" }],
      tasks: [est({ id: "t1", lane: "b" }), est({ id: "t2", lane: "a" }), est({ id: "t3", lane: "b" })],
    });
    expect(p.lanes.map((l) => [l.key, l.priority])).toEqual([["a", 1], ["b", 2]]);
    expect(p.tasks.map((t) => [t.id, t.lane, t.order])).toEqual([["t2", "a", 1], ["t1", "b", 1], ["t3", "b", 2]]);
  });

  it("sorts lanes by priority and tasks by order; missing values are appended after the max", () => {
    const p = normalizePlan({
      lanes: [{ key: "a", name: "A", priority: 2 }, { key: "b", name: "B" }, { key: "c", name: "C", priority: 1 }],
      tasks: [est({ id: "t1", lane: "a", order: 5 }), est({ id: "t2", lane: "a" }), est({ id: "t3", lane: "a", order: 1 })],
    });
    expect(p.lanes.map((l) => [l.key, l.priority])).toEqual([["c", 1], ["a", 2], ["b", 3]]);
    expect(p.tasks.map((t) => [t.id, t.order])).toEqual([["t3", 1], ["t1", 5], ["t2", 6]]);
  });

  it("duplicate priorities keep array order (stable), nothing is renumbered", () => {
    const p = normalizePlan({ lanes: [{ key: "a", name: "A", priority: 1 }, { key: "b", name: "B", priority: 1 }], tasks: [] });
    expect(p.lanes.map((l) => [l.key, l.priority])).toEqual([["a", 1], ["b", 1]]);
  });

  it("strips an empty metric and a false externalDate, keeps real ones", () => {
    const p = normalizePlan({ lanes: [{ key: "a", name: "A", metric: "  ", externalDate: false }, { key: "b", name: "B", metric: "3 kunder", externalDate: true }], tasks: [] });
    expect(p.lanes[0]).not.toHaveProperty("metric");
    expect(p.lanes[0]).not.toHaveProperty("externalDate");
    expect(p.lanes[1]).toMatchObject({ metric: "3 kunder", externalDate: true });
  });
});

describe("week windows and overdue", () => {
  it("isoWeek follows ISO 8601", () => {
    expect(isoWeek(new Date(2026, 11, 15))).toBe(51);
    expect(isoWeek(new Date(2026, 11, 31))).toBe(53);
    expect(isoWeek(new Date(2027, 0, 4))).toBe(1);
    expect(isoWeek(new Date(2027, 1, 1))).toBe(5);
  });

  it("weekSpan, windowLabel and epicWindowText", () => {
    const likely = dateToUnit(new Date(2026, 11, 1)), late = dateToUnit(new Date(2026, 11, 15));
    expect(weekSpan(likely, late)).toBe("uke 49–51");
    expect(weekSpan(late, late)).toBe("uke 51");
    // start 3.5 (mid Nov): normalizePlan clamps endLikely to start + 1 week, so a start of 4 (= 1 Dec) would move it
    expect(windowLabel(est({ start: 3.5, endLikely: likely, end: late }))).toBe("uke 49–51");
    expect(windowLabel(disc({}))).toBe("");
    const p = plan([est({ id: "a", start: 3.5, endLikely: likely, end: late })], { goalDate: 6 });
    expect(epicWindowText(p, "x")).toBe("Leveres uke 49–51");
    expect(epicWindowText(plan([disc({})]), "x")).toBe("");
    expect(epicWindowText(plan([]), "x")).toBe("");
  });

  it("discoveryOverdue only for discoveries whose end is before today", () => {
    expect(discoveryOverdue(disc({ start: 2, end: 3 }), 3.5)).toBe(true);
    expect(discoveryOverdue(disc({ start: 2, end: 3 }), 2.5)).toBe(false);
    expect(discoveryOverdue(est({ end: 3 }), 3.5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/timeline/epic-tools.test.ts`
Expected: FAIL. The `resolveDeps` tests fail (`["b"]` vs `[{id,by}]`), `isoWeek` etc. are "not a function", priority tests fail on `undefined`.

- [ ] **Step 3: Implement in `epic-tools.js`**

In `normalizePlan`, replace the lane loop and the end of the task block:

```js
  p.lanes.forEach((l) => {
    if (typeof l.owner !== "string" || !l.owner) l.owner = OWNER_DEFAULT;
    if (num(l.goalDate, null) === null) delete l.goalDate;
    if (!l.goalProvisional) delete l.goalProvisional;
    if (num(l.adoId, null) === null) delete l.adoId;
    if (typeof l.metric !== "string" || !l.metric.trim()) delete l.metric;
    if (!l.externalDate) delete l.externalDate;
  });
  // priority = the order on the timeline (1 = top). Data, not array order, so it survives the merge.
  let nextPri = Math.max(0, ...p.lanes.map((l) => num(l.priority, 0)));
  p.lanes.forEach((l) => { if (num(l.priority, null) === null) l.priority = ++nextPri; });
  p.lanes.sort((a, b) => a.priority - b.priority); // stable: equal priorities keep their order
```

After the existing `p.tasks.forEach((t) => { t.deps = t.deps.filter(...) })` block, before `return p;`:

```js
  // order = position inside the epic; missing ones go after the lane's max
  const nextOrd = {};
  p.tasks.forEach((t) => { if (num(t.order, null) !== null) nextOrd[t.lane] = Math.max(nextOrd[t.lane] || 0, t.order); });
  p.tasks.forEach((t) => { if (num(t.order, null) === null) t.order = nextOrd[t.lane] = (nextOrd[t.lane] || 0) + 1; });
  const laneIdx = new Map(p.lanes.map((l, i) => [l.key, i]));
  p.tasks.sort((a, b) => laneIdx.get(a.lane) - laneIdx.get(b.lane) || a.order - b.order);
```

Replace `resolveDeps`:

```js
function resolveDeps(plan) {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const shifted = []; // [{ id, by }]: by = the blocker whose late end forced the shift
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const t of plan.tasks) {
      let req = -Infinity, by = null;
      t.deps.forEach((d) => {
        const p = byId.get(d);
        if (p && p.end > req) { req = p.end; by = d; }
      });
      if (req > t.start + 1e-9 && shiftTask(t, req - t.start) !== 0) {
        const prev = shifted.find((s) => s.id === t.id);
        if (prev) prev.by = by; else shifted.push({ id: t.id, by });
        changed = true;
      }
    }
  }
  return shifted;
}
```

After the `labels` section (after `goalText`), add:

```js
/* ---------- delivery window in ISO weeks, overdue discoveries ---------- */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}
function weekSpan(u1, u2) {
  const w1 = isoWeek(unitToDate(u1)), w2 = isoWeek(unitToDate(u2));
  return "uke " + (w1 === w2 ? w1 : w1 + "–" + w2);
}
function windowLabel(t) {
  return t.kind === "estimate" ? weekSpan(t.endLikely, t.end) : "";
}
function epicWindowText(plan, laneKey) {
  const st = epicStatus(plan, laneKey);
  return typeof st.likely === "number" ? "Leveres " + weekSpan(st.likely, st.late) : "";
}
function discoveryOverdue(t, today) {
  return t.kind === "discovery" && t.end < today - 1e-9;
}
```

Add `isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue` to `module.exports`. In `epic-tools.d.ts` change `resolveDeps` to `export declare function resolveDeps(plan: Plan): { id: string; by: string | null }[];` and add:

```ts
export declare function isoWeek(d: Date): number;
export declare function weekSpan(u1: number, u2: number): string;
export declare function windowLabel(task: PlanTask): string;
export declare function epicWindowText(plan: Plan, laneKey: string): string;
export declare function discoveryOverdue(task: PlanTask, todayUnit: number): boolean;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/timeline/epic-tools.test.ts`
Expected: PASS (all, including the seed test: the seed lanes keep their order and `resolveDeps(seed)` is `[]`).

- [ ] **Step 5: Commit**

```bash
git add src/features/timeline/epic-tools.js src/features/timeline/epic-tools.d.ts src/features/timeline/epic-tools.test.ts
git commit -m "timeline: priority/order on epics and features, blocker in resolveDeps, week windows, overdue discoveries"
```

---

### Task 2: `merge.ts`: `order` in the `meta` group, lane fields typed

**Files:**
- Modify: `src/features/timeline/merge.ts`
- Test: `src/features/timeline/merge.test.ts`

**Interfaces:**
- Produces: `GROUP_PROPS.meta = ["lane", "kind", "adoId", "order"]`; `PlanTask.order?: number`; `PlanLane.priority?: number; metric?: string; externalDate?: boolean`.

- [ ] **Step 1: Write the failing test** (append to `merge.test.ts` inside the describe)

```ts
  it("order travels with lane in the meta group", () => {
    const stored = plan([task({ id: "a", lane: "x", order: 2, fv: { meta: 1 } })]);
    const incoming = plan([task({ id: "a", lane: "y", order: 1, fv: { meta: 2 } })]);
    expect(mergePlans(stored, incoming).tasks[0]).toMatchObject({ lane: "y", order: 1 });
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/timeline/merge.test.ts`
Expected: FAIL: merged task has `order: 2` (order is not in any group, so the stored value survives).

- [ ] **Step 3: Implement**

In `merge.ts`: `meta: ["lane", "kind", "adoId", "order"],`; add `order?: number;` to `PlanTask` (after `deps`), and to `PlanLane` add `priority?: number; metric?: string; externalDate?: boolean;`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/timeline/merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/timeline/merge.ts src/features/timeline/merge.test.ts
git commit -m "timeline merge: order merges with lane; lane priority/metric/externalDate typed"
```

---

### Task 3: `events.ts`: semantic diff, summaries, `needsReason`; retire `plan-delta.ts`

**Files:**
- Create: `src/features/timeline/events.ts`
- Test: `src/features/timeline/events.test.ts`
- Delete: `src/features/timeline/plan-delta.ts`, `src/features/timeline/plan-delta.test.ts` (the route stops importing it in Task 5; delete both here and fix the import in the same commit by leaving the route untouched until Task 5? No: delete in Task 5 to keep `tsc` green per commit. In this task only create.)

**Interfaces:**
- Produces: `diffPlans(before: Plan, after: Plan, opts?: { causes?: Record<string,string>; source?: string }): PlanEvent[]`, `needsReason(e: PlanEvent): boolean`, `movedKeys(before: string[], after: string[]): string[]`, `REASON_CODES`, `REASON_LABEL`, types `PlanEvent`, `EventCode`, `Cause`.

- [ ] **Step 1: Write the failing tests** (`src/features/timeline/events.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { diffPlans, movedKeys, needsReason, REASON_LABEL } from "./events";
import { WEEK, dateToUnit, normalizePlan } from "./epic-tools.js";
import type { Plan, PlanLane, PlanTask } from "./merge";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const est = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "e", lane: "x", label: "Est", kind: "estimate", start: 4, endLikely: 5, end: 6, deps: [], fv: {}, ...over });
const disc = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "d", lane: "x", label: "Disc", kind: "discovery", start: 2, end: 3, deps: [], fv: {}, ...over });
const lane = (key: string, over: Partial<PlanLane> = {}): PlanLane => ({ key, name: "Epic " + key.toUpperCase(), ...over });
const plan = (lanes: PlanLane[], tasks: PlanTask[]): Plan => normalizePlan({ lanes, tasks, deleted: {} });
const one = (lanes: PlanLane[], tasks: PlanTask[] = []) => plan(lanes, tasks);
const codes = (ev: ReturnType<typeof diffPlans>) => ev.map((e) => e.code);

describe("movedKeys", () => {
  it("one move = one key; identical = none", () => {
    expect(movedKeys(["a", "b", "c", "d", "e"], ["e", "a", "b", "c", "d"])).toEqual(["e"]);
    expect(movedKeys(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    expect(movedKeys(["a", "b", "c"], ["a", "c", "b"]).length).toBe(1);
    expect(movedKeys(["a", "b"], ["b", "x", "a"]).length).toBe(1); // x is new, ignored
  });
});

describe("diffPlans: epics", () => {
  it("identical plans, fv bumps and editor stamps are not events", () => {
    const b = one([lane("x")], [est({ fv: { tid: 1 }, editedBy: "A" })]);
    const a = one([lane("x")], [est({ fv: { tid: 4, label: 2 }, editedBy: "B", editedAt: "2026-10-08" })]);
    expect(diffPlans(b, a)).toEqual([]);
  });

  it("goal date: set, changed, provisional → firm, removed", () => {
    const dec = D(2026, 12, 15), jan = D(2027, 1, 15);
    const s = diffPlans(one([lane("x")]), one([lane("x", { goalDate: dec })]));
    expect(s).toEqual([expect.objectContaining({ code: "epic.maldato", targetType: "epic", targetId: "x", summary: "Måldato satt: 15. des" })]);
    expect(diffPlans(one([lane("x", { goalDate: dec })]), one([lane("x", { goalDate: jan })]))[0].summary).toBe("Måldato: 15. des → 15. jan");
    expect(diffPlans(one([lane("x", { goalDate: dec, goalProvisional: true })]), one([lane("x", { goalDate: dec })]))[0].summary).toBe("Foreløpig mål 15. des → endelig måldato");
    expect(diffPlans(one([lane("x", { goalDate: dec, goalProvisional: true })]), one([lane("x", { goalDate: jan, goalProvisional: true })]))[0].summary).toBe("Foreløpig mål: 15. des → 15. jan");
    expect(diffPlans(one([lane("x", { goalDate: dec })]), one([lane("x")]))[0].summary).toBe("Måldato fjernet (var 15. des)");
  });

  it("name, metric, external date, ado id, new and deleted epics", () => {
    const ev = diffPlans(
      one([lane("x", { name: "Gammel" }), lane("y")], [est({ lane: "y" }), est({ id: "e2", lane: "y" })]),
      one([lane("x", { name: "Ny", metric: "3 kunder", externalDate: true, adoId: 4791 }), lane("z")]),
    );
    expect(codes(ev)).toEqual(["epic.navn", "epic.maltall", "epic.ekstern", "epic.ado", "epic.ny", "epic.slettet"]);
    expect(ev.map((e) => e.summary)).toEqual([
      "Navn: «Gammel» → «Ny»", "Måltall satt: 3 kunder", "Merket som ekstern dato", "ADO-id: #4791", "Ny epic", "Epic slettet (med 2 features)",
    ]);
  });

  it("one reorder = one epic.prioritet, placed before the lane it now precedes", () => {
    const b = one([lane("a", { priority: 1 }), lane("b", { priority: 2 }), lane("c", { priority: 3 })]);
    const a = one([lane("a", { priority: 2 }), lane("b", { priority: 3 }), lane("c", { priority: 1 })]);
    const ev = diffPlans(b, a);
    expect(ev).toEqual([expect.objectContaining({ code: "epic.prioritet", targetId: "c", before: 3, after: 1, summary: "Prioritet: 3 → 1 (foran «Epic A»)" })]);
    const last = diffPlans(a, b);
    expect(last[0].summary).toBe("Prioritet: 1 → 3 (sist)");
  });
});

describe("diffPlans: features", () => {
  it("a plain drag is feature.flyttet only; a right-handle drag is feature.spenn only; a left-handle drag is both", () => {
    const b = one([lane("x")], [est({ start: 4, endLikely: 5, end: 6 })]);
    const moved = diffPlans(b, one([lane("x")], [est({ start: 4.5, endLikely: 5.5, end: 6.5 })]));
    expect(codes(moved)).toEqual(["feature.flyttet"]);
    expect(moved[0].summary).toMatch(/^Flyttet 2 uker senere: start \d+\. \w+ → \d+\. \w+$/);
    const widened = diffPlans(b, one([lane("x")], [est({ start: 4, endLikely: 5, end: 6.5 })]));
    expect(widened).toEqual([expect.objectContaining({ code: "feature.spenn", before: { likely: 4, late: 8 }, after: { likely: 4, late: 10 }, summary: "Spenn: 4–8 → 4–10 uker (utvidet 2 uker)" })]);
    const left = diffPlans(b, one([lane("x")], [est({ start: 4.25, endLikely: 5, end: 6 })]));
    expect(codes(left)).toEqual(["feature.flyttet", "feature.spenn"]);
    expect(left[1].summary).toBe("Spenn: 4–8 → 3–7 uker (krympet 1 uke)");
    const likelyOnly = diffPlans(b, one([lane("x")], [est({ start: 4, endLikely: 5.5, end: 6 })]));
    expect(likelyOnly[0].summary).toBe("Spenn: 4–8 → 6–8 uker (sannsynlig 4 → 6 uker)");
  });

  it("discovery end, kind changes, new and deleted", () => {
    const b = one([lane("x")], [disc({ start: 2, end: 3 })]);
    expect(diffPlans(b, one([lane("x")], [disc({ start: 2, end: 3.5 })]))[0].summary).toMatch(/^Utredning slutt: \d+\. \w+ → \d+\. \w+ \(2 uker senere\)$/);
    const estimated = diffPlans(b, one([lane("x")], [est({ id: "d", label: "Disc", start: 2, endLikely: 3, end: 3.5 })]));
    expect(estimated).toEqual([expect.objectContaining({ code: "feature.estimert", summary: "Utredet: estimat 4–6 uker" })]);
    const back = diffPlans(one([lane("x")], [est({})]), one([lane("x")], [disc({ id: "e", label: "Est", start: 4, end: 5 })]));
    expect(codes(back)).toEqual(["feature.utredning"]);
    const fresh = diffPlans(one([lane("x")]), one([lane("x")], [disc({ id: "n", label: "Ny" }), est({ id: "m", label: "M" })]));
    expect(fresh.map((e) => e.summary)).toEqual([expect.stringMatching(/^Ny utredning \(til /), "Ny feature (4–8 uker)"]);
    const gone = diffPlans(one([lane("x")], [est({}), disc({})]), one([lane("x")]));
    expect(gone.map((e) => e.summary)).toEqual(["Feature slettet", "Utredning slettet"]);
  });

  it("lane change gives feature.epic only; an order change inside the lane gives one feature.prioritet", () => {
    const b = one([lane("x"), lane("y")], [est({ id: "a", order: 1 }), est({ id: "b", order: 2 }), est({ id: "c", order: 3 })]);
    const moved = diffPlans(b, one([lane("x"), lane("y")], [est({ id: "a", order: 1 }), est({ id: "b", lane: "y", order: 1 }), est({ id: "c", order: 3 })]));
    expect(moved).toEqual([expect.objectContaining({ code: "feature.epic", targetId: "b", summary: "Flyttet fra «Epic X» til «Epic Y»" })]);
    const reordered = diffPlans(b, one([lane("x"), lane("y")], [est({ id: "a", order: 2 }), est({ id: "b", order: 3 }), est({ id: "c", order: 1 })]));
    expect(reordered).toEqual([expect.objectContaining({ code: "feature.prioritet", targetId: "c", summary: "Prioritet i epicen: 3 → 1" })]);
  });

  it("dependencies, ado id, name", () => {
    const b = one([lane("x")], [est({ id: "a", label: "A" }), est({ id: "b", label: "B", deps: ["a"] }), est({ id: "c", label: "C" })]);
    const a = one([lane("x")], [est({ id: "a", label: "A2", adoId: 1 }), est({ id: "b", label: "B", deps: ["c"] }), est({ id: "c", label: "C" })]);
    // labels are resolved in the AFTER plan, so the removed blocker shows its new name
    expect(diffPlans(b, a).map((e) => e.summary)).toEqual(["Navn: «A» → «A2»", "ADO-id: #1", "Blokkeres nå av «C»", "Avhengighet til «A2» fjernet"]);
  });

  it("a push caused by a dependency is attributed to the blocker", () => {
    const b = one([lane("x")], [est({ id: "a", label: "IAM", start: 4, endLikely: 5, end: 6 }), est({ id: "b", label: "Roller", start: 6, endLikely: 7, end: 8, deps: ["a"] })]);
    const a = one([lane("x")], [est({ id: "a", label: "IAM", start: 4.5, endLikely: 5.5, end: 6.5 }), est({ id: "b", label: "Roller", start: 6.5, endLikely: 7.5, end: 8.5, deps: ["a"] })]);
    const ev = diffPlans(b, a, { causes: { b: "dep:a" } });
    expect(ev[0]).toMatchObject({ targetId: "a", cause: "bruker" });
    expect(ev[1]).toMatchObject({ targetId: "b", code: "feature.flyttet", cause: "avhengighet", causeRef: "a", summary: "Flyttet 2 uker av avhengighet «IAM»" });
  });

  it("source seed collapses everything into one plan.seed event", () => {
    const ev = diffPlans(one([]), one([lane("x"), lane("y")], [est({}), disc({})]), { source: "seed" });
    expect(ev).toEqual([expect.objectContaining({ code: "plan.seed", targetType: "plan", cause: "system", summary: "Eksempel-epics lastet inn (2 epics, 2 features)" })]);
  });
});

describe("needsReason", () => {
  const dec = D(2026, 12, 15), jan = D(2027, 1, 15);
  const first = (b: Plan, a: Plan, o?: { causes?: Record<string, string> }) => diffPlans(b, a, o)[0];
  it("asks for goal changes but not the first goal, widened spans but not narrowed, moves of a week or more later, lane changes, epic reorders, deleted estimates", () => {
    expect(needsReason(first(one([lane("x")]), one([lane("x", { goalDate: dec })])))).toBe(false);
    expect(needsReason(first(one([lane("x", { goalDate: dec })]), one([lane("x", { goalDate: jan })])))).toBe(true);
    expect(needsReason(first(one([lane("x", { goalDate: dec, goalProvisional: true })]), one([lane("x", { goalDate: dec })])))).toBe(true);
    const b = one([lane("x")], [est({ start: 4, endLikely: 5, end: 6 })]);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4, endLikely: 5, end: 6.5 })])))).toBe(true);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4, endLikely: 5, end: 5.5 })])))).toBe(false);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4.25, endLikely: 5.25, end: 6.25 })])))).toBe(true);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4.1, endLikely: 5.1, end: 6.1 })])))).toBe(false);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 3, endLikely: 4, end: 5 })])))).toBe(false);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4.5, endLikely: 5.5, end: 6.5 })]), { causes: { e: "dep:z" } }))).toBe(false);
    const d = one([lane("x")], [disc({ start: 2, end: 3 })]);
    expect(needsReason(first(d, one([lane("x")], [disc({ start: 2, end: 3.25 })])))).toBe(true);
    expect(needsReason(first(d, one([lane("x")], [disc({ start: 2, end: 2.5 })])))).toBe(false);
    expect(needsReason(first(one([lane("x"), lane("y")], [est({})]), one([lane("x"), lane("y")], [est({ lane: "y" })])))).toBe(true);
    expect(needsReason(first(one([lane("a", { priority: 1 }), lane("b", { priority: 2 })]), one([lane("a", { priority: 2 }), lane("b", { priority: 1 })])))).toBe(true);
    expect(needsReason(first(one([lane("x")], [est({})]), one([lane("x")])))).toBe(true);
    expect(needsReason(first(one([lane("x")], [disc({})]), one([lane("x")])))).toBe(false);
  });
  it("labels exist for every reason code", () => {
    expect(REASON_LABEL.prioritering).toBe("Prioritert om i produktforum");
    expect(REASON_LABEL.ingen).toBe("Uten begrunnelse");
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/timeline/events.test.ts`
Expected: FAIL: cannot find module `./events`.

- [ ] **Step 3: Write `src/features/timeline/events.ts`**

```ts
// Semantic diff of two plan snapshots: one event per change a person would name
// (a goal date moved, a span widened, an epic reordered), with a Norwegian
// summary rendered once. The PUT handler logs these on every save; later the
// compare mode (R1b) reuses the same function for "since the baseline".
import type { Plan, PlanLane, PlanTask } from "./merge";
import { WEEK, unitToDate, fmtDate, rangeWeeks } from "./epic-tools.js";

export const EVENT_CODES = [
  "epic.ny", "epic.slettet", "epic.navn", "epic.maltall", "epic.eier", "epic.maldato", "epic.ekstern", "epic.prioritet", "epic.ado",
  "feature.ny", "feature.slettet", "feature.navn", "feature.flyttet", "feature.spenn", "feature.utredning-slutt",
  "feature.estimert", "feature.utredning", "feature.epic", "feature.prioritet", "feature.avhengighet", "feature.ado",
  "plan.seed", "plan.begrunnelse",
] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type Cause = "bruker" | "avhengighet" | "ado" | "system";
export type PlanEvent = {
  targetType: "epic" | "feature" | "plan";
  targetId: string;
  targetLabel: string;
  laneKey: string | null;
  code: EventCode;
  before?: unknown;
  after?: unknown;
  cause: Cause;
  causeRef?: string;
  summary: string;
};
export type DiffOptions = { causes?: Record<string, string>; source?: string };

export const REASON_CODES = ["utredning", "avhengighet", "kapasitet", "prioritering", "ekstern", "omfang", "rydding", "annet", "ingen"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const REASON_LABEL: Record<ReasonCode, string> = {
  utredning: "Utredningen viste mer/mindre arbeid",
  avhengighet: "En avhengighet flyttet seg",
  kapasitet: "Kapasitet: annet gikk foran",
  prioritering: "Prioritert om i produktforum",
  ekstern: "Ekstern dato endret",
  omfang: "Omfanget endret",
  rydding: "Retting / rydding",
  annet: "Annet",
  ingen: "Uten begrunnelse",
};

const near = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : Math.abs(a - b) < 1e-6;
const date = (u: number) => fmtDate(unitToDate(u));
const q = (s: string) => "«" + s + "»";
const n = (count: number, one: string, many: string) => count + " " + (count === 1 ? one : many);
const span = (r: { likely: number; late: number }) => (r.likely === r.late ? String(r.late) : r.likely + "–" + r.late);
const rangeWords = (t: PlanTask) => span(rangeWeeks(t)!) + " uker";
const pickLane = (l: PlanLane) => ({ name: l.name, goalDate: l.goalDate ?? null, goalProvisional: !!l.goalProvisional, metric: l.metric ?? null, priority: l.priority ?? null });
const pickTask = (t: PlanTask) => ({ label: t.label, lane: t.lane, kind: t.kind, start: t.start, end: t.end, endLikely: t.endLikely ?? null, deps: t.deps ?? [] });

/** Keys of `after` that are not part of the longest common subsequence with `before`:
 *  the items that actually moved. Keys present on one side only are ignored. */
export function movedKeys(before: string[], after: string[]): string[] {
  const both = new Set(before.filter((k) => after.includes(k)));
  const a = before.filter((k) => both.has(k));
  const b = after.filter((k) => both.has(k));
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const kept = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) { kept.add(a[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return b.filter((k) => !kept.has(k));
}

const laneKeysInOrder = (p: Plan) =>
  p.lanes.map((l, i) => ({ l, i })).sort((x, y) => (x.l.priority ?? Infinity) - (y.l.priority ?? Infinity) || x.i - y.i).map((x) => x.l.key);
const taskIdsInLane = (p: Plan, lane: string) =>
  p.tasks.map((t, i) => ({ t, i })).filter((x) => x.t.lane === lane).sort((x, y) => (x.t.order ?? Infinity) - (y.t.order ?? Infinity) || x.i - y.i).map((x) => x.t.id);

function goalSummary(b: PlanLane, a: PlanLane): string {
  const bd = typeof b.goalDate === "number" ? b.goalDate : null, ad = typeof a.goalDate === "number" ? a.goalDate : null;
  const bp = !!b.goalProvisional, ap = !!a.goalProvisional;
  if (bd === null && ad !== null) return (ap ? "Foreløpig mål satt: " : "Måldato satt: ") + date(ad);
  if (bd !== null && ad === null) return "Måldato fjernet (var " + date(bd) + ")";
  if (bd === null || ad === null) return "Måldato endret";
  if (near(bd, ad)) return ap ? "Måldato " + date(ad) + " → foreløpig" : "Foreløpig mål " + date(ad) + " → endelig måldato";
  if (bp === ap) return (ap ? "Foreløpig mål: " : "Måldato: ") + date(bd) + " → " + date(ad);
  return (bp ? "Foreløpig mål " : "Måldato ") + date(bd) + " → " + (ap ? "foreløpig mål " : "måldato ") + date(ad);
}
const textChange = (what: string, b: string | undefined, a: string | undefined) =>
  !b && a ? what + " satt: " + a : b && !a ? what + " fjernet (var " + b + ")" : what + ": " + q(b ?? "") + " → " + q(a ?? "");

export function diffPlans(before: Plan, after: Plan, opts: DiffOptions = {}): PlanEvent[] {
  if (opts.source === "seed") {
    return [{ targetType: "plan", targetId: "plan", targetLabel: "Planen", laneKey: null, code: "plan.seed", cause: "system",
      summary: `Eksempel-epics lastet inn (${after.lanes.length} epics, ${after.tasks.length} features)` }];
  }
  const ev: PlanEvent[] = [];
  const bl = new Map(before.lanes.map((l) => [l.key, l]));
  const al = new Map(after.lanes.map((l) => [l.key, l]));
  const laneName = (key: string) => al.get(key)?.name ?? bl.get(key)?.name ?? key;
  const bt = new Map(before.tasks.map((t) => [t.id, t]));
  const at = new Map(after.tasks.map((t) => [t.id, t]));
  const label = (id: string) => at.get(id)?.label ?? bt.get(id)?.label ?? id;

  // ----- epics -----
  const bKeys = laneKeysInOrder(before), aKeys = laneKeysInOrder(after);
  const movedLanes = new Set(movedKeys(bKeys, aKeys));
  for (const l of after.lanes) {
    const b = bl.get(l.key);
    const base = { targetType: "epic" as const, targetId: l.key, targetLabel: l.name, laneKey: l.key, cause: "bruker" as const };
    if (!b) { ev.push({ ...base, code: "epic.ny", after: pickLane(l), summary: "Ny epic" + (typeof l.goalDate === "number" ? " · " + goalSummary({ key: l.key, name: l.name }, l).replace(" satt", "") : "") }); continue; }
    if (b.name !== l.name) ev.push({ ...base, code: "epic.navn", before: b.name, after: l.name, summary: "Navn: " + q(b.name) + " → " + q(l.name) });
    if ((b.metric ?? "") !== (l.metric ?? "")) ev.push({ ...base, code: "epic.maltall", before: b.metric ?? null, after: l.metric ?? null, summary: textChange("Måltall", b.metric, l.metric) });
    if ((b.owner ?? "") !== (l.owner ?? "")) ev.push({ ...base, code: "epic.eier", before: b.owner ?? null, after: l.owner ?? null, summary: textChange("Eier", b.owner, l.owner) });
    if (!near(b.goalDate, l.goalDate) || !!b.goalProvisional !== !!l.goalProvisional)
      ev.push({ ...base, code: "epic.maldato", before: { date: b.goalDate ?? null, provisional: !!b.goalProvisional }, after: { date: l.goalDate ?? null, provisional: !!l.goalProvisional }, summary: goalSummary(b, l) });
    if (!!b.externalDate !== !!l.externalDate) ev.push({ ...base, code: "epic.ekstern", before: !!b.externalDate, after: !!l.externalDate, summary: l.externalDate ? "Merket som ekstern dato" : "Ekstern dato fjernet" });
    if ((b.adoId ?? null) !== (l.adoId ?? null)) ev.push({ ...base, code: "epic.ado", before: b.adoId ?? null, after: l.adoId ?? null, summary: l.adoId ? "ADO-id: #" + l.adoId : "ADO-id fjernet" });
    if (movedLanes.has(l.key)) {
      const from = bKeys.indexOf(l.key) + 1, to = aKeys.indexOf(l.key) + 1;
      const next = aKeys[to];
      ev.push({ ...base, code: "epic.prioritet", before: from, after: to, summary: `Prioritet: ${from} → ${to}` + (next ? ` (foran ${q(laneName(next))})` : " (sist)") });
    }
  }
  for (const b of before.lanes) if (!al.has(b.key)) {
    const count = before.tasks.filter((t) => t.lane === b.key).length;
    ev.push({ targetType: "epic", targetId: b.key, targetLabel: b.name, laneKey: b.key, code: "epic.slettet", before: pickLane(b), cause: "bruker",
      summary: "Epic slettet" + (count ? ` (med ${n(count, "feature", "features")})` : "") });
  }

  // ----- features -----
  const movedTasks = new Set<string>();
  for (const key of al.keys()) {
    const bo = taskIdsInLane(before, key).filter((id) => at.get(id)?.lane === key);
    const ao = taskIdsInLane(after, key).filter((id) => bt.get(id)?.lane === key);
    movedKeys(bo, ao).forEach((id) => movedTasks.add(id));
  }
  for (const t of after.tasks) {
    const b = bt.get(t.id);
    const base = { targetType: "feature" as const, targetId: t.id, targetLabel: t.label, laneKey: t.lane, cause: "bruker" as const };
    if (!b) {
      ev.push({ ...base, code: "feature.ny", after: pickTask(t), summary: t.kind === "discovery" ? `Ny utredning (til ${date(t.end)})` : `Ny feature (${rangeWords(t)})` });
      continue;
    }
    if (b.label !== t.label) ev.push({ ...base, code: "feature.navn", before: b.label, after: t.label, summary: "Navn: " + q(b.label) + " → " + q(t.label) });
    if (b.lane !== t.lane) ev.push({ ...base, code: "feature.epic", before: b.lane, after: t.lane, summary: `Flyttet fra ${q(laneName(b.lane))} til ${q(laneName(t.lane))}` });
    else if (movedTasks.has(t.id)) {
      const from = taskIdsInLane(before, t.lane).indexOf(t.id) + 1, to = taskIdsInLane(after, t.lane).indexOf(t.id) + 1;
      ev.push({ ...base, code: "feature.prioritet", before: from, after: to, summary: `Prioritet i epicen: ${from} → ${to}` });
    }
    if (b.kind !== t.kind) {
      ev.push(t.kind === "estimate"
        ? { ...base, code: "feature.estimert", before: { kind: b.kind, end: b.end }, after: { kind: t.kind, ...rangeWeeks(t)! }, summary: `Utredet: estimat ${rangeWords(t)}` }
        : { ...base, code: "feature.utredning", before: { kind: b.kind, ...rangeWeeks(b)! }, after: { kind: t.kind, end: t.end }, summary: `Tilbake til utredning (til ${date(t.end)})` });
    }
    if (!near(b.start, t.start)) {
      const dw = Math.round((t.start - b.start) / WEEK);
      const cause = opts.causes?.[t.id];
      const blocker = cause && cause.startsWith("dep:") ? cause.slice(4) : null;
      const where = `start ${date(b.start)} → ${date(t.start)}`;
      if (blocker) ev.push({ ...base, code: "feature.flyttet", before: { start: b.start }, after: { start: t.start }, cause: "avhengighet", causeRef: blocker,
        summary: dw ? `Flyttet ${n(Math.abs(dw), "uke", "uker")} av avhengighet ${q(label(blocker))}` : `Flyttet av avhengighet ${q(label(blocker))}: ${where}` });
      else ev.push({ ...base, code: "feature.flyttet", before: { start: b.start }, after: { start: t.start },
        summary: dw ? `Flyttet ${n(Math.abs(dw), "uke", "uker")} ${dw > 0 ? "senere" : "tidligere"}: ${where}` : `Flyttet: ${where}` });
    }
    if (b.kind === "estimate" && t.kind === "estimate") {
      const rb = rangeWeeks(b)!, ra = rangeWeeks(t)!;
      if (rb.likely !== ra.likely || rb.late !== ra.late) {
        const dl = ra.late - rb.late;
        const why = dl > 0 ? `utvidet ${n(dl, "uke", "uker")}` : dl < 0 ? `krympet ${n(-dl, "uke", "uker")}` : `sannsynlig ${rb.likely} → ${ra.likely} uker`;
        ev.push({ ...base, code: "feature.spenn", before: rb, after: ra, summary: `Spenn: ${span(rb)} → ${span(ra)} uker (${why})` });
      }
    }
    if (b.kind === "discovery" && t.kind === "discovery" && !near(b.end, t.end)) {
      const dw = Math.round((t.end - b.end) / WEEK);
      ev.push({ ...base, code: "feature.utredning-slutt", before: { end: b.end }, after: { end: t.end },
        summary: `Utredning slutt: ${date(b.end)} → ${date(t.end)}` + (dw > 0 ? ` (${n(dw, "uke", "uker")} senere)` : dw < 0 ? ` (${n(-dw, "uke", "uker")} tidligere)` : "") });
    }
    const bd = b.deps ?? [], ad = t.deps ?? [];
    for (const id of ad) if (!bd.includes(id)) ev.push({ ...base, code: "feature.avhengighet", after: id, summary: `Blokkeres nå av ${q(label(id))}` });
    for (const id of bd) if (!ad.includes(id)) ev.push({ ...base, code: "feature.avhengighet", before: id, summary: `Avhengighet til ${q(label(id))} fjernet` });
    if ((b.adoId ?? null) !== (t.adoId ?? null)) ev.push({ ...base, code: "feature.ado", before: b.adoId ?? null, after: t.adoId ?? null, summary: t.adoId ? "ADO-id: #" + t.adoId : "ADO-id fjernet" });
  }
  for (const b of before.tasks) if (!at.has(b.id) && al.has(b.lane)) // features of a deleted epic are covered by epic.slettet
    ev.push({ targetType: "feature", targetId: b.id, targetLabel: b.label, laneKey: b.lane, code: "feature.slettet", before: pickTask(b), cause: "bruker", summary: b.kind === "discovery" ? "Utredning slettet" : "Feature slettet" });
  return ev;
}

/** The server-side rule for "this change deserves a reason"; the page mirrors it in ASK_REASON_FOR. */
export function needsReason(e: PlanEvent): boolean {
  if (e.cause !== "bruker") return false;
  switch (e.code) {
    case "epic.maldato": return (e.before as { date: number | null }).date !== null;
    case "epic.prioritet":
    case "feature.epic": return true;
    case "feature.spenn": { const b = e.before as { likely: number; late: number }, a = e.after as { likely: number; late: number }; return a.late > b.late || a.likely > b.likely; }
    case "feature.flyttet": return (e.after as { start: number }).start - (e.before as { start: number }).start >= WEEK - 1e-9;
    case "feature.utredning-slutt": return (e.after as { end: number }).end > (e.before as { end: number }).end + 1e-9;
    case "feature.slettet": return (e.before as { kind: string }).kind === "estimate";
    default: return false;
  }
}
```

Note the `epic.ny` summary for a lane created with a goal: `goalSummary` gives «Måldato satt: 15. des» → after `.replace(" satt", "")` → «Ny epic · Måldato: 15. des». The test only checks «Ny epic» for a lane without a goal; keep it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/timeline/events.test.ts`
Expected: PASS (if the `feature.flyttet` regex fails on the Norwegian month, check `fmtDate` output like «16. des» and adjust the regex to `\d+\. [a-zæøå]+`).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add src/features/timeline/events.ts src/features/timeline/events.test.ts
git commit -m "timeline: semantic plan diff (events.ts) with Norwegian summaries, causes and needsReason"
```

---

### Task 4: Prisma: `TimelineChangeset`, `TimelineEvent`, `TimelineSnapshot` (one additive migration)

**Files:**
- Modify: `prisma/schema.prisma` (append after `TimelineChange`)
- Create: `prisma/migrations/20261008120000_add_timeline_history/migration.sql`
- Regenerate: `src/generated/prisma/**` (committed, via `npx prisma generate`)

**Interfaces:**
- Produces: Prisma models `timelineChangeset`, `timelineEvent` (relation `changeset`), `timelineSnapshot` with the columns below.

- [ ] **Step 1: Start a local database (the only database any migrate command may touch)**

Run in the background (keep it running until Task 5 is done):
```bash
cd ~/Skytale/SkyTracker-wt-epics && npx prisma dev --db-port 54329 --name skytracker-r1a
```
Expected: it prints connection strings. Copy the TCP one into a shell variable for every migrate command:
```bash
LOCAL_DB="postgres://postgres:postgres@localhost:54329/template1?sslmode=disable"   # use the exact string prisma dev prints
```
If only a `prisma+postgres://…` string is printed, use that: the CLI accepts it for migrate. Never run a migrate command without `DATABASE_URL="$LOCAL_DB"` in front.

- [ ] **Step 2: Prove the baseline migrations apply locally (fails if the DB is not reachable)**

Run: `DATABASE_URL="$LOCAL_DB" npx prisma migrate deploy`
Expected: `7 migrations found … All migrations have been successfully applied.` (the last applied is `20260812113000_add_buffer_snapshot`).

- [ ] **Step 3: Add the models** (append to `prisma/schema.prisma`)

```prisma
// ─────────────────────────────────────────────────────────────
// Timeline history — one changeset per save, one event per
// semantic change (features/timeline/events.ts), and plan
// snapshots: one per day before the first change, plus named
// baselines (R1b). TimelineChange above is the old log, unused.
// ─────────────────────────────────────────────────────────────

model TimelineChangeset {
  id          String          @id @default(cuid())
  at          DateTime        @default(now())
  editor      String?
  source      String          @default("bruker") // bruker | seed | import | ado | system
  reason      String?
  reasonCode  String?                            // utredning | avhengighet | … | annet | ingen (skipped)
  planVersion Int
  eventCount  Int             @default(0)
  events      TimelineEvent[]

  @@index([at])
}

model TimelineEvent {
  id          String   @id @default(cuid())
  changesetId String
  at          DateTime @default(now())
  editor      String?
  targetType  String   // epic | feature | plan
  targetId    String
  targetLabel String
  laneKey     String?
  code        String   // epic.maldato, feature.spenn, …
  before      Json?
  after       Json?
  cause       String   @default("bruker") // bruker | avhengighet | ado | system
  causeRef    String?
  summary     String

  changeset TimelineChangeset @relation(fields: [changesetId], references: [id], onDelete: Cascade)

  @@index([at])
  @@index([laneKey, at])
  @@index([targetId, at])
}

model TimelineSnapshot {
  id          String   @id @default(cuid())
  at          DateTime @default(now())
  kind        String   // dag | baseline | sprint
  day         String?  // YYYY-MM-DD in Europe/Oslo, set for kind = dag
  label       String?
  planVersion Int
  data        Json
  createdBy   String?

  @@unique([kind, day])
  @@index([at])
}
```

- [ ] **Step 4: Write the migration** (`prisma/migrations/20261008120000_add_timeline_history/migration.sql`)

```sql
-- CreateTable
CREATE TABLE "TimelineChangeset" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor" TEXT,
    "source" TEXT NOT NULL DEFAULT 'bruker',
    "reason" TEXT,
    "reasonCode" TEXT,
    "planVersion" INTEGER NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TimelineChangeset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "changesetId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "laneKey" TEXT,
    "code" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "cause" TEXT NOT NULL DEFAULT 'bruker',
    "causeRef" TEXT,
    "summary" TEXT NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineSnapshot" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "day" TEXT,
    "label" TEXT,
    "planVersion" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "TimelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineChangeset_at_idx" ON "TimelineChangeset"("at");

-- CreateIndex
CREATE INDEX "TimelineEvent_at_idx" ON "TimelineEvent"("at");

-- CreateIndex
CREATE INDEX "TimelineEvent_laneKey_at_idx" ON "TimelineEvent"("laneKey", "at");

-- CreateIndex
CREATE INDEX "TimelineEvent_targetId_at_idx" ON "TimelineEvent"("targetId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineSnapshot_kind_day_key" ON "TimelineSnapshot"("kind", "day");

-- CreateIndex
CREATE INDEX "TimelineSnapshot_at_idx" ON "TimelineSnapshot"("at");

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_changesetId_fkey" FOREIGN KEY ("changesetId") REFERENCES "TimelineChangeset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Validate, apply locally, prove the SQL matches the schema**

Run: `npx prisma validate` → Expected: `The schema at prisma/schema.prisma is valid 🚀`.
Run: `DATABASE_URL="$LOCAL_DB" npx prisma migrate deploy` → Expected: `Applying migration 20261008120000_add_timeline_history … All migrations have been successfully applied.`
Run: `DATABASE_URL="$LOCAL_DB" npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$LOCAL_DB" --exit-code`
Expected: exit code 0 and `No difference detected.` If a difference is printed, edit the SQL until it matches (that is the migration Vercel will run on merge; a mismatch is a Ruling to record).

- [ ] **Step 6: Regenerate the client, typecheck, commit**

Run: `npx prisma generate` → Expected: `Generated Prisma Client … to ./src/generated/prisma`.
Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add prisma/schema.prisma prisma/migrations/20261008120000_add_timeline_history/migration.sql src/generated/prisma
git commit -m "prisma: TimelineChangeset, TimelineEvent and TimelineSnapshot for the timeline history"
```

---

### Task 5: Server: `history.ts`, PUT with `note`, `/api/timeline-changes` GET + PATCH; retire `plan-delta.ts`

**Files:**
- Create: `src/features/timeline/history.ts`
- Test: `src/features/timeline/history.test.ts`
- Modify: `src/app/api/timeline-plan/route.ts`
- Modify: `src/app/api/timeline-changes/route.ts` (rewrite)
- Delete: `src/features/timeline/plan-delta.ts`, `src/features/timeline/plan-delta.test.ts`

**Interfaces:**
- Consumes: `diffPlans`, `needsReason`, `REASON_CODES`, `REASON_LABEL` (Task 3); Prisma models (Task 4).
- Produces: `parseNote(raw: unknown): SaveNote` (sanitised `{ reason?, reasonCode?, causes?, source? }`), `osloDay(d: Date): string`, `recordChangeset(db, { before, after, beforeVersion, afterVersion, editor, note }): Promise<string | null>`. `PUT /api/timeline-plan` accepts `{ data, note? }` and answers `{ version, data, changesetId }` (also on the create path, diffing against an empty plan). `GET /api/timeline-changes?lane=&target=&before=&limit=` → `{ events: (TimelineEvent & { changeset })[], missing14d }`. `PATCH /api/timeline-changes` `{ changesetId, reason, reasonCode }` (writers) → `{ ok: true }` and a `plan.begrunnelse` event.

- [ ] **Step 1: Write the failing tests** (`src/features/timeline/history.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { osloDay, parseNote } from "./history";

describe("history helpers", () => {
  it("osloDay gives the calendar day in Europe/Oslo", () => {
    expect(osloDay(new Date("2026-10-08T22:30:00Z"))).toBe("2026-10-09"); // 00:30 in Oslo (CEST)
    expect(osloDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01"); // 00:30 CET
    expect(osloDay(new Date("2026-10-08T10:00:00Z"))).toBe("2026-10-08");
  });

  it("parseNote keeps only known fields and codes, trims and caps the text", () => {
    expect(parseNote(undefined)).toEqual({});
    expect(parseNote({ reason: "  Flere noder  ", reasonCode: "utredning", causes: { b: "dep:a", c: 42 }, source: "seed", extra: 1 }))
      .toEqual({ reason: "Flere noder", reasonCode: "utredning", causes: { b: "dep:a" }, source: "seed" });
    expect(parseNote({ reasonCode: "bogus", source: "hacker" })).toEqual({});
    expect(parseNote({ reason: "x".repeat(600) }).reason!.length).toBe(500);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/timeline/history.test.ts`
Expected: FAIL: cannot find module `./history`.

- [ ] **Step 3: Write `src/features/timeline/history.ts`**

```ts
// Glue between a save and the history tables: sanitise the client's note,
// compute the events, write the daily snapshot (plan as it was before the
// first change of the day), the changeset and its events. Best effort: the
// caller must never fail a save because logging failed.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Plan } from "./merge";
import { diffPlans, needsReason, REASON_CODES, type PlanEvent } from "./events";

export type SaveNote = { reason?: string; reasonCode?: string; causes?: Record<string, string>; source?: string };
const SOURCES = ["bruker", "seed", "import", "ado", "system"];
const REASON_MAX = 500;

export function parseNote(raw: unknown): SaveNote {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const note: SaveNote = {};
  if (typeof r.reason === "string" && r.reason.trim()) note.reason = r.reason.trim().slice(0, REASON_MAX);
  if (typeof r.reasonCode === "string" && (REASON_CODES as readonly string[]).includes(r.reasonCode)) note.reasonCode = r.reasonCode;
  if (r.causes && typeof r.causes === "object") {
    const causes: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.causes as Record<string, unknown>)) if (typeof v === "string" && v.length < 100) causes[k] = v;
    if (Object.keys(causes).length) note.causes = causes;
  }
  if (typeof r.source === "string" && SOURCES.includes(r.source)) note.source = r.source;
  return note;
}

export function osloDay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const json = (v: unknown): Prisma.InputJsonValue | undefined => (v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue));

export async function recordChangeset(
  db: PrismaClient,
  args: { before: Plan; after: Plan; beforeVersion: number; afterVersion: number; editor: string | null; note: SaveNote },
): Promise<string | null> {
  const events: PlanEvent[] = diffPlans(args.before, args.after, { causes: args.note.causes, source: args.note.source });
  if (!events.length) return null;
  const day = osloDay(new Date());
  const hasDaily = await db.timelineSnapshot.findFirst({ where: { kind: "dag", day }, select: { id: true } });
  if (!hasDaily) {
    try {
      await db.timelineSnapshot.create({ data: { kind: "dag", day, planVersion: args.beforeVersion, data: args.before as unknown as Prisma.InputJsonValue } });
    } catch { /* a concurrent save won the unique (kind, day) race: fine */ }
  }
  const reasonCode = args.note.reasonCode ?? (events.some(needsReason) ? "ingen" : null);
  const cs = await db.timelineChangeset.create({
    data: {
      editor: args.editor,
      source: args.note.source ?? "bruker",
      reason: args.note.reason ?? null,
      reasonCode,
      planVersion: args.afterVersion,
      eventCount: events.length,
      events: {
        create: events.map((e) => ({
          editor: args.editor,
          targetType: e.targetType, targetId: e.targetId, targetLabel: e.targetLabel, laneKey: e.laneKey,
          code: e.code, before: json(e.before), after: json(e.after),
          cause: e.cause, causeRef: e.causeRef ?? null, summary: e.summary,
        })),
      },
    },
    select: { id: true },
  });
  return cs.id;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/timeline/history.test.ts` → Expected: PASS.

- [ ] **Step 5: Rewrite the PUT in `src/app/api/timeline-plan/route.ts`**

Replace the imports of `planDelta` with `import { parseNote, recordChangeset } from "@/features/timeline/history";`, update the header comment (`PUT → body { data, note? }; … responds { version, data, changesetId }`), and replace everything from `let body: { data?: unknown };` to the end of the file with:

```ts
  let body: { data?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const incoming = body.data as Plan | null | undefined;
  if (!incoming || !Array.isArray(incoming.lanes) || !Array.isArray(incoming.tasks)) {
    return Response.json({ error: "invalid plan: expected { lanes: [], tasks: [] }" }, { status: 400 });
  }
  if (incoming.schema !== undefined && incoming.schema !== PLAN_SCHEMA) {
    return Response.json({ error: "unknown plan schema" }, { status: 400 });
  }
  const note = parseNote(body.note);
  const updatedBy = session.user?.name ?? session.user?.email ?? null;
  const EMPTY: Plan = { schema: PLAN_SCHEMA, lanes: [], tasks: [], deleted: {}, deletedLanes: {} };

  // read-merge-write with a version guard; retry on write races
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
    if (!stored) {
      try {
        const created = await prisma.timelinePlan.create({
          data: { id: PLAN_ID, data: incoming as unknown as Prisma.InputJsonValue, version: 1, updatedBy },
        });
        const changesetId = await logHistory(EMPTY, incoming, 0, created.version, updatedBy, note);
        return Response.json({ version: created.version, updatedAt: created.updatedAt, data: incoming, changesetId });
      } catch {
        continue; // someone else created it first — retry as merge
      }
    }
    const merged = mergePlans(stored.data as unknown as Plan, incoming);
    const updated = await prisma.timelinePlan.updateMany({
      where: { id: PLAN_ID, version: stored.version },
      data: { data: merged as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy },
    });
    if (updated.count === 1) {
      const changesetId = await logHistory(stored.data as unknown as Plan, merged, stored.version, stored.version + 1, updatedBy, note);
      return Response.json({ version: stored.version + 1, data: merged, changesetId });
    }
  }
  return Response.json({ error: "contention — try again" }, { status: 409 });
}

// The history is best-effort: a failed log write must never fail the save.
async function logHistory(before: Plan, after: Plan, beforeVersion: number, afterVersion: number, editor: string | null, note: ReturnType<typeof parseNote>) {
  try {
    return await recordChangeset(prisma, { before, after, beforeVersion, afterVersion, editor, note });
  } catch {
    return null; // tables missing before the migration ran, or a transient DB error
  }
}
```

- [ ] **Step 6: Rewrite `src/app/api/timeline-changes/route.ts`**

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REASON_CODES, REASON_LABEL, type ReasonCode } from "@/features/timeline/events";
import type { Prisma } from "@/generated/prisma/client";

// History of the shared timeline plan, newest first.
// GET ?lane=<laneKey>&target=<id>&before=<ISO>&limit=60
//   → { events: [{ …TimelineEvent, changeset: { id, at, editor, source, reason, reasonCode, eventCount } }], missing14d }
//   missing14d = changesets of the last 14 days that needed a reason and got none (reasonCode "ingen").
// PATCH { changesetId, reason, reasonCode } (writers) → adds a reason afterwards and logs it as plan.begrunnelse.

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60));
  const before = url.searchParams.get("before");
  const lane = url.searchParams.get("lane");
  const target = url.searchParams.get("target");
  const where: Prisma.TimelineEventWhereInput = {};
  if (before) where.at = { lt: new Date(before) };
  if (lane) where.laneKey = lane;
  if (target) where.targetId = target;

  try {
    const [events, missing14d] = await Promise.all([
      prisma.timelineEvent.findMany({
        where,
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: limit,
        include: { changeset: { select: { id: true, at: true, editor: true, source: true, reason: true, reasonCode: true, eventCount: true } } },
      }),
      prisma.timelineChangeset.count({ where: { reasonCode: "ingen", at: { gte: new Date(Date.now() - 14 * 86400000) } } }),
    ]);
    return Response.json({ events, missing14d }, NO_STORE);
  } catch {
    return Response.json({ events: [], missing14d: 0 }, NO_STORE); // tables missing before the migration ran
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  let body: { changesetId?: unknown; reason?: unknown; reasonCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const changesetId = typeof body.changesetId === "string" ? body.changesetId : "";
  const reasonCode = typeof body.reasonCode === "string" && (REASON_CODES as readonly string[]).includes(body.reasonCode) && body.reasonCode !== "ingen"
    ? (body.reasonCode as ReasonCode) : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!changesetId || !reasonCode) return Response.json({ error: "changesetId and a reason code are required" }, { status: 400 });
  const editor = session.user?.name ?? session.user?.email ?? null;
  try {
    await prisma.timelineChangeset.update({ where: { id: changesetId }, data: { reason: reason || null, reasonCode } });
    await prisma.timelineEvent.create({
      data: {
        changesetId, editor, targetType: "plan", targetId: changesetId, targetLabel: "Begrunnelse", laneKey: null,
        code: "plan.begrunnelse", cause: "system",
        summary: "Begrunnelse lagt til: " + REASON_LABEL[reasonCode] + (reason ? " – " + reason : ""),
      },
    });
    return Response.json({ ok: true }, NO_STORE);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
```

- [ ] **Step 7: Delete `plan-delta.ts` and its test; typecheck, test, build**

```bash
git rm -q src/features/timeline/plan-delta.ts src/features/timeline/plan-delta.test.ts
npx tsc --noEmit && npx vitest run && npx next build
```
Expected: tsc clean; vitest all green (the suite is now epic-tools, merge, events, history, schedule, ado); `next build` lists `/api/timeline-changes` and `/api/timeline-plan` as dynamic routes with no errors.

- [ ] **Step 8: Commit, then stop the local database**

```bash
git add -A src/features/timeline src/app/api
git commit -m "timeline: log a changeset with reasons and events on every save; history API (GET, PATCH)"
npx prisma dev stop skytracker-r1a   # or Ctrl-C in its terminal
```

---

### Task 6: Page: the save carries a note; dependency causes; the reason dialog

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Test: `<scratchpad>/hosted-history-smoke.mjs` (new; scratchpad = `/private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad`)

**Interfaces:**
- Consumes: `resolveDeps` → `{ id, by }[]` (Task 1); `PUT` body `{ data, note }` and `GET/PATCH /api/timeline-changes` (Task 5).
- Produces (page globals inside `__bootTimeline`): `pendingNote` `{ causes, reason, reasonCode, source, lines }`, `emptyNote()`, `restoreNote(note)`, `askReason(lines, late?)`, `closeReason(code, text)`, `submitLateReason(changesetId, code, text)` (stub, filled in Task 8), `reasonOpen`, `ASK_REASON_FOR`, `REASON_CODES`, `REASON_LABEL`, `dragReasonLines(d)`, `editReasonLines(before, t)`, `spanText(r)`. DOM: `#reasonBack`, `#reasonList`, `#reasonCodes button[data-code]`, `#reasonText`, `#reasonSave`, `#reasonSkip`.

- [ ] **Step 1: Write the failing smoke** (`<scratchpad>/hosted-history-smoke.mjs`)

```js
// hosted-history-smoke.mjs: timeline.html + epic-tools.js behind a mock API that runs the REAL mergePlans and
// diffPlans/needsReason (tsx imports from the worktree) and keeps changesets/events in memory, exactly like the
// route. Drives the page through the R1a history scenarios S1–S8 (S4–S8 are added by later tasks).
// Run from the worktree:  npx tsx <scratchpad>/hosted-history-smoke.mjs
import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { mergePlans } from "/Users/dnumreig/Skytale/SkyTracker-wt-epics/src/features/timeline/merge.ts";
import { diffPlans, needsReason, REASON_LABEL } from "/Users/dnumreig/Skytale/SkyTracker-wt-epics/src/features/timeline/events.ts";
const require = createRequire("/Users/dnumreig/ptt-e2e/package.json");
const { chromium } = require("playwright");
const SRC = "/Users/dnumreig/Skytale/SkyTracker-wt-epics";
const DIR = "/private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad/ui";
mkdirSync(DIR, { recursive: true });
const assert = (cond, msg) => { if (!cond) throw new Error("ASSERT: " + msg); };
const src = (rel) => readFileSync(SRC + "/" + rel, "utf8");

/* ---------- mock server: plan + history (mirrors api/timeline-plan and api/timeline-changes) ---------- */
let stored = null, seq = 0;
const changesets = [], events = [];
const EMPTY = { schema: "epics-v1", lanes: [], tasks: [], deleted: {}, deletedLanes: {} };
function record(before, after, note, version) {
  const evs = diffPlans(before, after, { causes: note?.causes, source: note?.source });
  if (!evs.length) return null;
  const cs = { id: "cs" + (++seq), at: new Date(Date.now() + seq).toISOString(), editor: "Test Bruker", source: note?.source || "bruker",
    reason: note?.reason || null, reasonCode: note?.reasonCode || (evs.some(needsReason) ? "ingen" : null), planVersion: version, eventCount: evs.length };
  changesets.push(cs);
  evs.forEach((e) => events.push({ id: "ev" + (++seq), seq, changesetId: cs.id, at: cs.at, editor: cs.editor, ...e, changeset: cs }));
  return cs.id;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
  const body = async () => { let b = ""; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; };
  if (req.method === "GET" && url.pathname === "/timeline") return send(200, src("src/app/timeline/timeline.html"), "text/html; charset=utf-8");
  if (req.method === "GET" && url.pathname === "/timeline/epic-tools.js") return send(200, src("src/features/timeline/epic-tools.js"), "application/javascript");
  if (req.method === "GET" && url.pathname === "/api/timeline-plan") return send(200, JSON.stringify({ role: "writer", user: "Test Bruker", plan: stored }));
  if (req.method === "PUT" && url.pathname === "/api/timeline-plan") {
    const { data, note } = await body();
    const before = stored ? stored.data : EMPTY;
    const merged = stored ? mergePlans(before, data) : data;
    stored = { data: merged, version: (stored?.version || 0) + 1, updatedAt: new Date().toISOString(), updatedBy: "Test Bruker" };
    const changesetId = record(before, merged, note, stored.version);
    return send(200, JSON.stringify({ version: stored.version, data: merged, changesetId }));
  }
  if (req.method === "GET" && url.pathname === "/api/timeline-changes") {
    const lane = url.searchParams.get("lane"), target = url.searchParams.get("target"), before = url.searchParams.get("before");
    const limit = parseInt(url.searchParams.get("limit") || "60", 10);
    const list = events.filter((e) => (!lane || e.laneKey === lane) && (!target || e.targetId === target) && (!before || e.at < before))
      .sort((a, b) => b.seq - a.seq).slice(0, limit);
    return send(200, JSON.stringify({ events: list, missing14d: changesets.filter((c) => c.reasonCode === "ingen").length }));
  }
  if (req.method === "PATCH" && url.pathname === "/api/timeline-changes") {
    const { changesetId, reason, reasonCode } = await body();
    const cs = changesets.find((c) => c.id === changesetId);
    if (!cs || !reasonCode || reasonCode === "ingen") return send(400, "{}");
    cs.reason = reason || null; cs.reasonCode = reasonCode;
    events.push({ id: "ev" + (++seq), seq, changesetId: cs.id, at: new Date(Date.now() + seq).toISOString(), editor: "Test Bruker", targetType: "plan", targetId: cs.id,
      targetLabel: "Begrunnelse", laneKey: null, code: "plan.begrunnelse", cause: "system", summary: "Begrunnelse lagt til: " + REASON_LABEL[reasonCode] + (reason ? " – " + reason : ""), changeset: cs });
    return send(200, JSON.stringify({ ok: true }));
  }
  if (req.method === "GET" && url.pathname === "/__events") return send(200, JSON.stringify({ events, changesets, stored }));
  send(404, "not found", "text/plain");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- browser ---------- */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const savedNote = () => page.waitForFunction(() => /lagret/.test(document.getElementById("dirtyNote").textContent), null, { timeout: 15000 });
const reasonClosed = () => page.waitForFunction(() => !document.getElementById("reasonBack").classList.contains("open"));
const evs = async () => (await (await fetch(BASE + "/__events")).json());
const dragBar = async (id, dx, atRightHandle) => {
  const box = await (await page.$(`.bar[data-id="${id}"]`)).boundingBox();
  const cx = atRightHandle ? box.x + box.width - 3 : box.x + Math.min(box.width / 2, 30), cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 6 }); await page.mouse.up();
};

await page.goto(BASE + "/timeline");
await page.waitForFunction(() => !document.getElementById("emptyState").hidden);

// S1: seed → exactly one plan.seed event, no reason dialog
await page.click("#seedBtn"); await page.waitForSelector("#dlgBack.open"); await page.click("#dlgYes");
await page.waitForSelector(".lane-label"); await savedNote();
let ev = await evs();
assert(ev.events.length === 1 && ev.events[0].code === "plan.seed", "seed logs exactly one plan.seed event, got: " + ev.events.map((e) => e.code).join(","));
assert(!(await page.$("#reasonBack.open")), "no reason dialog for the seed");
console.log("S1 ok:", ev.events[0].summary);

// S2: widen Kapasitet (right handle +2 weeks) → dialog lists the span → reason «utredning» + text → feature.spenn carries it
await dragBar("kapasitet", 48, true);
await page.waitForSelector("#reasonBack.open");
const listed = await page.$eval("#reasonList", (e) => e.textContent);
assert(/spenn 4–7 → 4–9 uker/.test(listed), "dialog lists the widened span, got: " + listed);
await page.click('#reasonCodes button[data-code="utredning"]');
await page.fill("#reasonText", "Flere lagringsnoder enn antatt");
await page.click("#reasonSave"); await reasonClosed(); await savedNote();
ev = await evs();
const spenn = ev.events.find((e) => e.code === "feature.spenn");
assert(spenn && spenn.summary === "Spenn: 4–7 → 4–9 uker (utvidet 2 uker)", "feature.spenn summary: " + (spenn && spenn.summary));
assert(spenn.changeset.reasonCode === "utredning" && spenn.changeset.reason === "Flere lagringsnoder enn antatt", "reason stored on the changeset");
console.log("S2 ok:", spenn.summary, "|", spenn.changeset.reasonCode);

// S3: move IAM +2 weeks → dialog (start later, discovery end later) → skip → reasonCode ingen; Rollebasert pushed with cause avhengighet
await dragBar("iam", 48, false);
await page.waitForSelector("#reasonBack.open");
assert(/utredning slutt/.test(await page.$eval("#reasonList", (e) => e.textContent)), "dialog mentions the discovery end date");
await page.click("#reasonSkip"); await reasonClosed(); await savedNote();
ev = await evs();
const pushed = ev.events.find((e) => e.code === "feature.flyttet" && e.targetId === "roller");
assert(pushed && pushed.cause === "avhengighet" && pushed.causeRef === "iam" && /av avhengighet «IAM: brukerlivsløp»/.test(pushed.summary), "push attributed to IAM: " + JSON.stringify(pushed));
const own = ev.events.find((e) => e.code === "feature.flyttet" && e.targetId === "iam");
assert(own && own.cause === "bruker" && /^Flyttet 2 uker senere/.test(own.summary), "IAM's own move: " + (own && own.summary));
assert(ev.events.some((e) => e.code === "feature.utredning-slutt" && e.targetId === "iam"), "discovery end logged");
assert(pushed.changeset.reasonCode === "ingen", "skipped reason recorded as ingen");
console.log("S3 ok:", own.summary, "|", pushed.summary);

// __LATER_SCENARIOS__ (Tasks 7 and 8 insert S5–S8 here)

await page.screenshot({ path: DIR + "/08-history-final.png", fullPage: true });
await browser.close();
server.close();
if (errors.length) { console.error("page errors:", errors); process.exit(1); }
console.log("OK");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd ~/Skytale/SkyTracker-wt-epics && npx tsx /private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad/hosted-history-smoke.mjs`
Expected: `ASSERT: seed logs exactly one plan.seed event, got: epic.ny,epic.ny,…` (the page does not send `source: "seed"` yet).

- [ ] **Step 3: Page: CSS and the dialog markup**

Append to the `<style>` block, after `.dlg-body input{margin-top:12px}`:

```css
  /* ---------- begrunnelse ---------- */
  #reasonBack{z-index:70}
  .reason-list{margin:0 20px 12px;padding:10px 12px;border:1px solid var(--line-soft);border-radius:6px;background:var(--bg);font-size:13px;color:var(--text);display:grid;gap:4px}
  .reason-codes{display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 12px}
  .reason-codes button.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .reason-text{display:block;padding:0 20px 16px}
  .reason-text textarea{width:100%;font:inherit;font-size:14px;padding:6px 12px;border:1px solid var(--line);border-radius:4px;background:var(--input-bg);color:var(--text);min-height:64px;resize:vertical}
  .reason-text textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
```

Insert before `<!-- bekreftelses-/inndata-dialog -->`:

```html
<!-- begrunnelse: hvorfor flyttet noe seg -->
<div class="modal-back" id="reasonBack">
  <div class="modal" style="width:min(560px,100%)">
    <div class="modal-head">
      <div><h2>Hvorfor?</h2><div class="md">Begrunnelsen lagres i historikken sammen med endringen.</div></div>
    </div>
    <div class="modal-body">
      <div class="reason-list" id="reasonList"></div>
      <div class="reason-codes" id="reasonCodes"></div>
      <label class="reason-text"><textarea id="reasonText" placeholder="Kort, slik ledelsen skal lese det"></textarea></label>
    </div>
    <div class="modal-foot">
      <button class="text" id="reasonSkip">Lagre uten begrunnelse</button>
      <span class="btns"><button class="primary" id="reasonSave">Lagre</button></span>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Page: constants, note state, causes, save path**

After `const FV_FIELDS = ['tid','label','deps','meta'];` add:

```js
  const REASON_CODES = [
    ['utredning', 'Utredningen viste mer/mindre arbeid'], ['avhengighet', 'En avhengighet flyttet seg'],
    ['kapasitet', 'Kapasitet: annet gikk foran'], ['prioritering', 'Prioritert om i produktforum'],
    ['ekstern', 'Ekstern dato endret'], ['omfang', 'Omfanget endret'], ['rydding', 'Retting / rydding'], ['annet', 'Annet'],
  ];
  const REASON_LABEL = Object.fromEntries(REASON_CODES);
  /* Hvilke endringer som spør etter begrunnelse. Speiler needsReason() i events.ts; GO justerer her. */
  const ASK_REASON_FOR = { goalChanged: true, startLaterWeeks: 1, rangeWidened: true, discoveryEndLater: true, movedToOtherEpic: true, epicReordered: true, estimateDeleted: true };
```

After `let drag = null, colDrag = null, saveTimer = null, pendingSave = false, pushing = false;` add:

```js
  function emptyNote(){ return { causes: {}, reason: null, reasonCode: null, source: null, lines: [] }; }
  let pendingNote = emptyNote();   // følger neste lagring: begrunnelse, årsaker (dytt fra avhengighet), kilde (eksempel)
  function restoreNote(note){      // lagringen feilet: begrunnelsen og årsakene skal bli med i neste forsøk
    Object.assign(pendingNote.causes, note.causes);
    if(!pendingNote.reasonCode && note.reasonCode){ pendingNote.reasonCode = note.reasonCode; pendingNote.reason = note.reason; }
    if(!pendingNote.source) pendingNote.source = note.source;
  }
```

Replace `pushDeps`:

```js
  function pushDeps(recordCauses){
    resolveDeps(state).forEach(({id, by}) => {
      const t = getTask(id);
      if(!t) return;
      touch(t, 'tid');
      if(recordCauses !== false && by) pendingNote.causes[id] = 'dep:' + by;   // historikken: «flyttet av avhengighet …»
    });
  }
```

In `applyRemote` change `pushDeps();` to `pushDeps(false);` (a push caused by someone else's save is not this client's edit).

In `pushPlan`: after `pushing = true;` add
```js
    const note = pendingNote;        // det som følger akkurat denne lagringen
    pendingNote = emptyNote();
```
change the body to `body: JSON.stringify({ data: state, note: { reason: note.reason, reasonCode: note.reasonCode, causes: note.causes, source: note.source } })`, change the 409 line to `if(r.status === 409){ restoreNote(note); setSaveNote('travelt – prøver igjen'); scheduleServerSave(); return; }`, and in the `catch` add `restoreNote(note);` before the `setSaveNote(...)`.

Replace `scheduleServerSave`:

```js
  function scheduleServerSave(){
    if(!serverReady || !canWrite || applyingRemote) return;
    pendingSave = true;
    if(reasonOpen){ setSaveNote('venter på begrunnelse…'); return; }   // closeReason() kaller hit igjen
    setSaveNote('lagrer…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushPlan, 900);
  }
```

Change `anyModalOpen` to include the dialog: `const anyModalOpen = () => editorBack.classList.contains('open') || epicBack.classList.contains('open') || dlgBack.classList.contains('open') || reasonBack.classList.contains('open');`

In the seed handler, after `state = exampleSeed(state);` add `pendingNote.source = 'seed';   // én hendelse «Eksempel-epics lastet inn», ikke 25 «ny»`.

- [ ] **Step 5: Page: the dialog logic** (new section after `/* ================== dialoger ================== */` … `$('dlgInput').addEventListener(...)`)

```js
  /* ================== begrunnelse ================== */
  const reasonBack = $('reasonBack');
  let reasonOpen = false, reasonLate = null;   // reasonLate = { changesetId }: begrunnelse som legges til i etterkant (historikken)
  function askReason(lines, late){
    if(!HOSTED || !canWrite) return;           // lokal fil eller lesetilgang: ingen delt historikk å begrunne
    reasonLate = late || null;
    if(!reasonLate) pendingNote.lines = pendingNote.lines.concat(lines);
    reasonOpen = true;
    const shown = reasonLate ? lines : pendingNote.lines;
    $('reasonList').innerHTML = shown.map(l => '<span>' + esc(l) + '</span>').join('');
    const cur = reasonLate ? null : pendingNote.reasonCode;
    $('reasonCodes').innerHTML = REASON_CODES.map(([c, lbl]) =>
      '<button type="button" data-code="' + c + '"' + (cur === c ? ' class="on"' : '') + '>' + esc(lbl) + '</button>').join('');
    $('reasonText').value = reasonLate ? '' : (pendingNote.reason || '');
    $('reasonSkip').hidden = !!reasonLate;
    reasonBack.classList.add('open');
    setTimeout(() => $('reasonText').focus(), 0);
  }
  function closeReason(code, text){
    reasonOpen = false;
    reasonBack.classList.remove('open');
    const late = reasonLate; reasonLate = null;
    if(late){ if(code !== 'ingen') submitLateReason(late.changesetId, code, text); }
    else { pendingNote.reasonCode = code; pendingNote.reason = text || null; pendingNote.lines = []; }
    if(pendingSave) scheduleServerSave();   // en lagring som ventet på dialogen (også en sen begrunnelse) går nå
  }
  async function submitLateReason(changesetId, code, text){ /* fylles i historikk-oppgaven */ }
  $('reasonCodes').addEventListener('click', e => {
    const b = e.target.closest('button[data-code]');
    if(!b) return;
    [...$('reasonCodes').querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b));
  });
  $('reasonSave').addEventListener('click', () => {
    const on = $('reasonCodes').querySelector('button.on');
    const text = $('reasonText').value.trim();
    if(!on && !text){ $('reasonText').focus(); return; }
    closeReason(on ? on.dataset.code : 'annet', text);
  });
  $('reasonSkip').addEventListener('click', () => closeReason('ingen', null));
  const spanText = r => r.likely === r.late ? String(r.late) : r.likely + '–' + r.late;
  const weeksWord = n => n + ' uke' + (n === 1 ? '' : 'r');
  function dragReasonLines(d){
    const t = d.t, lines = [];
    const laterW = Math.round((t.start - d.start0) / WEEK);
    if(ASK_REASON_FOR.startLaterWeeks && laterW >= ASK_REASON_FOR.startLaterWeeks)
      lines.push(t.label + ': flyttet ' + weeksWord(laterW) + ' senere (start ' + fmtDate(unitToDate(d.start0)) + ' → ' + fmtDate(unitToDate(t.start)) + ')');
    if(t.kind === 'estimate' && ASK_REASON_FOR.rangeWidened){
      const b = { likely: Math.round((d.likely0 - d.start0) / WEEK), late: Math.round((d.end0 - d.start0) / WEEK) }, a = rangeWeeks(t);
      if(a.late > b.late || a.likely > b.likely) lines.push(t.label + ': spenn ' + spanText(b) + ' → ' + spanText(a) + ' uker');
    }
    if(t.kind === 'discovery' && ASK_REASON_FOR.discoveryEndLater && t.end > d.end0 + 1e-9)
      lines.push(t.label + ': utredning slutt ' + fmtDate(unitToDate(d.end0)) + ' → ' + fmtDate(unitToDate(t.end)));
    return lines;
  }
  function editReasonLines(b, t){
    const lines = [];
    const laterW = Math.round((t.start - b.start) / WEEK);
    if(ASK_REASON_FOR.startLaterWeeks && laterW >= ASK_REASON_FOR.startLaterWeeks) lines.push(t.label + ': flyttet ' + weeksWord(laterW) + ' senere');
    if(b.kind === 'estimate' && t.kind === 'estimate' && ASK_REASON_FOR.rangeWidened){
      const rb = rangeWeeks(b), ra = rangeWeeks(t);
      if(ra.late > rb.late || ra.likely > rb.likely) lines.push(t.label + ': spenn ' + spanText(rb) + ' → ' + spanText(ra) + ' uker');
    }
    if(b.kind === 'discovery' && t.kind === 'discovery' && ASK_REASON_FOR.discoveryEndLater && t.end > b.end + 1e-9)
      lines.push(t.label + ': utredning slutt ' + fmtDate(unitToDate(b.end)) + ' → ' + fmtDate(unitToDate(t.end)));
    if(b.lane !== t.lane && ASK_REASON_FOR.movedToOtherEpic)
      lines.push(t.label + ': flyttet fra «' + (getLane(b.lane) || {name: b.lane}).name + '» til «' + (getLane(t.lane) || {name: t.lane}).name + '»');
    return lines;
  }
```

- [ ] **Step 6: Page: ask at the edit sites**

Replace `endDrag`:
```js
  function endDrag(){
    if(!drag) return;
    drag.bar.classList.remove('dragging');
    tip.style.display = 'none';
    const d = drag;
    drag = null;
    if(d.moved){
      const lines = dragReasonLines(d);
      if(lines.length) askReason(lines);   // dialogen holder lagringen til den er lukket
      save(); render();
    }
  }
```

In `$('edSave')`: after `if(!t){ closeEditor(); return; }` insert `const before = { label: t.label, lane: t.lane, kind: t.kind, start: t.start, end: t.end, endLikely: t.endLikely };` and replace the tail
```js
    normalizePlan(state);
    pushDeps();
    save(); render();
    closeEditor();
```
with
```js
    normalizePlan(state);
    pushDeps();
    const lines = editReasonLines(before, t);
    if(lines.length) askReason(lines);
    save(); render();
    closeEditor();
```

In `$('epSave')`: after `let changed = false;` insert
```js
    const lines = [];
    const before = { goalDate: l.goalDate, goalProvisional: !!l.goalProvisional };
```
and replace `if(changed){ bumpLane(l); save(); }` with
```js
    if(ASK_REASON_FOR.goalChanged && typeof before.goalDate === 'number'){
      if(typeof l.goalDate !== 'number') lines.push(l.name + ': måldato fjernet (var ' + fmtDate(unitToDate(before.goalDate)) + ')');
      else if(Math.abs(l.goalDate - before.goalDate) > 1e-9) lines.push(l.name + ': måldato ' + fmtDate(unitToDate(before.goalDate)) + ' → ' + fmtDate(unitToDate(l.goalDate)));
      else if(before.goalProvisional && !l.goalProvisional) lines.push(l.name + ': foreløpig mål → endelig måldato');
    }
    if(changed){ bumpLane(l); if(lines.length) askReason(lines); save(); }
```

Quiet editor saves (otherwise every save of a dragged feature logs a 0-week «Flyttet», because a snapped unit does not round-trip through the date field): replace the block from `if(edSel.kind === 'discovery'){` to the closing `}` of its `else` branch in `$('edSave')` with
```js
    if(edSel.kind === 'discovery'){
      const end = fromDateInput($('edEnd').value);
      if(end === null){ $('edEnd').focus(); return; }
      const newEnd = Math.max(start + MIN_DUR, end);
      const startChanged = toDateInput(start) !== toDateInput(t.start), endChanged = toDateInput(newEnd) !== toDateInput(t.end);
      if(startChanged || endChanged || kindChanged){
        if(startChanged || kindChanged) t.start = start;
        if(endChanged || kindChanged) t.end = Math.max(t.start + MIN_DUR, newEnd);
        delete t.endLikely; touch(t, 'tid');
      }
    } else {
      const lw = Math.max(1, parseInt($('edLikely').value, 10) || 1);
      const hw = Math.max(lw, parseInt($('edLate').value, 10) || lw);
      const r = rangeWeeks(t);
      const startChanged = toDateInput(start) !== toDateInput(t.start);
      const weeksChanged = !r || lw !== r.likely || hw !== r.late;
      if(startChanged || weeksChanged || kindChanged){
        if(startChanged || kindChanged) t.start = start;
        t.endLikely = t.start + lw * WEEK; t.end = t.start + hw * WEEK;
        touch(t, 'tid');
      }
    }
```

Deleting an estimate asks: in `removeTask` after the confirm line insert `if(t.kind === 'estimate' && ASK_REASON_FOR.estimateDeleted) askReason([t.label + ': slettet']);` and the same line in `$('edDelete')` after `const id = editorTaskId;` (there `t` is already in scope).

Escape: make the keydown chain start with `if(reasonBack.classList.contains('open')) closeReason('ingen', null);\n    else if(dlgBack.classList.contains('open')) dlgClose(false);`.

- [ ] **Step 7: Run both smokes**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: `S1 ok: … S2 ok: … S3 ok: … OK`.
Run: `node <scratchpad>/ui-smoke.mjs` → Expected: `OK` (file:// mode: `askReason` returns early, nothing else changed for it).
Run: `npx tsx <scratchpad>/hosted-smoke.mjs` → Expected: `OK (PUTs: …)` (the old scenarios still pass; its mock ignores `note`).

- [ ] **Step 8: Commit**

```bash
git add src/app/timeline/timeline.html
git commit -m "timeline page: reason dialog on significant moves, causes for dependency pushes, note on every save"
```

---

### Task 7: Page: priority is data: drag rows, priority field, epic select

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Test: `<scratchpad>/hosted-history-smoke.mjs` (S5, S6, S6b)

**Interfaces:**
- Consumes: `lane.priority`, `task.order`, sorted `normalizePlan` (Task 1); `askReason`, `ASK_REASON_FOR` (Task 6).
- Produces: `moveLane(key, toIndex)`, `moveTask(id, laneKey, toIndex)`, `renumberLane(laneKey)`, `laneTasks(key)` sorted by `order`; DOM `.lane-label .grip`, `.task-label .grip`, `#epPriority`, `#edLane`.

- [ ] **Step 1: Add the failing scenarios** (replace the line `// __LATER_SCENARIOS__ (Tasks 7 and 8 insert S5–S8 here)` with the block below, keeping a new marker line `// __LATER_SCENARIOS__` at its end)

```js
// S5: priority through the epic editor: Telenor 3 → 1 → dialog → «prioritering» → lanes reordered, exactly one epic.prioritet
await page.click('.lane-label[data-key="telenor"] .ln'); await page.waitForSelector("#epicBack.open");
assert((await page.inputValue("#epPriority")) === "3", "telenor is 3rd before the move");
await page.fill("#epPriority", "1"); await page.click("#epSave");
await page.waitForSelector("#reasonBack.open");
assert(/prioritet 3 → 1/.test(await page.$eval("#reasonList", (e) => e.textContent)), "dialog names the priority change");
await page.click('#reasonCodes button[data-code="prioritering"]'); await page.click("#reasonSave"); await reasonClosed(); await savedNote();
assert((await page.$eval(".lane-label", (e) => e.dataset.key)) === "telenor", "telenor is first after the move");
ev = await evs();
const pri = ev.events.filter((e) => e.code === "epic.prioritet");
assert(pri.length === 1 && pri[0].summary === "Prioritet: 3 → 1 (foran «En ny organisasjon er i gang fra dag én»)", "one epic.prioritet: " + JSON.stringify(pri.map((e) => e.summary)));
assert(ev.stored.data.lanes[0].key === "telenor" && ev.stored.data.lanes[0].priority === 1, "server lanes carry the priority");
console.log("S5 ok:", pri[0].summary);

// S6: «Varsler» moved to epic «org» with the editor's epic select → dialog → skip → feature.epic, appended last
await page.click('.task-label[data-id="varsler"] .t'); await page.waitForSelector("#editorBack.open");
await page.selectOption("#edLane", "org"); await page.click("#edSave");
await page.waitForSelector("#reasonBack.open"); await page.click("#reasonSkip"); await reasonClosed(); await savedNote();
ev = await evs();
const movedTo = ev.events.find((e) => e.code === "feature.epic");
assert(movedTo && movedTo.summary === "Flyttet fra «Samtaler du kan stole på» til «En ny organisasjon er i gang fra dag én»", "feature.epic: " + (movedTo && movedTo.summary));
assert(!ev.events.some((e) => e.code === "feature.prioritet"), "no feature.prioritet for a lane change");
assert(ev.stored.data.tasks.find((t) => t.id === "varsler").order === 4, "varsler is 4th in org");
console.log("S6 ok:", movedTo.summary);

// S6b: drag Rollebasert tilgang's grip above IAM → feature.prioritet, no dialog
await page.hover('.task-label[data-id="roller"]');
await (await page.$('.task-label[data-id="roller"] .grip')).dragTo(await page.$('.task-label[data-id="iam"]'), { targetPosition: { x: 60, y: 6 } });
await savedNote();
ev = await evs();
const fp = ev.events.find((e) => e.code === "feature.prioritet");
assert(fp && fp.targetId === "roller" && fp.summary === "Prioritet i epicen: 3 → 1", "feature.prioritet by drag: " + (fp && fp.summary));
const rowIds = await page.$$eval(".task-label", (els) => els.map((e) => e.dataset.id));
assert(rowIds.indexOf("roller") < rowIds.indexOf("iam"), "roller drawn above iam");
console.log("S6b ok:", fp.summary);

// __LATER_SCENARIOS__
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs`
Expected: S1–S3 ok, then a timeout/assert in S5 (`#epPriority` does not exist).

- [ ] **Step 3: CSS and markup**

Append to the `<style>` block:

```css
  /* ---------- rekkefølge: dra rader i navnekolonnen ---------- */
  .grip{position:absolute;left:4px;top:50%;transform:translateY(-50%);width:12px;color:var(--text-4);font-size:12px;line-height:1;letter-spacing:-2px;cursor:grab;opacity:0;user-select:none}
  .lane-label:hover .grip,.task-label:hover .grip{opacity:1}
  .lane-label{padding-left:20px}
  .task-label{padding-left:24px}
  .drop-before{box-shadow:inset 0 2px 0 var(--accent)}
  .drop-after{box-shadow:inset 0 -2px 0 var(--accent)}
  .drop-into{box-shadow:inset 0 0 0 2px var(--accent)}
  .dragging-row{opacity:.5}
  .ed-field select{width:100%;font:inherit;font-size:14px;padding:6px 12px;border:1px solid var(--line);border-radius:4px;background:var(--input-bg);color:var(--text)}
```

Feature editor: after the `Navn` field insert `<label class="ed-field"><span>Epic</span><select id="edLane"></select></label>`.
Epic editor: after the `ADO-id (Epic)` field insert `<label class="ed-field"><span>Prioritet (1 = øverst på tidslinjen)</span><input id="epPriority" type="number" min="1" step="1"></label>`.

- [ ] **Step 4: Order as data**

Replace `const laneTasks = key => state.tasks.filter(t => t.lane === key);` with
```js
  const laneTasks = key => state.tasks.filter(t => t.lane === key).sort((a, b) => (a.order || 0) - (b.order || 0));
```

After `pushDeps` add a new section:

```js
  /* ================== rekkefølge: prioritet (epics) og order (features) ================== */
  function moveLane(key, toIndex){           // toIndex: plass i listen uten raden selv (0 = øverst)
    const keys = state.lanes.map(l => l.key).filter(k => k !== key);
    keys.splice(Math.max(0, Math.min(keys.length, toIndex)), 0, key);
    keys.forEach((k, i) => { const l = getLane(k); if(l.priority !== i + 1){ l.priority = i + 1; bumpLane(l); } });
    state.example = false;
    normalizePlan(state);
  }
  function renumberLane(laneKey){
    laneTasks(laneKey).forEach((t, i) => { if(t.order !== i + 1){ t.order = i + 1; touch(t, 'meta'); } });
  }
  function moveTask(id, laneKey, toIndex){   // toIndex: plass i målepicen uten featuren selv
    const t = getTask(id);
    if(!t || !getLane(laneKey)) return;
    const fromLane = t.lane;
    if(fromLane !== laneKey){ t.lane = laneKey; touch(t, 'meta'); }
    const ids = laneTasks(laneKey).map(v => v.id).filter(v => v !== id);
    ids.splice(Math.max(0, Math.min(ids.length, toIndex)), 0, id);
    ids.forEach((v, i) => { const q = getTask(v); if(q.order !== i + 1){ q.order = i + 1; touch(q, 'meta'); } });
    if(fromLane !== laneKey) renumberLane(fromLane);
    state.example = false;
    normalizePlan(state);
    pushDeps();
  }
```

Replace `addFeature`:
```js
  function addFeature(laneKey, kind){
    const start = snapTo(Math.max(todayUnit(), VIEW_FROM), SNAP);
    const order = Math.max(0, ...laneTasks(laneKey).map(v => v.order || 0)) + 1;
    const t = kind === 'discovery'
      ? {id: uid(), lane: laneKey, label: 'Ny utredning', kind: 'discovery', start, end: start + 2 * WEEK, deps: [], fv: {}, order}
      : {id: uid(), lane: laneKey, label: 'Ny feature', kind: 'estimate', start, endLikely: start + 4 * WEEK, end: start + 6 * WEEK, deps: [], fv: {}, order};
    if(myName){ t.editedBy = myName; t.editedAt = new Date().toISOString(); }
    state.tasks.push(t);
    normalizePlan(state);
    save(); render();
    openEditor(t.id);
  }
```

- [ ] **Step 5: Grips and drop targets in `render()`**

Before `function render(){` add:
```js
  let rowDrag = null;   // { type:'lane', key } | { type:'task', id } mens en rad dras i navnekolonnen
  const dropHalf = (e, elm) => { const r = elm.getBoundingClientRect(); return (e.clientY - r.top) < r.height / 2; };   // true = slipp FØR raden
  function clearDropMarks(){
    labels.querySelectorAll('.drop-before,.drop-after,.drop-into,.dragging-row').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging-row'));
  }
```

In the lane loop, replace `ll.append(ln, lm, add);` with:
```js
      const grip = el('span', 'grip', '⋮⋮');
      grip.title = 'Dra for å endre prioritet';
      grip.draggable = true;
      grip.addEventListener('dragstart', e => { rowDrag = { type: 'lane', key: lane.key }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', lane.key); ll.classList.add('dragging-row'); });
      grip.addEventListener('dragend', () => { rowDrag = null; clearDropMarks(); });
      ll.addEventListener('dragover', e => {
        if(!rowDrag) return;
        e.preventDefault();
        clearDropMarks();
        ll.classList.add(rowDrag.type === 'lane' ? (dropHalf(e, ll) ? 'drop-before' : 'drop-after') : 'drop-into');
      });
      ll.addEventListener('drop', e => {
        if(!rowDrag) return;
        e.preventDefault();
        const d = rowDrag; rowDrag = null; clearDropMarks();
        if(d.type === 'lane'){
          if(d.key === lane.key) return;
          const from = state.lanes.findIndex(v => v.key === d.key) + 1;
          const keys = state.lanes.map(v => v.key).filter(k => k !== d.key);
          const to = keys.indexOf(lane.key) + (dropHalf(e, ll) ? 0 : 1);
          moveLane(d.key, to);
          if(ASK_REASON_FOR.epicReordered && from !== to + 1) askReason([getLane(d.key).name + ': prioritet ' + from + ' → ' + (to + 1)]);
        } else {
          const t = getTask(d.id);
          if(!t) return;
          const fromLane = t.lane;
          moveTask(d.id, lane.key, laneTasks(lane.key).filter(v => v.id !== d.id).length);
          if(fromLane !== lane.key && ASK_REASON_FOR.movedToOtherEpic) askReason([t.label + ': flyttet fra «' + getLane(fromLane).name + '» til «' + lane.name + '»']);
        }
        save(); render();
      });
      ll.append(grip, ln, lm, add);
```

In the task loop, replace `tl.append(tt, dd, acts);` with:
```js
        const tg = el('span', 'grip', '⋮⋮');
        tg.title = 'Dra for å endre rekkefølgen, eller slipp på en annen epic';
        tg.draggable = true;
        tg.addEventListener('dragstart', e => { rowDrag = { type: 'task', id: t.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); tl.classList.add('dragging-row'); });
        tg.addEventListener('dragend', () => { rowDrag = null; clearDropMarks(); });
        tl.addEventListener('dragover', e => {
          if(!rowDrag || rowDrag.type !== 'task') return;
          e.preventDefault();
          clearDropMarks();
          tl.classList.add(dropHalf(e, tl) ? 'drop-before' : 'drop-after');
        });
        tl.addEventListener('drop', e => {
          if(!rowDrag || rowDrag.type !== 'task') return;
          e.preventDefault();
          const d = rowDrag; rowDrag = null; clearDropMarks();
          if(d.id === t.id) return;
          const m = getTask(d.id);
          if(!m) return;
          const fromLane = m.lane;
          const ids = laneTasks(t.lane).map(v => v.id).filter(v => v !== d.id);
          moveTask(d.id, t.lane, ids.indexOf(t.id) + (dropHalf(e, tl) ? 0 : 1));
          if(fromLane !== t.lane && ASK_REASON_FOR.movedToOtherEpic) askReason([m.label + ': flyttet fra «' + getLane(fromLane).name + '» til «' + getLane(t.lane).name + '»']);
          save(); render();
        });
        tl.append(tg, tt, dd, acts);
```
and in the task label's click handler make the first line `if(e.target.closest('.row-actions') || e.target.tagName === 'A' || e.target.classList.contains('grip')) return;`.

- [ ] **Step 6: Editors**

`openEpicEditor`: after `$('epAdo').value = l.adoId || '';` add `$('epPriority').value = state.lanes.findIndex(v => v.key === key) + 1;`.

`$('epSave')`: before the `if(ASK_REASON_FOR.goalChanged …` block insert:
```js
    const pri = parseInt($('epPriority').value, 10);
    const cur = state.lanes.findIndex(v => v.key === epicKey) + 1;
    if(isFinite(pri) && pri >= 1 && pri !== cur){
      const target = Math.min(state.lanes.length, pri);
      moveLane(epicKey, target - 1);
      if(ASK_REASON_FOR.epicReordered) lines.push(l.name + ': prioritet ' + cur + ' → ' + target);
      changed = true;
    }
```

`openEditor`: after `$('edName').value = t.label;` add
```js
    $('edLane').innerHTML = state.lanes.map(l => '<option value="' + esc(l.key) + '"' + (l.key === t.lane ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
```

`$('edSave')`: before `normalizePlan(state);` (the first of the two tail lines) insert
```js
    const newLane = $('edLane').value;
    if(newLane && newLane !== t.lane && getLane(newLane)) moveTask(t.id, newLane, laneTasks(newLane).length);
```

- [ ] **Step 7: Run the smokes**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: `S1 ok … S6b ok … OK`.
If S6b's `dragTo` does not trigger the HTML5 drop in headless Chromium, replace the drag with a synthetic sequence and keep the assertion: `await page.evaluate(() => { const dt = new DataTransfer(); const g = document.querySelector('.task-label[data-id="roller"] .grip'); const t = document.querySelector('.task-label[data-id="iam"]'); g.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const r = t.getBoundingClientRect(); t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 4 })); t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 4 })); g.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); });` and record the Ruling.
Run: `node <scratchpad>/ui-smoke.mjs` → Expected: `OK`.
Run: `npx vitest run` → Expected: all green (unchanged modules).

- [ ] **Step 8: Commit**

```bash
git add src/app/timeline/timeline.html
git commit -m "timeline page: priority on epics and order on features; drag rows, priority field, epic select"
```

---

### Task 8: Page: the Historikk drawer, the missing-reason badge, late reasons

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Test: `<scratchpad>/hosted-history-smoke.mjs` (S4, S8)

**Interfaces:**
- Consumes: `GET /api/timeline-changes` (`{ events, missing14d }`), `PATCH` (Task 5); `askReason(lines, late)` / `submitLateReason` stub (Task 6).
- Produces: `openHistory({ lane?, target? })`, `loadHistory()`, `appendEvent(e)`, `setBadge(n)`, `refreshHistoryBadge()`, `submitLateReason(changesetId, code, text)`; DOM `#histBtn`, `#histBadge`, `#histDrawer`, `#histLane`, `#histList` (`.hist-cs` per changeset, `.hist-ev` per event, `.add-reason` buttons), `#histMore`, `#histClose`, `#epHistory`, `#edHistory`.

- [ ] **Step 1: Add the failing scenarios** (replace `// __LATER_SCENARIOS__` with the block; keep the marker at its end)

```js
// S4: badge counts the skipped reasons (S3, S6); the drawer shows causes, missing and given reasons; a late reason via PATCH clears one
await page.waitForFunction(() => document.getElementById("histBadge").textContent === "2");
await page.click("#histBtn"); await page.waitForSelector("#histDrawer:not([hidden])");
await page.waitForFunction(() => document.querySelectorAll("#histList .hist-ev").length > 5);
let txt = await page.$eval("#histList", (e) => e.textContent);
assert(/av avhengighet «IAM: brukerlivsløp»/.test(txt), "drawer shows the dependency cause");
assert(/Begrunnelse mangler/.test(txt) && /Utredningen viste mer/.test(txt) && /Flere lagringsnoder/.test(txt), "drawer shows missing and given reasons with text");
assert((await page.$$("#histList .hist-cs")).length >= 5, "events are grouped per changeset");
await page.screenshot({ path: DIR + "/07-history-drawer.png", fullPage: false });
await page.click("#histList .add-reason");                 // newest changeset without a reason = S6
await page.waitForSelector("#reasonBack.open");
assert(await page.$eval("#reasonSkip", (e) => e.hidden), "no skip button when adding a reason afterwards");
await page.click('#reasonCodes button[data-code="prioritering"]'); await page.click("#reasonSave"); await reasonClosed();
await page.waitForFunction(() => document.getElementById("histBadge").textContent === "1");
await page.waitForFunction(() => /Begrunnelse lagt til: Prioritert om i produktforum/.test(document.getElementById("histList").textContent));
ev = await evs();
assert(ev.changesets.filter((c) => c.reasonCode === "ingen").length === 1, "one changeset still without a reason");
console.log("S4 ok: badge 2 → 1, late reason patched");

// S8: per-epic history from the epic editor shows only that epic, with the lane filter preselected
await page.click("#histClose"); await page.waitForSelector("#histDrawer", { state: "hidden" });
await page.click('.lane-label[data-key="telenor"] .ln'); await page.waitForSelector("#epicBack.open");
await page.click("#epHistory"); await page.waitForSelector("#histDrawer:not([hidden])");
await page.waitForFunction(() => document.querySelectorAll("#histList .hist-ev").length > 0);
txt = await page.$eval("#histList", (e) => e.textContent);
assert(/Spenn: 4–7 → 4–9 uker/.test(txt) && /Prioritet: 3 → 1/.test(txt) && !/IAM/.test(txt), "telenor's history only, got: " + txt.slice(0, 300));
assert((await page.$eval("#histLane", (e) => e.value)) === "telenor", "lane filter preselected");
await page.click("#histClose");
console.log("S8 ok");

// __LATER_SCENARIOS__
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs`
Expected: S1–S6b ok, then S4 times out on `#histBadge`.

- [ ] **Step 3: CSS and markup**

Append to `<style>`:
```css
  /* ---------- historikk ---------- */
  .drawer{position:fixed;top:0;right:0;bottom:0;width:min(520px,100%);background:var(--surface);border-left:1px solid var(--line);box-shadow:var(--shadow);z-index:55;display:flex;flex-direction:column}
  .drawer[hidden]{display:none}
  .drawer-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line-soft)}
  .drawer-head h2{font-size:16px;font-weight:600;flex:1;color:var(--text)}
  .drawer-head select{font:inherit;font-size:12px;padding:4px 8px;border:1px solid var(--line);border-radius:4px;background:var(--input-bg);color:var(--text);max-width:220px}
  .drawer-body{overflow:auto;padding:4px 16px 16px;flex:1}
  .hist-cs{margin-top:14px;padding-top:10px;border-top:1px solid var(--line-soft);display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-3)}
  .hist-cs:first-child{border-top:none;margin-top:4px}
  .hist-cs .when{font-weight:600;color:var(--text)}
  .hist-cs .reason{background:var(--ok-bg);color:var(--ok-fg);white-space:normal}
  .hist-cs .reason.missing{background:var(--warn-bg);color:var(--warn-fg)}
  .hist-ev{display:grid;gap:2px;padding:5px 0 5px 10px;border-left:2px solid var(--line-soft);margin-top:6px;font-size:13px}
  .hist-ev .where{font-size:11px;color:var(--text-3)}
  .hist-ev .sum{color:var(--text)}
  .hist-ev .chip.cause{background:var(--warn-bg);color:var(--warn-fg);margin-left:6px}
  .hist-empty{padding:24px 0;color:var(--text-4);font-size:13px;text-align:center}
  .drawer-foot{padding:10px 16px;border-top:1px solid var(--line-soft);display:flex;justify-content:center}
  #histBtn{position:relative}
  .count{position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:10px;font-weight:700;line-height:18px;text-align:center}
  .count[hidden]{display:none}
```

Top bar: before `<button id="helpBtn">Hjelp</button>` insert `<button id="histBtn" title="Hva har flyttet seg, og hvorfor">Historikk<span class="count" id="histBadge" hidden></span></button>`.

After `<div class="drag-tip" id="dragTip"></div>` insert:
```html
<aside class="drawer" id="histDrawer" hidden>
  <div class="drawer-head">
    <h2>Historikk</h2>
    <select id="histLane" title="Vis én epic"><option value="">Alle epics</option></select>
    <button class="x" id="histClose" title="Lukk">✕</button>
  </div>
  <div class="drawer-body" id="histList"></div>
  <div class="drawer-foot"><button id="histMore">Last flere</button></div>
</aside>
```

Feature editor foot: replace `<button class="danger-ghost" id="edDelete">Slett feature …</button>` with `<span class="btns"><button class="danger-ghost" id="edDelete">Slett feature …</button><button class="text" id="edHistory">Historikk</button></span>`. Epic editor foot: same pattern with `epDelete` / `<button class="text" id="epHistory">Historikk</button>`.

- [ ] **Step 4: JS: the history section** (new section after the «begrunnelse» section; replace the `submitLateReason` stub there with the real one below)

```js
  /* ================== historikk ================== */
  const histDrawer = $('histDrawer'), histList = $('histList'), histLane = $('histLane'), histBadge = $('histBadge');
  let hist = { lane: '', target: '', before: null, done: false, lastCs: null };
  $('histBtn').hidden = !HOSTED; $('edHistory').hidden = !HOSTED; $('epHistory').hidden = !HOSTED;
  const fmtWhen = iso => new Date(iso).toLocaleString('nb-NO', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
  function setBadge(n){ histBadge.hidden = !n; histBadge.textContent = n ? String(n) : ''; }
  async function refreshHistoryBadge(){
    if(!HOSTED) return;
    try{
      const r = await fetch('api/timeline-changes?limit=1', {cache:'no-store'});
      if(r.ok) setBadge((await r.json()).missing14d);
    }catch(e){}
  }
  function openHistory(opts){
    opts = opts || {};
    hist = { lane: opts.lane || '', target: opts.target || '', before: null, done: false, lastCs: null };
    histLane.innerHTML = '<option value="">Alle epics</option>' + state.lanes.map(l =>
      '<option value="' + esc(l.key) + '"' + (l.key === hist.lane ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
    histLane.disabled = !!hist.target;
    histList.innerHTML = '';
    histDrawer.hidden = false;
    loadHistory();
  }
  async function loadHistory(){
    if(hist.done) return;
    const q = new URLSearchParams({ limit: '60' });
    if(hist.lane) q.set('lane', hist.lane);
    if(hist.target) q.set('target', hist.target);
    if(hist.before) q.set('before', hist.before);
    try{
      const r = await fetch('api/timeline-changes?' + q, {cache:'no-store'});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      setBadge(j.missing14d);
      if(!j.events.length && !histList.children.length) histList.innerHTML = '<div class="hist-empty">Ingen endringer ennå.</div>';
      j.events.forEach(appendEvent);
      if(j.events.length < 60) hist.done = true; else hist.before = j.events[j.events.length - 1].at;
      $('histMore').hidden = hist.done;
    }catch(e){ histList.innerHTML = '<div class="hist-empty">Kunne ikke hente historikken.</div>'; }
  }
  function appendEvent(e){
    const cs = e.changeset || {};
    if(cs.id !== hist.lastCs){
      hist.lastCs = cs.id;
      const head = el('div', 'hist-cs');
      const reason = cs.reasonCode && cs.reasonCode !== 'ingen'
        ? '<span class="chip reason">' + esc(REASON_LABEL[cs.reasonCode] || cs.reasonCode) + (cs.reason ? ' – ' + esc(cs.reason) : '') + '</span>'
        : cs.reasonCode === 'ingen'
          ? '<span class="chip reason missing">Begrunnelse mangler</span>' + (canWrite ? '<button class="text add-reason" data-cs="' + esc(cs.id) + '" data-when="' + esc(fmtWhen(cs.at || e.at)) + '">Legg til</button>' : '')
          : '';
      head.innerHTML = '<span class="when">' + esc(fmtWhen(cs.at || e.at)) + '</span><span>' + esc(cs.editor || 'system') + '</span>' + reason;
      histList.appendChild(head);
    }
    const lane = e.laneKey ? getLane(e.laneKey) : null;
    const where = e.targetType === 'feature' ? (lane ? lane.name + ' › ' : '') + e.targetLabel : e.targetLabel;
    const cause = e.cause === 'avhengighet'
      ? '<span class="chip cause">avhengighet' + (e.causeRef ? ': ' + esc((getTask(e.causeRef) || {label: e.causeRef}).label) : '') + '</span>' : '';
    const row = el('div', 'hist-ev');
    row.innerHTML = '<span class="where">' + esc(where) + '</span><span class="sum">' + esc(e.summary) + cause + '</span>';
    histList.appendChild(row);
  }
  async function submitLateReason(changesetId, code, text){
    try{
      const r = await fetch('api/timeline-changes', { method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ changesetId, reasonCode: code, reason: text || '' }) });
      if(!r.ok) throw new Error('HTTP ' + r.status);
    }catch(e){ askDialog('Kunne ikke lagre begrunnelsen', 'Prøv igjen om litt.', {confirmText:'OK', noCancel:true}); }
    openHistory({ lane: hist.lane, target: hist.target });   // last listen på nytt: chippen og tellingen oppdateres
  }
  histList.addEventListener('click', e => {
    const b = e.target.closest('button.add-reason');
    if(!b) return;
    askReason(['Begrunnelse for endringen ' + b.dataset.when], { changesetId: b.dataset.cs });
  });
  histLane.addEventListener('change', () => openHistory({ lane: histLane.value }));
  $('histMore').addEventListener('click', loadHistory);
  $('histClose').addEventListener('click', () => { histDrawer.hidden = true; });
  $('histBtn').addEventListener('click', () => histDrawer.hidden ? openHistory() : (histDrawer.hidden = true));
  $('epHistory').addEventListener('click', () => { const k = epicKey; closeEpicEditor(); openHistory({ lane: k }); });
  $('edHistory').addEventListener('click', () => { const id = editorTaskId; closeEditor(); openHistory({ target: id }); });
```

Wiring: in `pushPlan` after `const j = await r.json();` add `refreshHistoryBadge();`; in `initServerPlan` after `whoami.textContent = myName || '';` add `refreshHistoryBadge();`. Escape chain: after the reason-dialog branch add `else if(!histDrawer.hidden) histDrawer.hidden = true;` placed before the `linkSource` branch.

- [ ] **Step 5: Run the smokes**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: `… S4 ok: badge 2 → 1, late reason patched … S8 ok … OK` and `ui/07-history-drawer.png` written. Open the screenshot and check: the drawer on the right, grouped entries with a time, editor, green reason chips or amber «Begrunnelse mangler» with «Legg til», event lines «Telenor kan bygge på oss › Kapasitet i store grupper / Spenn: 4–7 → 4–9 uker (utvidet 2 uker)», an amber «avhengighet: IAM: brukerlivsløp» chip.
Run: `node <scratchpad>/ui-smoke.mjs` → Expected: `OK` (buttons hidden in file:// mode).

- [ ] **Step 6: Commit**

```bash
git add src/app/timeline/timeline.html
git commit -m "timeline page: history drawer per plan, epic and feature; missing-reason badge; reasons added afterwards"
```

---

### Task 9: Page: måltall, ekstern dato, delivery windows, overdue discoveries, «Tidslinjen», help

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Modify: `src/app/page.tsx` (link text)
- Test: `<scratchpad>/ui-smoke.mjs` (file:// mode; append the block below before `await browser.close()`)

**Interfaces:**
- Consumes: `windowLabel`, `epicWindowText`, `discoveryOverdue`, `lane.metric`, `lane.externalDate` (Task 1).
- Produces: DOM `#epMetric`, `#epExternal`, `.lane-label.ext`, `.lane-label .metric`, `.chip.ext-chip`, overdue chips; copy «Tidslinjen».

- [ ] **Step 1: Add the failing checks to `ui-smoke.mjs`** (before `await browser.close();`)

```js
// R1a display: week windows on estimates and epics, måltall + ekstern dato, overdue discovery, wording
assert(/uker → uke \d+/.test(await page.$eval(".range-lbl.weeks", (e) => e.textContent)), "estimate label carries the week window");
assert(/^Leveres uke \d+(–\d+)? · /.test(await page.$eval('.lane-label[data-key="telenor"] .goal', (e) => e.textContent)), "telenor shows its delivery window before the goal text");
await page.click('.lane-label[data-key="telenor"] .ln'); await page.waitForSelector("#epicBack.open");
await page.fill("#epMetric", "Telenor pilot i drift"); await page.check("#epExternal"); await page.click("#epSave"); await closed("epicBack");
assert(await page.$eval('.lane-label[data-key="telenor"]', (e) => e.classList.contains("ext") && e.textContent.includes("Ekstern dato") && e.textContent.includes("Telenor pilot i drift")), "måltall and ekstern dato rendered");
if (new Date() > new Date(2026, 9, 9)) {   // the axis starts 1 Oct and a discovery lasts a week: the earliest end date is 8–9 Oct
  await page.click('.task-label[data-id="iam"] .t'); await page.waitForSelector("#editorBack.open");
  await page.fill("#edStart", "2026-10-01"); await page.fill("#edEnd", "2026-10-01"); await page.click("#edSave"); await closed("editorBack");
  assert(await page.$eval('.task-label[data-id="iam"]', (e) => e.textContent.includes("Utredning forsinket")), "overdue chip on the discovery row");
  assert(await page.$eval('.lane-label[data-key="org"]', (e) => /1 utredning forsinket/.test(e.textContent)), "epic counts its overdue discoveries");
} else console.log("overdue chip: skipped, today is before 9 Oct 2026 (covered by vitest)");
assert((await page.title()) === "SkyTracker – Tidslinjen", "page title");
assert((await page.$eval("h1", (e) => e.textContent)).startsWith("Tidslinjen"), "heading");
console.log("display ok");
```

- [ ] **Step 2: Run it**

Run: `node <scratchpad>/ui-smoke.mjs` → Expected: `ASSERT: estimate label carries the week window`.

- [ ] **Step 3: Wording and help**

- `<title>SkyTracker – Veikart</title>` → `<title>SkyTracker – Tidslinjen</title>`; `<h1>Veikart <span class="sub">– epics</span></h1>` → `<h1>Tidslinjen <span class="sub">– epics</span></h1>`; footer `Skytale AS · Veikart for utviklingsavdelingen` → `Skytale AS · Tidslinjen for utviklingsavdelingen`; help `<h3>Slik bruker du veikartet</h3>` → `<h3>Slik bruker du tidslinjen</h3>`; export file name `'skytale-veikart-'` → `'skytale-tidslinjen-'`.
- `src/app/page.tsx`: the link text `Tidslinje` → `Tidslinjen`.
- Help: replace the «Epic og måldato» card with
```html
      <div class="help-card"><h4>Epic, måltall og måldato</h4>
        <p>Hver uthevet rad er en <b>epic</b>: et resultat ledelsen vil ha, eid av PM + CTO. Klikk navnet for å sette navn,
        <b>måltall</b>, måldato (eller foreløpig mål), <b>ekstern dato</b> og prioritet. <b>＋ Epic</b> øverst lager en ny. Måldatoen tegnes som en
        loddrett strek i raden; «Leveres uke 49–51» er vinduet spennene gir.</p></div>
```
  and append two cards to the grid:
```html
      <div class="help-card"><h4>Historikk og begrunnelser</h4>
        <p>Hver lagring logges: hvem, når, hva. Flytter du en måldato, utvider et spenn, flytter en feature senere eller endrer
        prioritet, spør siden <b>hvorfor</b>. Svaret følger endringen i <b>Historikk</b>. Du kan lagre uten begrunnelse; de mangler da i
        tellingen på knappen til du fyller dem inn.</p></div>
      <div class="help-card"><h4>Prioritet</h4>
        <p>Rekkefølgen på epicene er prioriteten produktforum har satt; rekkefølgen i en epic er byggerekkefølgen. Dra i <b>⋮⋮</b>
        for å flytte en rad, eller sett tallet i redigeringen. Dra en feature til en annen epic for å flytte den dit. En utredning
        som har passert sluttdatoen sin merkes <b>Utredning forsinket</b>.</p></div>
```

- [ ] **Step 4: Epic editor fields and save**

Markup: after the `Måldato` row in the epic editor insert
```html
        <label class="ed-field"><span>Måltall (hva som er sant når epicen er levert)</span><input id="epMetric" type="text" placeholder="f.eks. 3 kunder i drift på 2.0"></label>
        <label class="ed-check"><input type="checkbox" id="epExternal"> Ekstern dato (NSR, Telenor, revisjon) – datoen er satt utenfra</label>
```
`openEpicEditor`: add `$('epMetric').value = l.metric || ''; $('epExternal').checked = !!l.externalDate;`.
`$('epSave')`: after the `newAdo` block insert
```js
    const metric = $('epMetric').value.trim();
    if((l.metric || '') !== metric){ if(metric) l.metric = metric; else delete l.metric; changed = true; }
    const ext = $('epExternal').checked;
    if(ext !== !!l.externalDate){ if(ext) l.externalDate = true; else delete l.externalDate; changed = true; }
```

- [ ] **Step 5: Rendering**

CSS, append:
```css
  .lane-label.ext{background:var(--line-soft)}
  .chip.ext-chip{background:var(--text);color:var(--surface)}
  .lane-label .metric{color:var(--text-3);overflow:hidden;text-overflow:ellipsis;min-width:0}
```
In `render()`: `const ll = el('div', 'lane-label');` → `const ll = el('div', 'lane-label' + (lane.externalDate ? ' ext' : ''));` and replace the `lm.innerHTML = …` statement with
```js
      const overdue = laneTasks(lane.key).filter(t => discoveryOverdue(t, todayUnit())).length;
      const win = epicWindowText(state, lane.key);
      lm.innerHTML = '<span class="chip st-' + st.code + '">' + esc(STATUS_LABEL[st.code]) + '</span>' +
        (lane.externalDate ? '<span class="chip ext-chip" title="Datoen er satt utenfra">Ekstern dato</span>' : '') +
        (overdue ? '<span class="chip st-gul">' + overdue + ' utredning' + (overdue > 1 ? 'er' : '') + ' forsinket</span>' : '') +
        '<span class="goal">' + esc((win ? win + ' · ' : '') + goalText(lane)) + '</span>' +
        (lane.metric ? '<span class="metric" title="Måltall">' + esc(lane.metric) + '</span>' : '');
```
In `position(t)`: `rl.textContent = t.kind === 'estimate' ? rangeLabel(t) : 'til ' + fmtDate(unitToDate(t.end));` → `rl.textContent = t.kind === 'estimate' ? rangeLabel(t) + ' → ' + windowLabel(t) : 'til ' + fmtDate(unitToDate(t.end));` and before `if(t.editedBy){` add `if(discoveryOverdue(t, todayUnit())) chips.push('<span class="chip st-gul" title="Sluttdatoen er passert: sett en ny før den passerer">Utredning forsinket</span>');`.

- [ ] **Step 6: Run everything for the page**

Run: `node <scratchpad>/ui-smoke.mjs` → Expected: `display ok` and `OK`.
Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: `OK`.
Run: `node <scratchpad>/theme-shots.mjs` → Expected: light and dark screenshots regenerate; open `ui/t-dark-01-*.png` and check the `ext` lane header is readable in dark mode and the badge is visible.
Run: `npx tsc --noEmit` → clean (page.tsx).

- [ ] **Step 7: Commit**

```bash
git add src/app/timeline/timeline.html src/app/page.tsx
git commit -m "timeline page: måltall, ekstern dato, delivery window in weeks, overdue discoveries; named Tidslinjen"
```

---

### Task 10: Whole-branch verification, review, PR text

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-planning-system-design.md` (§3/§4 touch-ups listed below)
- Create: `~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body-planning-system.md` (outside the repo; this task writes its stage-1 section, later stages append theirs)

- [ ] **Step 1: Full suite**

```bash
npx vitest run && npx tsc --noEmit && npx next build
node <scratchpad>/ui-smoke.mjs && npx tsx <scratchpad>/hosted-smoke.mjs && npx tsx <scratchpad>/hosted-history-smoke.mjs
```
Expected: vitest green (epic-tools, merge, events, history, schedule, ado), tsc clean, build OK, three smokes `OK`.

- [ ] **Step 2: Spec touch-ups** (so the spec matches what was built)

In §3 «History tables»: `targetType: "epic" | "feature" | "plan"`, columns `before`/`after` (not `from`/`to`), `TimelineSnapshot.day`. In §4.1 add rows for `epic.ado`, `feature.utredning`, `plan.begrunnelse`. In §4.2 delete the sentence about `cause: flette` and say `Cause = bruker | avhengighet | ado | system`. In §4.6 add that `GET` returns `missing14d`. Commit: `git commit -am "spec: history as built in R1a"`.

- [ ] **Step 3: Review the branch** (inline, `/review-branch`, base `origin/main`)

Run `/review-branch` from the worktree. Fix Critical and Important findings with a failing test first; minors go to the ledger. Re-run Step 1 after fixes.

- [ ] **Step 4: PR text, stage-1 section** (`~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body-planning-system.md`; the PR itself is created after stage 7)

```markdown
## Stage 1 · History with reasons, priority as data, delivery windows

Every save on `/timeline` now writes a **changeset** (who, when, why) and one **event** per change a person would name:
«Måldato: 15. des → 15. jan», «Spenn: 4–7 → 6–9 uker (utvidet 2 uker)», «Flyttet fra «Samtaler» til «Telenor»»,
«Prioritet: 3 → 1». Epics are logged too. A feature pushed by a dependency is attributed to the blocker («Flyttet 2 uker
av avhengighet «IAM»») instead of looking like a drag.

### What changed
- **Server**: `events.ts` (semantic diff + Norwegian summaries + `needsReason`) replaces `plan-delta.ts`; `history.ts`
  writes the daily pre-change snapshot, the changeset and its events (best effort, never fails a save). `PUT /api/timeline-plan`
  takes `note { reason, reasonCode, causes, source }` and answers `changesetId`. `GET /api/timeline-changes` serves events
  with their changeset (filters: lane, target, before) and `missing14d`; `PATCH` adds a reason afterwards.
- **Prisma**: `TimelineChangeset`, `TimelineEvent`, `TimelineSnapshot` (migration `20261008120000_add_timeline_history`,
  additive). `TimelineChange` stays unused.
- **Page**: reason dialog after a significant edit (goal date changed, span widened, start a week or more later, discovery
  end later, moved to another epic, epic reordered, estimate deleted) with eight preset reasons and free text; «Lagre uten
  begrunnelse» is allowed and counted on the Historikk button. Historikk drawer (all / per epic / per feature) with «Legg
  til» for missing reasons. Priority: `priority` on epics and `order` on features (data, so it survives the merge); drag
  rows by ⋮⋮, a priority field in the epic editor, an epic select in the feature editor. Epics get måltall and ekstern
  dato; labels show the delivery window in ISO weeks («4–7 uker → uke 49–51», «Leveres uke 49–51 · Måldato 15. des»);
  a discovery past its end date is marked «Utredning forsinket». The page is called Tidslinjen.

### Verification
`npx vitest run`, `npx tsc --noEmit`, `npx next build`; the migration applied and diffed clean against a local
`prisma dev` database; Playwright: file:// smoke, the hosted mock smoke from PR #11, and a new hosted history smoke that
runs the real `mergePlans` + `diffPlans` behind a mock API (seed → one event; widen → dialog → reason stored; move →
dependency push attributed; skip → counted; priority 3 → 1; feature moved between epics; drawer, late reason, per-epic view).

Note: the Vercel check on fork PRs always fails with "Authorization required"; the migration runs on merge through
`vercel-build`.
```

- [ ] **Step 5: Stage gate, then stage 2**

No push and no PR here. Write the ledger line `Stage 1: complete (…)`, then write the plan for stage 2 (spec §5 R1b, baselines and compare) with superpowers:writing-plans in this plan's style and execute it the same way. The PR for the whole branch is created after stage 7, as `build-prompt.md` says: GO pushes (`! git -C ~/Skytale/SkyTracker-wt-epics push -u fork feat/planning-system`), then `gh pr create --repo ksols/SkyTracker --head dnumreig:feat/planning-system --title "Tidslinjen: the planning system" --body-file ~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body-planning-system.md`. After the merge the migrations run on Vercel; the first real save writes the first changeset.
