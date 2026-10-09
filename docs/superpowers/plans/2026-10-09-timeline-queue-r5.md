# Tidslinjen stage 6 (R5): queue and capacity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An active feature's start follows its blockers and the same developer's earlier work instead of being dragged; a manual override is allowed and logged; the sprint mix is a stated factor from raw weeks to elapsed time; the shelf preview shows the computed window of the dropped feature and of everything it pushes.

**Architecture:** `resolveQueue(plan)` in `epic-tools.js` generalises `resolveDeps`: features are visited in priority order (epic priority, then order inside the epic); each active estimate's floor is the latest of its blockers' late ends and the late end of the same developer's earlier active features; a feature below its floor is shifted and the cause recorded (`dep:<id>` or `queue:<id>`). A feature the planner dragged below its floor is `pinned` (meta group): it keeps its place and still counts for the ones after it. `capacityFactor(plan)` turns raw weeks into elapsed weeks from the sprint mix (`plan.capacity.mode`: transition 55 % or normal 60 % of a sprint to features) when a range is set from the raw estimate. `previewPlacement` runs the queue on the clone and reports what moved. The page swaps `pushDeps` for `pushQueue`, pins on a drag below the floor, offers «Følger køen» in the editor and the mix in the legend.

**Tech Stack:** as before. No new dependency, no schema change.

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §5 R5, §4.2 causes (the queue's push is `cause: avhengighet` with the earlier feature as `causeRef`), decision 6 (assignee rule; the board bridge stays until GO decides).

## Global Constraints

- The queue only ever moves a feature later, never earlier; it touches active estimates in epics, never discoveries, the shelf, delivered or pinned features.
- A drag that lands below the floor pins the feature (`pinned: true`, logged); a drag at or after the floor does not pin.
- The sprint-mix factor applies when a range is set from raw weeks (the shelf's «Klar for veikart», the estimate pull, the placement preview) and never rewrites ranges already on the chart.
- Norwegian in the UI, English in code; additive data only (`pinned` in `meta`, `plan.capacity`); no schema change; routes untested against Postgres; commits per task, no attribution.

## Review Focus

1. Two features of one developer in two epics, the lower-priority one starting first on the chart: expected the higher-priority epic's feature keeps its start and the other waits for it (Task 1 fixture).
2. A blocker in a lower-priority epic: expected the blocked feature still waits for it (dependencies win over order) (Task 1).
3. A pinned feature below its floor: expected it stays, is not re-pushed on the next normalise, and still delays the developer's later features (Task 1).
4. The shelf preview on a developer with queued work: expected the dropped feature's window lands after that work and the list names what it pushes (Task 2).
5. A feature without an assignee: expected only its blockers constrain it (Task 1).

---

### Task 1: `resolveQueue`, `pinned`, the capacity factor and their events

**Files:**
- Modify: `src/features/timeline/epic-tools.js` (+ `.d.ts`, `.test.ts`): `resolveQueue`, `queueFloor`, `capacityFactor`, `MIX`, `pinned` and `capacity` in `normalizePlan`
- Modify: `src/features/timeline/merge.ts` (+ test): `pinned` in `meta`, `capacity` on `Plan` (newer `at` wins, like `sprints`)
- Modify: `src/features/timeline/events.ts` (+ test): `queue:` causes («Flyttet 2 uker: i kø bak «Kapasitet» (THM)»), codes `feature.ko` («Overstyrer køen» / «Følger køen igjen»), `plan.kapasitet` («Sprintmiks: overgang (55 % til features) → normal (60 %)»)

**Interfaces:**
- Produces: `resolveQueue(plan) → { id, by, kind: "dep" | "queue" }[]` (every shifted feature with what it waits for; mutates like `resolveDeps`); `queueFloor(plan, taskId) → { floor: number | null; by: string | null; kind: "dep" | "queue" | null }` (without mutating); `MIX = { transition: 0.55, normal: 0.6 }`, `capacityFactor(plan) → number` (1 / share, 2 decimals); `elapsedWeeks(rawWeeks, factor) → number` (rounded up to whole weeks); `PlanTask.pinned?: boolean`; `Plan.capacity?: { mode: "transition" | "normal"; at: string }`; `resolveDeps` stays (used by tests and the smokes' mock) and now delegates to `resolveQueue` filtered to `kind === "dep"`.

- [ ] **Step 1: Write the failing tests** (epic-tools.test.ts, the spec's fixture: two developers, three features, one blocker)

```ts
describe("resolveQueue: blockers first, then the same developer's earlier work", () => {
  const S = 4;   // all start at the same unit
  const A = (over = {}) => est({ id: "a", lane: "x", label: "A", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 1, ...over });
  const B = (over = {}) => est({ id: "b", lane: "x", label: "B", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 2, ...over });
  const C = (over = {}) => est({ id: "c", lane: "y", label: "C", start: S, endLikely: S + 0.5, end: S + 1, state: "aktiv", assignee: "KSO", deps: ["a"], order: 1, ...over });
  const two = (tasks: PlanTask[]) => normalizePlan({ lanes: [{ key: "x", name: "X", priority: 1 }, { key: "y", name: "Y", priority: 2 }], tasks });
  it("B waits for A (same developer, earlier in the order); C waits for its blocker A; the causes name them", () => {
    const p = two([A(), B(), C()]);
    const moved = resolveQueue(p);
    expect(moved).toEqual([{ id: "b", by: "a", kind: "queue" }, { id: "c", by: "a", kind: "dep" }]);
    expect(p.tasks.find((t) => t.id === "b")!.start).toBeCloseTo(S + 1.5);
    expect(p.tasks.find((t) => t.id === "c")!.start).toBeCloseTo(S + 1.5);
    expect(resolveQueue(p)).toEqual([]);   // a fixed point: nothing moves twice
  });
  it("priority decides who is earlier: the higher-priority epic's feature keeps its start even if it was drawn later", () => {
    const p = two([A({ lane: "y", order: 1, start: S + 2, endLikely: S + 3, end: S + 3.5 }), B({ lane: "x" })]);
    resolveQueue(p);
    expect(p.tasks.find((t) => t.id === "b")!.start).toBeCloseTo(S);            // B is in the priority-1 epic: first in line
    expect(p.tasks.find((t) => t.id === "a")!.start).toBeCloseTo(S + 2);        // A already after B's end (S + 1.5): untouched
    const q = two([A({ lane: "y", order: 1 }), B({ lane: "x" })]);
    resolveQueue(q);
    expect(q.tasks.find((t) => t.id === "a")!.start).toBeCloseTo(S + 1.5);      // A (priority 2) waits for B (priority 1)
  });
  it("a pinned feature stays below its floor and still delays the developer's later features; no assignee → only blockers count", () => {
    const p = two([A(), B({ pinned: true }), est({ id: "d", lane: "x", label: "D", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 3 })]);
    const moved = resolveQueue(p);
    expect(moved.map((m) => [m.id, m.by])).toEqual([["d", "b"]]);
    expect(p.tasks.find((t) => t.id === "b")!.start).toBeCloseTo(S);
    expect(p.tasks.find((t) => t.id === "d")!.start).toBeCloseTo(S + 1.5);
    const free = two([A(), B({ assignee: undefined })]);
    expect(resolveQueue(free)).toEqual([]);
    expect(queueFloor(p, "b")).toEqual({ floor: S + 1.5, by: "a", kind: "queue" });
    expect(queueFloor(p, "a")).toEqual({ floor: null, by: null, kind: null });
  });
  it("discoveries, shelf and delivered features are left alone; resolveDeps still reports only the blockers", () => {
    const p = two([A(), disc({ id: "u", lane: "x", assignee: "THM", start: S, end: S + 0.5, order: 2 }), B({ lane: "_backlog" }), est({ id: "l", lane: "x", label: "L", start: S, endLikely: S + 1, end: S + 1.5, state: "levert", deliveredAt: "2026-11-01", assignee: "THM", order: 3 })]);
    expect(resolveQueue(p)).toEqual([]);
    const q = two([A(), B(), C()]);
    expect(resolveDeps(q)).toEqual([{ id: "c", by: "a" }]);
  });
  it("capacityFactor from the sprint mix and elapsedWeeks", () => {
    expect(capacityFactor({ lanes: [], tasks: [] })).toBe(1.82);
    expect(capacityFactor({ lanes: [], tasks: [], capacity: { mode: "normal", at: "x" } })).toBe(1.67);
    expect(elapsedWeeks(4, 1.82)).toBe(8);
    expect(elapsedWeeks(6, 1.67)).toBe(11);
    const p = normalizePlan({ lanes: [], tasks: [], capacity: { mode: "nope", at: "x" } });
    expect(p.capacity).toBeUndefined();
    expect(normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [est({ pinned: 1 as never })] }).tasks[0].pinned).toBe(true);
  });
});
```
merge.test: `pinned` travels in `meta` (an incoming `meta` bump carries it); `capacity` newer `at` wins. events.test: `queue:a` cause → `feature.flyttet` with `cause: "avhengighet"`, `causeRef: "a"`, summary «Flyttet 2 uker: i kø bak «A» (THM)»; `pinned` false → true gives `feature.ko` «Overstyrer køen»; true → false «Følger køen igjen»; `capacity` mode change gives `plan.kapasitet` «Sprintmiks: overgang (55 % til features) → normal (60 %)».

- [ ] **Step 2: RED** — `npx vitest run src/features/timeline`.
- [ ] **Step 3: Implement**

epic-tools.js (replacing `resolveDeps`'s body, keeping its export):
```js
/* ---------- the queue: blockers first, then the same developer's earlier work (priority order) ---------- */
const MIX = { transition: 0.55, normal: 0.6 };   // share of a sprint that goes to planned features
function capacityFactor(plan) { const mode = plan && plan.capacity && MIX[plan.capacity.mode] ? plan.capacity.mode : "transition"; return Math.round(100 / MIX[mode]) / 100; }
function elapsedWeeks(rawWeeks, factor) { return Math.ceil(rawWeeks * factor - 1e-9); }
function queueOrder(plan) {   // active estimates in epics, in priority order; pinned ones are in the order (they count) but never move
  const idx = new Map(plan.lanes.map((l, i) => [l.key, i]));
  return plan.tasks.filter((t) => t.kind === "estimate" && t.lane !== BACKLOG && idx.has(t.lane) && t.state !== "levert")
    .sort((a, b) => idx.get(a.lane) - idx.get(b.lane) || (a.order || 0) - (b.order || 0));
}
function floorOf(plan, t, earlier) {
  const byId = new Map(plan.tasks.map((v) => [v.id, v]));
  let floor = -Infinity, by = null, kind = null;
  (t.deps || []).forEach((d) => { const p = byId.get(d); if (p && p.end > floor + 1e-9) { floor = p.end; by = d; kind = "dep"; } });
  if (t.assignee) earlier.forEach((e) => { if (e.assignee === t.assignee && e.end > floor + 1e-9) { floor = e.end; by = e.id; kind = "queue"; } });
  return { floor: floor === -Infinity ? null : floor, by, kind };
}
function queueFloor(plan, taskId) {
  const order = queueOrder(plan), i = order.findIndex((t) => t.id === taskId);
  return floorOf(plan, plan.tasks.find((t) => t.id === taskId) || { deps: [] }, i < 0 ? [] : order.slice(0, i));
}
function resolveQueue(plan) {
  const shifted = [];
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    const order = queueOrder(plan);
    order.forEach((t, i) => {
      const f = floorOf(plan, t, order.slice(0, i));
      if (f.floor === null || t.pinned || f.floor <= t.start + 1e-9) return;
      if (shiftTask(t, f.floor - t.start) !== 0) { const prev = shifted.find((s) => s.id === t.id); if (prev) { prev.by = f.by; prev.kind = f.kind; } else shifted.push({ id: t.id, by: f.by, kind: f.kind }); changed = true; }
    });
    // discoveries and shelf features keep today's dependency rule: a blocker's late end
    plan.tasks.filter((t) => !(t.kind === "estimate" && t.lane !== BACKLOG && t.state !== "levert")).forEach((t) => {
      const f = floorOf(plan, t, []);
      if (f.floor !== null && !t.pinned && f.floor > t.start + 1e-9 && shiftTask(t, f.floor - t.start) !== 0) { const prev = shifted.find((s) => s.id === t.id); if (prev) prev.by = f.by; else shifted.push({ id: t.id, by: f.by, kind: "dep" }); changed = true; }
    });
  }
  return shifted;
}
function resolveDeps(plan) { return resolveQueue(plan).filter((s) => s.kind === "dep").map(({ id, by }) => ({ id, by })); }
```
(`resolveDeps`'s old callers in the smokes keep working: a plan without assignees behaves as before.) `normalizePlan`: `t.pinned = !!t.pinned` kept only when true (`if (!t.pinned) delete t.pinned; else t.pinned = true`); `p.capacity` kept when `{ mode in MIX, at: string }`, else deleted. `.d.ts` declarations for `MIX`, `capacityFactor`, `elapsedWeeks`, `queueFloor`, `resolveQueue`.

merge.ts: `GROUP_PROPS.meta` + `"pinned"`; `PlanTask.pinned?: boolean`; `Plan.capacity?: { mode: "transition" | "normal"; at: string }` merged like `sprints` (newer `at`).

events.ts: `EVENT_CODES` + `"feature.ko", "plan.kapasitet"`; in the start block: `cause.startsWith("queue:")` → `cause: "avhengighet"`, `causeRef`, summary `Flyttet ${n(dw)} : i kø bak ${q(label(ref))}` + (assignee ? ` (${t.assignee})` : ""), or «Flyttet: i kø bak …: start A → B» when dw is 0; after the deps block: `if (!!b.pinned !== !!t.pinned) ev.push({ ...base, code: "feature.ko", before: !!b.pinned, after: !!t.pinned, summary: t.pinned ? "Overstyrer køen" : "Følger køen igjen" })`; after the sprint goals: capacity mode change → `plan.kapasitet` (targetId "capacity", targetLabel "Sprintmiks") with summary `Sprintmiks: ${MIX_LABEL[before]} → ${MIX_LABEL[after]}` where `MIX_LABEL = { transition: "overgang (55 % til features)", normal: "normal (60 %)" }`. `needsReason`: `feature.flyttet` with cause avhengighet stays exempt (cause ≠ bruker).

- [ ] **Step 4: GREEN + commit** — `npx vitest run && npx tsc --noEmit`; «timeline: the queue (blockers, then the same developer's earlier work), pinned overrides, the sprint-mix factor».

---

### Task 2: The placement preview with the computed window and what it pushes

**Files:** Modify `src/features/timeline/epic-tools.js` (+ `.d.ts`, `.test.ts`): `previewPlacement`.

**Interfaces:** Produces `previewPlacement(plan, taskId, laneKey) → { before, after, window, featureWindow, pushed: { id, label, laneKey, weeks }[], epics: { key, name, before, after }[] } | null` — on the clone: the feature is placed (lane, `state: aktiv`, range = `elapsedWeeks(raw × factor) + buffer` when it has `raw` and its current range is the raw one, else its current range), `resolveQueue` runs, `featureWindow = windowLabel(feature)`, `pushed` = features whose start moved (weeks rounded, ≥ 1), `epics` = other epics whose colour changed.

- [ ] **Step 1: Failing test**: a shelf feature (`raw { 4, 6 }`, range 4–6, assignee THM) dropped into epic x where THM already has an active feature ending at unit 6: expected `featureWindow` starts after unit 6 (the clone's feature `start` = 6, window from `elapsedWeeks(4 × 1.82) = 8` to `11` weeks), `pushed` lists a later THM feature in epic y with its weeks, `epics` names y with its colour change; `before/after/window` unchanged in meaning from stage 3 (the stage-3 test still passes).
- [ ] **Step 2: RED** — **Step 3: implement** (clone, place, apply the factor when `t.raw` and `rangeWeeks(t)` equal the raw plus buffer, `resolveQueue(copy)`, diff starts against the clone before the queue, colours per lane before/after) — **Step 4: GREEN + commit** «timeline: the shelf preview computes the window and lists what it pushes».

---

### Task 3: The page: the queue in place of the dependency push, pins, the mix, the richer preview; smokes S19–S20

**Files:** Modify `src/app/timeline/timeline.html`; scratchpad `hosted-history-smoke.mjs` (S19–S20).

**Interfaces:** Consumes Task 1–2. Produces: `pushQueue(recordCauses)` (replaces `pushDeps`; causes `dep:`/`queue:`), `endDrag` pins when the dropped start is below `queueFloor` (chip «overstyrt» with the floor in its title), editor checkbox `#edQueue` «Følger køen (flyttes automatisk etter blokkere og eierens tidligere arbeid)», legend select `#mixSelect` («Sprintmiks: overgang 55 %» / «normal 60 %», writers), `#placePreview` text «Telenor blir gul (var grønn) · leveres uke 49–51 · Kontaktkort: uke 46–49 (4–6 uker × 1,82 + 0 buffer) · Flytter: Kapasitet 2 uker, IAM 1 uke» or «Ingenting annet flyttes.»; «Klar for veikart» and the estimate pull set the range with the factor (`elapsedWeeks`), the dialog says so («4–6 uker rått → 8–11 uker på tidslinjen (sprintmiks overgang)»); help card «Kø og kapasitet».

- [ ] **Step 1: Smoke RED**
```js
// S19: the queue: a second feature for THM in the same epic starts after the first; dragging it earlier pins it (chip «overstyrt», event); «Følger køen» in the editor releases it
… create «Kø B» in filer with owner THM, start today, 4–6 weeks (Fremdriftstest from S17 has no owner: give it THM first via the editor) → after save, Kø B's start equals Fremdriftstest's late end (read starts from __events.stored) and the event for Kø B reads «Flyttet … i kø bak «Fremdriftstest» (THM)»; drag Kø B's bar 2 weeks left → chip .chip.pinned on its row, event feature.ko «Overstyrer køen»; open its editor, tick #edQueue, save → the chip is gone and the start is back at the floor.
// S20: the mix and the preview: #mixSelect → normal → event plan.kapasitet; the shelf: register «Kø C», start discovery (THM), ready 4–6 → the ready dialog text mentions the factor; place dialog on filer → #placePreview mentions «Kø C: uke» and «Flytter:» or «Ingenting annet flyttes.»
```
- [ ] **Step 2: Build the page** — `pushQueue` (`resolveQueue(state).forEach(({id, by, kind}) => { touch(t,'tid'); if(recordCauses !== false && by) pendingNote.causes[id] = kind + ':' + by; })`, every `pushDeps(` call site renamed); `endDrag`: for an active estimate in an epic with a floor above the new start → `t.pinned = true; touch(t,'meta')`; chips «overstyrt» (`chip pinned`, title «Står før køen tilsier (…); fjern i redigeringen») and «i kø» hint in the drag tip; editor `#edQueue` (checked = not pinned) saved into `pinned` (meta); `#mixSelect` in the legend (writers; `state.capacity = { mode, at }`, save); `markReady`/`#readySave` and the estimate pull apply `elapsedWeeks(raw, capacityFactor(state))` and show «rått 4–6 → 8–11 uker på tidslinjen (sprintmiks overgang 55 %)»; `previewText` renders the new fields; help card «Kø og kapasitet» (the rule, the override, the mix, «antall aktive epics er fortsatt bare et tall»).
- [ ] **Step 3: Smokes green, commit** — «timeline page: the queue replaces the dependency push, pinned overrides, the sprint mix, the preview with what moves».

---

### Task 4: Stage gate — suite, tsc, build, smokes, inline review + fix pass, PR text «Stage 6» (incl. decision 6: the board bridge stays until GO says), ledger, memory.
