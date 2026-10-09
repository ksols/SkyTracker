import { describe, expect, it } from "vitest";
import {
  WEEK, N_MONTHS, dateToUnit, unitToDate, normalizePlan, epicStatus, resolveDeps,
  rangeLabel, goalText, exampleSeed, STATUS_LABEL,
  isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue,
  shelfTasks, epicCounts, sizeClass, bufferLabel, rawLabel, previewPlacement,
  currentSprint, sprintDay, sprintLabel, progressFraction, progressSignal, epicProgressSignal, progressText,
  resolveQueue, queueFloor, capacityFactor, elapsedWeeks,
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
    const p = normalizePlan({
      lanes: [{ key: "x", name: "X" }],
      tasks: [est({ deps: ["nope", "e"] }), est({ id: "orphan", lane: "gone" })],
    });
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
    expect(resolveDeps(p)).toEqual([{ id: "b", by: "a" }]);
    expect(p.tasks[1]).toMatchObject({ start: 6, endLikely: 7, end: 9 });
  });

  it("chains transitively and is a no-op when already satisfied", () => {
    const p = plan([
      disc({ id: "a", start: 2, end: 3 }),
      est({ id: "b", start: 3, endLikely: 4, end: 5, deps: ["a"] }),
      est({ id: "c", start: 1, endLikely: 2, end: 3, deps: ["b"] }),
    ]);
    expect(resolveDeps(p)).toEqual([{ id: "c", by: "b" }]);
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

describe("exampleSeed(prev) over a plan that was emptied by deletes", () => {
  it("bumps lanes and tasks past the old tombstones so the server merge keeps the seed", async () => {
    const { mergePlans } = await import("./merge");
    const prev = normalizePlan({ lanes: [], tasks: [], deleted: { iam: 3, roller: 1 }, deletedLanes: { org: 2, telenor: 1 } });
    const seed = exampleSeed(prev);
    expect(seed.lanes.find((l) => l.key === "org")!.v).toBe(3);
    expect(seed.lanes.find((l) => l.key === "samtaler")!.v).toBeUndefined();
    expect(seed.tasks.find((t) => t.id === "iam")!.fv).toEqual({ tid: 4 });
    expect(seed.deleted).toEqual({ iam: 3, roller: 1 });
    const merged = mergePlans(prev, seed);
    expect(merged.lanes.map((l) => l.key)).toEqual(seed.lanes.map((l) => l.key));
    expect(merged.tasks.map((t) => t.id)).toEqual(seed.tasks.map((t) => t.id));
  });

  it("without prev the seed is unchanged (no versions, no tombstones)", () => {
    const s = exampleSeed();
    expect(s.lanes.every((l) => l.v === undefined)).toBe(true);
    expect(s.tasks.every((t) => Object.keys(t.fv!).length === 0)).toBe(true);
    expect(s.deleted).toEqual({});
  });
});

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
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [est({ id: "a", lane: "_backlog", state: "aktiv", committedRange: { likely: 4, late: 6, start: 4 }, activatedAt: "2026-11-05" })] });
    expect(p.tasks[0]).toMatchObject({ state: "klar" });
    expect(p.tasks[0]).not.toHaveProperty("committedRange");
    expect(p.tasks[0]).not.toHaveProperty("activatedAt");
  });

  it("deps across the shelf still push, epicStatus ignores the shelf, epic fields are cleaned", () => {
    const p = normalizePlan({
      lanes: [{ key: "x", name: "X", state: "avsluttet", outcome: "nådd", closedReason: " ", assignee: "" }, { key: "y", name: "Y", state: "bogus" }],
      tasks: [est({ id: "a", lane: "_backlog", start: 4, endLikely: 5, end: 6 }), est({ id: "b", lane: "x", start: 4, endLikely: 5, end: 7, deps: ["a"], assignee: "  ", bufferWeeks: -2, raw: { likely: "x" } as unknown as PlanTask["raw"] })],
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

describe("sprints", () => {
  const sprints = [
    { name: "Sprint 70", path: "Skytale\\Sprint 70", start: "2026-09-21", finish: "2026-10-02" },
    { name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-16" },
  ];
  it("currentSprint finds the sprint containing the day, by calendar day, or null", () => {
    expect(currentSprint(sprints, new Date(2026, 9, 9, 23, 59))!.name).toBe("Sprint 71");
    expect(currentSprint(sprints, new Date(2026, 9, 3))).toBeNull();
    expect(currentSprint([], new Date())).toBeNull();
  });
  it("sprintDay counts working days from the start: Fri 9.10 = 5, the weekend stays 5, Mon 12.10 = 6, Fri 16.10 = 10", () => {
    expect(sprintDay(sprints[1], new Date(2026, 9, 5))).toBe(1);
    expect(sprintDay(sprints[1], new Date(2026, 9, 9))).toBe(5);
    expect(sprintDay(sprints[1], new Date(2026, 9, 10))).toBe(5);
    expect(sprintDay(sprints[1], new Date(2026, 9, 12))).toBe(6);
    expect(sprintDay(sprints[1], new Date(2026, 9, 16))).toBe(10);
  });
  it("sprintLabel reads «Sprint 71 · dag 5» and is empty outside every sprint", () => {
    expect(sprintLabel(sprints, new Date(2026, 9, 9))).toBe("Sprint 71 · dag 5");
    expect(sprintLabel(sprints, new Date(2026, 9, 3))).toBe("");
  });
  it("normalizePlan keeps a valid spec folder, sprints and sprint goals, and drops invalid ones", () => {
    const p = normalizePlan({ lanes: [{ key: "a", name: "A" }], tasks: [
      { id: "t1", lane: "a", label: "x", kind: "estimate", start: 2, end: 3, specPath: "Threading" },
      { id: "t2", lane: "a", label: "y", kind: "estimate", start: 2, end: 3, specPath: "../etc" },
    ], sprints: { at: "2026-10-09T08:00:00.000Z", items: sprints }, sprintGoals: { "Sprint 71": { text: "Tråder i beta", at: "2026-10-09T08:00:00.000Z" }, bad: "x" } });
    expect(p.tasks[0].specPath).toBe("Threading");
    expect(p.tasks[1].specPath).toBeUndefined();
    expect(p.sprints!.items.length).toBe(2);
    expect(Object.keys(p.sprintGoals!)).toEqual(["Sprint 71"]);
    expect(normalizePlan({ lanes: [], tasks: [], sprints: "nope", sprintGoals: 3 })).not.toHaveProperty("sprints");
  });
});

describe("progress: the second signal", () => {
  const E = (over: Partial<PlanTask>): PlanTask => est({ start: 4, endLikely: 6, end: 7, state: "aktiv", ...over });   // likely window = 2 months
  it("progressFraction: points first, then percent, else null", () => {
    expect(progressFraction({ pointsDone: 13, pointsTotal: 21, at: "", source: "manuell" })).toBeCloseTo(13 / 21);
    expect(progressFraction({ pct: 60, at: "", source: "manuell" })).toBe(0.6);
    expect(progressFraction({ pointsDone: 0, pointsTotal: 0, at: "", source: "manuell" })).toBeNull();
    expect(progressFraction(undefined)).toBeNull();
  });
  it("green when progress keeps up with time (10 % slack), yellow when behind, red after the late end while not delivered", () => {
    expect(progressSignal(E({ progress: { pct: 50, at: "", source: "manuell" } }), 5)).toMatchObject({ code: "gronn", done: 0.5, elapsed: 0.5 });
    expect(progressSignal(E({ progress: { pct: 45, at: "", source: "manuell" } }), 5)!.code).toBe("gronn");
    expect(progressSignal(E({ progress: { pct: 30, at: "", source: "manuell" } }), 5)!.code).toBe("gul");
    expect(progressSignal(E({ progress: { pct: 30, at: "", source: "manuell" } }), 7.5)!.code).toBe("rod");
    expect(progressSignal(E({ progress: { pct: 100, at: "", source: "manuell" } }), 7.5)!.code).toBe("gronn");
  });
  it("no signal without progress, before the start, for discoveries, for delivered features", () => {
    expect(progressSignal(E({}), 5)).toBeNull();
    expect(progressSignal(E({ progress: { pct: 50, at: "", source: "manuell" } }), 3)).toBeNull();
    expect(progressSignal(disc({ progress: { pct: 50, at: "", source: "manuell" } }), 2.5)).toBeNull();
    expect(progressSignal(E({ state: "levert", deliveredAt: "2026-12-03", progress: { pct: 50, at: "", source: "manuell" } }), 7.5)).toBeNull();
  });
  it("the epic's signal is the worst of its features; null when none has progress", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [E({ id: "a", progress: { pct: 50, at: "", source: "manuell" } }), E({ id: "b", progress: { pct: 10, at: "", source: "manuell" } }), E({ id: "c" })] });
    expect(epicProgressSignal(p, "x", 5)).toBe("gul");
    expect(epicProgressSignal(normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [E({ id: "c" })] }), "x", 5)).toBeNull();
  });
  it("progressText and the normaliser", () => {
    const t = E({ progress: { pointsDone: 13, pointsTotal: 21, at: "", source: "manuell" } });
    expect(progressText(t, progressSignal(t, 5)!)).toBe("fremdrift 62 % · tid 50 %");
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [
      E({ id: "ok", progress: { pct: 60, at: "2026-10-09", source: "ado" } }),
      E({ id: "bad", progress: { pct: 140, at: "2026-10-09", source: "manuell" } }),
      E({ id: "src", progress: { pointsDone: 2, pointsTotal: 5, at: "x", source: "nope" as never } }),
    ] });
    expect(p.tasks.find((t) => t.id === "ok")!.progress!.source).toBe("ado");
    expect(p.tasks.find((t) => t.id === "bad")!.progress).toBeUndefined();
    expect(p.tasks.find((t) => t.id === "src")!.progress!.source).toBe("manuell");
  });
});

describe("resolveQueue: blockers first, then the same developer's earlier work", () => {
  const S = 4;
  const A = (over: Partial<PlanTask> = {}) => est({ id: "a", lane: "x", label: "A", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 1, ...over });
  const B = (over: Partial<PlanTask> = {}) => est({ id: "b", lane: "x", label: "B", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 2, ...over });
  const C = (over: Partial<PlanTask> = {}) => est({ id: "c", lane: "y", label: "C", start: S, endLikely: S + 0.5, end: S + 1, state: "aktiv", assignee: "KSO", deps: ["a"], order: 1, ...over });
  const two = (tasks: PlanTask[]) => normalizePlan({ lanes: [{ key: "x", name: "X", priority: 1 }, { key: "y", name: "Y", priority: 2 }], tasks });
  const startOf = (p: Plan, id: string) => p.tasks.find((t) => t.id === id)!.start;
  it("B waits for A (same developer, earlier in the order); C waits for its blocker A; the causes name them", () => {
    const p = two([A(), B(), C()]);
    expect(resolveQueue(p)).toEqual([{ id: "b", by: "a", kind: "queue" }, { id: "c", by: "a", kind: "dep" }]);
    expect(startOf(p, "b")).toBeCloseTo(S + 1.5);
    expect(startOf(p, "c")).toBeCloseTo(S + 1.5);
    expect(resolveQueue(p)).toEqual([]);
  });
  it("priority decides who is earlier: the higher-priority epic's feature keeps its start even if it was drawn later", () => {
    const p = two([A({ lane: "y", order: 1, start: S + 2, endLikely: S + 3, end: S + 3.5 }), B({ lane: "x" })]);
    resolveQueue(p);
    expect(startOf(p, "b")).toBeCloseTo(S);
    expect(startOf(p, "a")).toBeCloseTo(S + 2);
    const q = two([A({ lane: "y", order: 1 }), B({ lane: "x" })]);
    resolveQueue(q);
    expect(startOf(q, "a")).toBeCloseTo(S + 1.5);
  });
  it("a pinned feature stays below its floor and still delays the developer's later features; no assignee → only blockers count", () => {
    const p = two([A(), B({ pinned: true }), est({ id: "d", lane: "x", label: "D", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 3 })]);
    expect(resolveQueue(p).map((m) => [m.id, m.by])).toEqual([["d", "b"]]);
    expect(startOf(p, "b")).toBeCloseTo(S);
    expect(startOf(p, "d")).toBeCloseTo(S + 1.5);
    expect(resolveQueue(two([A(), B({ assignee: undefined })]))).toEqual([]);
    expect(queueFloor(p, "b")).toEqual({ floor: S + 1.5, by: "a", kind: "queue" });
    expect(queueFloor(p, "a")).toEqual({ floor: null, by: null, kind: null });
  });
  it("discoveries, shelf and delivered features are left alone; resolveDeps still reports only the blockers", () => {
    const p = two([A(), disc({ id: "u", lane: "x", assignee: "THM", start: S, end: S + 0.5, order: 2 }), B({ lane: "_backlog" }), est({ id: "l", lane: "x", label: "L", start: S, endLikely: S + 1, end: S + 1.5, state: "levert", deliveredAt: "2026-11-01", assignee: "THM", order: 3 })]);
    expect(resolveQueue(p)).toEqual([]);
    expect(resolveDeps(two([A(), B(), C()]))).toEqual([{ id: "c", by: "a" }]);
  });
  it("capacityFactor from the sprint mix, elapsedWeeks, and the normaliser's pinned/capacity", () => {
    expect(capacityFactor({ lanes: [], tasks: [] })).toBe(1.82);
    expect(capacityFactor({ lanes: [], tasks: [], capacity: { mode: "normal", at: "x" } })).toBe(1.67);
    expect(elapsedWeeks(4, 1.82)).toBe(8);
    expect(elapsedWeeks(6, 1.67)).toBe(11);
    expect(normalizePlan({ lanes: [], tasks: [], capacity: { mode: "nope", at: "x" } }).capacity).toBeUndefined();
    expect(normalizePlan({ lanes: [], tasks: [], capacity: { mode: "normal", at: "x" } }).capacity).toEqual({ mode: "normal", at: "x" });
    const t = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [est({ pinned: 1 as never }), est({ id: "f", pinned: false })] }).tasks;
    expect(t[0].pinned).toBe(true);
    expect(t[1].pinned).toBeUndefined();
  });
});
