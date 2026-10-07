# Epic Roadmap Timeline Implementation Plan

> **For agentic workers:** This repo forbids subagents (hard rule in `~/Skytale/CLAUDE.md`). Use superpowers:executing-plans inline, task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild SkyTracker's `/timeline` as the epic roadmap (one lane per epic, feature bars, goal-date line, computed status) with placeholder epics ready for the 09.10.2026 management meeting.

**Architecture:** The plan JSON stays in `TimelinePlan` (new row `epics`) behind the existing GET/PUT route with server-side field merge. All roadmap logic (time unit, normalisation, status, dependency push, example seed) lives in one plain-JS module `epic-tools.js` that the browser loads as a script and vitest imports through a `.d.ts`. `timeline.html` is rewritten from scratch around that module, reusing the old tool's renderer/drag/link/editor/autosave patterns.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (no schema change), vanilla HTML/CSS/JS, vitest, Playwright (from `~/ptt-e2e`, headless, file:// only) for a UI smoke check.

**Spec:** `docs/superpowers/specs/2026-10-07-epic-roadmap-timeline-design.md` (Workstream B: `2026-10-07-ado-skytracker-sync-design.md`, design only, no tasks here).

## Global Constraints

- Time unit = fractional months since 1 Aug 2026; axis 17 months; one week = 0.25 units (also the drag snap). View starts at Oct 2026 (`VIEW_FROM = 2`).
- `end` is always the bar's far end; estimates add `endLikely` with `start + 0.25 <= endLikely <= end`.
- A blocker's `end` pushes its dependents (finish-to-start). Status is computed, never stored.
- Plan row id is `"epics"`. The row `default` is never read or written by the new code.
- Norwegian UI copy, status labels exactly: "Grønn: holder", "Gul: i fare", "Rød: sprekker", "Venter på utredning", "Uten måldato", "Ingen features ennå"; goal text "Måldato 15. des" / "Foreløpig mål 1. feb" / "Måldato settes etter utredning".
- No commits unless GO says so; no Claude co-author trailer in SkyTracker commits; never run anything against the shared DB except through the deployed app.
- Verify with `npx vitest run`, `npx tsc --noEmit`, `npx next build` from `~/Skytale/SkyTracker-wt-epics`.

## Review Focus

1. A dependency cycle (A blocks B, B blocks A) must never hang `resolveDeps`: test in Task 1 (guard returns after 200 passes, tasks pinned at the axis end).
2. A plan saved by one client while another deleted the epic: lane tombstones must win over an unedited lane and lose to a lane bumped past them: test in Task 2.
3. A discovery task received with an `endLikely` (kind changed on another client) must not carry a stale `endLikely` into status: `normalizePlan` strips it: test in Task 1.
4. An estimate task whose `endLikely` drifted past `end` (hand-edited JSON import) must be clamped, never produce "likely > late": test in Task 1.
5. A reader (role `reader`) must never see the seed button or trigger a PUT: Task 6 manual check + Task 7 smoke (seed button hidden when `canWrite` is false).

---

### Task 1: `epic-tools.js` shared module (time, normalise, status, deps, seed)

**Files:**
- Create: `src/features/timeline/epic-tools.js`
- Create: `src/features/timeline/epic-tools.d.ts`
- Test: `src/features/timeline/epic-tools.test.ts`

**Interfaces:**
- Produces (CommonJS exports and browser globals): `BASE_Y, BASE_M, N_MONTHS, WEEK, SCHEMA, OWNER_DEFAULT, STATUS_LABEL, dateToUnit(d: Date): number, unitToDate(u: number): Date, fmtDate(d: Date): string, normalizePlan(plan): Plan, epicStatus(plan, laneKey): {code, likely?, late?}, resolveDeps(plan): string[] (ids shifted), shiftTask(task, delta): number, rangeWeeks(task): {likely, late} | null, rangeLabel(task): string, goalText(lane): string, exampleSeed(): Plan`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/timeline/epic-tools.test.ts
import { describe, expect, it } from "vitest";
import {
  WEEK, N_MONTHS, dateToUnit, unitToDate, normalizePlan, epicStatus, resolveDeps,
  rangeLabel, goalText, exampleSeed, STATUS_LABEL,
} from "./epic-tools.js";
import type { Plan, PlanTask } from "./merge";

const est = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "e", lane: "x", label: "Est", kind: "estimate", start: 4, endLikely: 5, end: 6, deps: [], fv: {}, ...over });
const disc = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "d", lane: "x", label: "Disc", kind: "discovery", start: 2, end: 3, deps: [], fv: {}, ...over });
const plan = (tasks: PlanTask[], lane: Record<string, unknown> = {}): Plan =>
  normalizePlan({ lanes: [{ key: "x", name: "Epic X", ...lane }], tasks, deleted: {} });

describe("time unit", () => {
  it("1 Aug 2026 is 0, 1 Oct 2026 is 2, 15 Dec 2026 is mid-December", () => {
    expect(dateToUnit(new Date(2026, 7, 1))).toBe(0);
    expect(dateToUnit(new Date(2026, 9, 1))).toBe(2);
    expect(dateToUnit(new Date(2026, 11, 15))).toBeCloseTo(4 + 14 / 31, 5);
    expect(unitToDate(4 + 14 / 31).getDate()).toBe(15);
  });
});

describe("normalizePlan", () => {
  it("fills defaults: owner, deps, fv, kind, endLikely for estimates", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [{ id: "t", lane: "x", label: "T", start: 1, end: 2 }] });
    expect(p.schema).toBe("epics-v1");
    expect(p.lanes[0].owner).toBe("PM + CTO");
    expect(p.tasks[0]).toMatchObject({ kind: "estimate", endLikely: 2, deps: [], fv: {} });
  });
  it("strips endLikely from discovery tasks and clamps estimates into start+week..end", () => {
    const p = plan([disc({ endLikely: 2.5 } as Partial<PlanTask>), est({ id: "hi", endLikely: 9 }), est({ id: "lo", endLikely: 4.1 })]);
    expect(p.tasks[0].endLikely).toBeUndefined();
    expect(p.tasks[1].endLikely).toBe(6);
    expect(p.tasks[2].endLikely).toBe(4 + WEEK);
  });
  it("drops deps to unknown or self and tasks whose lane is gone", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [
      est({ deps: ["nope", "e"] }), est({ id: "orphan", lane: "gone" }),
    ] });
    expect(p.tasks.map((t) => t.id)).toEqual(["e"]);
    expect(p.tasks[0].deps).toEqual([]);
  });
});

describe("epicStatus", () => {
  it("tom when the lane has no features", () => {
    expect(epicStatus(plan([]), "x").code).toBe("tom");
  });
  it("venter when any feature is in discovery, even with a goal date", () => {
    expect(epicStatus(plan([disc({}), est({})], { goalDate: 10 }), "x").code).toBe("venter");
  });
  it("ingen-mal when estimated but no goal date", () => {
    expect(epicStatus(plan([est({})]), "x").code).toBe("ingen-mal");
  });
  it("gronn / gul / rod from the lane's max likely and max late against the goal", () => {
    const tasks = [est({ id: "a", start: 4, endLikely: 5, end: 6 }), est({ id: "b", start: 4, endLikely: 5.5, end: 5.75 })];
    expect(epicStatus(plan(tasks, { goalDate: 6 }), "x")).toMatchObject({ code: "gronn", likely: 5.5, late: 6 });
    expect(epicStatus(plan(tasks, { goalDate: 5.75 }), "x").code).toBe("gul");
    expect(epicStatus(plan(tasks, { goalDate: 5.25 }), "x").code).toBe("rod");
  });
});

describe("resolveDeps", () => {
  it("pushes a blocked feature to the blocker's late end and shifts its whole range", () => {
    const p = plan([est({ id: "a", start: 4, endLikely: 5, end: 6 }), est({ id: "b", start: 4, endLikely: 5, end: 7, deps: ["a"] })]);
    expect(resolveDeps(p)).toEqual(["b"]);
    expect(p.tasks[1]).toMatchObject({ start: 6, endLikely: 7, end: 9 });
  });
  it("chains transitively and is a no-op when already satisfied", () => {
    const p = plan([
      disc({ id: "a", start: 2, end: 3 }), est({ id: "b", start: 3, endLikely: 4, end: 5, deps: ["a"] }),
      est({ id: "c", start: 1, endLikely: 2, end: 3, deps: ["b"] }),
    ]);
    expect(resolveDeps(p)).toEqual(["c"]);
    expect(p.tasks[2]).toMatchObject({ start: 5, endLikely: 6, end: 7 });
    expect(resolveDeps(p)).toEqual([]);
  });
  it("terminates on a cycle and keeps tasks inside the axis", () => {
    const p = plan([est({ id: "a", deps: ["b"] }), est({ id: "b", deps: ["a"] })]);
    resolveDeps(p);
    expect(p.tasks.every((t) => t.end <= N_MONTHS)).toBe(true);
  });
});

describe("labels", () => {
  it("rangeLabel and goalText", () => {
    expect(rangeLabel(est({ start: 4, endLikely: 5, end: 5.75 }))).toBe("4–7 uker");
    expect(rangeLabel(est({ start: 4, endLikely: 5, end: 5 }))).toBe("4 uker");
    expect(rangeLabel(disc({}))).toBe("");
    expect(goalText({ key: "x", name: "X" })).toBe("Måldato settes etter utredning");
    expect(goalText({ key: "x", name: "X", goalDate: dateToUnit(new Date(2026, 11, 15)) })).toBe("Måldato 15. des");
    expect(goalText({ key: "x", name: "X", goalDate: dateToUnit(new Date(2027, 1, 1)), goalProvisional: true })).toBe("Foreløpig mål 1. feb");
    expect(STATUS_LABEL.gul).toBe("Gul: i fare");
  });
});

describe("exampleSeed", () => {
  it("has the 7 deck epics with the slide 22-24 statuses", () => {
    const s = exampleSeed();
    expect(s.example).toBe(true);
    expect(s.lanes.map((l) => l.key)).toEqual(["org", "samtaler", "telenor", "revisjon", "drift", "filer", "kanaler"]);
    const codes = Object.fromEntries(s.lanes.map((l) => [l.key, epicStatus(s, l.key).code]));
    expect(codes).toEqual({ org: "venter", samtaler: "venter", telenor: "gul", revisjon: "venter", drift: "venter", filer: "venter", kanaler: "venter" });
    expect(s.tasks.find((t) => t.id === "roller")!.deps).toEqual(["iam"]);
    expect(resolveDeps(s)).toEqual([]); // the seed is already consistent
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/timeline/epic-tools.test.ts`
Expected: FAIL, "Failed to resolve import ./epic-tools.js".

- [ ] **Step 3: Write the module**

```js
// src/features/timeline/epic-tools.js
// Shared logic for the epic roadmap (/timeline): time unit, plan normalisation,
// computed epic status, dependency push and the example seed. Plain script:
// the browser loads it with <script src>, vitest imports it via epic-tools.d.ts.
// One source, no drift between the page and the tests.

/* ---------- time: unit = months since 1 Aug 2026 ---------- */
const BASE_Y = 2026;
const BASE_M = 7; // august, 0-indexed
const N_MONTHS = 17; // axis ends Dec 2027
const WEEK = 0.25; // one week in month units, also the drag snap
const MND = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

function dateToUnit(d) {
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getFullYear() - BASE_Y) * 12 + (d.getMonth() - BASE_M) + (d.getDate() - 1) / dim;
}
function unitToDate(u) {
  u = Math.max(0, Math.min(N_MONTHS, u));
  const i = Math.min(N_MONTHS - 1, Math.floor(u));
  const m = (BASE_M + i) % 12;
  const y = BASE_Y + Math.floor((BASE_M + i) / 12);
  const dim = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dim, 1 + Math.round((u - i) * dim)));
}
function fmtDate(d) {
  return d.getDate() + ". " + MND[d.getMonth()];
}

/* ---------- plan shape ---------- */
const SCHEMA = "epics-v1";
const KINDS = ["discovery", "estimate"];
const OWNER_DEFAULT = "PM + CTO";
const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);

function normalizePlan(plan) {
  const p = plan && typeof plan === "object" ? plan : {};
  p.schema = SCHEMA;
  p.lanes = Array.isArray(p.lanes) ? p.lanes : [];
  p.tasks = Array.isArray(p.tasks) ? p.tasks : [];
  p.deleted = p.deleted && typeof p.deleted === "object" ? p.deleted : {};
  p.deletedLanes = p.deletedLanes && typeof p.deletedLanes === "object" ? p.deletedLanes : {};
  p.lanes.forEach((l) => {
    if (typeof l.owner !== "string" || !l.owner) l.owner = OWNER_DEFAULT;
    if (num(l.goalDate, null) === null) delete l.goalDate;
    if (!l.goalProvisional) delete l.goalProvisional;
    if (num(l.adoId, null) === null) delete l.adoId;
  });
  const laneKeys = new Set(p.lanes.map((l) => l.key));
  p.tasks = p.tasks.filter((t) => t && typeof t.id === "string" && laneKeys.has(t.lane));
  p.tasks.forEach((t) => {
    t.deps = Array.isArray(t.deps) ? t.deps : [];
    t.fv = t.fv && typeof t.fv === "object" ? t.fv : {};
    if (!KINDS.includes(t.kind)) t.kind = "estimate";
    t.start = num(t.start, 0);
    t.end = num(t.end, t.start + WEEK);
    if (t.end < t.start + WEEK) t.end = t.start + WEEK;
    if (t.kind === "estimate") {
      t.endLikely = Math.min(t.end, Math.max(t.start + WEEK, num(t.endLikely, t.end)));
    } else {
      delete t.endLikely;
    }
    if (num(t.adoId, null) === null) delete t.adoId;
  });
  const ids = new Set(p.tasks.map((t) => t.id));
  p.tasks.forEach((t) => {
    t.deps = t.deps.filter((d) => d !== t.id && ids.has(d));
  });
  return p;
}

/* ---------- computed epic status ---------- */
const STATUS_LABEL = {
  gronn: "Grønn: holder",
  gul: "Gul: i fare",
  rod: "Rød: sprekker",
  venter: "Venter på utredning",
  "ingen-mal": "Uten måldato",
  tom: "Ingen features ennå",
};

function epicStatus(plan, laneKey) {
  const lane = plan.lanes.find((l) => l.key === laneKey);
  const tasks = plan.tasks.filter((t) => t.lane === laneKey);
  if (!lane || !tasks.length) return { code: "tom" };
  if (tasks.some((t) => t.kind === "discovery")) return { code: "venter" };
  const likely = Math.max(...tasks.map((t) => t.endLikely));
  const late = Math.max(...tasks.map((t) => t.end));
  if (typeof lane.goalDate !== "number") return { code: "ingen-mal", likely, late };
  const goal = lane.goalDate;
  const code = late <= goal + 1e-9 ? "gronn" : likely > goal + 1e-9 ? "rod" : "gul";
  return { code, likely, late };
}

/* ---------- dependencies: finish-to-start on the blocker's late end ---------- */
function shiftTask(t, d) {
  d = Math.max(d, -t.start);
  d = Math.min(d, N_MONTHS - t.end);
  if (!d) return 0;
  t.start += d;
  t.end += d;
  if (t.kind === "estimate") t.endLikely += d;
  return d;
}

function resolveDeps(plan) {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const shifted = [];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const t of plan.tasks) {
      let req = -Infinity;
      t.deps.forEach((d) => {
        const p = byId.get(d);
        if (p) req = Math.max(req, p.end);
      });
      if (req > t.start + 1e-9 && shiftTask(t, req - t.start) !== 0) {
        if (!shifted.includes(t.id)) shifted.push(t.id);
        changed = true;
      }
    }
  }
  return shifted;
}

/* ---------- labels ---------- */
const weeks = (u) => Math.round(u / WEEK);
function rangeWeeks(t) {
  if (t.kind !== "estimate") return null;
  return { likely: weeks(t.endLikely - t.start), late: weeks(t.end - t.start) };
}
function rangeLabel(t) {
  const r = rangeWeeks(t);
  if (!r) return "";
  return (r.likely === r.late ? r.late : r.likely + "–" + r.late) + " uker";
}
function goalText(lane) {
  if (typeof lane.goalDate !== "number") return "Måldato settes etter utredning";
  return (lane.goalProvisional ? "Foreløpig mål " : "Måldato ") + fmtDate(unitToDate(lane.goalDate));
}

/* ---------- example seed (deck slides 6, 22, 23, 24) ---------- */
const D = (y, m, d) => dateToUnit(new Date(y, m - 1, d));
function exampleSeed() {
  const est = (id, lane, label, start, likelyW, lateW, extra) =>
    Object.assign({ id, lane, label, kind: "estimate", start, endLikely: start + likelyW * WEEK, end: start + lateW * WEEK, deps: [], fv: {} }, extra || {});
  const disc = (id, lane, label, start, end, extra) =>
    Object.assign({ id, lane, label, kind: "discovery", start, end, deps: [], fv: {} }, extra || {});
  const lane = (key, name, extra) => Object.assign({ key, name, owner: OWNER_DEFAULT }, extra || {});
  return normalizePlan({
    schema: SCHEMA,
    example: true,
    lanes: [
      lane("org", "En ny organisasjon er i gang fra dag én", { goalDate: D(2027, 2, 1), goalProvisional: true }),
      lane("samtaler", "Samtaler du kan stole på"),
      lane("telenor", "Telenor kan bygge på oss", { goalDate: D(2026, 12, 15) }),
      lane("revisjon", "Vi består en ekstern sikkerhetsrevisjon"),
      lane("drift", "Vi ser nedetid før kunden gjør det"),
      lane("filer", "Filene dine er trygge i Skytale"),
      lane("kanaler", "Samarbeid i travle kanaler"),
    ],
    tasks: [
      disc("iam", "org", "IAM: brukerlivsløp", D(2026, 10, 12), D(2026, 11, 6)),
      disc("qr", "org", "Innmelding med QR-kode", D(2026, 11, 9), D(2026, 12, 4), { adoId: 4791 }),
      est("roller", "org", "Rollebasert tilgang", D(2026, 11, 9), 4, 6, { adoId: 4664, deps: ["iam"] }),
      disc("samtaler-sfu", "samtaler", "Samtaler: video og skjermdeling (SFU)", D(2026, 10, 12), D(2026, 11, 20), { adoId: 4742 }),
      disc("varsler", "samtaler", "Varsler", D(2026, 11, 23), D(2026, 12, 4)),
      est("f24", "telenor", "API for integrasjoner (F-24)", D(2026, 10, 12), 6, 9),
      est("kapasitet", "telenor", "Kapasitet i store grupper", D(2026, 11, 2), 4, 7, { adoId: 4499 }),
      disc("herding", "revisjon", "Sikkerhetsherding", D(2026, 11, 2), D(2026, 11, 20)),
      disc("overvaking", "revisjon", "Driftsovervåking", D(2026, 11, 23), D(2026, 12, 11)),
      disc("fjernsletting", "revisjon", "Fjernsletting av enhet", D(2026, 12, 7), D(2026, 12, 18), { adoId: 4790 }),
      disc("statusvarsel", "drift", "Driftsovervåking og statusvarsel", D(2026, 11, 2), D(2026, 11, 27)),
      disc("reservedrift", "drift", "Infrastruktur og reservedrift", D(2026, 11, 30), D(2026, 12, 18)),
      disc("filevault", "filer", "FileVault-fanen", D(2026, 10, 19), D(2026, 11, 13), { adoId: 4780 }),
      est("fildeling", "filer", "Fildeling i chat", D(2026, 10, 12), 3, 5, { adoId: 4492 }),
      disc("trader", "kanaler", "Tråder", D(2026, 11, 2), D(2026, 11, 27), { adoId: 4566 }),
      disc("omtaler", "kanaler", "@-omtaler", D(2026, 11, 30), D(2026, 12, 11)),
      disc("kontaktkort", "kanaler", "Kontaktkort", D(2026, 12, 14), D(2026, 12, 23)),
      disc("sok", "kanaler", "Søk", D(2027, 1, 4), D(2027, 1, 29), { adoId: 4716 }),
    ],
    deleted: {},
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    BASE_Y, BASE_M, N_MONTHS, WEEK, SCHEMA, OWNER_DEFAULT, STATUS_LABEL,
    dateToUnit, unitToDate, fmtDate, normalizePlan, epicStatus, shiftTask, resolveDeps,
    rangeWeeks, rangeLabel, goalText, exampleSeed,
  };
}
```

```ts
// src/features/timeline/epic-tools.d.ts
import type { Plan, PlanLane, PlanTask } from "./merge";

export declare const BASE_Y: number;
export declare const BASE_M: number;
export declare const N_MONTHS: number;
export declare const WEEK: number;
export declare const SCHEMA: "epics-v1";
export declare const OWNER_DEFAULT: string;
export type EpicStatusCode = "gronn" | "gul" | "rod" | "venter" | "ingen-mal" | "tom";
export declare const STATUS_LABEL: Record<EpicStatusCode, string>;
export declare function dateToUnit(d: Date): number;
export declare function unitToDate(u: number): Date;
export declare function fmtDate(d: Date): string;
export declare function normalizePlan(plan: unknown): Plan;
export declare function epicStatus(plan: Plan, laneKey: string): { code: EpicStatusCode; likely?: number; late?: number };
export declare function shiftTask(task: PlanTask, delta: number): number;
export declare function resolveDeps(plan: Plan): string[];
export declare function rangeWeeks(task: PlanTask): { likely: number; late: number } | null;
export declare function rangeLabel(task: PlanTask): string;
export declare function goalText(lane: PlanLane): string;
export declare function exampleSeed(): Plan;
```

- [ ] **Step 4: Run the tests** (they also need Task 2's `PlanLane` type; if Task 2 is not done yet, the type import fails only in tsc, vitest still runs)

Run: `npx vitest run src/features/timeline/epic-tools.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit (only after GO's OK to commit on the branch)**

```bash
git add src/features/timeline/epic-tools.js src/features/timeline/epic-tools.d.ts src/features/timeline/epic-tools.test.ts
git commit -m "feat(timeline): epic-tools module - status, dependency push, example seed"
```

---

### Task 2: Field groups and lane tombstones in `merge.ts`, tests updated

**Files:**
- Modify: `src/features/timeline/merge.ts` (whole file)
- Modify: `src/features/timeline/merge.test.ts`, `src/features/timeline/plan-delta.test.ts`
- `plan-delta.ts` is unchanged (it derives from `GROUP_PROPS`).

**Interfaces:**
- Produces: `TaskFieldGroup = "tid" | "label" | "deps" | "meta"`, `GROUP_PROPS`, `PlanTask { id, lane, label, kind, start, end, endLikely?, adoId?, deps?, fv?, ... }`, `PlanLane { key, name, v?, owner?, goalDate?, goalProvisional?, adoId? }`, `Plan { schema?, lanes, tasks, deleted?, deletedLanes?, ... }`, `mergePlans(stored, incoming)`.

- [ ] **Step 1: Rewrite the tests for the new groups and lane tombstones**

Replace `merge.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { mergePlans, type Plan, type PlanTask } from "./merge";

function task(over: Partial<PlanTask>): PlanTask {
  return { id: "t1", lane: "x", label: "Feature", kind: "estimate", start: 1, endLikely: 1.5, end: 2, deps: [], fv: {}, ...over };
}
function plan(tasks: PlanTask[], over: Partial<Plan> = {}): Plan {
  return { lanes: [{ key: "x", name: "Epic X" }], tasks, deleted: {}, ...over };
}

describe("mergePlans - field-level versioning", () => {
  it("edits to different tasks both survive", () => {
    const stored = plan([task({ id: "a", start: 5, endLikely: 5.5, end: 6, fv: { tid: 1 } }), task({ id: "b" })]);
    const incoming = plan([task({ id: "a" }), task({ id: "b", label: "Nytt navn", fv: { label: 1 } })]);
    const m = mergePlans(stored, incoming);
    expect(m.tasks.find((t) => t.id === "a")!.start).toBe(5);
    expect(m.tasks.find((t) => t.id === "b")!.label).toBe("Nytt navn");
  });

  it("edits to different fields on the SAME task both survive (tid carries endLikely)", () => {
    const stored = plan([task({ id: "a", start: 5, endLikely: 6, end: 7, fv: { tid: 2 } })]);
    const incoming = plan([task({ id: "a", adoId: 4664, fv: { meta: 1 } })]);
    const a = mergePlans(stored, incoming).tasks[0];
    expect(a).toMatchObject({ start: 5, endLikely: 6, end: 7, adoId: 4664 });
    expect(a.fv).toMatchObject({ tid: 2, meta: 1 });
  });

  it("same field, same version, different values: incoming wins that field only", () => {
    const stored = plan([task({ id: "a", label: "A hos Kristoffer", start: 9, end: 10, fv: { label: 3, tid: 5 } })]);
    const incoming = plan([task({ id: "a", label: "A hos Gjermund", fv: { label: 3 } })]);
    const m = mergePlans(stored, incoming);
    expect(m.tasks[0].label).toBe("A hos Gjermund");
    expect(m.tasks[0].start).toBe(9);
  });

  it("kind change to discovery removes endLikely when the meta+tid groups win", () => {
    const stored = plan([task({ id: "a", fv: { tid: 1, meta: 1 } })]);
    const incoming = plan([task({ id: "a", kind: "discovery", endLikely: undefined, fv: { tid: 2, meta: 2 } })]);
    const a = mergePlans(stored, incoming).tasks[0];
    expect(a.kind).toBe("discovery");
    expect(a.endLikely).toBeUndefined();
  });

  it("tombstone wins over an unedited task, loses to a task edited past it", () => {
    const stored = plan([task({ id: "gone", fv: { label: 1 } }), task({ id: "kept", fv: { label: 1 } })]);
    const removed = mergePlans(stored, plan([], { deleted: { gone: 1, kept: 1 } }));
    expect(removed.tasks).toEqual([]);
    const edited = plan([task({ id: "kept", label: "Redigert etter sletting", fv: { label: 2 } })]);
    expect(mergePlans(removed, edited).tasks.find((t) => t.id === "kept")!.label).toBe("Redigert etter sletting");
  });

  it("editedBy/editedAt follow the newest edit stamp", () => {
    const stored = plan([task({ id: "a", editedBy: "Kristoffer", editedAt: "2026-10-07T10:00:00Z", start: 9, end: 10, fv: { tid: 5 } })]);
    const incoming = plan([task({ id: "a", editedBy: "Gjermund", editedAt: "2026-10-07T11:00:00Z", fv: { label: 1 }, label: "Ny" })]);
    const m = mergePlans(stored, incoming);
    expect(m.tasks[0].editedBy).toBe("Gjermund");
    expect(m.tasks[0].start).toBe(9);
  });

  it("lane rename or goal date with higher version wins; unknown lanes are unioned", () => {
    const stored = plan([], { lanes: [{ key: "x", name: "Epic X", goalDate: 4, v: 2 }] });
    const incoming = plan([], { lanes: [{ key: "x", name: "Gammelt navn", v: 1 }, { key: "ny", name: "Ny epic" }] });
    const m = mergePlans(stored, incoming);
    expect(m.lanes.find((l) => l.key === "x")).toMatchObject({ name: "Epic X", goalDate: 4 });
    expect(m.lanes.find((l) => l.key === "ny")).toBeTruthy();
  });

  it("lane tombstone removes an unedited lane and loses to a lane bumped past it", () => {
    const stored = plan([], { lanes: [{ key: "x", name: "Epic X", v: 1 }, { key: "y", name: "Epic Y", v: 1 }] });
    const removed = mergePlans(stored, plan([], { lanes: [], deletedLanes: { x: 1, y: 1 } }));
    expect(removed.lanes).toEqual([]);
    expect(removed.deletedLanes).toEqual({ x: 1, y: 1 });
    const revived = mergePlans(removed, plan([], { lanes: [{ key: "y", name: "Epic Y igjen", v: 2 }] }));
    expect(revived.lanes.map((l) => l.key)).toEqual(["y"]);
  });
});
```

In `plan-delta.test.ts` change the `task()` helper to `{ id: "t1", lane: "x", label: "Oppgave", kind: "estimate", start: 1, endLikely: 1.5, end: 2, deps: [], fv: {} }` and the "flere grupper" case to `plan([task({ label: "Nytt", adoId: 4742 })])` expecting `groups` `["label", "meta"]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/timeline/merge.test.ts src/features/timeline/plan-delta.test.ts`
Expected: FAIL (type errors on `kind`, lane tombstone test fails: lanes still present).

- [ ] **Step 3: Rewrite `merge.ts`**

```ts
// src/features/timeline/merge.ts
// Field-level merge for the shared /timeline plan (epic roadmap).
//
// Every task carries `fv`, a version number per FIELD GROUP, bumped by the
// client whenever it edits that group. Merging two plans is then per-field:
// the higher version wins; an equal version with different values means two
// clients raced on the same field, and the incoming save wins (last write
// wins, but only for that one field, nothing else is lost). Deletes are
// tombstones (`deleted[taskId] = version`, `deletedLanes[key] = version`):
// a tombstone wins over an item whose version hasn't been bumped past it.

export type TaskFieldGroup = "tid" | "label" | "deps" | "meta";
export const TASK_FIELD_GROUPS: TaskFieldGroup[] = ["tid", "label", "deps", "meta"];

// Which task properties belong to which field group.
export const GROUP_PROPS: Record<TaskFieldGroup, string[]> = {
  tid: ["start", "end", "endLikely"],
  label: ["label"],
  deps: ["deps"],
  meta: ["lane", "kind", "adoId"],
};

export type PlanTask = {
  id: string;
  lane: string;
  label: string;
  kind: "discovery" | "estimate";
  start: number;
  end: number;
  endLikely?: number;
  adoId?: number;
  deps?: string[];
  fv?: Partial<Record<TaskFieldGroup, number>>;
  [key: string]: unknown;
};

export type PlanLane = {
  key: string;
  name: string;
  v?: number;
  owner?: string;
  goalDate?: number;
  goalProvisional?: boolean;
  adoId?: number;
};

export type Plan = {
  schema?: string;
  lanes: PlanLane[];
  tasks: PlanTask[];
  deleted?: Record<string, number>;
  deletedLanes?: Record<string, number>;
  [key: string]: unknown;
};

export const fvOf = (t: PlanTask, f: TaskFieldGroup): number => t.fv?.[f] ?? 0;
export const maxFv = (t: PlanTask): number => Math.max(0, ...TASK_FIELD_GROUPS.map((f) => fvOf(t, f)));

function mergeTask(stored: PlanTask, incoming: PlanTask): PlanTask {
  const out: PlanTask = { ...stored, fv: { ...(stored.fv ?? {}) } };
  for (const f of TASK_FIELD_GROUPS) {
    const sv = fvOf(stored, f);
    const iv = fvOf(incoming, f);
    // incoming wins ties: it is the later save, and per-field this is the
    // only place "last write wins" still applies
    const winner = iv >= sv ? incoming : stored;
    for (const p of GROUP_PROPS[f]) {
      if (winner[p] === undefined) delete out[p];
      else out[p] = winner[p];
    }
    out.fv![f] = Math.max(sv, iv);
  }
  // the "last edited by" stamp follows the newest edit (ISO strings compare
  // lexicographically = chronologically)
  const sAt = typeof stored.editedAt === "string" ? stored.editedAt : "";
  const iAt = typeof incoming.editedAt === "string" ? incoming.editedAt : "";
  const newer = iAt >= sAt ? incoming : stored;
  if (newer.editedAt !== undefined) {
    out.editedAt = newer.editedAt;
    out.editedBy = newer.editedBy;
  }
  return out;
}

function mergeTombstones(a?: Record<string, number>, b?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [id, v] of Object.entries(b ?? {})) out[id] = Math.max(out[id] ?? 0, v);
  return out;
}

export function mergePlans(stored: Plan, incoming: Plan): Plan {
  const deleted = mergeTombstones(stored.deleted, incoming.deleted);
  const deletedLanes = mergeTombstones(stored.deletedLanes, incoming.deletedLanes);

  // lanes: union by key, versioned (incoming wins ties); a tombstone removes a
  // lane unless its version was bumped PAST the tombstone
  const lanes: PlanLane[] = [];
  const laneByKey = new Map(incoming.lanes.map((l) => [l.key, l]));
  for (const s of stored.lanes) {
    const i = laneByKey.get(s.key);
    lanes.push(i && (i.v ?? 0) >= (s.v ?? 0) ? { ...i } : { ...s });
    laneByKey.delete(s.key);
  }
  for (const i of laneByKey.values()) lanes.push({ ...i });
  const liveLanes = lanes.filter((l) => (l.v ?? 0) > (deletedLanes[l.key] ?? 0) || deletedLanes[l.key] === undefined);

  // tasks: union by id, stored order first, incoming-only appended
  const storedMap = new Map(stored.tasks.map((t) => [t.id, t]));
  const incomingMap = new Map(incoming.tasks.map((t) => [t.id, t]));
  const orderedIds = [
    ...stored.tasks.map((t) => t.id),
    ...incoming.tasks.filter((t) => !storedMap.has(t.id)).map((t) => t.id),
  ];

  const tasks: PlanTask[] = [];
  for (const id of orderedIds) {
    const s = storedMap.get(id);
    const i = incomingMap.get(id);
    const candidate = s && i ? mergeTask(s, i) : ({ ...(s ?? i)! } as PlanTask);
    // a tombstone wins unless the task's fields were bumped PAST it
    const tomb = deleted[id] ?? 0;
    if (tomb > 0 && maxFv(candidate) <= tomb) continue;
    tasks.push(candidate);
  }

  return { ...stored, ...incoming, lanes: liveLanes, tasks, deleted, deletedLanes };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/timeline`
Expected: merge + plan-delta + epic-tools PASS; `plan-tools.test.ts` and `schedule.test.ts` may fail on types until Task 3 removes plan-tools (schedule.ts does not import merge, it stays green).

- [ ] **Step 5: Commit (after GO's OK)**

```bash
git add src/features/timeline/merge.ts src/features/timeline/merge.test.ts src/features/timeline/plan-delta.test.ts
git commit -m "feat(timeline): merge field groups for epic features, lane tombstones"
```

---

### Task 3: Plan route on row `epics`, remove the obsolete modules and routes

**Files:**
- Modify: `src/app/api/timeline-plan/route.ts`
- Delete: `src/app/api/timeline-buffer-history/route.ts`, `src/app/timeline/plan-tools.js/route.ts`, `src/app/timeline/claude-instruksjoner.md/route.ts`, `src/app/timeline/guide/route.ts`, `src/app/timeline/guide/guide.html`, `src/features/timeline/plan-tools.js`, `src/features/timeline/plan-tools.d.ts`, `src/features/timeline/plan-tools.test.ts`, `src/features/timeline/claude-instruksjoner.md`
- Create: `src/app/timeline/epic-tools.js/route.ts`
- Keep: `src/app/api/timeline-changes/route.ts` (change log read), `src/app/api/timeline-export/route.ts` + `schedule.ts` (board bridge for Workstream B).

**Interfaces:**
- Produces: `GET /api/timeline-plan` -> `{ role, user, plan: { data, version, updatedAt, updatedBy } | null }`; `PUT /api/timeline-plan` body `{ data: Plan }` -> `{ version, data }` (merged); `GET /timeline/epic-tools.js` -> the module source.

- [ ] **Step 1: Edit the plan route**

In `src/app/api/timeline-plan/route.ts`:
- `const PLAN_ID = "epics";` with the comment `// epic roadmap row; the old company plan stays in row "default", untouched`.
- Remove `import { bufferStatuses } from "@/features/timeline/plan-tools";`, the `snapshotBuffers` call and function, and `isoWeek`.
- In PUT, after the shape check add: `if (incoming.schema !== undefined && incoming.schema !== "epics-v1") return Response.json({ error: "unknown plan schema" }, { status: 400 });`

- [ ] **Step 2: Create the module route**

```ts
// src/app/timeline/epic-tools.js/route.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Serves the shared epic-tools module (time unit, status, dependency push,
// seed) to the hosted timeline page. The same file is imported by vitest, so
// the browser and the tests always run identical logic.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  const js = readFileSync(path.join(process.cwd(), "src/features/timeline/epic-tools.js"), "utf8");
  return new Response(js, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 3: Delete the obsolete files**

```bash
git rm -q src/app/api/timeline-buffer-history/route.ts src/app/timeline/plan-tools.js/route.ts \
  src/app/timeline/claude-instruksjoner.md/route.ts src/app/timeline/guide/route.ts src/app/timeline/guide/guide.html \
  src/features/timeline/plan-tools.js src/features/timeline/plan-tools.d.ts src/features/timeline/plan-tools.test.ts \
  src/features/timeline/claude-instruksjoner.md
```
(Without GO's commit OK, use `rm` and leave the deletions unstaged.)

- [ ] **Step 4: Verify**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (schedule, merge, plan-delta, epic-tools, ado, board tests). `grep -rn "plan-tools\|claude-instruksjoner\|timeline/guide\|buffer-history" src` must only hit the old `timeline.html` (replaced in Task 5).

- [ ] **Step 5: Commit (after GO's OK)**

```bash
git add -A src/app/api/timeline-plan src/app/api/timeline-buffer-history src/app/timeline src/features/timeline
git commit -m "feat(timeline): plan route on the epics row; drop buffer, guide and import modules"
```

---

### Task 4: `timeline.html` rewrite, part 1: skeleton, styles, state, render

**Files:**
- Rewrite: `src/app/timeline/timeline.html` (the whole file; parts 1 and 2 are one file written in two sittings)

**Interfaces:**
- Consumes: globals from `epic-tools.js` (Task 1), `GET/PUT api/timeline-plan` (Task 3).
- Produces for part 2: `state`, `render()`, `positionAll()`, `position(t)`, `drawArrows()`, `touch(t, group)`, `save()`, `getTask(id)`, `getLane(key)`, `x(u)`, `askDialog/confirmDialog`, DOM ids listed below.

- [ ] **Step 1: Write the document skeleton**

Head: `<title>Skytale veikart - epics</title>`, the same Google Fonts link as the old file (Fraunces, Archivo, Spline Sans Mono). Body:

```html
<div class="wrap">
  <div class="meta-row">
    <span class="brand">SKYTALE <em>·</em> VEIKART</span>
    <span id="metaRight">Utviklingsavdelingen <span class="example-badge" id="exampleBadge" hidden>Eksempel, ikke en plan</span></span>
  </div>
  <div class="titlebar">
    <div>
      <h1>Veikartet — <span class="accent">epics.</span></h1>
      <p class="hint">Én rad per epic. Utredning er stripet med sluttdato, estimater er et spenn: mørk del = sannsynlig, lys del = usikker.
      Statusen regnes ut fra spennet mot måldatoen. Trykk <b>Hjelp</b> for bruk.</p>
    </div>
    <div class="toolbar">
      <span class="dirty-note" id="dirtyNote"></span>
      <button id="addEpicBtn">＋ Epic</button>
      <button class="ghost" id="exportBtn">Eksporter (JSON)</button>
      <button class="ghost" id="helpBtn">Hjelp</button>
    </div>
  </div>
  <div class="ro-banner" id="roBanner" hidden><b>👁 Lesetilgang</b> — endringene dine lagres kun i din nettleser og deles ikke med andre.</div>
  <div class="help" id="helpPanel"> …six help cards: Flytt og juster · Epic og måldato · Utredning vs estimat · Avhengigheter · Status · Lagring og deling… </div>
  <div class="link-banner" id="linkBanner"><span id="linkText"></span><button id="linkCancel">Avbryt (Esc)</button></div>
  <div class="legend">
    <span><i class="sw discovery"></i>Utredning</span>
    <span><i class="sw likely"></i>Sannsynlig</span>
    <span><i class="sw late"></i>Usikker del av spennet</span>
    <span><i class="sw goal"></i>Måldato</span>
    <span><i class="sw today"></i>I dag</span>
    <span><i class="sw depsw"></i>Avhengighet</span>
    <span class="tl-summary" id="tlSummary"></span>
  </div>
  <div class="empty" id="emptyState" hidden>
    <p>Planen er tom.</p>
    <button id="seedBtn" hidden>Last inn eksempel-epics</button>
    <span class="note" id="emptyNote"></span>
  </div>
  <div class="gantt" id="gantt">
    <div class="labels" id="labels"></div>
    <div class="chart-scroll" id="chartScroll"><div class="chart" id="chart"></div></div>
    <div class="col-resizer" id="colResizer" title="Dra for å justere kolonnebredden · dobbeltklikk for standard"></div>
  </div>
  <footer><span>Skytale AS · Veikart for utviklingsavdelingen</span><span>ADO eier hva som finnes og tilstand · estimater og avhengigheter bor her</span></footer>
</div>
<div class="drag-tip" id="dragTip"></div>
```

Modals (same `.modal-back/.modal/.modal-head/.modal-body/.modal-foot` structure as the old file lines 889-971):

```html
<div class="modal-back" id="editorBack"><div class="modal" style="width:min(560px,100%)">
  <div class="modal-head"><div><h2 id="edTitle">Rediger feature</h2><div class="md" id="edDates"></div></div><button id="edClose">Lukk</button></div>
  <div class="modal-body"><div class="ed-body">
    <label class="ed-field"><span>Navn</span><input id="edName" type="text"></label>
    <div class="ed-field"><span>Type</span><div class="ed-kind" id="edKind">
      <button type="button" data-k="discovery">Utredning — sluttdato</button>
      <button type="button" data-k="estimate">Estimert — spenn i uker</button></div></div>
    <div class="ed-row">
      <label class="ed-field"><span>Start</span><input id="edStart" type="date"></label>
      <label class="ed-field" id="edEndField"><span>Utredning ferdig</span><input id="edEnd" type="date"></label>
      <label class="ed-field" id="edLikelyField"><span>Sannsynlig (uker)</span><input id="edLikely" type="number" min="1" step="1"></label>
      <label class="ed-field" id="edLateField"><span>Senest (uker)</span><input id="edLate" type="number" min="1" step="1"></label>
    </div>
    <label class="ed-field"><span>ADO-id (Feature)</span><input id="edAdo" type="number" min="1" step="1" placeholder="f.eks. 4742"></label>
    <div class="ed-field"><span>Venter på (blokkere)</span><div class="ed-deps" id="edDeps"></div></div>
    <div class="ed-row"><button class="ghost" type="button" id="edLink">Koble avhengighet …</button></div>
  </div></div>
  <div class="modal-foot"><button class="danger-ghost" id="edDelete">Slett feature …</button>
    <span class="btns"><button class="ghost" id="edCancel">Avbryt</button><button id="edSave">Lagre</button></span></div>
</div></div>

<div class="modal-back" id="epicBack"><div class="modal" style="width:min(520px,100%)">
  <div class="modal-head"><div><h2 id="epTitle">Rediger epic</h2><div class="md" id="epSub">Eies av PM + CTO</div></div><button id="epClose">Lukk</button></div>
  <div class="modal-body"><div class="ed-body">
    <label class="ed-field"><span>Navn (resultatet ledelsen vil ha)</span><input id="epName" type="text"></label>
    <div class="ed-row">
      <label class="ed-field"><span>Måldato</span><input id="epGoal" type="date"></label>
      <label class="ed-check"><input type="checkbox" id="epProvisional"> Foreløpig (settes endelig etter utredning)</label>
    </div>
    <label class="ed-field"><span>ADO-id (Epic)</span><input id="epAdo" type="number" min="1" step="1"></label>
  </div></div>
  <div class="modal-foot"><button class="danger-ghost" id="epDelete">Slett epic …</button>
    <span class="btns"><button class="ghost" id="epCancel">Avbryt</button><button id="epSave">Lagre</button></span></div>
</div></div>

<div class="modal-back" id="dlgBack"> …identical to the old file lines 959-971… </div>
```

Loader at the end of body:

```html
<script>
(function(){
  var s = document.createElement('script');
  s.src = location.protocol === 'file:' ? 'epic-tools.js' : 'timeline/epic-tools.js';
  s.onload = function(){ window.__bootTimeline(); };
  s.onerror = function(){ document.getElementById('emptyState').hidden = false;
    document.getElementById('emptyNote').textContent = 'Kunne ikke laste epic-tools.js.'; };
  document.head.appendChild(s);
})();
</script>
<script>
window.__bootTimeline = function(){
  "use strict";
  … part 1 + part 2 code …
};
</script>
```

- [ ] **Step 2: Write the styles**

Keep the old tokens (`:root` block, lines 11-29) and the base/toolbar/menu/help/link-banner/gantt/labels/axis/grid/today/row/drag-tip/modal/editor/dialog/ro-banner/footer rules (old lines 30-113, 124-166, 167-232, 258-327, 384-398, 400-418, 489-500, 510-519, 535-539, 550-570, 641-653). Drop the lane colour classes, t2zone, presentation, cause-menu, mini/detail view, import/Claude, buffer, hva-nå, dashboard, log rules. Add:

```css
  --disc-a:#e8a06a; --disc-b:#f3c9a6; --likely:#2f6e9e; --late:#9dbfd9; --goal:#15233b; --today:#a9531a;
  .example-badge{margin-left:10px;padding:2px 8px;border:1px solid var(--gold);color:var(--gold);border-radius:2px}
  .sw.discovery{background:repeating-linear-gradient(45deg,var(--disc-a) 0 4px,var(--disc-b) 4px 8px)}
  .sw.likely{background:var(--likely)} .sw.late{background:var(--late)}
  .sw.goal{width:4px;height:16px;background:var(--goal)} .sw.today{width:3px;height:16px;background:var(--today)}
  .empty{border:1px dashed var(--line);background:var(--card);padding:40px 30px;text-align:center;font-family:'Fraunces',serif;font-size:18px;color:var(--ink-soft);margin-bottom:18px}
  .empty button{margin:14px 0 6px} .empty .note{display:block;font-family:'Spline Sans Mono',monospace;font-size:11px}
  .lane-label{height:52px;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;text-transform:none;letter-spacing:0;font-family:'Archivo',sans-serif}
  .lane-label .ln{font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
  .lane-label .lm{display:flex;gap:8px;align-items:center;font-size:11px;color:rgba(247,244,238,.78)}
  .lane-label .lm .chip{font-family:'Spline Sans Mono',monospace;font-size:9.5px;letter-spacing:.06em;padding:1px 7px;border-radius:8px;text-transform:uppercase}
  .chip.st-gronn{background:#2e7d4f;color:#fff} .chip.st-gul{background:#c9932f;color:#fff} .chip.st-rod{background:#b23a3a;color:#fff}
  .chip.st-venter,.chip.st-ingen-mal,.chip.st-tom{background:#dcd6cb;color:var(--ink)}
  .lane-label .lane-add{position:absolute;right:8px;top:8px;display:none;gap:3px}
  .lane-label:hover .lane-add{display:flex}
  .lane-label .lane-add button{background:transparent;border:1px solid rgba(247,244,238,.4);color:var(--paper);height:20px;padding:0 6px;font-size:9.5px}
  .lane-label .lane-add button:hover{background:var(--paper);color:var(--ink)}
  .lane-band{height:52px;position:relative}
  .lane-band .goal-lbl{position:absolute;top:6px;transform:translateX(-50%);font-family:'Spline Sans Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--goal);white-space:nowrap}
  .goal-line{position:absolute;top:0;bottom:0;width:3px;background:var(--goal);z-index:3;pointer-events:none}
  .today{background:var(--today)} .today .tl{background:var(--today)}
  .bar{color:#fff;background:transparent;box-shadow:none}
  .bar.discovery{background:repeating-linear-gradient(45deg,var(--disc-a) 0 8px,var(--disc-b) 8px 16px);color:var(--ink);box-shadow:0 1px 2px rgba(19,32,47,.22)}
  .bar .seg{position:absolute;top:0;bottom:0;pointer-events:none}
  .bar .seg.likely{left:0;background:var(--likely);border-radius:3px 0 0 3px}
  .bar .seg.late{right:0;background:var(--late);border-radius:0 3px 3px 0}
  .bar.estimate .bl{position:relative;z-index:1}
  .bar .h.m{cursor:ew-resize} .bar .h.m::after{background:rgba(19,32,47,.55)}
  .range-lbl{position:absolute;top:0;height:var(--row-h);display:flex;align-items:center;font-family:'Spline Sans Mono',monospace;font-size:10.5px;color:var(--ink-soft);white-space:nowrap;pointer-events:none;padding-left:8px}
  .task-label .chip.ado{background:transparent;border-color:var(--sea);color:var(--sea);text-decoration:none}
  .ed-kind{display:flex;gap:6px;flex-wrap:wrap} .ed-kind button{padding:7px 12px}
  .ed-kind button.on[data-k=discovery]{background:var(--disc-a);border-color:var(--disc-a);color:var(--ink)}
  .ed-kind button.on[data-k=estimate]{background:var(--likely);border-color:var(--likely);color:#fff}
  .ed-field input[type=date]{font-family:'Archivo',sans-serif;font-size:14px;padding:7px 10px;border:1px solid var(--line);border-radius:2px;background:#fff;color:var(--ink)}
```

- [ ] **Step 3: Write part 1 of the script (constants, state, persistence, render)**

Inside `window.__bootTimeline = function(){ … }`:

```js
  /* ================== constants ================== */
  const MONTH_W = cssNum('--month-w'), ROW_H = cssNum('--row-h');
  const VIEW_FROM = 2;                       // axis starts Oct 2026 (unit 2)
  const VIEW_MONTHS = N_MONTHS - VIEW_FROM;  // 15 months to Dec 2027
  const SNAP = WEEK, MIN_DUR = WEEK;
  const STORE = 'skytale-veikart-v1';
  const HOSTED = location.protocol !== 'file:';
  const ADO_URL = id => 'https://dev.azure.com/SkytaleAS/Skytale/_workitems/edit/' + id;
  const MND_UP = ['JAN','FEB','MAR','APR','MAI','JUN','JUL','AUG','SEP','OKT','NOV','DES'];

  function cssNum(v){ return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)); }
  const x = u => (u - VIEW_FROM) * MONTH_W;             // unit -> px in the chart
  const monthInfo = i => ({ m: (BASE_M + i) % 12, y: BASE_Y + Math.floor((BASE_M + i) / 12) });
  function todayUnit(){ return Math.max(VIEW_FROM, Math.min(N_MONTHS, dateToUnit(new Date()))); }
  const fmt = d => fmtDate(d) + ' ' + String(d.getFullYear()).slice(2);
  function rangeText(t){
    if(t.kind === 'discovery') return 'Utredning ' + fmt(unitToDate(t.start)) + ' – ' + fmt(unitToDate(t.end));
    return fmt(unitToDate(t.start)) + ' → ' + fmt(unitToDate(t.endLikely)) + ' (senest ' + fmt(unitToDate(t.end)) + ')';
  }
  const snapTo = (v, s) => Math.round(v / s) * s;
  const uid = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const toDateInput = u => { const d = unitToDate(u); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  const fromDateInput = s => { const [y,m,d] = s.split('-').map(Number); return (y && m && d) ? snapTo(dateToUnit(new Date(y, m-1, d)), SNAP) : null; };

  /* ================== state ================== */
  let state = loadState();
  let linkSource = null, myName = null, canWrite = false, serverReady = false, serverVersion = null, applyingRemote = false;
  function emptyPlan(){ return normalizePlan({ lanes: [], tasks: [], deleted: {} }); }
  function loadState(){
    try{ const raw = localStorage.getItem(STORE); if(raw){ const s = JSON.parse(raw); if(s && Array.isArray(s.lanes)) return normalizePlan(s); } }catch(e){}
    return HOSTED ? emptyPlan() : exampleSeed();   // local file mode: show the example at once
  }
  const getTask = id => state.tasks.find(t => t.id === id);
  const getLane = key => state.lanes.find(l => l.key === key);
  const laneTasks = key => state.tasks.filter(t => t.lane === key);

  /* field versions: client bumps the group it edits; the server merges per group */
  const pendingTouch = new Map();
  function touch(t, field){ let s = pendingTouch.get(t); if(!s){ s = new Set(); pendingTouch.set(t, s); } s.add(field); }
  function flushTouches(){
    pendingTouch.forEach((fields, t) => { t.fv = t.fv || {}; fields.forEach(f => { t.fv[f] = (t.fv[f] || 0) + 1; });
      if(myName){ t.editedBy = myName; t.editedAt = new Date().toISOString(); } });
    pendingTouch.clear();
  }
  const maxFvOf = t => Math.max(0, ...['tid','label','deps','meta'].map(f => (t.fv && t.fv[f]) || 0));
  function bumpLane(l){ l.v = (l.v || 0) + 1; }
  function save(){ flushTouches(); try{ localStorage.setItem(STORE, JSON.stringify(state)); }catch(e){} if(HOSTED) scheduleServerSave(); }
```

`render()` (replaces old lines 1275-1471). Per lane: label block with `.ln` (click -> `openEpicEditor(lane.key)`), `.lm` with the status chip (`epicStatus(state, lane.key)` -> `<span class="chip st-'+code+'">'+STATUS_LABEL[code]+'</span>`) and `goalText(lane)`, and `.lane-add` with two buttons (`+ Utredning` -> `addFeature(key,'discovery')`, `+ Estimert` -> `addFeature(key,'estimate')`); chart side `.lane-band` with the goal line + `goal-lbl` ("MÅLDATO 15. DES") when `goalDate` is set. Per feature: `.task-label` (dot removed; `.t` click -> `openEditor`, `.d` filled by `position`) and a `.row` with `.goal-line` (if the lane has a goal) and the bar:

```js
        const bar = document.createElement('div');
        bar.className = 'bar ' + t.kind;
        bar.dataset.id = t.id;
        bar.innerHTML = (t.kind === 'estimate' ? '<div class="seg likely"></div><div class="seg late"></div>' : '') +
          '<div class="h l"></div><span class="bl">' + esc(t.label) + '</span>' +
          (t.kind === 'estimate' ? '<div class="h m"></div>' : '') + '<div class="h r"></div>';
        row.appendChild(bar);
        const rl = document.createElement('div'); rl.className = 'range-lbl'; row.appendChild(rl);
        barRefs[t.id] = bar; rowRefs[t.id] = row; rangeRefs[t.id] = rl;
```

`position(t)`:

```js
  function position(t){
    const bar = barRefs[t.id]; if(!bar) return;
    const left = x(t.start), width = Math.max(14, (t.end - t.start) * MONTH_W);
    bar.style.left = left + 'px'; bar.style.width = width + 'px';
    if(t.kind === 'estimate'){
      const lw = Math.max(0, (t.endLikely - t.start) * MONTH_W);
      bar.querySelector('.seg.likely').style.width = lw + 'px';
      bar.querySelector('.seg.late').style.width = Math.max(0, width - lw) + 'px';
      bar.querySelector('.h.m').style.left = (lw - 4) + 'px';
    }
    rangeRefs[t.id].style.left = (left + width) + 'px';
    rangeRefs[t.id].textContent = t.kind === 'estimate' ? rangeLabel(t) : 'til ' + fmtDate(unitToDate(t.end));
    const chips = [];
    if(t.adoId) chips.push('<a class="chip ado" target="_blank" rel="noopener" href="' + ADO_URL(t.adoId) + '">#' + t.adoId + '</a>');
    if(t.deps.length) chips.push('<span class="chip">⇠ ' + t.deps.length + '</span>');
    if(t.editedBy) chips.push('<span class="chip who" title="Sist endret av ' + esc(t.editedBy) + '">' + esc(initials(t.editedBy)) + '</span>');
    labelDateRefs[t.id].innerHTML = esc(rangeText(t)) + chips.join('');
    bar.title = t.label + ' · ' + rangeText(t);
  }
```

Axis loop runs `for(let i = VIEW_FROM; i < N_MONTHS; i++)`, grid lines at `x(i)`, chart width `VIEW_MONTHS * MONTH_W` (`.chart{width:calc(var(--month-w) * 15)}`), today line at `x(todayUnit())` labelled `'I DAG · ' + d + '. ' + MND_UP[m]`. `drawArrows()` is the old function with `a.end*MONTH_W` -> `x(a.end)` and `b.start*MONTH_W` -> `x(b.start)`. `updateTlSummary()` counts status codes over lanes and renders one dot per colour plus "N venter". `exampleBadge.hidden = !state.example`. `render()` must NOT call `save()`; every mutation site calls `save()` itself.

- [ ] **Step 4: Open the file locally and check it renders**

Copy `timeline.html` and `epic-tools.js` to `/private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad/ui/` and run the Playwright screenshot script from Task 6 (screenshot only). Expected: 7 epic rows, hatched and two-tone bars, goal lines on `org` and `telenor`, today line in October, status chips `Venter på utredning` x6 and `Gul: i fare` on Telenor.

---

### Task 5: `timeline.html` rewrite, part 2: drag, links, editors, epics, persistence, export, help

**Files:**
- Modify: `src/app/timeline/timeline.html` (same file, script part 2)

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: `addFeature(laneKey, kind)`, `openEditor(id)`, `openEpicEditor(key)`, `addEpic()`, `removeEpic(key)`, `startLink/completeLink/cancelLink`, `initServerPlan/pushPlan/scheduleServerSave/pollTick/applyRemote`, `loadSeed()`.

- [ ] **Step 1: Dependency push wrapper and drag**

```js
  function pushDeps(){ resolveDeps(state).forEach(id => { const t = getTask(id); if(t) touch(t, 'tid'); }); }
  let drag = null;
  chart.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.bar'); if(!bar) return;
    if(linkSource){ completeLink(bar.dataset.id); e.preventDefault(); return; }
    const t = getTask(bar.dataset.id);
    const h = e.target.classList.contains('h') ? e.target : null;
    const mode = !h ? 'move' : h.classList.contains('l') ? 'l' : h.classList.contains('m') ? 'm' : 'r';
    drag = {t, bar, mode, x0: e.clientX, start0: t.start, likely0: t.endLikely, end0: t.end};
    bar.classList.add('dragging'); bar.setPointerCapture(e.pointerId); showTip(e, t); e.preventDefault();
  });
  chart.addEventListener('pointermove', e => {
    if(!drag) return;
    const du = (e.clientX - drag.x0) / MONTH_W, t = drag.t;
    if(drag.mode === 'move'){
      let s = snapTo(drag.start0 + du, SNAP);
      s = Math.max(VIEW_FROM, Math.min(N_MONTHS - (drag.end0 - drag.start0), s));
      const d = s - t.start; if(d){ shiftTask(t, d); touch(t, 'tid'); }
    } else if(drag.mode === 'l'){
      let s = snapTo(drag.start0 + du, SNAP);
      const cap = t.kind === 'estimate' ? drag.likely0 - MIN_DUR : drag.end0 - MIN_DUR;
      s = Math.max(VIEW_FROM, Math.min(cap, s));
      if(s !== t.start){ t.start = s; touch(t, 'tid'); }
    } else if(drag.mode === 'm'){
      let m = snapTo(drag.likely0 + du, SNAP);
      m = Math.max(drag.start0 + MIN_DUR, Math.min(drag.end0, m));
      if(m !== t.endLikely){ t.endLikely = m; touch(t, 'tid'); }
    } else {
      let en = snapTo(drag.end0 + du, SNAP);
      const floor = t.kind === 'estimate' ? drag.likely0 : drag.start0 + MIN_DUR;
      en = Math.min(N_MONTHS, Math.max(floor, en));
      if(en !== t.end){ t.end = en; touch(t, 'tid'); }
    }
    pushDeps(); positionAll(); showTip(e, t);
  });
  function endDrag(){ if(!drag) return; drag.bar.classList.remove('dragging'); tip.style.display = 'none'; drag = null; save(); render(); }
```

(`render()` after a drag refreshes the status chips; `showTip` is the old function.)

- [ ] **Step 2: Features: add, remove, link mode**

```js
  function addFeature(laneKey, kind){
    const start = snapTo(Math.max(todayUnit(), VIEW_FROM), SNAP);
    const t = kind === 'discovery'
      ? {id: uid(), lane: laneKey, label: 'Ny utredning', kind, start, end: start + 2 * WEEK, deps: [], fv: {}}
      : {id: uid(), lane: laneKey, label: 'Ny feature', kind, start, endLikely: start + 4 * WEEK, end: start + 6 * WEEK, deps: [], fv: {}};
    if(myName){ t.editedBy = myName; t.editedAt = new Date().toISOString(); }
    let idx = -1; state.tasks.forEach((v, i) => { if(v.lane === laneKey) idx = i; });
    if(idx === -1) state.tasks.push(t); else state.tasks.splice(idx + 1, 0, t);
    save(); render(); openEditor(t.id);
  }
  function doRemoveTask(id){
    const t = getTask(id); if(!t) return;
    state.deleted[id] = maxFvOf(t) + 1;
    state.tasks = state.tasks.filter(v => v.id !== id);
    state.tasks.forEach(v => { if(v.deps.includes(id)){ v.deps = v.deps.filter(d => d !== id); touch(v, 'deps'); } });
    if(linkSource === id) cancelLink();
    save(); render();
  }
```

Link mode = old lines 1586-1621 verbatim, with `resolveDeps()` replaced by `pushDeps()` and `dependsOn` kept as is (it walks `deps`).

- [ ] **Step 3: Feature editor**

`openEditor(id)` fills: `edName`, kind buttons (`edSel.kind`), `edStart = toDateInput(t.start)`, discovery: `edEnd = toDateInput(t.end)`; estimate: `edLikely = rangeWeeks(t).likely`, `edLate = rangeWeeks(t).late`; `edAdo = t.adoId || ''`; deps chips as the old editor. `paintEdKind()` toggles `edEndField` vs `edLikelyField/edLateField`. `edSave`:

```js
    const name = edName.value.trim(); if(name && name !== t.label){ t.label = name; touch(t, 'label'); }
    const start = fromDateInput(edStart.value); if(start === null) return;
    const kindChanged = edSel.kind !== t.kind;
    if(kindChanged){ t.kind = edSel.kind; touch(t, 'meta'); }
    if(edSel.kind === 'discovery'){
      const end = fromDateInput(edEnd.value); if(end === null) return;
      if(start !== t.start || end !== t.end || kindChanged){ t.start = start; t.end = Math.max(start + MIN_DUR, end); delete t.endLikely; touch(t, 'tid'); }
    } else {
      const lw = Math.max(1, parseInt(edLikely.value, 10) || 1), hw = Math.max(lw, parseInt(edLate.value, 10) || lw);
      const el = start + lw * WEEK, en = start + hw * WEEK;
      if(start !== t.start || el !== t.endLikely || en !== t.end || kindChanged){ t.start = start; t.endLikely = el; t.end = en; touch(t, 'tid'); }
    }
    const ado = parseInt(edAdo.value, 10); const newAdo = isFinite(ado) && ado > 0 ? ado : undefined;
    if(t.adoId !== newAdo){ if(newAdo) t.adoId = newAdo; else delete t.adoId; touch(t, 'meta'); }
    const keep = [...document.querySelectorAll('#edDeps .depchip')].map(el => el.dataset.id);
    if(keep.length !== t.deps.length){ t.deps = t.deps.filter(d => keep.includes(d)); touch(t, 'deps'); }
    normalizePlan(state); pushDeps(); save(); render(); closeEditor();
```

`edDelete` -> `confirmDialog('Slette feature', 'Slette «' + t.label + '»? Avhengigheter til den fjernes også.', {danger:true, confirmText:'Slett'})` then `doRemoveTask`. `edLink` -> `closeEditor(); startLink(id)`.

- [ ] **Step 4: Epics: add, edit, delete**

```js
  function addEpic(){
    const key = 'e' + Date.now().toString(36);
    state.lanes.push({ key, name: 'Ny epic', owner: OWNER_DEFAULT, v: 1 });
    delete state.example;
    save(); render(); openEpicEditor(key);
  }
  function openEpicEditor(key){
    const l = getLane(key); if(!l) return;
    epicKey = key; epName.value = l.name; epGoal.value = typeof l.goalDate === 'number' ? toDateInput(l.goalDate) : '';
    epProvisional.checked = !!l.goalProvisional; epAdo.value = l.adoId || ''; epicBack.classList.add('open');
  }
  // epSave: compare name/goalDate/goalProvisional/adoId; on any change assign and bumpLane(l); save(); render(); close
  async function removeEpic(key){
    const l = getLane(key); if(!l) return;
    const n = laneTasks(key).length;
    if(!(await confirmDialog('Slette epic', 'Slette «' + l.name + '»' + (n ? ' og ' + n + ' features under den' : '') + '?', {danger:true, confirmText:'Slett'}))) return;
    laneTasks(key).map(t => t.id).forEach(doRemoveTaskSilent);   // same as doRemoveTask without save/render
    state.deletedLanes[key] = (l.v || 0) + 1;
    state.lanes = state.lanes.filter(v => v.key !== key);
    delete state.example;
    save(); render();
  }
```

- [ ] **Step 5: Persistence, empty state, seed, export, help, resizer, Escape**

Copy the old `setSaveNote / applyRemote / initServerPlan / pushPlan / scheduleServerSave / pollTick` (lines 2034-2138) with these changes: `normalize` -> `normalizePlan`; `resolveDeps()` -> `pushDeps()`; `updateSyncBtn()` removed; `pollTick` skips while `drag || linkSource || editorBack.classList.contains('open') || epicBack.classList.contains('open') || dlgBack.classList.contains('open')`; `initServerPlan` with no server plan does NOT push automatically; instead `showEmpty()`:

```js
  function showEmpty(){
    const empty = !state.lanes.length;
    emptyState.hidden = !empty; gantt.hidden = empty;
    seedBtn.hidden = !(empty && (canWrite || !HOSTED));
    emptyNote.textContent = empty && HOSTED && !canWrite ? 'Kun lesetilgang — be en med skrivetilgang legge inn epics.' : '';
  }
  seedBtn.addEventListener('click', async () => {
    if(!(await confirmDialog('Last inn eksempel', 'Legger inn de sju eksempel-epicene fra ledermøtedecken. Det blir den delte planen for alle.', {confirmText:'Last inn'}))) return;
    state = exampleSeed(); save(); render();
  });
```

`render()` calls `showEmpty()` first and returns early when empty. Export: old `downloadFile` with `exportBtn` -> `downloadFile('skytale-veikart-' + ymd + '.json', JSON.stringify(state, null, 2), 'application/json')`. Help panel toggle, column resizer (old 1998-2033) and the Escape handler (closing dlg, editor, epic editor, link mode in that order) are copied. Boot sequence at the end: `render(); initServerPlan(); if(HOSTED) setInterval(pollTick, 10000);`.

- [ ] **Step 6: Lint the page by loading it**

Run the Task 6 smoke script. Expected: no console errors, all assertions pass.

- [ ] **Step 7: Commit (after GO's OK)**

```bash
git add src/app/timeline/timeline.html src/app/timeline/epic-tools.js
git commit -m "feat(timeline): epic roadmap view - lanes per epic, discovery and estimate bars, goal lines, computed status"
```

---

### Task 6: Headless UI smoke check (file:// mode, no database)

**Files:**
- Create (scratchpad, not in the repo): `/private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad/ui-smoke.mjs`

- [ ] **Step 1: Write the script**

```js
// ui-smoke.mjs: opens timeline.html from disk with Playwright (from ~/ptt-e2e), checks the seed renders,
// drags IAM two weeks and expects Rollebasert tilgang to follow, screenshots before/after.
import { createRequire } from "node:module";
import { mkdirSync, copyFileSync } from "node:fs";
const require = createRequire("/Users/dnumreig/ptt-e2e/package.json");
const { chromium } = require("playwright");
const SRC = "/Users/dnumreig/Skytale/SkyTracker-wt-epics";
const DIR = "/private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad/ui";
mkdirSync(DIR, { recursive: true });
copyFileSync(SRC + "/src/app/timeline/timeline.html", DIR + "/timeline.html");
copyFileSync(SRC + "/src/features/timeline/epic-tools.js", DIR + "/epic-tools.js");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("file://" + DIR + "/timeline.html");
await page.waitForSelector(".lane-label");

const chips = await page.$$eval(".lane-label .chip", (els) => els.map((e) => e.textContent));
console.log("status chips:", chips);
const bars = await page.$$eval(".bar", (els) => els.map((e) => ({ id: e.dataset.id, cls: e.className, left: e.style.left, width: e.style.width })));
console.log("bars:", bars.length, bars.filter((b) => ["iam", "roller", "kapasitet"].includes(b.id)));
await page.screenshot({ path: DIR + "/01-seed.png", fullPage: true });

// drag IAM (discovery) 2 weeks right: Rollebasert tilgang must move with it (dep push on end)
const iam = await page.$('.bar[data-id="iam"]');
const box = await iam.boundingBox();
const monthW = 96, twoWeeks = monthW / 2;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + twoWeeks, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
const after = await page.$$eval(".bar", (els) => Object.fromEntries(els.map((e) => [e.dataset.id, parseFloat(e.style.left)])));
const before = Object.fromEntries(bars.map((b) => [b.id, parseFloat(b.left)]));
console.log("iam moved", before.iam, "->", after.iam, "| roller", before.roller, "->", after.roller);
if (!(after.iam > before.iam && after.roller > before.roller)) throw new Error("dependency push did not move Rollebasert tilgang");
await page.screenshot({ path: DIR + "/02-after-drag.png", fullPage: true });

// feature editor opens from the name
await page.click('.task-label[data-id="kapasitet"] .t');
await page.waitForSelector("#editorBack.open");
console.log("editor likely/late:", await page.inputValue("#edLikely"), await page.inputValue("#edLate"));
await page.screenshot({ path: DIR + "/03-editor.png" });
await browser.close();
if (errors.length) { console.error("page errors:", errors); process.exit(1); }
console.log("OK");
```

- [ ] **Step 2: Run it**

Run: `cd /private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad && node ui-smoke.mjs`
Expected: chips = 6 x "Venter på utredning" + "Gul: i fare" (Telenor), bars 18, iam and roller both moved, editor shows 4 / 7, "OK". Then view the three PNGs with the Read tool and compare with deck slide 23.

---

### Task 7: Full verification and hand-off to GO

- [ ] **Step 1: Run everything**

```bash
cd ~/Skytale/SkyTracker-wt-epics && npx vitest run && npx tsc --noEmit && npx next build
```
Expected: vitest green (~80 tests), tsc clean, build succeeds (the `/timeline`, `/timeline/epic-tools.js`, `/api/timeline-plan` routes listed).

- [ ] **Step 2: Branch state and PR text**

`git status` shows only the intended files. Write the PR body to `~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body.md` (what changed, how to demo, the `epics` row, the backup, nothing about Claude). GO pushes: `! git -C ~/Skytale/SkyTracker-wt-epics push -u fork feat/timeline-epics`; then `gh pr create --repo ksols/SkyTracker --head dnumreig:feat/timeline-epics --title "Timeline: epic roadmap view" --body-file …`. Vercel's check on fork PRs always fails ("Authorization required"), merge anyway.

- [ ] **Step 3: GO's manual pass on the deployed preview or `npm run dev`**

Empty state -> "Last inn eksempel-epics" -> 7 epics; drag Kapasitet's right handle past 15 Dec -> Telenor turns red; set a goal date on an epic -> chip updates; reader account sees no seed button; reload keeps the plan.
