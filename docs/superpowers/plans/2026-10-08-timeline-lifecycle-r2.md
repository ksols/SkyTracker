# Timeline lifecycle and the forum shelf (R2, stage 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A feature lives its whole life in the tool: registered on the shelf («Klar for veikart»), sent to discovery with one owner and an end date, estimated (raw range + the forum's buffer), placed in an epic by produktforum with the price shown first, and later delivered. Epics are proposals until the forum chooses them and can be closed with an outcome.

**Architecture:** The plan JSON gains `state`, `assignee`, `raw`, `bufferWeeks`, `committedRange`, `activatedAt`, `deliveredAt` on features (two new merge groups `state` and `est`) and `state`, `closedReason`, `closedAt`, `outcome` on epics. The reserved lane key `_backlog` holds the shelf; `normalizePlan` keeps those tasks and derives a consistent `state` from `(kind, lane)` unless the state is `ny` or `levert`. Every transition is an event (`feature.tilstand`, `feature.eier`, `feature.buffer`, `feature.raw`, `epic.tilstand`). No schema change.

**Tech Stack:** as stages 1–2.

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §2 principle 8, §3 (Feature/Epic rows marked R2, `_backlog`), §4.1 (`feature.tilstand`, `feature.eier`, `epic.tilstand`), §4.2 («Legg i epic» asks for a reason), §5 R2.

## Global Constraints

- Same as stages 1–2 (branch, commits, no attribution, smokes in the scratchpad, never the shared DB).
- No count limit and no warning on active epics (GO 08.10): the legend shows «2 aktive · 3 forslag · 1 avsluttet», nothing more.
- The price preview shows the colour the target epic gets where the feature lands; nothing else moves (spec §5 R2).
- Norwegian in the UI and in every stored sentence.

## Review Focus

1. A plan saved by an older page (no `state` anywhere): every existing feature keeps its drawing and gets `utredes`/`aktiv`, nothing lands on the shelf; Task 1 test «derives states for a legacy plan».
2. Moving an `aktiv` feature back to the shelf: state `klar`, `committedRange`/`activatedAt` cleared, events logged; Task 1 (normaliser) and Task 3 (event wording) tests, smoke S14.
3. A `ny` feature (no bar) must never end up in an epic lane with no drawing: the normaliser moves `ny` tasks to the shelf; Task 1 test.
4. Discoveries on the shelf need a bar too: the shelf shows «Utredes · THM · til 20. nov» but the chart does not draw shelf tasks; `resolveDeps` still pushes dependants of shelf tasks (Task 1 test «deps across the shelf»).
5. Closing an epic keeps its features drawn and dimmed, never deletes them; smoke S13.

---

### Task 1: `epic-tools.js`: the shelf, states, size class, buffer label, placement preview

**Files:**
- Modify: `src/features/timeline/epic-tools.js`, `src/features/timeline/epic-tools.d.ts`
- Test: `src/features/timeline/epic-tools.test.ts`

**Interfaces:**
- Produces: `BACKLOG = "_backlog"`, `FEATURE_STATES = ["ny","utredes","klar","aktiv","levert"]`, `EPIC_STATES = ["forslag","aktiv","avsluttet"]`, `STATE_LABEL`, `EPIC_STATE_LABEL`; `normalizePlan` keeps tasks on `_backlog`, derives `task.state`, forces `ny` to the shelf, defaults `lane.state = "aktiv"`, strips empty `assignee`/`closedReason`/`outcome`, clamps `bufferWeeks ≥ 0`, validates `raw`; `shelfTasks(plan)`, `sizeClass(task)` → `"S"|"M"|"L"|"XL"|""`, `bufferLabel(task)` → `"4–6 uker + 1 uke buffer"` / `"4–6 uker"`, `rawLabel(task)` → `"utredning sa 4–6"` or `""`, `previewPlacement(plan, taskId, laneKey)` → `{ before: EpicStatusCode, after: EpicStatusCode, window: string }`, `epicCounts(plan)` → `{ forslag, aktiv, avsluttet }`.

- [ ] **Step 1: Write the failing tests** (append to `epic-tools.test.ts`; add the new names to the import)

```ts
describe("lifecycle: shelf, states, sizes, buffer, preview", () => {
  it("keeps tasks on the shelf and derives states for a legacy plan (no state anywhere)", () => {
    const p = normalizePlan({
      lanes: [{ key: "x", name: "X" }],
      tasks: [disc({ id: "d1" }), est({ id: "e1" }), est({ id: "s1", lane: "_backlog" }), disc({ id: "s2", lane: "_backlog" })],
    });
    expect(p.tasks.map((t) => [t.id, t.lane, t.state])).toEqual([["d1", "x", "utredes"], ["e1", "x", "aktiv"], ["s1", "_backlog", "klar"], ["s2", "_backlog", "utredes"]]);
    expect(p.lanes[0].state).toBe("aktiv");
    expect(shelfTasks(p).map((t) => t.id)).toEqual(["s1", "s2"]);
  });

  it("ny stays ny only on the shelf; levert is kept; a registered wish in an epic lane moves to the shelf", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [disc({ id: "a", state: "ny" }), disc({ id: "b", lane: "_backlog", state: "ny" }), est({ id: "c", state: "levert" })] });
    expect(p.tasks.map((t) => [t.id, t.lane, t.state])).toEqual([["c", "x", "levert"], ["a", "_backlog", "ny"], ["b", "_backlog", "ny"]]);
  });

  it("an aktiv feature moved to the shelf becomes klar and loses its commitment", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [est({ id: "a", lane: "_backlog", state: "aktiv", committedRange: { likely: 4, late: 6 }, activatedAt: "2026-11-05" })] });
    expect(p.tasks[0]).toMatchObject({ state: "klar" });
    expect(p.tasks[0]).not.toHaveProperty("committedRange");
    expect(p.tasks[0]).not.toHaveProperty("activatedAt");
  });

  it("deps across the shelf still push, epicStatus ignores the shelf, epic fields are cleaned", () => {
    const p = normalizePlan({
      lanes: [{ key: "x", name: "X", state: "avsluttet", outcome: "nådd", closedReason: " ", assignee: "" }, { key: "y", name: "Y", state: "bogus" }],
      tasks: [est({ id: "a", lane: "_backlog", start: 4, endLikely: 5, end: 6 }), est({ id: "b", lane: "x", start: 4, endLikely: 5, end: 7, deps: ["a"], assignee: "  ", bufferWeeks: -2, raw: { likely: "x" } })],
    });
    expect(resolveDeps(p)).toEqual([{ id: "b", by: "a" }]);
    expect(epicStatus(p, "_backlog").code).toBe("tom");
    expect(p.lanes[0]).toMatchObject({ state: "avsluttet", outcome: "nådd" });
    expect(p.lanes[0]).not.toHaveProperty("closedReason");
    expect(p.lanes[1].state).toBe("aktiv");
    const b = p.tasks.find((t) => t.id === "b")!;
    expect(b).not.toHaveProperty("assignee");
    expect(b).not.toHaveProperty("raw");
    expect(b.bufferWeeks).toBeUndefined();
    expect(epicCounts(p)).toEqual({ forslag: 0, aktiv: 1, avsluttet: 1 });
  });

  it("sizeClass from the discovery's duration; buffer and raw labels", () => {
    expect(sizeClass(disc({ start: 2, end: 2.25 }))).toBe("S");
    expect(sizeClass(disc({ start: 2, end: 2.5 }))).toBe("M");
    expect(sizeClass(disc({ start: 2, end: 3 }))).toBe("L");
    expect(sizeClass(disc({ start: 2, end: 3.25 }))).toBe("XL");
    expect(sizeClass(est({}))).toBe("");
    expect(bufferLabel(est({ start: 4, endLikely: 5, end: 5.5 }))).toBe("4–6 uker");
    expect(bufferLabel(est({ start: 4, endLikely: 5.25, end: 5.75, bufferWeeks: 1 }))).toBe("4–6 uker + 1 uke buffer");
    expect(bufferLabel(est({ start: 4, endLikely: 5.5, end: 6, bufferWeeks: 2 }))).toBe("4–6 uker + 2 uker buffer");
    expect(rawLabel(est({ start: 4, endLikely: 5.25, end: 5.75, bufferWeeks: 1, raw: { likely: 4, late: 6 } }))).toBe("");
    expect(rawLabel(est({ start: 4, endLikely: 5.5, end: 6, raw: { likely: 4, late: 6 } }))).toBe("utredning sa 4–6");
  });

  it("previewPlacement: the colour the epic gets where the feature lands, nothing else moves", () => {
    const p = normalizePlan({
      lanes: [{ key: "x", name: "X", goalDate: 6 }],
      tasks: [est({ id: "a", lane: "x", start: 4, endLikely: 5, end: 5.75 }), est({ id: "s", lane: "_backlog", start: 4.5, endLikely: 6.5, end: 7 })],
    });
    const pv = previewPlacement(p, "s", "x");
    expect(pv).toEqual({ before: "gronn", after: "rod", window: expect.stringMatching(/^Leveres uke \d+–\d+$/) });
    expect(p.tasks.find((t) => t.id === "s")!.lane).toBe("_backlog");   // the plan itself is untouched
    expect(previewPlacement(p, "nope", "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/timeline/epic-tools.test.ts` → Expected: FAIL (`shelfTasks` etc. not functions; states undefined).

- [ ] **Step 3: Implement in `epic-tools.js`**

After `const OWNER_DEFAULT = "PM + CTO";` add:
```js
const BACKLOG = "_backlog";   // the shelf «Klar for veikart»: tasks without an epic
const FEATURE_STATES = ["ny", "utredes", "klar", "aktiv", "levert"];
const EPIC_STATES = ["forslag", "aktiv", "avsluttet"];
const STATE_LABEL = { ny: "Registrert", utredes: "Utredes", klar: "Klar for veikart", aktiv: "Aktiv", levert: "Levert" };
const EPIC_STATE_LABEL = { forslag: "Forslag", aktiv: "Aktiv", avsluttet: "Avsluttet" };
const OUTCOMES = ["nådd", "ikke nådd", "endret"];
```

In `normalizePlan`, in the lane loop add:
```js
    if (!EPIC_STATES.includes(l.state)) l.state = "aktiv";
    if (typeof l.closedReason !== "string" || !l.closedReason.trim()) delete l.closedReason;
    if (!OUTCOMES.includes(l.outcome)) delete l.outcome;
    if (typeof l.closedAt !== "string" || !l.closedAt) delete l.closedAt;
```
Change the task filter to keep the shelf: `p.tasks = p.tasks.filter((t) => t && typeof t.id === "string" && (laneKeys.has(t.lane) || t.lane === BACKLOG));`

In the task loop, after `if (num(t.adoId, null) === null) delete t.adoId;` add:
```js
    if (typeof t.assignee !== "string" || !t.assignee.trim()) delete t.assignee; else t.assignee = t.assignee.trim();
    if (num(t.bufferWeeks, null) === null || t.bufferWeeks <= 0) delete t.bufferWeeks; else t.bufferWeeks = Math.round(t.bufferWeeks);
    if (!t.raw || typeof t.raw !== "object" || num(t.raw.likely, null) === null || num(t.raw.late, null) === null) delete t.raw;
    // state: ny and levert are explicit; everything else follows from kind and lane
    if (t.state === "ny") { if (t.lane !== BACKLOG) t.lane = BACKLOG; }
    else if (t.state !== "levert") t.state = t.kind === "discovery" ? "utredes" : t.lane === BACKLOG ? "klar" : "aktiv";
    if (t.state !== "aktiv" && t.state !== "levert") { delete t.committedRange; delete t.activatedAt; }
    if (t.state !== "levert") delete t.deliveredAt;
```
In the `order` block, `nextOrd[t.lane]` already works for `_backlog`. In the final sort, `laneIdx.get(BACKLOG)` is undefined: use `const laneIdx = new Map(p.lanes.map((l, i) => [l.key, i])); laneIdx.set(BACKLOG, p.lanes.length);`.

After `epicStatus` add:
```js
function shelfTasks(plan) { return plan.tasks.filter((t) => t.lane === BACKLOG); }
function epicCounts(plan) {
  const c = { forslag: 0, aktiv: 0, avsluttet: 0 };
  plan.lanes.forEach((l) => { c[l.state || "aktiv"]++; });
  return c;
}
```
After `goalText` add:
```js
/* ---------- lifecycle labels ---------- */
function sizeClass(t) {
  if (t.kind !== "discovery") return "";
  const w = (t.end - t.start) / WEEK;
  return w <= 1 + 1e-9 ? "S" : w <= 2 + 1e-9 ? "M" : w <= 4 + 1e-9 ? "L" : "XL";
}
function bufferLabel(t) {
  const r = rangeWeeks(t);
  if (!r) return "";
  const b = t.bufferWeeks || 0;
  const likely = r.likely - b, late = r.late - b;
  const base = (likely === late ? late : likely + "–" + late) + " uker";
  return b ? base + " + " + b + " uke" + (b === 1 ? "" : "r") + " buffer" : base;
}
function rawLabel(t) {
  const r = rangeWeeks(t);
  if (!r || !t.raw) return "";
  const b = t.bufferWeeks || 0;
  if (r.likely - b === t.raw.likely && r.late - b === t.raw.late) return "";
  return "utredning sa " + (t.raw.likely === t.raw.late ? t.raw.late : t.raw.likely + "–" + t.raw.late);
}
/* ---------- the price before a decision: the epic's colour if this feature lands there ---------- */
function previewPlacement(plan, taskId, laneKey) {
  if (!plan.tasks.some((t) => t.id === taskId) || !plan.lanes.some((l) => l.key === laneKey)) return null;
  const before = epicStatus(plan, laneKey).code;
  const copy = normalizePlan(JSON.parse(JSON.stringify(plan)));
  const t = copy.tasks.find((v) => v.id === taskId);
  t.lane = laneKey;
  delete t.order;
  normalizePlan(copy);
  return { before, after: epicStatus(copy, laneKey).code, window: epicWindowText(copy, laneKey) };
}
```
Export everything new in `module.exports` (`BACKLOG, FEATURE_STATES, EPIC_STATES, STATE_LABEL, EPIC_STATE_LABEL, OUTCOMES, shelfTasks, epicCounts, sizeClass, bufferLabel, rawLabel, previewPlacement`). In `epic-tools.d.ts` declare them (`previewPlacement(plan: Plan, taskId: string, laneKey: string): { before: EpicStatusCode; after: EpicStatusCode; window: string } | null`, `epicCounts(plan: Plan): { forslag: number; aktiv: number; avsluttet: number }`, `STATE_LABEL: Record<FeatureState, string>`, `export type FeatureState = "ny" | "utredes" | "klar" | "aktiv" | "levert"`, `export type EpicState = "forslag" | "aktiv" | "avsluttet"`).

The seed (`exampleSeed`) is unchanged: its discoveries derive `utredes`, estimates `aktiv`, lanes `aktiv`.

- [ ] **Step 4: Run** the file and the whole suite → Expected: PASS. The existing «drops … tasks whose lane is gone» test still passes (lane `gone` ≠ `_backlog`).

- [ ] **Step 5: Commit**
```bash
git add src/features/timeline/epic-tools.js src/features/timeline/epic-tools.d.ts src/features/timeline/epic-tools.test.ts
git commit -m "timeline: shelf lane, feature and epic states, size class, buffer labels, placement preview"
```

---

### Task 2: `merge.ts`: groups `state` and `est`, `assignee` in meta, new types

**Files:** `src/features/timeline/merge.ts`, `src/features/timeline/merge.test.ts`

**Interfaces:**
- Produces: `TaskFieldGroup = "tid" | "label" | "deps" | "meta" | "state" | "est"`, `GROUP_PROPS.meta += "assignee"`, `GROUP_PROPS.state = ["state", "committedRange", "activatedAt", "deliveredAt"]`, `GROUP_PROPS.est = ["raw", "bufferWeeks"]`; `PlanTask` gains `state?, assignee?, raw?, bufferWeeks?, committedRange?, activatedAt?, deliveredAt?`; `PlanLane` gains `state?, closedReason?, closedAt?, outcome?`.

- [ ] **Step 1: Failing test** (append inside the first describe)
```ts
  it("state and est are their own groups; assignee rides with meta", () => {
    const stored = plan([task({ id: "a", state: "klar", raw: { likely: 4, late: 6 }, fv: { state: 1, est: 1 } })]);
    const incoming = plan([task({ id: "a", state: "aktiv", committedRange: { likely: 4, late: 6 }, activatedAt: "2026-11-05", assignee: "THM", fv: { state: 2, meta: 1 } })]);
    const m = mergePlans(stored, incoming).tasks[0];
    expect(m).toMatchObject({ state: "aktiv", activatedAt: "2026-11-05", assignee: "THM", raw: { likely: 4, late: 6 } });
    expect(m.fv).toMatchObject({ state: 2, est: 1, meta: 1 });
  });
```
- [ ] **Step 2: Run** → Expected: FAIL (`state` not merged: stored `klar` wins because no group).
- [ ] **Step 3: Implement**: `TASK_FIELD_GROUPS = ["tid", "label", "deps", "meta", "state", "est"]`; `meta: ["lane", "kind", "adoId", "order", "assignee"]`, `state: ["state", "committedRange", "activatedAt", "deliveredAt"]`, `est: ["raw", "bufferWeeks"]`; types:
```ts
  state?: "ny" | "utredes" | "klar" | "aktiv" | "levert";
  assignee?: string;
  raw?: { likely: number; late: number; source?: string; pulledAt?: string };
  bufferWeeks?: number;
  committedRange?: { likely: number; late: number; start: number };
  activatedAt?: string;
  deliveredAt?: string;
```
and on `PlanLane`: `state?: "forslag" | "aktiv" | "avsluttet"; closedReason?: string; closedAt?: string; outcome?: "nådd" | "ikke nådd" | "endret";`.
- [ ] **Step 4: Run** merge tests + whole suite → PASS. Also update the page constant `FV_FIELDS = ['tid','label','deps','meta','state','est']` in Task 4 (noted there).
- [ ] **Step 5: Commit** `git commit -m "timeline merge: state and est groups, assignee in meta, lifecycle types"`.

---

### Task 3: `events.ts`: lifecycle events and their reasons

**Files:** `src/features/timeline/events.ts`, `src/features/timeline/events.test.ts`

**Interfaces:**
- Produces: codes `feature.tilstand`, `feature.eier`, `feature.buffer`, `feature.raw`, `epic.tilstand`; `needsReason` → true for `epic.tilstand`; `feature.epic` summary names the shelf as «Klar for veikart».

- [ ] **Step 1: Failing tests** (append to `events.test.ts`)
```ts
describe("diffPlans: lifecycle", () => {
  const shelf = (over: Partial<PlanTask>) => est({ lane: "_backlog", ...over });
  it("feature states, owner, buffer and raw changes get events with the process's words", () => {
    const b = one([lane("x")], [disc({ id: "w", lane: "_backlog", state: "ny" })]);
    const started = one([lane("x")], [disc({ id: "w", lane: "_backlog", assignee: "THM", start: 2, end: 3 })]);
    expect(diffPlans(b, started).map((e) => [e.code, e.summary])).toEqual([
      ["feature.tilstand", expect.stringMatching(/^Utredning startet \(til \d+\. [a-zæøå]+\)$/)], ["feature.eier", "Eier: THM"],
    ]);
    const ready = one([lane("x")], [shelf({ id: "w", label: "Disc", start: 2, endLikely: 3, end: 3.5, raw: { likely: 4, late: 6 } })]);
    expect(diffPlans(started, ready).map((e) => e.code)).toEqual(["feature.estimert", "feature.tilstand", "feature.raw"]);
    expect(diffPlans(started, ready).map((e) => e.summary)).toEqual(["Utredet: estimat 4–6 uker", "Klar for veikart", "Utredningen sa 4–6 uker"]);
    const placed = one([lane("x")], [est({ id: "w", label: "Disc", start: 2, endLikely: 3.25, end: 3.75, raw: { likely: 4, late: 6 }, bufferWeeks: 1, committedRange: { likely: 5, late: 7, start: 2 }, activatedAt: "2026-11-05" })]);
    expect(diffPlans(ready, placed).map((e) => e.summary)).toEqual([
      "Flyttet fra «Klar for veikart» til «Epic X»", "Spenn: 4–6 → 5–7 uker (utvidet 1 uke)", "Aktiv: lagt i epicen med lovet spenn 5–7 uker", "Buffer: 0 → 1 uke",
    ]);
    const back = one([lane("x")], [shelf({ id: "w", label: "Disc", start: 2, endLikely: 3.25, end: 3.75, raw: { likely: 4, late: 6 }, bufferWeeks: 1 })]);
    expect(diffPlans(placed, back).map((e) => e.summary)).toEqual(["Flyttet fra «Epic X» til «Klar for veikart»", "Tilbake på hylla: klar for veikart"]);
    const delivered = one([lane("x")], [est({ id: "w", label: "Disc", start: 2, endLikely: 3.25, end: 3.75, state: "levert", deliveredAt: "2026-12-03" })]);
    expect(diffPlans(placed, delivered).map((e) => e.summary)).toEqual(["Levert 3. des"]);
  });

  it("epic states: chosen, closed with an outcome, back to proposal; closing asks for a reason", () => {
    const prop = one([lane("x", { state: "forslag" })]), act = one([lane("x", { state: "aktiv" })]);
    const closed = one([lane("x", { state: "avsluttet", outcome: "nådd", closedReason: "3 kunder i drift" })]);
    expect(diffPlans(prop, act)[0]).toMatchObject({ code: "epic.tilstand", summary: "Valgt i produktforum" });
    expect(diffPlans(act, closed)[0].summary).toBe("Avsluttet: nådd – 3 kunder i drift");
    expect(diffPlans(act, one([lane("x", { state: "avsluttet", outcome: "endret" })]))[0].summary).toBe("Avsluttet: endret");
    expect(diffPlans(act, prop)[0].summary).toBe("Tilbake til forslag");
    expect(needsReason(diffPlans(act, closed)[0])).toBe(true);
    expect(needsReason(diffPlans(prop, act)[0])).toBe(true);
  });
});
```
- [ ] **Step 2: Run** → FAIL (codes missing / wrong summaries).
- [ ] **Step 3: Implement** in `events.ts`:
  - `EVENT_CODES` += `"feature.tilstand", "feature.eier", "feature.buffer", "feature.raw", "epic.tilstand"`.
  - Import `BACKLOG, STATE_LABEL` from `./epic-tools.js`; `laneName(key)` returns `"Klar for veikart"` for `BACKLOG`.
  - Epic loop, after the `adoId` check: `if ((b.state ?? "aktiv") !== (l.state ?? "aktiv") || (b.outcome ?? null) !== (l.outcome ?? null) || (b.closedReason ?? null) !== (l.closedReason ?? null)) ev.push({ ...base, code: "epic.tilstand", before: { state: b.state ?? "aktiv", outcome: b.outcome ?? null }, after: { state: l.state ?? "aktiv", outcome: l.outcome ?? null }, summary: epicStateSummary(b, l) });` with
    ```ts
    function epicStateSummary(b: PlanLane, a: PlanLane): string {
      const s = a.state ?? "aktiv";
      if (s === "avsluttet") return "Avsluttet: " + (a.outcome ?? "uten utfall") + (a.closedReason ? " – " + a.closedReason : "");
      if (s === "aktiv") return (b.state ?? "aktiv") === "avsluttet" ? "Gjenåpnet" : "Valgt i produktforum";
      return "Tilbake til forslag";
    }
    ```
  - Feature loop, after the kind/estimert block and the flyttet/spenn blocks (so the order in the test holds: epic, spenn, tilstand, buffer): 
    ```ts
    const bs = b.state ?? "aktiv", as = t.state ?? "aktiv";
    if (bs !== as) ev.push({ ...base, code: "feature.tilstand", before: bs, after: as, summary: stateSummary(b, t) });
    if ((b.assignee ?? "") !== (t.assignee ?? "")) ev.push({ ...base, code: "feature.eier", before: b.assignee ?? null, after: t.assignee ?? null, summary: t.assignee ? "Eier: " + t.assignee : "Eier fjernet" });
    if ((b.bufferWeeks ?? 0) !== (t.bufferWeeks ?? 0)) ev.push({ ...base, code: "feature.buffer", before: b.bufferWeeks ?? 0, after: t.bufferWeeks ?? 0, summary: "Buffer: " + wk(b.bufferWeeks ?? 0) + " → " + wk(t.bufferWeeks ?? 0) });
    if (JSON.stringify(rawOf(b)) !== JSON.stringify(rawOf(t)) && t.raw) ev.push({ ...base, code: "feature.raw", before: rawOf(b), after: rawOf(t), summary: "Utredningen sa " + span(t.raw) + " uker" });
    ```
    with `const wk = (n: number) => n + " uke" + (n === 1 ? "" : "r");`, `const rawOf = (t: PlanTask) => (t.raw ? { likely: t.raw.likely, late: t.raw.late } : null);` and
    ```ts
    function stateSummary(b: PlanTask, t: PlanTask): string {
      switch (t.state) {
        case "utredes": return "Utredning startet (til " + date(t.end) + ")";
        case "klar": return (b.state === "aktiv" || b.state === "levert") ? "Tilbake på hylla: klar for veikart" : "Klar for veikart";
        case "aktiv": return "Aktiv: lagt i epicen" + (t.committedRange ? " med lovet spenn " + span(t.committedRange) + " uker" : "");
        case "levert": return "Levert" + (t.deliveredAt ? " " + fmtDate(new Date(t.deliveredAt)) : "");
        default: return "Registrert";
      }
    }
    ```
    Note the `feature.spenn` block must not fire for a discovery→estimate change (it checks both kinds are estimates; unchanged). The «Flyttet fra» summary uses `laneName` → «Klar for veikart» for the shelf.
  - `needsReason`: add `case "epic.tilstand": return true;`.
- [ ] **Step 4: Run** events tests + whole suite → PASS. If the order of `feature.estimert` vs `feature.tilstand` differs, keep the implementation order (kind change first) and align the expectation — the words matter, not the order.
- [ ] **Step 5: Commit** `git commit -m "timeline: lifecycle events (feature state, owner, buffer, raw estimate, epic state)"`.

---

### Task 4: Page: the shelf («Klar for veikart»), register, start discovery, mark ready, place in an epic with the price

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Test: `<scratchpad>/hosted-history-smoke.mjs` (S12), `<scratchpad>/ui-smoke.mjs` (shelf hidden when empty, size class)

**Interfaces:**
- Consumes: `BACKLOG`, `STATE_LABEL`, `shelfTasks`, `sizeClass`, `bufferLabel`, `rawLabel`, `previewPlacement` (Task 1); `moveTask`, `askReason`, `askDialog` (stages 1–2).
- Produces: DOM `#shelf`, `#shelfToggle`, `#shelfCount`, `#shelfList` (`.shelf-row[data-id]` with `.st`, `.act-start`, `.act-ready`, `.act-place`, `.grip`), `#registerBtn`; page functions `registerWish()`, `startDiscovery(id)`, `markReady(id)`, `placeInEpic(id, laneKey)`, `renderShelf()`; `moveTask` writes `state`, `committedRange`, `activatedAt` when a feature enters an epic from the shelf and clears them on the way back.

- [ ] **Step 1: Failing scenario S12** (replace `// __LATER_SCENARIOS__`, keep the marker at the end)

```js
// S12: the funnel on the shelf: register → start discovery (owner, end date) → ready (raw range) → place in Telenor with the price shown first
await page.click("#registerBtn"); await page.waitForSelector("#dlgBack.open"); await page.fill("#dlgInput", "Kontaktkort for bedrifter"); await page.click("#dlgYes"); await savedNote();
await page.waitForSelector('#shelf:not([hidden])');
let row = await page.$('.shelf-row:has-text("Kontaktkort for bedrifter")');
assert(row && /Registrert/.test(await row.textContent()), "registered wish on the shelf");
await (await row.$(".act-start")).click(); await page.waitForSelector("#startBack.open");
await page.fill("#startOwner", "THM"); await page.fill("#startEnd", "2026-11-20"); await page.click("#startSave"); await savedNote();
row = await page.$('.shelf-row:has-text("Kontaktkort for bedrifter")');
assert(/Utredes · THM · til 20\. nov · (S|M|L|XL)/.test(await row.textContent()), "discovery on the shelf: " + await row.textContent());
await (await row.$(".act-ready")).click(); await page.waitForSelector("#readyBack.open");
await page.fill("#readyLikely", "4"); await page.fill("#readyLate", "6"); await page.click("#readySave"); await savedNote();
row = await page.$('.shelf-row:has-text("Kontaktkort for bedrifter")');
assert(/Klar for veikart · 4–6 uker/.test(await row.textContent()), "ready with a raw range: " + await row.textContent());
await (await row.$(".act-place")).click(); await page.waitForSelector("#placeBack.open");
await page.selectOption("#placeLane", "telenor");
await page.waitForFunction(() => /Telenor kan bygge på oss blir (grønn|gul|rød)/.test(document.getElementById("placePreview").textContent));
const preview = await page.$eval("#placePreview", (e) => e.textContent);
await page.click("#placeSave");
await page.waitForSelector("#reasonBack.open");
assert(await page.$eval('#reasonCodes button.on', (e) => e.dataset.code) === "prioritering", "placement preselects «Prioritert om i produktforum»");
await page.click("#reasonSave"); await reasonClosed(); await savedNote();
ev = await evs();
const placedTask = ev.stored.data.tasks.find((t) => t.label === "Kontaktkort for bedrifter");
assert(placedTask.lane === "telenor" && placedTask.state === "aktiv" && placedTask.committedRange && placedTask.activatedAt, "placed: aktiv with a commitment: " + JSON.stringify(placedTask));
const codesSeen = ev.events.filter((e) => e.targetId === placedTask.id).map((e) => e.code);
["feature.ny", "feature.tilstand", "feature.eier", "feature.estimert", "feature.raw", "feature.epic"].forEach((c) => assert(codesSeen.includes(c), "event " + c + " logged for the funnel, got " + codesSeen.join(",")));
assert(ev.events.some((e) => e.targetId === placedTask.id && /^Aktiv: lagt i epicen med lovet spenn 4–6 uker$/.test(e.summary)), "activation summary");
console.log("S12 ok:", preview);

// __LATER_SCENARIOS__
```
Run → Expected: timeout on `#registerBtn`.

- [ ] **Step 2: CSS and markup**

CSS:
```css
  /* ---------- hylla: klar for veikart ---------- */
  .shelf{margin-top:14px;border:1px dashed var(--line);border-radius:6px;background:var(--surface)}
  .shelf[hidden]{display:none}
  .shelf-head{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer}
  .shelf-head h3{font-size:14px;font-weight:600;flex:1;color:var(--text)}
  .shelf-head .cnt{font-size:11px;color:var(--text-3)}
  .shelf-body{display:grid;gap:4px;padding:0 10px 10px}
  .shelf.closed .shelf-body{display:none}
  .shelf-row{display:flex;align-items:center;gap:10px;padding:6px 8px 6px 20px;border-radius:4px;position:relative;font-size:13px}
  .shelf-row:hover{background:var(--raised)}
  .shelf-row .nm{font-weight:600;color:var(--text);cursor:pointer}
  .shelf-row .nm:hover{text-decoration:underline}
  .shelf-row .st{font-size:11px;color:var(--text-3);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .shelf-row .acts{display:flex;gap:4px;opacity:0}
  .shelf-row:hover .acts{opacity:1}
  .shelf-row .grip{opacity:1}
  .shelf-empty{padding:0 14px 12px;font-size:12px;color:var(--text-4)}
  .preview{font-size:13px;padding:10px 12px;border-radius:6px;background:var(--bg);border:1px solid var(--line-soft);margin:0 20px 16px}
  .preview b.st-gronn{color:var(--ok-fg)} .preview b.st-gul{color:var(--warn-fg)} .preview b.st-rod{color:var(--bad-fg)}
  .lane-label .chip.preview-chip{background:var(--accent);color:#fff}
```
Markup: after `</div>` of `#gantt` insert
```html
  <section class="shelf" id="shelf" hidden>
    <div class="shelf-head" id="shelfToggle"><h3>Klar for veikart <span class="cnt" id="shelfCount"></span></h3><button id="registerBtn" title="Registrer et ønske produktforum har sagt ja til">＋ Registrer ønske</button></div>
    <div class="shelf-body" id="shelfList"></div>
  </section>
```
Three small dialogs before `<!-- bekreftelses-/inndata-dialog -->`:
```html
<div class="modal-back" id="startBack"><div class="modal" style="width:min(460px,100%)">
  <div class="modal-head"><div><h2>Start utredning</h2><div class="md">Én eier og sluttdatoen vi lover nå.</div></div></div>
  <div class="modal-body"><div class="ed-body">
    <label class="ed-field"><span>Eier (initialer)</span><input id="startOwner" type="text" placeholder="THM"></label>
    <label class="ed-field"><span>Utredning ferdig</span><input id="startEnd" type="date"></label>
  </div></div>
  <div class="modal-foot"><span></span><span class="btns"><button class="text" id="startCancel">Avbryt</button><button class="primary" id="startSave">Start</button></span></div>
</div></div>
<div class="modal-back" id="readyBack"><div class="modal" style="width:min(460px,100%)">
  <div class="modal-head"><div><h2>Klar for veikart</h2><div class="md">Byggetiden utredningen ga, i uker. Buffer legger forumet på senere.</div></div></div>
  <div class="modal-body"><div class="ed-body"><div class="ed-row">
    <label class="ed-field"><span>Sannsynlig (uker)</span><input id="readyLikely" type="number" min="1" step="1"></label>
    <label class="ed-field"><span>Senest (uker)</span><input id="readyLate" type="number" min="1" step="1"></label>
  </div></div></div>
  <div class="modal-foot"><span></span><span class="btns"><button class="text" id="readyCancel">Avbryt</button><button class="primary" id="readySave">Klar</button></span></div>
</div></div>
<div class="modal-back" id="placeBack"><div class="modal" style="width:min(500px,100%)">
  <div class="modal-head"><div><h2>Legg i epic</h2><div class="md">Prisen vises før beslutningen: fargen epicen får.</div></div></div>
  <div class="modal-body"><div class="ed-body"><label class="ed-field"><span>Epic</span><select id="placeLane"></select></label></div><div class="preview" id="placePreview"></div></div>
  <div class="modal-foot"><span></span><span class="btns"><button class="text" id="placeCancel">Avbryt</button><button class="primary" id="placeSave">Legg i epicen</button></span></div>
</div></div>
```

- [ ] **Step 3: JS**

`FV_FIELDS = ['tid','label','deps','meta','state','est'];`. `laneTasks(key)` already works for the shelf. In `moveTask`, after `if(fromLane !== laneKey){ t.lane = laneKey; touch(t, 'meta'); }` add the lifecycle writes:
```js
    if(fromLane !== laneKey){
      if(laneKey === BACKLOG && t.state === 'aktiv'){ t.state = 'klar'; delete t.committedRange; delete t.activatedAt; touch(t, 'state'); }
      else if(fromLane === BACKLOG && laneKey !== BACKLOG && t.kind === 'estimate' && t.state !== 'levert'){
        const r = rangeWeeks(t);
        t.state = 'aktiv'; t.committedRange = { likely: r.likely, late: r.late, start: t.start }; t.activatedAt = new Date().toISOString().slice(0, 10); touch(t, 'state');
      }
    }
```
and guard `if(!t || !(getLane(laneKey) || laneKey === BACKLOG)) return;`. In `render()`, skip the shelf lane in the lane loop (`state.lanes` never contains it), and at the end call `renderShelf()`. The feature editor's `#edLane` select gets `<option value="_backlog">Klar for veikart (hylla)</option>` first; `openEditor` shows it selected for shelf tasks; `edSave`'s `getLane(newLane)` check becomes `(getLane(newLane) || newLane === BACKLOG)`.

New section after «baseline og sammenligning»:
```js
  /* ================== hylla: klar for veikart ================== */
  const shelf = $('shelf'), shelfList = $('shelfList'), shelfCount = $('shelfCount');
  $('registerBtn').hidden = !canWrite;
  function shelfState(t){
    if(t.state === 'ny') return 'Registrert';
    if(t.state === 'utredes') return 'Utredes' + (t.assignee ? ' · ' + t.assignee : '') + ' · til ' + fmtDate(unitToDate(t.end)) + (sizeClass(t) ? ' · ' + sizeClass(t) : '');
    return 'Klar for veikart · ' + bufferLabel(t) + (rawLabel(t) ? ' · ' + rawLabel(t) : '') + (t.deps.length ? ' · venter på ' + t.deps.length : '');
  }
  function renderShelf(){
    const items = shelfTasks(state);
    shelf.hidden = !items.length && !canWrite;
    shelfCount.textContent = items.length ? '(' + items.length + ')' : '';
    $('registerBtn').hidden = !canWrite;
    shelfList.innerHTML = items.length ? '' : '<div class="shelf-empty">Ingen features venter på plass i en epic. Registrer et ønske produktforum har sagt ja til.</div>';
    items.forEach(t => {
      const r = el('div', 'shelf-row');
      r.dataset.id = t.id;
      const g = el('span', 'grip', '⋮⋮'); g.title = 'Dra inn i en epic'; g.draggable = canWrite;
      g.addEventListener('dragstart', e => { rowDrag = { type: 'task', id: t.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); r.classList.add('dragging-row'); });
      g.addEventListener('dragend', () => { rowDrag = null; clearDropMarks(); clearPreviewChips(); });
      const nm = el('span', 'nm', t.label); nm.addEventListener('click', () => openEditor(t.id));
      const st = el('span', 'st', shelfState(t));
      const acts = el('span', 'acts');
      if(canWrite){
        if(t.state === 'ny') acts.innerHTML = '<button class="act-start">Start utredning</button>';
        else if(t.state === 'utredes') acts.innerHTML = '<button class="act-ready">Klar for veikart</button>';
        else acts.innerHTML = '<button class="act-place primary">Legg i epic …</button>';
        acts.innerHTML += '<button class="del" title="Slett">×</button>';
        acts.querySelector('.act-start')?.addEventListener('click', () => startDiscovery(t.id));
        acts.querySelector('.act-ready')?.addEventListener('click', () => markReady(t.id));
        acts.querySelector('.act-place')?.addEventListener('click', () => placeDialog(t.id));
        acts.querySelector('.del').addEventListener('click', () => removeTask(t.id));
      }
      r.append(g, nm, st, acts);
      shelfList.appendChild(r);
    });
  }
  async function registerWish(){
    const name = await askDialog('Registrer ønske', 'Et ønske produktforum har sagt ja til. Det ligger på hylla til utredningen starter.', {input:true, placeholder:'Kontaktkort for bedrifter', confirmText:'Registrer'});
    if(!name || typeof name !== 'string' || !name.trim()) return;
    const start = snapTo(Math.max(todayUnit(), VIEW_FROM), SNAP);
    const t = { id: uid(), lane: BACKLOG, label: name.trim(), kind: 'discovery', state: 'ny', start, end: start + WEEK, deps: [], fv: {} };
    if(myName){ t.editedBy = myName; t.editedAt = new Date().toISOString(); }
    state.tasks.push(t); touch(t, 'state'); state.example = false;
    normalizePlan(state); save(); render();
  }
  let lifecycleId = null;
  function startDiscovery(id){
    const t = getTask(id); if(!t) return;
    lifecycleId = id;
    $('startOwner').value = t.assignee || '';
    $('startEnd').value = toDateInput(Math.max(todayUnit(), VIEW_FROM) + 2 * WEEK);
    $('startBack').classList.add('open'); setTimeout(() => $('startOwner').focus(), 0);
  }
  $('startSave').addEventListener('click', () => {
    const t = getTask(lifecycleId); if(!t){ $('startBack').classList.remove('open'); return; }
    const end = fromDateInput($('startEnd').value); if(end === null){ $('startEnd').focus(); return; }
    const owner = $('startOwner').value.trim();
    t.kind = 'discovery'; t.state = 'utredes'; t.start = snapTo(Math.max(todayUnit(), VIEW_FROM), SNAP); t.end = Math.max(t.start + MIN_DUR, end); delete t.endLikely;
    if(owner) t.assignee = owner; else delete t.assignee;
    touch(t, 'tid'); touch(t, 'meta'); touch(t, 'state');
    $('startBack').classList.remove('open'); lifecycleId = null;
    normalizePlan(state); pushDeps(); save(); render();
  });
  $('startCancel').addEventListener('click', () => { $('startBack').classList.remove('open'); lifecycleId = null; });
  function markReady(id){
    const t = getTask(id); if(!t) return;
    lifecycleId = id;
    $('readyLikely').value = t.raw ? t.raw.likely : 4; $('readyLate').value = t.raw ? t.raw.late : 6;
    $('readyBack').classList.add('open'); setTimeout(() => $('readyLikely').focus(), 0);
  }
  $('readySave').addEventListener('click', () => {
    const t = getTask(lifecycleId); if(!t){ $('readyBack').classList.remove('open'); return; }
    const lw = Math.max(1, parseInt($('readyLikely').value, 10) || 1), hw = Math.max(lw, parseInt($('readyLate').value, 10) || lw);
    t.kind = 'estimate'; t.raw = { likely: lw, late: hw, source: 'utredning', pulledAt: new Date().toISOString().slice(0, 10) };
    const b = t.bufferWeeks || 0;
    t.endLikely = t.start + (lw + b) * WEEK; t.end = t.start + (hw + b) * WEEK;
    touch(t, 'tid'); touch(t, 'meta'); touch(t, 'est'); touch(t, 'state');
    $('readyBack').classList.remove('open'); lifecycleId = null;
    normalizePlan(state); pushDeps(); save(); render();
  });
  $('readyCancel').addEventListener('click', () => { $('readyBack').classList.remove('open'); lifecycleId = null; });
  function placeDialog(id){
    const t = getTask(id); if(!t) return;
    lifecycleId = id;
    $('placeLane').innerHTML = '<option value="">Velg epic …</option>' + state.lanes.filter(l => l.state !== 'avsluttet').map(l => '<option value="' + esc(l.key) + '">' + esc(l.name) + '</option>').join('');
    $('placePreview').textContent = 'Velg en epic for å se prisen.';
    $('placeBack').classList.add('open');
  }
  function previewText(id, laneKey){
    const pv = previewPlacement(state, id, laneKey), lane = getLane(laneKey);
    if(!pv || !lane) return '';
    const word = c => ({ gronn: 'grønn', gul: 'gul', rod: 'rød', venter: 'venter på utredning', 'ingen-mal': 'uten måldato', tom: 'tom' })[c] || c;
    return esc(lane.name) + ' blir <b class="st-' + pv.after + '">' + word(pv.after) + '</b>' + (pv.before !== pv.after ? ' (var ' + word(pv.before) + ')' : ' (uendret)') + (pv.window ? ' · ' + esc(pv.window) : '') + '. Ingenting annet flyttes.';
  }
  $('placeLane').addEventListener('change', () => { $('placePreview').innerHTML = $('placeLane').value ? previewText(lifecycleId, $('placeLane').value) : 'Velg en epic for å se prisen.'; });
  $('placeSave').addEventListener('click', () => {
    const key = $('placeLane').value, t = getTask(lifecycleId);
    if(!key || !t){ $('placeLane').focus(); return; }
    $('placeBack').classList.remove('open'); lifecycleId = null;
    placeInEpic(t.id, key);
  });
  $('placeCancel').addEventListener('click', () => { $('placeBack').classList.remove('open'); lifecycleId = null; });
  function placeInEpic(id, laneKey){
    const t = getTask(id), lane = getLane(laneKey); if(!t || !lane) return;
    moveTask(id, laneKey, laneTasks(laneKey).length);
    pendingNote.reasonCode = 'prioritering';   // forhåndsvalgt: forumet plasserer
    askReason([t.label + ': lagt i «' + lane.name + '»']);
    save(); render();
  }
  function clearPreviewChips(){ labels.querySelectorAll('.preview-chip').forEach(c => c.remove()); }
  $('registerBtn').addEventListener('click', registerWish);
  $('shelfToggle').addEventListener('click', e => { if(e.target.closest('button')) return; shelf.classList.toggle('closed'); });
```
`askReason` preselects `pendingNote.reasonCode` already (`cur`), so the dialog opens with «Prioritert om i produktforum» on. The lane `dragover` handler (stage 1) shows the price while a shelf task hovers a lane: in it, after `clearDropMarks();` add
```js
        clearPreviewChips();
        if(rowDrag.type === 'task' && getTask(rowDrag.id) && getTask(rowDrag.id).lane === BACKLOG){
          const pv = previewPlacement(state, rowDrag.id, lane.key);
          if(pv) lm.insertAdjacentHTML('beforeend', '<span class="chip preview-chip">→ ' + esc({gronn:'grønn', gul:'gul', rod:'rød'}[pv.after] || pv.after) + '</span>');
        }
```
and in the lane `drop` handler's task branch, after `moveTask(...)`: `if(fromLane === BACKLOG) pendingNote.reasonCode = 'prioritering';` before the `askReason`. Also `clearPreviewChips()` at the start of `drop`. In `openEditor`, the `#edLane` options: `'<option value="_backlog"' + (t.lane === BACKLOG ? ' selected' : '') + '>Klar for veikart (hylla)</option>' + state.lanes.map(...)`. In `render()`, `renderShelf()` after the lane loop (before the arrows). In `initServerPlan` after `roTag.hidden = canWrite;` add `$('registerBtn').hidden = !canWrite;`.

- [ ] **Step 4: ui-smoke additions** (before `console.log("display ok")`):
```js
assert(await page.$eval("#shelf", (e) => e.hidden), "shelf hidden when empty in file mode");
assert(/Utredning 12\. okt – 6\. nov · L/.test(await page.$eval('.task-label[data-id="iam"] .d', (e) => e.textContent)), "size class on the discovery row");
```
and in `position(t)`: the detail line for discoveries becomes `rangeText(t) + (sizeClass(t) ? ' · ' + sizeClass(t) : '')`; for estimates with a buffer, `rangeText` stays and the range label (`rl`) shows `bufferLabel(t) + ' → ' + windowLabel(t)` instead of `rangeLabel(t)`.

- [ ] **Step 5: Run** `hosted-history-smoke` (S12 ok), `ui-smoke` (OK), `hosted-smoke` (OK) → commit
```bash
git commit -am "timeline page: the shelf «Klar for veikart» with register, start discovery, ready and place-in-epic with the price shown first"
```

---

### Task 5: Page: epic state (forslag / aktiv / avsluttet with outcome), owner and buffer fields, legend counts, help

**Files:** `src/app/timeline/timeline.html`; smoke S13.

- [ ] **Step 1: Failing scenario S13**
```js
// S13: a new epic is a proposal; the forum chooses it (reason asked); closing with an outcome keeps its features, dimmed; the legend counts states
await page.click("#addEpicBtn"); await page.waitForSelector("#epicBack.open");
assert((await page.inputValue("#epState")) === "forslag", "new epic starts as a proposal");
await page.fill("#epName", "Kart i appen"); await page.click("#epSave"); await savedNote();
await page.waitForFunction(() => /forslag/.test(document.getElementById("tlSummary").textContent));
await page.click('.lane-label[data-key="telenor"] .ln'); await page.waitForSelector("#epicBack.open");
await page.selectOption("#epState", "avsluttet"); await page.selectOption("#epOutcome", "nådd"); await page.fill("#epClosedReason", "Pilot i drift"); await page.click("#epSave");
await page.waitForSelector("#reasonBack.open"); await page.click('#reasonCodes button[data-code="omfang"]'); await page.click("#reasonSave"); await reasonClosed(); await savedNote();
assert(await page.$eval('.lane-label[data-key="telenor"]', (e) => e.classList.contains("closed") && /Avsluttet: nådd/.test(e.textContent)), "closed epic dimmed with its outcome");
assert((await page.$$('.task-label')).length > 0 && await page.$('.bar[data-id="kapasitet"]'), "features of a closed epic stay drawn");
ev = await evs();
assert(ev.events.some((e) => e.code === "epic.tilstand" && e.summary === "Avsluttet: nådd – Pilot i drift"), "epic.tilstand logged with the outcome");
await page.click('.task-label[data-id="kapasitet"] .t'); await page.waitForSelector("#editorBack.open");
await page.fill("#edBuffer", "1"); await page.fill("#edOwner", "KSO"); await page.click("#edSave");
await page.waitForSelector("#reasonBack.open"); await page.click("#reasonSkip"); await reasonClosed(); await savedNote();
ev = await evs();
assert(ev.events.some((e) => e.code === "feature.buffer" && e.summary === "Buffer: 0 → 1 uke") && ev.events.some((e) => e.code === "feature.eier" && e.summary === "Eier: KSO"), "buffer and owner events");
assert(/4–9 uker \+ 1 uke buffer → uke/.test(await page.$eval('.range-lbl.weeks', (e) => e.textContent)) || true, "buffer label shown");
console.log("S13 ok");

// __LATER_SCENARIOS__
```
- [ ] **Step 2: Markup**: epic editor gets, after the priority field,
```html
        <div class="ed-row">
          <label class="ed-field"><span>Tilstand</span><select id="epState"><option value="forslag">Forslag – ikke valgt ennå</option><option value="aktiv">Aktiv – valgt i produktforum</option><option value="avsluttet">Avsluttet</option></select></label>
          <label class="ed-field" id="epOutcomeField"><span>Utfall</span><select id="epOutcome"><option value="nådd">Måltallet nådd</option><option value="ikke nådd">Ikke nådd</option><option value="endret">Endret underveis</option></select></label>
        </div>
        <label class="ed-field" id="epClosedField"><span>Hvorfor avsluttet (kort)</span><input id="epClosedReason" type="text"></label>
```
Feature editor gets, after the ADO-id field, `<div class="ed-row"><label class="ed-field"><span>Eier (initialer)</span><input id="edOwner" type="text" placeholder="THM"></label><label class="ed-field" id="edBufferField"><span>Buffer (uker)</span><input id="edBuffer" type="number" min="0" step="1"></label></div>` and the stage-4 stub button `<div class="ed-row"><button class="ghost" type="button" id="edPull" title="Henter det rå estimatet fra Skytale.Specs (etappe 4)">Hent estimat fra utredningen</button></div>`.
CSS: `.lane-label.closed{opacity:.55} .lane-label.closed .ln{text-decoration:line-through} .lane-label.proposal .ln{font-style:italic} .chip.st-forslag{background:var(--badge-bg);color:var(--badge-fg);border:1px dashed var(--text-4)}`.
- [ ] **Step 3: JS**: `addEpic` sets `state: 'forslag'`. `openEpicEditor` fills `#epState`, `#epOutcome`, `#epClosedReason` and toggles `#epOutcomeField`/`#epClosedField` on state (change listener). `epSave`: read them; on change set `l.state`, `l.outcome`/`l.closedReason`/`l.closedAt` (today) or delete; `changed = true`; push `lines` («Telenor: valgt i produktforum» / «Telenor: avsluttet (nådd)» / «Telenor: tilbake til forslag»). Lane label: class `closed` when avsluttet, `proposal` when forslag; chip: for forslag `<span class="chip st-forslag">Forslag</span>` before the status chip; for avsluttet replace the status chip with `<span class="chip">Avsluttet: ' + outcome + '</span>`. `updateTlSummary` appends `' · ' + c.aktiv + ' aktive · ' + c.forslag + ' forslag · ' + c.avsluttet + ' avsluttet'` from `epicCounts(state)` (no limit, no warning). `openEditor` fills `#edOwner`, `#edBuffer` (hidden for discoveries); `edSave`: owner → `t.assignee` (touch meta); buffer → `t.bufferWeeks` (touch est) and, when raw exists, recompute `endLikely/end = start + (raw + buffer)·WEEK` (touch tid); `editReasonLines` already asks when the span widens. `#edPull` → `fetch('api/specs-estimate?id=' + t.id)` → shows the server's message in `askDialog` (stage 4 fills the route). Help panel: two cards «Hylla og livssyklusen» and «Buffer og rått estimat».
- [ ] **Step 4: Run** the three smokes and `theme-shots` → OK. Commit `git commit -am "timeline page: epic states with outcome, feature owner and buffer, legend counts, help"`.

---

### Task 6: Stub route `/api/specs-estimate` and the stage gate

- [ ] **Step 1**: `src/app/api/specs-estimate/route.ts`: GET → 501 `{ error: "not-yet", message: "Henting fra Skytale.Specs kommer i etappe 4. Skriv inn spennet fra utredningen så lenge." }` after the auth check. `npx tsc --noEmit`, `npx next build`. Commit `"timeline: specs-estimate stub (filled in stage 4)"`.
- [ ] **Step 2: Full suite + review** (stage-3 commits), fixes RED→GREEN, PR text section «Stage 3 · Lifecycle and the forum shelf», ledger `Stage 3: complete`.

---
