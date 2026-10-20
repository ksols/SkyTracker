import { describe, expect, it } from "vitest";
import {
  WEEK, N_MONTHS, dateToUnit, unitToDate, normalizePlan, epicStatus, resolveDeps,
  rangeLabel, goalText, exampleSeed, STATUS_LABEL,
  isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue,
  shelfTasks, epicCounts, sizeClass, bufferLabel, rawLabel, previewPlacement,
  currentSprint, sprintDay, sprintLabel, progressFraction, progressSignal, epicProgressSignal, progressText,
  resolveQueue, queueFloor, capacityFactor, elapsedWeeks, wishesByStatus, WISH_STATUS_LABEL, WISH_SOURCE_LABEL, sizeClassDerived, sizeClassText, FEATURE_TYPE_LABEL, AREAS,
  dayToUnit, releaseSegments, releaseProgress, releaseScope, releaseItemDone, releaseItemClosed,
  workDays, workDaysBetween, addWorkDays, calendarDays, releaseStartDay, releasePace, nextReleaseText, releaseStateCounts, releaseSprintText, releaseBurndownData, dayKey,
  releaseForecastText, focusKey, restoreFocus, releaseDevTarget, releasePhase, releaseExpected, releaseExpectedLate, releaseQaText,
  BACKLOG, canMarkDelivered, markDelivered, canRestartDiscovery, applyLaneChange, boardColumn, featureTransition,
  navTabsHtml, epicStatusWords, forumBaseline, forumDefault,
  osloDay, osloDate,
  DELIVERY_WORD, deliveryOwner, deliveryCustomersText, deliveryParts, deliveryComputed, deliveryStatus, deliveryUnlabelled, deliveryBugsLeft, deliveryPartsText, deliveryLines, epicCustomers, epicCustomersText, epicWeight, deliverySegments, deliveryInvestor, deliveryRows,
  nextSprint, budgetShare, sprintRangeText, dueFeatureIds, sprintDue, sprintInWork, slipCost, slipCostText, healthForecast, budgetText, healthStripText, releaseLeftOutText, sprintCheckMarkdown, nextRelease,
} from "./epic-tools.js";
import type { Delivery, Plan, PlanTask, Sprint, SprintCheck } from "./merge";

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

  it("a shared priority sorts by name (Norwegian order), nothing is renumbered", () => {
    const p = normalizePlan({ lanes: [{ key: "b", name: "Øst", priority: 1 }, { key: "a", name: "Beta", priority: 2 }, { key: "c", name: "Alfa", priority: 1 }, { key: "d", name: "ærlig", priority: 1 }], tasks: [] });
    expect(p.lanes.map((l) => [l.key, l.priority])).toEqual([["c", 1], ["d", 1], ["b", 1], ["a", 2]]);
  });

  it("a priority that is not a whole number from 1 is set after the highest", () => {
    const p = normalizePlan({ lanes: [{ key: "a", name: "A", priority: 0 }, { key: "b", name: "B", priority: 2 }, { key: "c", name: "C", priority: 1.5 }], tasks: [] });
    expect(p.lanes.map((l) => [l.key, l.priority])).toEqual([["b", 2], ["a", 3], ["c", 4]]);
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
    expect(pv).toMatchObject({ before: "gronn", after: "rod", window: expect.stringMatching(/^Leveres uke \d+–\d+$/) });
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
  it("a discovery of the same owner occupies them (R8); the shelf and delivered features are left alone; resolveDeps still reports only the blockers", () => {
    const p = two([A(), disc({ id: "u", lane: "x", assignee: "THM", start: S, end: S + 0.5, order: 2 }), B({ lane: "_backlog" }), est({ id: "l", lane: "x", label: "L", start: S, endLikely: S + 1, end: S + 1.5, state: "levert", assignee: "THM", order: 3 })]);
    expect(resolveQueue(p)).toEqual([{ id: "a", by: "u", kind: "queue" }]);
    expect(startOf(p, "a")).toBeCloseTo(S + 0.5);
    expect(startOf(p, "b")).toBeCloseTo(S);
    expect(startOf(p, "l")).toBeCloseTo(S);
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

describe("previewPlacement with the queue (stage 6)", () => {
  it("places after the developer's queued work with the factor applied, lists what it pushes and the epics that change colour", () => {
    const S = 4;
    const p = normalizePlan({
      lanes: [{ key: "x", name: "X", priority: 1, goalDate: S + 2.6 }, { key: "y", name: "Y", priority: 2, goalDate: S + 2.6 }],
      tasks: [
        est({ id: "busy", lane: "x", label: "Busy", start: S, endLikely: S + 1.5, end: S + 2, state: "aktiv", assignee: "THM", order: 1 }),
        est({ id: "later", lane: "y", label: "Later", start: S + 2, endLikely: S + 2.25, end: S + 2.5, state: "aktiv", assignee: "THM", order: 1 }),
        est({ id: "wish", lane: "_backlog", label: "Wish", start: S, endLikely: S + 1, end: S + 1.5, state: "klar", assignee: "THM", raw: { likely: 4, late: 6 } }),
      ],
    });
    const pv = previewPlacement(p, "wish", "x")!;
    expect(pv.after).toBe("rod");                                   // 8–11 elapsed weeks after Busy's late end run past the goal
    expect(pv.featureWindow).toMatch(/^uke \d+–\d+$/);
    expect(pv.featureStart).toBeCloseTo(S + 2);                    // after Busy (same developer, earlier in the order)
    expect(pv.featureWeeks).toEqual({ likely: 8, late: 11 });      // 4–6 raw weeks × 1.82, rounded up, no buffer
    expect(pv.pushed).toEqual([{ id: "later", label: "Later", laneKey: "y", weeks: 11 }]);   // Later waits for Wish's late end: 2.75 units = 11 weeks
    expect(pv.epics).toEqual([{ key: "y", name: "Y", before: "gronn", after: "rod" }]);
    const quiet = previewPlacement(p, "wish", "y")!;               // dropped last in Y: still after Busy, pushes nothing
    expect(quiet.pushed).toEqual([]);
    expect(quiet.epics).toEqual([]);
  });
});

describe("normalizePlan: wishes", () => {
  it("keeps well-formed wishes, defaults status and source, drops the malformed ones, and groups by status", () => {
    const p = normalizePlan({ lanes: [], tasks: [], deleted: {}, wishes: [
      { id: "w1", title: "Kontaktkort for bedrifter", source: "kunde", askedBy: "Telenor", askedOn: "2026-10-01", registeredBy: "PreSales", registeredAt: "2026-10-02T10:00:00.000Z" },
      { id: "w2", title: "Noe", status: "utred", source: "tull", owner: "thm", sizeClass: "M", featureId: "f1" },
      { id: "w3", title: "   " }, { title: "uten id" }, "junk", { id: "w4", title: "Nei-sak", status: "nei", reason: "Utenfor strategien" },
    ] });
    expect(p.wishes!.map((w) => w.id)).toEqual(["w1", "w2", "w4"]);
    expect(p.wishes![0].status).toBe("ubehandlet");
    expect(p.wishes![1].source).toBe("annet");
    expect(p.wishes![1].owner).toBe("THM");
    expect(p.deletedWishes).toEqual({});
    const g = wishesByStatus(p);
    expect(g.ubehandlet.map((w) => w.id)).toEqual(["w1"]);
    expect(g.utred.map((w) => w.id)).toEqual(["w2"]);
    expect(g.nei.map((w) => w.id)).toEqual(["w4"]);
    expect(WISH_STATUS_LABEL.utred).toBe("Utred nå");
    expect(WISH_SOURCE_LABEL.kunde).toBe("Kunde");
  });
});

describe("R8: size classes", () => {
  const S = 4;
  const d = (over: Partial<PlanTask> = {}) => disc({ id: "d", lane: "x", assignee: "THM", start: S, end: S + 0.5, ...over });
  it("the stored class is the promise; the derived one is what the dates say; the text shows the drift", () => {
    expect(sizeClass(d())).toBe("M");
    expect(sizeClass(d({ sizeClass: "S" }))).toBe("S");
    expect(sizeClassDerived(d({ sizeClass: "S" }))).toBe("M");
    expect(sizeClassText(d({ sizeClass: "S" }))).toBe("S, nå M");
    expect(sizeClassText(d({ sizeClass: "M" }))).toBe("M");
    expect(sizeClassText(d())).toBe("M");
    expect(sizeClassText(d({ end: S + 1.5, sizeClass: "L" }))).toBe("L, nå XL");
    expect(sizeClassText(est({ sizeClass: "M" } as Partial<PlanTask>))).toBe("");
    expect(normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [d({ sizeClass: "XXL" as never })] }).tasks[0].sizeClass).toBeUndefined();
  });
});

describe("R8: a discovery occupies its owner", () => {
  const S = 4;
  const lanes = [{ key: "x", name: "X", priority: 1 }, { key: "y", name: "Y", priority: 2 }];
  const F = (over: Partial<PlanTask> = {}) => est({ id: "f", lane: "x", label: "F", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 1, ...over });
  const D = (over: Partial<PlanTask> = {}) => disc({ id: "d", lane: "y", label: "D", assignee: "THM", start: S + 0.25, end: S + 0.75, order: 1, ...over });
  const mk = (tasks: PlanTask[]) => normalizePlan({ lanes, tasks });
  const startOf = (p: Plan, id: string) => p.tasks.find((t) => t.id === id)!.start;
  it("a feature that overlaps the owner's discovery starts when the discovery ends; the discovery stays", () => {
    const p = mk([F(), D()]);
    expect(resolveQueue(p)).toEqual([{ id: "f", by: "d", kind: "queue" }]);
    expect(startOf(p, "f")).toBeCloseTo(S + 0.75);
    expect(startOf(p, "d")).toBeCloseTo(S + 0.25);
    expect(queueFloor(p, "f")).toEqual({ floor: S + 0.75, by: "d", kind: "queue" });
  });
  it("a discovery far ahead leaves today's feature alone; a discovery without an owner occupies no one", () => {
    expect(resolveQueue(mk([F(), D({ start: S + 6, end: S + 6.5 })]))).toEqual([]);
    expect(resolveQueue(mk([F(), D({ assignee: undefined })]))).toEqual([]);
    expect(resolveQueue(mk([F({ assignee: "KSO" }), D()]))).toEqual([]);
  });
  it("two overlapping discoveries of one owner run one after the other, by start", () => {
    const p = mk([D({ id: "d1", start: S, end: S + 0.5 }), D({ id: "d2", start: S + 0.25, end: S + 1 })]);
    expect(resolveQueue(p)).toEqual([{ id: "d2", by: "d1", kind: "queue" }]);
    expect(startOf(p, "d2")).toBeCloseTo(S + 0.5);
    expect(p.tasks.find((t) => t.id === "d2")!.end).toBeCloseTo(S + 1.25);
  });
  it("discoveries of one owner run in the order they were started: a new one starting today queues behind an older one already pushed", () => {
    const p = mk([D({ id: "old", start: S + 0.5, end: S + 1, startedAt: "2026-10-01T10:00:00.000Z" }), D({ id: "fresh", start: S, end: S + 0.5, startedAt: "2026-10-09T10:00:00.000Z" })]);
    expect(resolveQueue(p)).toEqual([{ id: "fresh", by: "old", kind: "queue" }]);
    expect(startOf(p, "old")).toBeCloseTo(S + 0.5);
    expect(startOf(p, "fresh")).toBeCloseTo(S + 1);
    expect(normalizePlan({ lanes, tasks: [D({ startedAt: 7 as never })] }).tasks[0].startedAt).toBeUndefined();
  });
  it("a feature pushed past one discovery lands after the next one too; the pin keeps it where it was dragged", () => {
    const p = mk([F(), D({ id: "d1" }), D({ id: "d2", start: S + 0.75, end: S + 1.25 })]);
    resolveQueue(p);
    expect(startOf(p, "f")).toBeCloseTo(S + 1.25);
    const q = mk([F({ pinned: true }), D()]);
    expect(resolveQueue(q)).toEqual([]);
    expect(startOf(q, "f")).toBeCloseTo(S);
  });
  it("blockers still come first for a discovery", () => {
    const p = mk([F({ assignee: "KSO" }), D({ deps: ["f"], assignee: undefined })]);
    expect(resolveQueue(p)).toEqual([{ id: "d", by: "f", kind: "dep" }]);
    expect(startOf(p, "d")).toBeCloseTo(S + 1.5);
  });
});

describe("R9: the four attributes from the old board", () => {
  it("normalises type, areas (canonical names, deduplicated, in order) and the fixed end", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [
      est({ type: "teknisk", areas: ["frontend", "Backend", "frontend", "Nope", "ios"], fixedEnd: 1 } as unknown as Partial<PlanTask>),
      est({ id: "g", type: "nope", areas: "x", fixedEnd: false } as unknown as Partial<PlanTask>),
    ] });
    expect(p.tasks[0].type).toBe("teknisk");
    expect(p.tasks[0].areas).toEqual(["Backend", "Frontend", "iOS"]);
    expect(p.tasks[0].fixedEnd).toBe(true);
    expect(p.tasks[1].type).toBeUndefined();
    expect(p.tasks[1].areas).toBeUndefined();
    expect(p.tasks[1].fixedEnd).toBeUndefined();
    expect(FEATURE_TYPE_LABEL.vedlikehold).toBe("Vedlikehold");
    expect(AREAS).toEqual(["Backend", "Frontend", "iOS", "Android", "Desktop", "Admin"]);
  });
  it("a fixed-end feature is never shifted by the queue, yet the owner's next feature waits for it", () => {
    const S = 4;
    const p = normalizePlan({ lanes: [{ key: "x", name: "X", priority: 1 }], tasks: [
      est({ id: "a", lane: "x", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 1 }),
      est({ id: "b", lane: "x", start: S + 0.5, endLikely: S + 1.5, end: S + 2, state: "aktiv", assignee: "THM", order: 2, fixedEnd: true } as Partial<PlanTask>),
      est({ id: "c", lane: "x", start: S, endLikely: S + 1, end: S + 1.5, state: "aktiv", assignee: "THM", order: 3 }),
    ] });
    expect(resolveQueue(p)).toEqual([{ id: "c", by: "b", kind: "queue" }]);
    expect(p.tasks.find((t) => t.id === "b")!.start).toBeCloseTo(S + 0.5);
    expect(p.tasks.find((t) => t.id === "c")!.start).toBeCloseTo(S + 2);
  });
});

describe("releases (R10): the normaliser, the band segments and the progress text", () => {
  const rel = (over: Record<string, unknown>) => ({ key: "r1", version: "2.0.1", targetDate: "2026-10-22", ...over });
  it("keeps a release with key, version and a valid target day, drops the rest, sorts by end day", () => {
    const p = normalizePlan({ lanes: [], tasks: [], releases: [
      rel({ key: "r2", version: "2.0.2", targetDate: "2026-11-12", v: 3, note: " patch to ", label: "2.0.2+ota.1", shippedDate: "not-a-day" }),
      rel({}),
      rel({ key: "r3", version: "", targetDate: "2026-12-01" }),
      rel({ key: "r4", version: "1.9", targetDate: "2026-13-45" }),
      rel({ key: "r0", version: "2.0.0", targetDate: "2026-10-30", shippedDate: "2026-10-07" }),
      null,
    ], deletedReleases: { gone: 2 } });
    expect(p.releases!.map((r) => r.key)).toEqual(["r0", "r1", "r2"]);   // r0 ends on its shipped day, before r1's target
    expect(p.releases![2]).toEqual({ key: "r2", v: 3, version: "2.0.2", targetDate: "2026-11-12", note: "patch to", label: "2.0.2+ota.1" });
    expect(p.releases![1]).toEqual({ key: "r1", v: 0, version: "2.0.1", targetDate: "2026-10-22" });
    expect(p.deletedReleases).toEqual({ gone: 2 });
    expect(normalizePlan({ lanes: [], tasks: [] }).releases).toEqual([]);
  });
  it("keeps the ADO read-back only when it has a time and an items array; items are cleaned", () => {
    const p = normalizePlan({ lanes: [], tasks: [], releases: [
      rel({ ado: { at: "2026-10-12T20:00:00.000Z", label: "2.0.1", items: [{ id: 4536, type: "Bug", title: "Nav bar", state: "New", points: 8, assignee: "THM" }, { id: 4804, type: "Weird", title: "Receipts", state: "Closed", points: "x" }, "junk"] } }),
      rel({ key: "r2", ado: { items: [] } }),
    ] });
    expect(p.releases![0].ado).toEqual({ at: "2026-10-12T20:00:00.000Z", label: "2.0.1", items: [
      { id: 4536, type: "Bug", title: "Nav bar", state: "New", points: 8, assignee: "THM" },
      { id: 4804, type: "User Story", title: "Receipts", state: "Closed", points: 0, assignee: null },
    ] });
    expect(p.releases![1].ado).toBeUndefined();
  });
  it("segments: each release starts where the previous one ends, the first two weeks before its end; shipped and overdue flags", () => {
    const p = normalizePlan({ lanes: [], tasks: [], releases: [rel({ key: "b", version: "2.0.1", targetDate: "2026-10-22" }), rel({ key: "a", version: "2.0.0", targetDate: "2026-10-01", shippedDate: "2026-10-07" })] });
    const today = dayToUnit("2026-10-12");
    const s = releaseSegments(p, today);
    expect(s.map((x) => x.release.version)).toEqual(["2.0.0", "2.0.1"]);
    expect(s[0].end).toBeCloseTo(dayToUnit("2026-10-07"), 6);
    expect(s[0].start).toBeCloseTo(s[0].end - 2 * WEEK, 6);
    expect(s[1].start).toBeCloseTo(s[0].end, 6);
    expect(s[1].end).toBeCloseTo(dayToUnit("2026-10-22"), 6);
    expect([s[0].shipped, s[0].overdue, s[1].shipped, s[1].overdue]).toEqual([true, false, false, false]);
    expect(releaseSegments(p, dayToUnit("2026-10-30"))[1].overdue).toBe(true);
  });
  it("progress: points done over points total, the counts in words; items without points count by number; nothing read = no fraction", () => {
    const items = [
      { id: 1, type: "Bug", title: "a", state: "Closed", points: 5, assignee: null }, { id: 2, type: "Bug", title: "b", state: "Active", points: 3, assignee: null },
      { id: 3, type: "User Story", title: "c", state: "Resolved", points: 2, assignee: null },
    ];
    const r = normalizePlan({ lanes: [], tasks: [], releases: [rel({ ado: { at: "2026-10-12T20:00:00.000Z", label: "2.0.1", items } })] }).releases![0];
    expect(releaseProgress(r)).toMatchObject({ fraction: 0.7, text: "2 bugs, 1 story · 7/10 SP utviklet", bugs: 2, stories: 1, done: 2, total: 3, pointsDone: 7, pointsTotal: 10 });
    const noPoints = normalizePlan({ lanes: [], tasks: [], releases: [rel({ ado: { at: "x", label: "2.0.1", items: items.map((i) => ({ ...i, points: 0 })) } })] }).releases![0];
    expect(releaseProgress(noPoints)).toMatchObject({ fraction: 2 / 3, text: "2 bugs, 1 story · 2 av 3 utviklet" });
    expect(releaseProgress(normalizePlan({ lanes: [], tasks: [], releases: [rel({})] }).releases![0])).toMatchObject({ fraction: null, text: "ikke lest fra ADO" });
    expect(releaseScope(rel({ label: "2.0.1+ota.2" }) as never)).toBe("2.0.1+ota.2");
    expect(releaseScope(rel({}) as never)).toBe("2.0.1");
  });
});

describe("exampleSeed over an earlier copy of its own features", () => {
  it("bumps every field group past the copy that is still in the plan, so the example wins the merge and its features return to their epics", () => {
    const prev = normalizePlan({ lanes: [], tasks: [{ id: "iam", lane: "_backlog", label: "IAM: brukerlivsløp", kind: "discovery", start: 2, end: 2.5, state: "utredes", deps: [], fv: { meta: 3, tid: 1 } }], deleted: {}, deletedLanes: { org: 2 } });
    const seed = exampleSeed(prev);
    const iam = seed.tasks.find((t) => t.id === "iam")!;
    expect(iam.lane).toBe("org");
    expect(iam.fv!.meta).toBeGreaterThan(3);
    expect(iam.fv!.tid).toBeGreaterThan(1);
    expect(seed.lanes.find((l) => l.key === "org")!.v).toBe(3);
  });
});

describe("R11: working days", () => {
  it("counts Mon–Fri inclusive, skips weekends, steps forward over them, and counts calendar days signed", () => {
    expect(workDays("2026-10-05", "2026-10-12")).toBe(6);        // Mon 5 … Mon 12
    expect(workDays("2026-10-10", "2026-10-11")).toBe(0);        // a weekend
    expect(workDays("2026-10-12", "2026-10-05")).toBe(0);
    expect(workDaysBetween("2026-10-22", "2026-10-27")).toBe(3); // Thu → Fri, Mon, Tue
    expect(workDaysBetween("2026-10-22", "2026-10-22")).toBe(0);
    expect(workDaysBetween("2026-10-24", "2026-10-27")).toBe(2); // from a Saturday: Mon, Tue
    expect(addWorkDays("2026-10-22", 3)).toBe("2026-10-27");
    expect(addWorkDays("2026-10-09", 1)).toBe("2026-10-12");     // Friday + 1 = Monday
    expect(addWorkDays("2026-10-09", 0)).toBe("2026-10-09");
    expect(calendarDays("2026-10-12", "2026-10-22")).toBe(10);
    expect(calendarDays("2026-10-22", "2026-10-12")).toBe(-10);
  });
});

describe("R11: the tempo of a release", () => {
  const items = (done: number[], open: number[], delivered = "2026-10-09") => [
    ...done.map((p, i) => ({ id: 100 + i, type: "Bug", title: "d" + i, state: "Closed", points: p, assignee: null, iteration: "Sprint 71", delivered })),
    ...open.map((p, i) => ({ id: 200 + i, type: "User Story", title: "o" + i, state: "Active", points: p, assignee: null, iteration: "Sprint 71" })),
  ];
  const sprints = { at: "2026-10-12T00:00:00.000Z", items: [{ name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-23" }] };
  const hist = (days: string[]) => days.map((day) => ({ day, pointsDone: 10, pointsTotal: 79, done: 1, total: 2 }));
  const mk = (ado: Record<string, unknown> | undefined, over: Record<string, unknown> = {}) => {
    const p = normalizePlan({ lanes: [], tasks: [], sprints, releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-22", ...(ado ? { ado: { at: "2026-10-12T10:00:00.000Z", label: "2.0.1", ...ado } } : {}), ...over }] });
    return { p, r: p.releases![0] };
  };
  it("the clock starts at the oldest sprint among the items, else two weeks before the target", () => {
    const a = mk({ items: items([10], [69]) });
    expect(releaseStartDay(a.p, a.r)).toBe("2026-10-05");
    const b = mk({ items: items([10], [69]).map((i) => ({ ...i, iteration: "Sprint 99" })) }, { targetDate: "2026-11-12" });
    expect(releaseStartDay(b.p, b.r)).toBe("2026-10-28");
  });
  it("the clock starts no earlier than the first reading that found the label: the scope did not exist before it", () => {
    const c = mk({ items: items([], [82]), history: hist(["2026-10-12"]) });   // 2.0.1: stamped on 12.10, a week into Sprint 71
    expect(releaseStartDay(c.p, c.r)).toBe("2026-10-12");
    const empty = { day: "2026-10-09", pointsDone: 0, pointsTotal: 0, done: 0, total: 0 };   // read before anything carried the label
    const d = mk({ items: items([], [82]), history: [empty, ...hist(["2026-10-13"])] });
    expect(releaseStartDay(d.p, d.r)).toBe("2026-10-13");
    const e = mk({ items: items([], [82]).map((i) => ({ ...i, iteration: "Sprint 99" })), history: hist(["2026-10-12"]) }, { targetDate: "2026-11-12" });
    expect(releaseStartDay(e.p, e.r)).toBe("2026-10-28");   // a later sprint start still wins
  });
  it("day one of a short release is green with nothing delivered: the straight line allows one working day, at least 10 %", () => {
    const c = mk({ items: items([], [82]), history: hist(["2026-10-13"]) });   // 13.10–22.10: eight working days
    expect(releasePace(c.p, c.r, "2026-10-13")).toMatchObject({ code: "gronn", startDay: "2026-10-13", elapsedDays: 1, totalDays: 8, tempo: null });
    expect(releasePace(c.p, c.r, "2026-10-13")!.text).toBe("0 % utviklet · 13 % av tiden brukt · ingenting utviklet ennå");
    expect(releasePace(c.p, c.r, "2026-10-14")!.code).toBe("gul");   // two days in, nothing delivered
  });
  it("the straight line until something is delivered after the start: green when delivered keeps up with the time used, yellow behind, red past the target", () => {
    const today = "2026-10-12";   // 6 of 14 working days from 5.10 to 22.10
    const g = mk({ items: items([30], [49], "2026-10-02"), history: hist(["2026-10-05"]) });   // 38 % delivered, all of it before the start; 43 % of the time
    expect(releasePace(g.p, g.r, today)).toMatchObject({ code: "gronn", tempo: null, forecastDay: null, elapsedDays: 6, totalDays: 14, startDay: "2026-10-05" });
    expect(releasePace(g.p, g.r, today)!.text).toBe("38 % utviklet · 43 % av tiden brukt · ingenting utviklet siden 5. okt");
    const y = mk({ items: items([10], [69], "2026-10-02"), history: hist(["2026-10-05"]) });   // 13 % delivered
    expect(releasePace(y.p, y.r, today)!.code).toBe("gul");
    expect(releasePace(y.p, y.r, "2026-10-23")!.code).toBe("rod");   // the target day is past
    expect(releasePace(y.p, y.r, "2026-10-01")).toMatchObject({ code: "gronn", elapsed: 0, elapsedDays: 0 });   // today before the start
  });
  it("the tempo decides once something is delivered after the start: units per working day since the start, the finish in working days, three days of yellow", () => {
    const today = "2026-10-12";
    const two = hist(["2026-10-05"]);   // one reading is enough: the delivered days say when
    const late = mk({ items: items([10], [69]), history: two });   // 10 SP in 6 days: 69 left needs 42 more → 9 Dec
    const lp = releasePace(late.p, late.r, today)!;
    expect(lp).toMatchObject({ code: "rod", readings: 1, forecastDay: "2026-12-09", deltaDays: 34 });
    expect(lp.tempo).toBeCloseTo(10 / 6);
    expect(lp.text).toBe("13 % utviklet · 43 % av tiden brukt · med dagens tempo ferdig 9. des, 34 arbeidsdager etter målet");
    const ok = mk({ items: items([42], [37]), history: two });   // 7/day: 37 left → 6 more → 20 Oct, two days before
    expect(releasePace(ok.p, ok.r, today)).toMatchObject({ code: "gronn", forecastDay: "2026-10-20", deltaDays: -2 });
    expect(releasePace(ok.p, ok.r, today)!.text).toBe("53 % utviklet · 43 % av tiden brukt · med dagens tempo ferdig 20. okt, to arbeidsdager før målet");
    const yel = mk({ items: items([30], [49]), history: two });   // 5/day: 49 left → 10 more → 26 Oct, two days after
    expect(releasePace(yel.p, yel.r, today)).toMatchObject({ code: "gul", forecastDay: "2026-10-26", deltaDays: 2 });
    const three = mk({ items: items([28], [51]), history: two }); // 4.67/day: 51 left → 11 more → 27 Oct, three days after: still yellow
    expect(releasePace(three.p, three.r, today)).toMatchObject({ code: "gul", forecastDay: "2026-10-27", deltaDays: 3 });
    const four = mk({ items: items([27], [52]), history: two });  // 4.5/day: 52 left → 12 more → 28 Oct, four days after: red
    expect(releasePace(four.p, four.r, today)).toMatchObject({ code: "rod", forecastDay: "2026-10-28", deltaDays: 4 });
    const onIt = mk({ items: items([34], [45]), history: two });  // 5.67/day: 45 left → 8 more → 22 Oct, on the target
    expect(releasePace(onIt.p, onIt.r, today)!.text).toContain("ferdig 22. okt, på målet");
  });
  it("points delivered before the start count as delivered but not in the tempo", () => {
    const today = "2026-10-12";
    const its = [...items([10], [], "2026-10-02"), ...items([20], [49]).map((i) => ({ ...i, id: i.id + 50 }))];   // 10 before the start, 20 after
    const m = mk({ items: its, history: hist(["2026-10-05"]) });
    const pace = releasePace(m.p, m.r, today)!;
    expect(pace.done).toBeCloseTo(30 / 79);
    expect(pace.tempo).toBeCloseTo(20 / 6);   // 49 left at 3.33/day → 15 more → 2 Nov
    expect(pace).toMatchObject({ code: "rod", forecastDay: "2026-11-02", deltaDays: 7 });
  });
  it("no pace when shipped, unread or empty; everything delivered is green and says so; two readings with nothing delivered say so", () => {
    const shipped = mk({ items: items([10], [69]), history: hist(["2026-10-12"]) }, { shippedDate: "2026-10-22" });
    expect(releasePace(shipped.p, shipped.r, "2026-10-23")).toBeNull();
    const unread = mk(undefined);
    expect(releasePace(unread.p, unread.r, "2026-10-12")).toBeNull();
    const empty = mk({ items: [] });
    expect(releasePace(empty.p, empty.r, "2026-10-12")).toBeNull();
    const all = mk({ items: items([79], []), history: hist(["2026-10-05", "2026-10-12"]) });
    expect(releasePace(all.p, all.r, "2026-10-12")).toMatchObject({ code: "gronn", forecastDay: null });
    expect(releasePace(all.p, all.r, "2026-10-12")!.text).toBe("100 % utviklet · 43 % av tiden brukt · alt utviklet · sett «Sluppet» når den er ute");
    const none = mk({ items: items([], [79]), history: hist(["2026-10-05", "2026-10-12"]) });
    expect(releasePace(none.p, none.r, "2026-10-12")!.text).toBe("0 % utviklet · 43 % av tiden brukt · ingenting utviklet ennå");
  });
  it("nextReleaseText: the first unshipped release by target day, calendar days away, the share delivered and the colour in words", () => {
    const p = normalizePlan({ lanes: [], tasks: [], sprints, releases: [
      { key: "a", version: "2.0.0", targetDate: "2026-10-01", shippedDate: "2026-10-07" },
      { key: "b", version: "2.0.1", targetDate: "2026-10-22", ado: { at: "x", label: "2.0.1", items: items([30], [49]), history: hist(["2026-10-12"]) } },
      { key: "c", version: "2.0.2", targetDate: "2026-11-12" },
    ] });
    expect(nextReleaseText(p, "2026-10-12")).toMatchObject({ code: "gronn", text: "Neste release 2.0.1 om 10 dager · 38 % · grønn" });
    expect(nextReleaseText(p, "2026-10-22")!.text).toBe("Neste release 2.0.1 i dag · 38 % · gul");
    expect(nextReleaseText(p, "2026-10-25")!.text).toBe("Neste release 2.0.1 3 dager på overtid · 38 % · rød");
    const unread = normalizePlan({ lanes: [], tasks: [], releases: [{ key: "c", version: "2.0.2", targetDate: "2026-11-13" }] });
    expect(nextReleaseText(unread, "2026-11-12")).toEqual({ text: "Neste release 2.0.2 om 1 dag · ikke lest fra ADO", code: null, release: unread.releases![0], phase: "utvikling" });
    expect(nextReleaseText(normalizePlan({ lanes: [], tasks: [] }), "2026-10-12")).toBeNull();
  });
  it("releaseStateCounts and releaseSprintText: ADO's states in order, the items per sprint and the sprint's unlabelled items", () => {
    const { r } = mk({ items: [
      { id: 1, type: "Bug", title: "a", state: "Closed", points: 5, assignee: null, iteration: "Sprint 71" },
      { id: 2, type: "Bug", title: "b", state: "New", points: 3, assignee: null, iteration: "Sprint 71" },
      { id: 3, type: "User Story", title: "c", state: "Active", points: 2, assignee: null, iteration: "Sprint 72" },
      { id: 4, type: "User Story", title: "d", state: "Weird", points: 2, assignee: null },
      { id: 5, type: "User Story", title: "e", state: "New", points: 2, assignee: null, iteration: "Sprint 71" },
    ], sprints: [{ name: "Sprint 71", unlabelled: 3 }, { name: "Sprint 72", unlabelled: 0 }] });
    expect(releaseStateCounts(r)).toEqual([{ state: "New", count: 2 }, { state: "Active", count: 1 }, { state: "Closed", count: 1 }, { state: "Weird", count: 1 }]);
    expect(releaseSprintText(r)).toBe("5 items i 2.0.1: 3 i Sprint 71, 1 i Sprint 72, 1 uten sprint · Sprint 71 har 3 items uten release-label");
    expect(releaseSprintText(mk(undefined).r)).toBe("");
  });
  it("releaseBurndownData: today's scope left on every working day from the delivered days (no holes where nobody read), the forecast day, the scope at the first reading", () => {
    const today = "2026-10-12";
    const its = [
      { id: 1, type: "Bug", title: "a", state: "Closed", points: 4, assignee: null, iteration: "Sprint 71", delivered: "2026-10-07" },
      { id: 2, type: "Bug", title: "b", state: "Resolved", points: 6, assignee: null, iteration: "Sprint 71", delivered: "2026-10-09" },
      { id: 3, type: "User Story", title: "c", state: "Active", points: 69, assignee: null, iteration: "Sprint 71" },
    ];
    const h = [{ day: "2026-10-05", pointsDone: 0, pointsTotal: 70, done: 0, total: 2 }, { day: today, pointsDone: 10, pointsTotal: 79, done: 2, total: 3 }];
    const a = mk({ items: its, history: h });
    expect(releaseBurndownData(a.p, a.r, today)).toEqual({ startDay: "2026-10-05", axisStart: "2026-10-05", targetDay: "2026-10-22", releaseDay: "2026-10-22", qaDay: null, endDay: "2026-10-22", todayDay: today, total: 79, unit: "SP",
      actual: [{ day: "2026-10-05", remaining: 79 }, { day: "2026-10-06", remaining: 79 }, { day: "2026-10-07", remaining: 75 }, { day: "2026-10-08", remaining: 75 }, { day: "2026-10-09", remaining: 69 }, { day: today, remaining: 69 }],
      closedActual: [{ day: "2026-10-05", remaining: 79 }, { day: "2026-10-06", remaining: 79 }, { day: "2026-10-07", remaining: 75 }, { day: "2026-10-08", remaining: 75 }, { day: "2026-10-09", remaining: 75 }, { day: today, remaining: 75 }],   // R18: the Closed bug has no closed day, so it counts from its developed day (7.10)
      forecastDay: "2026-12-09", firstScope: { day: "2026-10-05", total: 70 }, chances: [] });
    expect(releaseBurndownData(a.p, a.r, "2026-10-30")!.endDay).toBe("2026-10-30");
    const same = mk({ items: its, history: [{ ...h[0], pointsTotal: 79 }] });
    expect(releaseBurndownData(same.p, same.r, today)!.firstScope).toBeNull();   // the scope has not moved
    const shipped = mk({ items: its, history: h }, { shippedDate: "2026-10-08" });
    const sd = releaseBurndownData(shipped.p, shipped.r, "2026-11-30")!;
    expect(sd).toMatchObject({ endDay: "2026-10-22", forecastDay: null });
    expect(sd.actual.map((p) => p.day)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);   // the curve stops at the shipped day
    expect(releaseBurndownData(mk(undefined).p, mk(undefined).r, today)).toBeNull();
  });
  it("a done item without a delivered day (read before R11's last change) counts as done from the axis start", () => {
    const its = [{ id: 1, type: "Bug", title: "a", state: "Closed", points: 4, assignee: null, iteration: "Sprint 71" }, { id: 2, type: "Bug", title: "b", state: "New", points: 6, assignee: null, iteration: "Sprint 71" }];
    const a = mk({ items: its, history: hist(["2026-10-05"]) });
    expect(releaseBurndownData(a.p, a.r, "2026-10-06")!.actual).toEqual([{ day: "2026-10-05", remaining: 6 }, { day: "2026-10-06", remaining: 6 }]);
    expect(releasePace(a.p, a.r, "2026-10-06")!.tempo).toBeNull();
  });
  it("normalizePlan keeps the history one per day, sorted, the latest 120, the sprint counts, and the iteration only as text", () => {
    const rel = (over: Record<string, unknown>) => ({ key: "r1", version: "2.0.1", targetDate: "2026-10-22", ...over });
    const history = [{ day: "2026-10-12", pointsDone: 10, pointsTotal: 79, done: 1, total: 2 }, { day: "2026-10-09", pointsDone: 4, pointsTotal: 70, done: 1, total: 2 }, { day: "2026-10-12", pointsDone: 12, pointsTotal: 79, done: 2, total: 2 }, { day: "nope", pointsDone: 1, pointsTotal: 1, done: 1, total: 1 }, "junk"];
    const p = normalizePlan({ lanes: [], tasks: [], releases: [rel({ ado: { at: "x", label: "2.0.1", items: [{ id: 1, type: "Bug", title: "a", state: "Closed", points: 1, assignee: null, iteration: "Sprint 71", delivered: "2026-10-09" }, { id: 2, type: "Bug", title: "b", state: "New", points: 1, assignee: null, iteration: "", delivered: "2026-13-40" }], history, sprints: [{ name: "Sprint 71", unlabelled: 3 }, { unlabelled: 1 }, { name: "Sprint 72", unlabelled: -2 }, "x"] } })] });
    const a = p.releases![0].ado!;
    expect(a.history).toEqual([{ day: "2026-10-09", pointsDone: 4, pointsTotal: 70, done: 1, total: 2 }, { day: "2026-10-12", pointsDone: 12, pointsTotal: 79, done: 2, total: 2 }]);
    expect(a.sprints).toEqual([{ name: "Sprint 71", unlabelled: 3 }, { name: "Sprint 72", unlabelled: 0 }]);
    expect(a.items[0].iteration).toBe("Sprint 71");
    expect(a.items[1]).not.toHaveProperty("iteration");
    expect(a.items[0].delivered).toBe("2026-10-09");
    expect(a.items[1]).not.toHaveProperty("delivered");
    const many = Array.from({ length: 130 }, (_, i) => ({ day: dayKey(new Date(2026, 0, 1 + i)), pointsDone: i, pointsTotal: 200, done: 0, total: 0 }));
    const kept = normalizePlan({ lanes: [], tasks: [], releases: [rel({ ado: { at: "x", label: "2.0.1", items: [], history: many } })] }).releases![0].ado!.history!;
    expect(kept.length).toBe(120);
    expect(kept[0].day).toBe(dayKey(new Date(2026, 0, 11)));
    expect(normalizePlan({ lanes: [], tasks: [], releases: [rel({ ado: { at: "x", label: "2.0.1", items: [], history: [], sprints: [] } })] }).releases![0].ado).toEqual({ at: "x", label: "2.0.1", items: [] });
  });
});

describe("R11: a release whose clock starts after today (items in a coming sprint)", () => {
  const sprints = { at: "x", items: [{ name: "Sprint 72", path: "Skytale\\Sprint 72", start: "2026-10-26", finish: "2026-11-06" }] };
  const p = normalizePlan({ lanes: [], tasks: [], sprints, releases: [{ key: "r", version: "2.0.2", targetDate: "2026-11-12", ado: { at: "x", label: "2.0.2", items: [
    { id: 1, type: "Bug", title: "a", state: "Closed", points: 5, assignee: null, iteration: "Sprint 72" }, { id: 2, type: "Bug", title: "b", state: "New", points: 11, assignee: null, iteration: "Sprint 72" },
  ], history: [{ day: "2026-10-12", pointsDone: 5, pointsTotal: 16, done: 1, total: 2 }, { day: "2026-10-13", pointsDone: 5, pointsTotal: 16, done: 1, total: 2 }] } }] });
  it("says where the tempo counts from instead of «ingenting levert ennå», and stays green", () => {
    const pace = releasePace(p, p.releases![0], "2026-10-13")!;
    expect(pace).toMatchObject({ code: "gronn", elapsedDays: 0, tempo: null, startDay: "2026-10-26" });
    expect(pace.text).toBe("31 % utviklet · 0 % av tiden brukt · tempo regnes fra 26. okt");
  });
  it("the burndown's axis starts at the earlier of the clock's start and the first reading", () => {
    const d = releaseBurndownData(p, p.releases![0], "2026-10-13")!;
    expect(d.axisStart).toBe("2026-10-12");
    expect(d.startDay).toBe("2026-10-26");
  });
});

describe("R12: the chance a release is done by its target day, in words and in the plan", () => {
  const FC = { day: "2026-10-13", need: 82, days: 7, p: 0.44, mean: 78, p10: 37, p90: 121,
    people: [{ name: "Gjermund Østby", days: 5, pace: 8.7, expected: 43.3 }, { name: "Tor Håkon Moen", days: 7, pace: 3, expected: 20.6 }],
    basis: ["Sprint 69", "Sprint 70"], capacity: ["Sprint 71"] };
  const rel = (forecast: unknown, over: Record<string, unknown> = {}) => normalizePlan({ lanes: [], tasks: [], releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-22",
    ado: { at: "x", label: "2.0.1", items: [{ id: 1, type: "Bug", title: "a", state: "New", points: 82, assignee: null }], history: [{ day: "2026-10-13", pointsDone: 0, pointsTotal: 82, done: 0, total: 1, forecast: { p: 0.44, mean: 78 } }], forecast }, ...over }] }).releases![0];
  it("the chance, what is expected and the range, the people and what it rests on", () => {
    expect(releaseForecastText(rel(FC), "2026-10-13")).toEqual({
      short: "44 % sjanse",
      text: "44 % sjanse for at alt er utviklet til 22. okt",
      detail: "Forventet 78 av 82 SP på 7 arbeidsdager · 8 av 10 utfall mellom 37 og 121 SP",
      basis: "Tempo per person fra Sprint 69 og Sprint 70 · tilgjengelighet fra Capacity i Sprint 71 (Development-timer, 7,5 t = full dag) · ikke regnet med: hvem som kan ta hvilken oppgave",
      people: FC.people,
    });
  });
  it("never says 0 or 100 %, and says when the forecast is from an earlier day", () => {
    expect(releaseForecastText(rel({ ...FC, p: 1 }), "2026-10-13")!.short).toBe("over 99 % sjanse");
    expect(releaseForecastText(rel({ ...FC, p: 0 }), "2026-10-13")!.short).toBe("under 1 % sjanse");
    expect(releaseForecastText(rel(FC), "2026-10-14")!.text).toBe("44 % sjanse for at alt er utviklet til 22. okt · regnet 13. okt");
    expect(releaseForecastText(rel({ ...FC, p10: 26, p90: 26, mean: 26 }), "2026-10-13")!.detail).toBe("Forventet 26 av 82 SP på 7 arbeidsdager · 8 av 10 utfall rundt 26 SP");
  });
  it("tells what is missing: Capacity for a sprint, sprints up to the target, the past to measure a pace from", () => {
    expect(releaseForecastText(rel({ day: "2026-10-13", missing: "capacity", sprints: ["Sprint 71"], unplanned: 0 }), "2026-10-13")).toEqual({ short: null, text: "Fyll inn Capacity i ADO for Sprint 71 (Development-timer per dag og fridager) for å få sannsynligheten" });
    expect(releaseForecastText(rel({ day: "2026-10-13", missing: "capacity", sprints: ["Sprint 71", "Sprint 72"], unplanned: 3 }), "2026-10-13")!.text).toBe("Fyll inn Capacity i ADO for Sprint 71 og Sprint 72 (Development-timer per dag og fridager) og lag sprintene fram til målet (3 arbeidsdager er uten sprint) for å få sannsynligheten");
    expect(releaseForecastText(rel({ day: "2026-10-13", missing: "capacity", sprints: [], unplanned: 13 }), "2026-10-13")!.text).toBe("Lag sprintene fram til målet i ADO og fyll inn Capacity (13 arbeidsdager er uten sprint) for å få sannsynligheten");
    expect(releaseForecastText(rel({ day: "2026-10-13", missing: "history" }), "2026-10-13")).toEqual({ short: null, text: "Ingen utviklede poeng i de to siste sprintene å regne tempo fra" });
  });
  it("nothing when there is no forecast or the release is shipped", () => {
    expect(releaseForecastText(rel(undefined), "2026-10-13")).toBeNull();
    expect(releaseForecastText(rel(FC, { shippedDate: "2026-10-22" }), "2026-10-23")).toBeNull();
  });
  it("normalizePlan keeps a well-formed forecast and the day's chance, and drops the rest", () => {
    expect(rel(FC).ado!.forecast).toEqual(FC);
    expect(rel(FC).ado!.history![0].forecast).toEqual({ p: 0.44, mean: 78 });
    expect(rel({ day: "2026-10-13", missing: "history" }).ado!.forecast).toEqual({ day: "2026-10-13", missing: "history" });
    expect(rel({ day: "2026-10-13", missing: "capacity", sprints: ["Sprint 71", 7], unplanned: -1 }).ado!.forecast).toEqual({ day: "2026-10-13", missing: "capacity", sprints: ["Sprint 71"], unplanned: 0 });
    for (const bad of [{ ...FC, p: 1.5 }, { ...FC, day: "nope" }, { ...FC, mean: "x" }, { day: "2026-10-13", missing: "weather" }, "junk"]) expect(rel(bad).ado).not.toHaveProperty("forecast");
    const odd = normalizePlan({ lanes: [], tasks: [], releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-22", ado: { at: "x", label: "2.0.1", items: [], history: [{ day: "2026-10-13", pointsDone: 0, pointsTotal: 1, done: 0, total: 1, forecast: { p: 2, mean: 1 } }] } }] }).releases![0];
    expect(odd.ado!.history![0]).not.toHaveProperty("forecast");
  });
  it("the burndown's numbers carry each reading's chance, for laying the forecast next to what happened", () => {
    const r = rel(FC);
    const p = normalizePlan({ lanes: [], tasks: [], releases: [r] });
    expect(releaseBurndownData(p, p.releases![0], "2026-10-13")!.chances).toEqual([{ day: "2026-10-13", p: 0.44, mean: 78 }]);
  });
});

describe("R13: the transitions the lifecycle lacked", () => {
  const est = (over: Partial<PlanTask> = {}): PlanTask => ({ id: "e", lane: BACKLOG, label: "Est", kind: "estimate", start: 4, endLikely: 5, end: 6, deps: [], fv: {}, state: "klar", ...over });
  const disc = (over: Partial<PlanTask> = {}): PlanTask => ({ id: "d", lane: BACKLOG, label: "Disc", kind: "discovery", start: 2, end: 3, deps: [], fv: {}, state: "utredes", ...over });

  it("shelfTasks leaves delivered features out", () => {
    const plan = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [est({ id: "k" }), est({ id: "l", state: "levert", deliveredAt: "2026-10-07" }), disc({ id: "d", lane: "x" })] });
    expect(shelfTasks(plan).map((t) => t.id)).toEqual(["k"]);
  });
  it("canMarkDelivered: only without an ADO id and not yet delivered", () => {
    expect(canMarkDelivered(est())).toBe(true);
    expect(canMarkDelivered(disc({ state: "ny" }))).toBe(true);
    expect(canMarkDelivered(est({ adoId: 4486 }))).toBe(false);
    expect(canMarkDelivered(est({ state: "levert", deliveredAt: "2026-10-07" }))).toBe(false);
  });
  it("markDelivered sets the day; a discovery becomes an estimate whose end is its span", () => {
    const e = est({ lane: "x", state: "aktiv" });
    expect(markDelivered(e, "2026-10-07")).toEqual(["state"]);
    expect([e.state, e.deliveredAt, e.kind]).toEqual(["levert", "2026-10-07", "estimate"]);
    const d = disc();
    expect(markDelivered(d, "2026-10-01")).toEqual(["state", "meta", "tid"]);
    expect([d.state, d.deliveredAt, d.kind, d.endLikely]).toEqual(["levert", "2026-10-01", "estimate", 3]);
  });
  it("canRestartDiscovery: an estimated feature on the shelf or in an epic, nothing else", () => {
    expect(canRestartDiscovery(est())).toBe(true);
    expect(canRestartDiscovery(est({ lane: "x", state: "aktiv" }))).toBe(true);
    expect(canRestartDiscovery(disc())).toBe(false);
    expect(canRestartDiscovery(est({ state: "levert", deliveredAt: "2026-10-07" }))).toBe(false);
    expect(canRestartDiscovery(disc({ state: "ny" }))).toBe(false);
  });
  it("applyLaneChange: an estimate from the shelf into an epic becomes aktiv with the promised span", () => {
    const e = est();
    expect(applyLaneChange(e, "x", "2026-10-13")).toEqual(["meta", "state"]);
    expect([e.lane, e.state, e.activatedAt]).toEqual(["x", "aktiv", "2026-10-13"]);
    expect(e.committedRange).toEqual({ likely: 4, late: 8, start: 4 });
  });
  it("applyLaneChange: back to the shelf makes it klar again and drops the span", () => {
    const e = est({ lane: "x", state: "aktiv", committedRange: { likely: 4, late: 8, start: 4 }, activatedAt: "2026-10-13" });
    expect(applyLaneChange(e, BACKLOG, "2026-10-14")).toEqual(["meta", "state"]);
    expect([e.lane, e.state, e.committedRange, e.activatedAt]).toEqual([BACKLOG, "klar", undefined, undefined]);
  });
  it("applyLaneChange: a discovery, a delivered or a registered feature keeps its state; the same lane changes nothing", () => {
    const d = disc();
    expect(applyLaneChange(d, "x", "2026-10-13")).toEqual(["meta"]);
    expect([d.lane, d.state]).toEqual(["x", "utredes"]);
    const l = est({ state: "levert", deliveredAt: "2026-10-07" });
    expect(applyLaneChange(l, "x", "2026-10-13")).toEqual(["meta"]);
    expect(l.state).toBe("levert");
    const n = disc({ state: "ny" });
    expect(applyLaneChange(n, "x", "2026-10-13")).toEqual(["meta"]);
    expect(n.state).toBe("ny");
    const same = est({ lane: "x", state: "aktiv" });
    expect(applyLaneChange(same, "x", "2026-10-13")).toEqual([]);
  });
  it("boardColumn and featureTransition: one step forward, back to the shelf or to discovery, delivered only without ADO", () => {
    const cols = (t: PlanTask) => ["ny", "utredes", "klar", "aktiv", "levert"].filter((to) => featureTransition(t, to));
    expect(boardColumn(disc({ state: "ny" }))).toBe("ny");
    expect(cols(disc({ state: "ny" }))).toEqual(["utredes", "levert"]);
    expect(boardColumn(disc())).toBe("utredes");
    expect(cols(disc())).toEqual(["klar", "levert"]);
    expect(cols(disc({ lane: "x" }))).toEqual(["aktiv", "levert"]);
    expect(boardColumn(est())).toBe("klar");
    expect(cols(est())).toEqual(["utredes", "aktiv", "levert"]);
    expect(cols(est({ adoId: 4486 }))).toEqual(["utredes", "aktiv"]);
    expect(boardColumn(est({ lane: "x", state: "aktiv" }))).toBe("aktiv");
    expect(cols(est({ lane: "x", state: "aktiv" }))).toEqual(["utredes", "klar", "levert"]);
    expect(boardColumn(est({ state: "levert", deliveredAt: "2026-10-07" }))).toBe("levert");
    expect(cols(est({ state: "levert", deliveredAt: "2026-10-07" }))).toEqual([]);
  });
});

describe("R14: the top bar's words", () => {
  const ln = (key: string, state: string, goalDate?: number) => ({ key, name: key, owner: "GO", v: 1, state, ...(goalDate !== undefined ? { goalDate } : {}) });
  const estT = (id: string, lane: string, endLikely: number, end: number): PlanTask => ({ id, label: id, lane, kind: "estimate", start: 0, endLikely, end, deps: [], fv: {}, state: "aktiv" });
  const discT = (id: string, lane: string, end: number): PlanTask => ({ id, label: id, lane, kind: "discovery", start: 0, endLikely: end, end, deps: [], fv: {}, state: "utredes" });
  const words = (lanes: ReturnType<typeof ln>[], tasks: PlanTask[]) => epicStatusWords({ lanes, tasks } as unknown as Plan);

  it("navTabsHtml keeps the process order, marks the active tab and shows all five when hosted", () => {
    const html = navTabsHtml("timeline", true);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/inntak", "/timeline", "/", "/kunder", "/sprint"]);   // R19: «Sprint» last
    expect(html).toContain('<a class="tab on" id="tab-timeline" data-tab="timeline" data-label="Tidslinjen" href="/timeline" aria-current="page">Tidslinjen</a>');
    expect(html).toContain('<a class="tab" id="tab-board" data-tab="board" data-label="Brettet" href="/">Brettet</a>');   // R17: the label reserves the bold width (sky.css)
    expect(html).not.toContain("hidden");
  });

  it("navTabsHtml hides the other tabs when the page is opened from a file", () => {
    const html = navTabsHtml("board", false);
    expect(html).toContain('id="tab-board" data-tab="board" data-label="Brettet" href="/" aria-current="page">');
    expect(html).toContain('id="tab-inntak" data-tab="inntak" data-label="Inntak" href="/inntak" hidden>');
    expect(html).toContain('id="tab-timeline" data-tab="timeline" data-label="Tidslinjen" href="/timeline" hidden>');
    expect(html).toContain('id="tab-kunder" data-tab="kunder" data-label="Kunder" href="/kunder" hidden>');
    expect(html).toContain('id="tab-sprint" data-tab="sprint" data-label="Sprint" href="/sprint" hidden>');
    expect(navTabsHtml("sprint", true)).toContain('<a class="tab on" id="tab-sprint" data-tab="sprint" data-label="Sprint" href="/sprint" aria-current="page">Sprint</a>');
  });

  it("epicStatusWords counts the active epics by colour, in Norwegian words", () => {
    const lanes = [ln("a", "aktiv", 10), ln("b", "aktiv", 5), ln("c", "aktiv", 2), ln("d", "aktiv", 8), ln("e", "forslag", 9), ln("f", "aktiv", 4)];
    const tasks = [estT("a1", "a", 6, 8), estT("b1", "b", 3, 7), estT("c1", "c", 4, 6), discT("d1", "d", 3)];
    expect(words(lanes, tasks)).toBe("5 aktive epics · 1 grønn · 1 gul · 1 rød · 1 venter på utredning · 1 forslag");
  });

  it("epicStatusWords uses the plural forms and leaves zero parts out", () => {
    expect(words([ln("a", "aktiv", 10), ln("b", "aktiv", 10)], [estT("a1", "a", 6, 8), estT("b1", "b", 6, 8)])).toBe("2 aktive epics · 2 grønne");
    expect(words([ln("a", "aktiv", 1)], [estT("a1", "a", 4, 6)])).toBe("1 aktiv epic · 1 rød");
    expect(words([], [])).toBe("Ingen epics ennå");
  });
});

describe("R15: the forum view", () => {
  const snap = (id: string, kind: string, at: string) => ({ id, kind, at, label: id });
  it("takes the newest baseline and ignores sprint starts", () => {
    const s = [snap("a", "baseline", "2026-10-05T10:00:00.000Z"), snap("b", "sprint", "2026-11-01T08:00:00.000Z"), snap("c", "baseline", "2026-11-05T09:10:00.000Z"), snap("d", "baseline", "2026-09-01T09:00:00.000Z")];
    expect(forumBaseline(s)?.id).toBe("c");
  });
  it("is null without a baseline", () => {
    expect(forumBaseline([snap("b", "sprint", "2026-11-01T08:00:00.000Z")])).toBeNull();
    expect(forumBaseline([])).toBeNull();
    expect(forumBaseline(undefined)).toBeNull();
  });
  it("a stored choice wins; readers land in the forum view by default", () => {
    expect(forumDefault("1", true)).toBe(true);
    expect(forumDefault("0", false)).toBe(false);
    expect(forumDefault(null, false)).toBe(true);
    expect(forumDefault(null, true)).toBe(false);
    expect(forumDefault(undefined, true)).toBe(false);
  });
});

describe("R16: Leveranser, the COO layer", () => {
  const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
  const TODAY = "2026-10-13";
  const del = (over: Record<string, unknown> = {}): Delivery => ({ key: "d1", name: "Skytale 2.0", customers: [], allCustomers: true, promisedDate: "2026-11-30", epics: ["x"], releases: ["r1"], ...over }) as unknown as Delivery;
  const base = (over: Record<string, unknown> = {}) => normalizePlan({
    lanes: [{ key: "x", name: "Epic X", priority: 1 }, { key: "y", name: "Epic Y", state: "avsluttet", outcome: "nådd", priority: 2 }, { key: "z", name: "Epic Z", priority: 3 }],
    tasks: [
      { id: "x1", lane: "x", label: "X1", kind: "estimate", start: D(2026, 11, 2), endLikely: D(2026, 12, 4), end: D(2026, 12, 11), deps: [], fv: {}, state: "aktiv" },
      { id: "y1", lane: "y", label: "Y1", kind: "estimate", start: D(2026, 9, 1), endLikely: D(2026, 9, 20), end: D(2026, 9, 30), deps: [], fv: {}, state: "levert", deliveredAt: "2026-09-30" },
    ],
    releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-11-20", ado: { at: "2026-10-13T08:00:00.000Z", label: "2.0.1", items: [
      { id: 1, type: "Bug", title: "a", state: "New", points: 3, assignee: null }, { id: 2, type: "Bug", title: "b", state: "Closed", points: 2, assignee: null }, { id: 3, type: "User Story", title: "c", state: "New", points: 5, assignee: null },
    ], sprints: [{ name: "Sprint 71", unlabelled: 3 }] } }, { key: "r0", version: "2.0.0", targetDate: "2026-10-07", shippedDate: "2026-10-07" }],
    deliveries: [del()],
    ...over,
  });

  it("the normaliser keeps a delivery with key, name and a valid promised day, cleans customers and keys, sorts by promised day", () => {
    const p = normalizePlan({ lanes: [], tasks: [], deliveries: [
      del({ key: "b", name: "  B ", promisedDate: "2026-12-01", allCustomers: false, customers: [" Telenor ", "NSR", "Telenor", "", 7], epics: ["x", "x", ""], releases: 5, owner: " COO ", note: " n " }),
      del({ key: "a", promisedDate: "2026-11-01", epics: [], releases: [] }),
      del({ key: "", promisedDate: "2026-11-01" }), del({ key: "c", name: "" }), del({ key: "e", promisedDate: "2026-02-30" }), null,
    ], deletedDeliveries: { gone: 1 } });
    expect(p.deliveries!.map((d) => d.key)).toEqual(["a", "b"]);
    expect(p.deliveries![0]).toEqual({ key: "a", v: 0, name: "Skytale 2.0", customers: [], allCustomers: true, promisedDate: "2026-11-01", epics: [], releases: [] });
    expect(p.deliveries![1]).toEqual({ key: "b", v: 0, name: "B", customers: ["Telenor", "NSR"], promisedDate: "2026-12-01", epics: ["x"], releases: [], owner: "COO", note: "n" });
    expect(p.deletedDeliveries).toEqual({ gone: 1 });
    expect(normalizePlan({ lanes: [], tasks: [] }).deliveries).toEqual([]);
  });

  it("words: owner, customers", () => {
    expect(deliveryOwner(del())).toBe("COO");
    expect(deliveryOwner(del({ owner: "GO" }))).toBe("GO");
    expect(deliveryCustomersText(del())).toBe("alle kunder");
    expect(deliveryCustomersText(del({ allCustomers: undefined, customers: ["Telenor", "NSR"] }))).toBe("Telenor, NSR");
    expect(deliveryCustomersText(del({ allCustomers: undefined, customers: [] }))).toBe("ingen kunder");
  });

  it("the parts are the existing epics and releases; an unknown key is ignored", () => {
    const p = base({ deliveries: [del({ epics: ["x", "gone"], releases: ["r1", "nope"] })] });
    const parts = deliveryParts(p, p.deliveries![0]);
    expect(parts.epics.map((l) => l.key)).toEqual(["x"]);
    expect(parts.releases.map((r) => r.key)).toEqual(["r1"]);
  });

  it("the computed date is the latest of the open epic's late end and the release's expected finish, with who gives it", () => {
    const p = base();
    const c = deliveryComputed(p, p.deliveries![0], TODAY);
    expect(c).toEqual({ day: "2026-12-11", by: { kind: "epic", key: "x", name: "Epic X" }, pending: false, open: 2, parts: 2 });
    const s = deliveryStatus(p, p.deliveries![0], TODAY);
    expect(s.code).toBe("rod");
    expect(s.deltaDays).toBe(9);
    expect(s.weeks).toBe(1.6);
    expect(s.text).toBe("utregnet 11. des · 1,6 uker etter lovet · dratt av «Epic X»");
    expect(deliveryStatus(p, { ...p.deliveries![0], promisedDate: "2026-12-11" }, TODAY)).toMatchObject({ code: "gronn", deltaDays: 0, text: "utregnet 11. des · på lovet dato · dratt av «Epic X»" });
    expect(deliveryStatus(p, { ...p.deliveries![0], promisedDate: "2026-12-09" }, TODAY)).toMatchObject({ code: "gul", deltaDays: 2, text: "utregnet 11. des · to arbeidsdager etter lovet · dratt av «Epic X»" });
    expect(deliveryStatus(p, { ...p.deliveries![0], promisedDate: "2026-12-18" }, TODAY)).toMatchObject({ code: "gronn", deltaDays: -5, text: "utregnet 11. des · 1 uke før lovet · dratt av «Epic X»" });
  });

  it("a release without a tempo gives its target day; a shipped release and a closed epic give nothing; nothing open is «alt levert»; no parts is «ingen»", () => {
    const p = base();
    const onlyRel = deliveryStatus(p, { ...p.deliveries![0], epics: [] }, TODAY);
    expect(onlyRel).toMatchObject({ code: "gronn", computed: "2026-11-20", text: "utregnet 20. nov · 1,4 uker før lovet · dratt av release 2.0.1" });
    expect(deliveryStatus(p, { ...p.deliveries![0], epics: ["y"], releases: ["r0"] }, TODAY)).toMatchObject({ code: "gronn", computed: null, text: "alt levert" });
    expect(deliveryStatus(p, { ...p.deliveries![0], epics: [], releases: [] }, TODAY)).toMatchObject({ code: "ingen", computed: null, text: "henger ikke på noe ennå" });
    expect(DELIVERY_WORD).toEqual({ gronn: "grønn", gul: "gul", rod: "rød", ingen: "uten dato" });
  });

  it("a discovery makes the date a floor («minst … · venter på utredning»); an end in the past is floored at today", () => {
    const p = base({ tasks: [
      { id: "x1", lane: "x", label: "X1", kind: "discovery", start: D(2026, 10, 5), end: D(2026, 10, 26), deps: [], fv: {}, state: "utredes" },
      { id: "z1", lane: "z", label: "Z1", kind: "estimate", start: D(2026, 8, 3), endLikely: D(2026, 9, 1), end: D(2026, 9, 15), deps: [], fv: {}, state: "aktiv" },
    ], deliveries: [del({ releases: [] }), del({ key: "d2", name: "Z", epics: ["z"], releases: [] })] });
    expect(deliveryStatus(p, p.deliveries![0], TODAY)).toMatchObject({ pending: true, computed: "2026-10-26", code: "gronn", text: "minst 26. okt · 5 uker før lovet · venter på utredning · dratt av «Epic X»" });
    expect(deliveryStatus(p, p.deliveries![1], TODAY)).toMatchObject({ computed: TODAY, by: { kind: "epic", key: "z" } });
  });

  it("bugs left, items without a label, the parts text and the lines", () => {
    const p = base();
    const d = p.deliveries![0];
    expect(deliveryBugsLeft(p, d)).toBe(1);
    expect(deliveryUnlabelled(p, d)).toBe(3);
    expect(deliveryPartsText(p, d)).toBe("Release 2.0.1 · Epic X · 3 uten release-label");
    expect(deliveryPartsText(p, { ...d, epics: [], releases: [] })).toBe("ingenting ennå");
    const lines = deliveryLines(p, TODAY);
    expect(lines.map((l) => [l.key, l.customer, l.all, l.none])).toEqual([["d1", "Alle kunder", true, false]]);
    expect(lines[0].status.code).toBe("rod");
    const named = deliveryLines(base({ deliveries: [del({ allCustomers: undefined, customers: ["Telenor", "NSR"] }), del({ key: "d2", name: "Tom", allCustomers: undefined, customers: [] })] }), TODAY);
    expect(named.map((l) => [l.key, l.customer, l.none])).toEqual([["d1", "Telenor", false], ["d1", "NSR", false], ["d2", "Ingen kunder", true]]);
  });

  it("customers per epic: all wins, names are distinct, the weight follows the count", () => {
    const p = base({ deliveries: [
      del({ key: "d1", allCustomers: true, epics: ["x"] }),
      del({ key: "d2", name: "Video", allCustomers: undefined, customers: ["Kunde B", "Kunde C"], epics: ["z"], releases: [] }),
      del({ key: "d3", name: "Proxy i drift", allCustomers: undefined, customers: ["Kunde B"], epics: ["z", "y"], releases: [] }),
    ] });
    const x = epicCustomers(p, "x"), z = epicCustomers(p, "z"), y = epicCustomers(p, "y"), none = epicCustomers(p, "nope");
    expect([x.all, x.names, x.deliveries.map((d) => d.key)]).toEqual([true, [], ["d1"]]);
    expect([z.all, z.names, z.count]).toEqual([false, ["Kunde B", "Kunde C"], 2]);
    expect([epicCustomersText(x), epicCustomersText(z), epicCustomersText(y), epicCustomersText(none)]).toEqual(["alle kunder", "2 kunder", "1 kunde", ""]);
    expect([epicWeight(x), epicWeight(z), epicWeight(y), epicWeight(none)]).toEqual([
      { code: "tyngst", label: "Tyngst" }, { code: "flere", label: "Flere interessenter" }, { code: "lett", label: "Lett å prioritere" }, { code: "ingen", label: "Ingen kunder venter" },
    ]);
  });

  it("segments: from the earliest feature start (else the release's segment, else today) to the computed day, the promise as a unit", () => {
    const p = base();
    const sg = deliverySegments(p, TODAY);
    expect(sg.length).toBe(1);
    expect(sg[0].start).toBeCloseTo(D(2026, 11, 2), 5);
    expect(sg[0].end).toBeCloseTo(D(2026, 12, 11), 5);
    expect(sg[0].promised).toBeCloseTo(D(2026, 11, 30), 5);
    expect(sg[0].status.code).toBe("rod");
    const rel = deliverySegments(base({ deliveries: [del({ epics: [] })] }), TODAY)[0];
    expect(rel.start).toBeCloseTo(D(2026, 10, 7), 5);   // r1's segment starts where the shipped 2.0.0's ends
    const bare = deliverySegments(base({ deliveries: [del({ epics: [], releases: [] })] }), TODAY)[0];
    expect(bare.start).toBeCloseTo(D(2026, 10, 13), 5);
    expect(bare.end).toBeCloseTo(D(2026, 11, 30), 5);
  });

  it("the investor numbers per delivery", () => {
    const p = base({ deliveries: [del({ epics: ["x", "y"] })] });
    expect(deliveryInvestor(p, p.deliveries![0], TODAY)).toEqual({
      key: "d1", name: "Skytale 2.0", customers: "alle kunder", owner: "COO", promised: "2026-11-30", computed: "2026-12-11", weeks: 1.6, colour: "rød", code: "rod",
      by: "«Epic X»", pending: false, epicsDone: 1, epicsTotal: 2, bugsLeft: 1, text: "utregnet 11. des · 1,6 uker etter lovet · dratt av «Epic X»",
    });
  });
});

describe("minors after R16: the Oslo day and the numeric sprint order", () => {
  it("osloDay and osloDate give the calendar day in Oslo, not UTC", () => {
    expect(osloDay(new Date("2026-10-13T22:30:00.000Z"))).toBe("2026-10-14");   // CEST
    expect(osloDay(new Date("2026-12-31T23:30:00.000Z"))).toBe("2027-01-01");   // CET
    expect(osloDay(new Date("2026-10-13T10:00:00.000Z"))).toBe("2026-10-13");
    const d = osloDate(new Date("2026-10-13T22:30:00.000Z"));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 14, 0]);
    expect(dayKey(osloDate(new Date("2026-12-31T23:30:00.000Z")))).toBe("2027-01-01");
  });
  it("releaseSprintText orders the sprints numerically («Sprint 9» before «Sprint 10»)", () => {
    const r = { key: "r", version: "2.1", targetDate: "2027-01-15", ado: { at: "x", label: "2.1", items: [
      { id: 1, type: "Bug", title: "a", state: "New", points: 1, assignee: null, iteration: "Sprint 10" },
      { id: 2, type: "Bug", title: "b", state: "New", points: 1, assignee: null, iteration: "Sprint 9" },
      { id: 3, type: "Bug", title: "c", state: "New", points: 1, assignee: null, iteration: "Sprint 9" },
    ] } } as unknown as Parameters<typeof releaseSprintText>[0];
    expect(releaseSprintText(r)).toBe("3 items i 2.1: 2 i Sprint 9, 1 i Sprint 10");
  });
});

describe("R17: «Per leveranse», the deliveries with what they hang on", () => {
  const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
  const TODAY = "2026-10-16";
  const del = (over: Record<string, unknown>): Delivery => ({ key: "d1", name: "Skytale 2.0", customers: [], allCustomers: true, promisedDate: "2026-11-30", epics: [], releases: [], ...over }) as unknown as Delivery;
  const f = (id: string, lane: string, start: number, likely: number, end: number, over: Partial<PlanTask> = {}): PlanTask =>
    ({ id, lane, label: id.toUpperCase(), kind: "estimate", start, endLikely: likely, end, deps: [], fv: {}, state: "aktiv", ...over }) as PlanTask;
  const base = (deliveries: Delivery[]) => normalizePlan({
    lanes: [
      { key: "a", name: "Epic A", priority: 1, goalDate: D(2026, 12, 18) }, { key: "b", name: "Epic B", priority: 2 },
      { key: "c", name: "Epic C", priority: 3, state: "avsluttet", outcome: "nådd" }, { key: "p", name: "Epic P", priority: 4, state: "forslag" },
      { key: "e", name: "Epic E", priority: 5 },
    ],
    tasks: [
      f("a1", "a", D(2026, 11, 2), D(2026, 11, 30), D(2026, 12, 11)),
      f("a2", "a", D(2026, 10, 12), D(2026, 10, 26), D(2026, 11, 2), { state: "levert", deliveredAt: "2026-11-02" }),
      { id: "b1", lane: "b", label: "B1", kind: "discovery", start: D(2026, 10, 19), end: D(2026, 11, 13), deps: [], fv: {}, state: "utredes" } as PlanTask,
      f("c1", "c", D(2026, 9, 1), D(2026, 9, 20), D(2026, 9, 30), { state: "levert", deliveredAt: "2026-09-30" }),
      f("p1", "p", D(2027, 1, 4), D(2027, 2, 1), D(2027, 2, 15)),
    ],
    releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-22" }, { key: "r0", version: "2.0.0", targetDate: "2026-10-07", shippedDate: "2026-10-07" }],
    deliveries,
  });

  it("one group per delivery in the plan's order; its parts by end, so the last one is what pulls the date", () => {
    const p = base([del({ key: "d1", epics: ["a", "b"], releases: ["r1"] }), del({ key: "d0", name: "Proxy", allCustomers: false, customers: ["Telenor"], promisedDate: "2026-11-15", epics: ["b"] })]);
    const { groups } = deliveryRows(p, TODAY);
    expect(groups.map((g) => g.delivery.key)).toEqual(["d0", "d1"]);
    expect(groups[1].parts.map((x) => x.key)).toEqual(["r1", "b", "a"]);
    expect(groups[1].status.by).toEqual({ kind: "epic", key: "a", name: "Epic A" });
    expect(groups[1].segment.promised).toBeCloseTo(dayToUnit("2026-11-30"), 9);
  });
  it("an epic part spans its open features, darker to the latest likely end, striped while a discovery runs", () => {
    const g = deliveryRows(base([del({ epics: ["a", "b"] })]), TODAY).groups[0];
    const a = g.parts.find((x) => x.key === "a")!, b = g.parts.find((x) => x.key === "b")!;
    expect(a).toMatchObject({ kind: "epic", code: "gronn", start: D(2026, 11, 2), likelyEnd: D(2026, 11, 30), end: D(2026, 12, 11), pending: false });
    expect(a.kind === "epic" && a.window).toMatch(/^Leveres uke /);
    expect(b).toMatchObject({ kind: "epic", code: "venter", start: D(2026, 10, 19), end: D(2026, 11, 13), pending: true });
  });
  it("shared: an epic two deliveries hang on shows under both, each naming the other", () => {
    const [g1, g2] = deliveryRows(base([del({ key: "d1", epics: ["b"] }), del({ key: "d2", name: "Proxy", promisedDate: "2026-12-15", epics: ["b"] })]), TODAY).groups;
    expect(g1.parts[0].kind === "epic" && g1.parts[0].shared).toEqual(["Proxy"]);
    expect(g2.parts[0].kind === "epic" && g2.parts[0].shared).toEqual(["Skytale 2.0"]);
  });
  it("a closed epic spans its delivered features; a release part is its segment, a shipped one marked", () => {
    const parts = deliveryRows(base([del({ epics: ["c"], releases: ["r0", "r1"] })]), TODAY).groups[0].parts;
    expect(parts.map((x) => x.key)).toEqual(["r0", "c", "r1"]);   // the shipped release and the closed epic pull nothing: first, by name
    expect(parts[1]).toMatchObject({ start: D(2026, 9, 1), end: D(2026, 9, 30) });
    expect(parts[0]).toMatchObject({ kind: "release", shipped: true, end: dayToUnit("2026-10-07") });
    expect(parts[2]).toMatchObject({ kind: "release", shipped: false, end: dayToUnit("2026-10-22") });
  });
  it("a release whose tempo forecast is past its target pulls the date: it is the last row, after an epic that ends between the two", () => {
    const sprints = { at: "2026-10-12T00:00:00.000Z", items: [{ name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-23" }] };
    const item = (id: number, state: string, points: number) => ({ id, type: "Bug", title: "b" + id, state, points, assignee: null, iteration: "Sprint 71", ...(state === "Closed" ? { delivered: "2026-10-09" } : {}) });
    const p = normalizePlan({
      lanes: [{ key: "a", name: "Epic A", priority: 1 }], tasks: [f("a1", "a", D(2026, 10, 19), D(2026, 10, 26), D(2026, 11, 2))], sprints,
      releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-22", ado: { at: "2026-10-12T10:00:00.000Z", label: "2.0.1", items: [item(1, "Closed", 30), item(2, "Active", 49)] } }],
      deliveries: [del({ epics: ["a"], releases: ["r1"] })],
    });
    expect(releasePace(p, p.releases![0], TODAY)!.forecastDay).toBe("2026-11-10");   // 30 SP in ten working days: 49 left → 17 more
    expect(deliveryRows(p, TODAY).groups[0].parts.map((x) => x.key)).toEqual(["a", "r1"]);   // the epic ends 2 Nov, the release's segment 22 Oct
    expect(deliveryStatus(p, p.deliveries![0], TODAY).by!.key).toBe("r1");
  });
  it("equal days: the part «dratt av» names is the last row (two overdue epics, both clamped to today)", () => {
    const p = normalizePlan({
      lanes: [{ key: "a", name: "Alpha", priority: 1 }, { key: "b", name: "Beta", priority: 2 }],
      tasks: [f("a1", "a", D(2026, 9, 7), D(2026, 9, 21), D(2026, 9, 28)), f("b1", "b", D(2026, 9, 7), D(2026, 9, 21), D(2026, 9, 28))],
      deliveries: [del({ epics: ["a", "b"] })],
    });
    const keys = deliveryRows(p, TODAY).groups[0].parts.map((x) => x.key);
    expect(keys[keys.length - 1]).toBe(deliveryStatus(p, p.deliveries![0], TODAY).by!.key);
  });
  it("a deleted key: the group stays, with no parts and «henger ikke på noe ennå»", () => {
    const [g] = deliveryRows(base([del({ epics: ["gone"], releases: ["gone-too"] })]), TODAY).groups;
    expect(g.parts).toEqual([]);
    expect(g.status).toMatchObject({ code: "ingen", text: "henger ikke på noe ennå" });
  });
  it("loose: the open epics no delivery hangs on, in the plan's order; one without features has no span", () => {
    const { loose } = deliveryRows(base([del({ epics: ["a"] })]), TODAY);
    expect(loose.map((x) => x.key)).toEqual(["b", "p", "e"]);
    expect(loose[2]).toMatchObject({ start: null, end: null, likelyEnd: null, pending: false, shared: [] });
    expect(deliveryRows(normalizePlan({ lanes: [], tasks: [] }), TODAY)).toEqual({ groups: [], loose: [] });
  });
});

describe("R17 review: the focus helpers never break a render", () => {
  it("a selector the browser can't parse, or an element that throws, leaves the focus where it is", () => {
    const doc = { querySelector: () => { throw new SyntaxError("unsupported selector"); }, activeElement: { id: "", closest: () => { throw new Error("detached"); } } };
    expect(() => restoreFocus(doc as never, ":nth-child(1 of tr)")).not.toThrow();
    expect(focusKey(doc as never)).toBeNull();
  });
});

describe("R18: developed and closed by category", () => {
  it("category first, the old names without one", () => {
    const i = (state: string, category?: string) => ({ id: 1, type: "Bug", title: "", state, points: 1, assignee: null, ...(category ? { category } : {}) }) as never;
    expect(releaseItemDone(i("QA", "Resolved"))).toBe(true);
    expect(releaseItemDone(i("Codereview", "InProgress"))).toBe(false);
    expect(releaseItemClosed(i("QA", "Resolved"))).toBe(false);
    expect(releaseItemClosed(i("Closed", "Completed"))).toBe(true);
    expect(releaseItemDone(i("Resolved"))).toBe(true);
    expect(releaseItemClosed(i("Resolved"))).toBe(false);
  });
  it("the state counts carry the category and come in its order; the normaliser keeps the fallback flag", () => {
    const it2 = (id: number, state: string, category: string) => ({ id, type: "Bug", title: "", state, category, points: 1, assignee: null });
    const r = normalizePlan({ lanes: [], tasks: [], releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-27", ado: { at: "x", label: "2.0.1", statesMissing: true,
      items: [it2(1, "Closed", "Completed"), it2(2, "QA", "Resolved"), it2(3, "Codereview", "InProgress"), it2(4, "Develop", "Resolved"), it2(5, "New", "Proposed"), it2(6, "QA", "Resolved")] } }] }).releases![0];
    expect(releaseStateCounts(r)).toEqual([
      { state: "New", category: "Proposed", count: 1 }, { state: "Codereview", category: "InProgress", count: 1 },
      { state: "Develop", category: "Resolved", count: 1 }, { state: "QA", category: "Resolved", count: 2 }, { state: "Closed", category: "Completed", count: 1 },
    ]);
    expect(r.ado!.statesMissing).toBe(true);
  });
  it("a state name in two categories gives one entry per category, each in its category's place and named by its type (a story's «Resolved» is InProgress, a bug's is Resolved)", () => {
    const it3 = (id: number, type: string, state: string, category: string) => ({ id, type, title: "", state, category, points: 1, assignee: null });
    const r = normalizePlan({ lanes: [], tasks: [], releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-27", ado: { at: "x", label: "2.0.1",
      items: [it3(1, "Bug", "Resolved", "Resolved"), it3(2, "Bug", "Develop", "Resolved"), it3(3, "User Story", "Resolved", "InProgress"), it3(4, "User Story", "Codereview", "InProgress")] } }] }).releases![0];
    const counts = releaseStateCounts(r);
    expect(counts).toEqual([
      { state: "Codereview", category: "InProgress", count: 1 }, { state: "Resolved", category: "InProgress", type: "User Story", count: 1 },
      { state: "Resolved", category: "Resolved", type: "Bug", count: 1 }, { state: "Develop", category: "Resolved", count: 1 },
    ]);
    expect(releaseItemDone(counts[1])).toBe(false);
    expect(releaseItemDone(counts[2])).toBe(true);
  });
});

describe("R18: a release in two phases", () => {
  const TODAY = "2026-10-16";
  const it_ = (id: number, state: string, category: string, points: number, delivered?: string, closed?: string) =>
    ({ id, type: "User Story", title: "s" + id, state, category, points, assignee: null, ...(delivered ? { delivered } : {}), ...(closed ? { closed } : {}) });
  const rel = (over: Record<string, unknown> = {}, items = [it_(1, "Develop", "Resolved", 3, "2026-10-12"), it_(2, "Codereview", "InProgress", 5), it_(3, "Closed", "Completed", 2, "2026-10-08", "2026-10-14")]) =>
    normalizePlan({ lanes: [], tasks: [], sprints: { at: "", items: [{ name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-23" }] },
      releases: [{ key: "r1", version: "2.0.1", targetDate: "2026-10-27", qaDate: "2026-10-20", ado: { at: TODAY + "T08:00:00Z", label: "2.0.1", items, history: [] }, ...over }] }).releases![0];

  it("the normaliser keeps «Klar for QA» as a valid day and the open ids only while «Sluppet» is set", () => {
    expect(rel().qaDate).toBe("2026-10-20");
    expect(rel({ qaDate: "2026-02-30" }).qaDate).toBeUndefined();
    expect(rel({ shippedDate: "2026-10-27", openAtShip: [2, 2, -1, "x"] }).openAtShip).toEqual([2]);
    expect(rel({ openAtShip: [2] }).openAtShip).toBeUndefined();
  });
  it("progress counts developed and closed apart; the dev target is «Klar for QA», else «Release»", () => {
    const pr = releaseProgress(rel());
    expect(pr).toMatchObject({ pointsDone: 5, pointsTotal: 10, pointsClosed: 2 });
    expect(pr.closedFraction).toBeCloseTo(0.2, 9);
    expect(releaseDevTarget(rel())).toBe("2026-10-20");
    expect(releaseDevTarget(rel({ qaDate: undefined }))).toBe("2026-10-27");
  });
  it("the phase: development while something is not developed, QA when all is, sluppet once out", () => {
    expect(releasePhase(rel())).toBe("utvikling");
    expect(releasePhase(rel({}, [it_(1, "QA", "Resolved", 3, "2026-10-12"), it_(2, "Closed", "Completed", 5, "2026-10-13", "2026-10-15")]))).toBe("qa");
    expect(releasePhase(rel({ shippedDate: "2026-10-27" }))).toBe("sluppet");
  });
  it("a late handover pushes the expected release by the same working days; on time it is the release date", () => {
    const p = (r: unknown) => normalizePlan({ lanes: [], tasks: [], releases: [r] });
    const onTime = rel({}, [it_(1, "QA", "Resolved", 3, "2026-10-12")]);
    expect(releaseExpected(p(onTime), onTime, TODAY)).toBe("2026-10-27");
    // «Klar for QA» passed, a story in review, no tempo (nothing developed since the clock started 12.10):
    // development runs at least to today, two working days late (15, 16) → 27.10 + 2
    const stalled = rel({ qaDate: "2026-10-14" }, [it_(2, "Codereview", "InProgress", 5), it_(3, "Closed", "Completed", 2, "2026-10-08", "2026-10-09")]);
    expect(releaseExpected(p(stalled), stalled, TODAY)).toBe("2026-10-29");
    // with a tempo (3 SP in the five working days since 12.10) development ends on the tempo's day 29.10,
    // eleven working days after 14.10 → 27.10 + 11
    const late = rel({ qaDate: "2026-10-14" });
    expect(releaseExpected(p(late), late, TODAY)).toBe("2026-11-11");
  });
  it("the tempo aims at «Klar for QA» and says «utviklet»", () => {
    const late = rel({ qaDate: "2026-10-14" });
    expect(releasePace(normalizePlan({ lanes: [], tasks: [], releases: [late] }), late, TODAY)!.text)
      .toBe("50 % utviklet · 100 % av tiden brukt · med dagens tempo klar for QA 29. okt, elleve arbeidsdager etter");
  });
  it("R18: the chance's sentence aims at «Klar for QA» when it is set", () => {
    const fc = { day: "2026-10-16", need: 8, days: 3, p: 0.44, mean: 7, p10: 4, p90: 9, people: [], basis: [], capacity: [] };
    const r = { key: "r1", version: "2.0.1", targetDate: "2026-10-27", qaDate: "2026-10-20", ado: { at: "x", label: "2.0.1", items: [], forecast: fc } };
    expect(releaseForecastText(r as never, "2026-10-16")!.text).toBe("44 % sjanse for at alt er utviklet til klar for QA 20. okt");
    expect(releaseForecastText({ ...r, qaDate: undefined } as never, "2026-10-16")!.text).toBe("44 % sjanse for at alt er utviklet til 27. okt");   // D9
    const developed = { ...r, ado: { ...r.ado, items: [{ id: 1, type: "Bug", title: "", state: "QA", category: "Resolved", points: 3, assignee: null }] } };
    expect(releaseForecastText(developed as never, "2026-10-16")).toBeNull();   // in QA there is no chance (spec §5)
    expect(releaseForecastText({ ...developed, qaDate: undefined } as never, "2026-10-16")).not.toBeNull();   // one phase reads as today (D7)
  });
  it("R18: the missing-Capacity sentences say «fram til klar for QA» when it is set, and «fram til målet» without it (D7)", () => {
    const miss = (sprints: string[], unplanned: number) => ({ day: "2026-10-16", missing: "capacity", sprints, unplanned });
    const r = (f: unknown, qaDate?: string) => ({ key: "r1", version: "2.0.1", targetDate: "2026-10-27", ...(qaDate ? { qaDate } : {}), ado: { at: "x", label: "2.0.1", items: [], forecast: f } });
    expect(releaseForecastText(r(miss([], 3), "2026-10-20") as never, "2026-10-16")!.text).toBe("Lag sprintene fram til klar for QA i ADO og fyll inn Capacity (3 arbeidsdager er uten sprint) for å få sannsynligheten");
    expect(releaseForecastText(r(miss(["Sprint 71"], 2), "2026-10-20") as never, "2026-10-16")!.text).toBe("Fyll inn Capacity i ADO for Sprint 71 (Development-timer per dag og fridager) og lag sprintene fram til klar for QA (2 arbeidsdager er uten sprint) for å få sannsynligheten");
    expect(releaseForecastText(r(miss([], 3)) as never, "2026-10-16")!.text).toBe("Lag sprintene fram til målet i ADO og fyll inn Capacity (3 arbeidsdager er uten sprint) for å få sannsynligheten");
    expect(releaseForecastText(r(miss(["Sprint 71"], 2)) as never, "2026-10-16")!.text).toBe("Fyll inn Capacity i ADO for Sprint 71 (Development-timer per dag og fridager) og lag sprintene fram til målet (2 arbeidsdager er uten sprint) for å få sannsynligheten");
  });
  it("the QA sentence per phase", () => {
    expect(releaseQaText(rel(), TODAY)).toBe("Klar for QA 20. okt · release 27. okt");
    expect(releaseQaText(rel({}, [it_(1, "QA", "Resolved", 3, "2026-10-12"), it_(2, "Closed", "Completed", 5, "2026-10-13", "2026-10-15")]), TODAY)).toBe("I QA: 1 av 2 lukket · release 27. okt");
    expect(releaseQaText(rel({ shippedDate: "2026-10-27", openAtShip: [2] }), TODAY)).toBe("Sluppet 27. okt · 1 åpen ved release");
  });
  it("R18 (D6): given the plan, the QA sentence names the expected release when it is later than «Release»; on time, with one date (D7) or once out, it does not", () => {
    const p = (r: unknown) => normalizePlan({ lanes: [], tasks: [], releases: [r] });
    const late = rel({ qaDate: "2026-10-14" });   // the review's probe: «Klar for QA» 14.10 passed, a story still in Codereview, the tempo's day 29.10 → 27.10 + 11
    expect(releaseExpectedLate(p(late), late, TODAY)).toBe("2026-11-11");
    expect(releaseQaText(late, TODAY, p(late))).toBe("Klar for QA 14. okt · release 27. okt · forventet release 11. nov");
    expect(releaseQaText(late, TODAY)).toBe("Klar for QA 14. okt · release 27. okt");   // without the plan, only the release's own dates
    const handedLate = rel({ qaDate: "2026-10-14" }, [it_(1, "QA", "Resolved", 3, "2026-10-16"), it_(3, "Closed", "Completed", 2, "2026-10-08", "2026-10-14")]);   // all developed 16.10: two working days late
    expect(releaseQaText(handedLate, TODAY, p(handedLate))).toBe("I QA: 1 av 2 lukket · release 27. okt · forventet release 29. okt");
    const onTime = rel({}, [it_(1, "QA", "Resolved", 3, "2026-10-12")]);
    expect(releaseExpectedLate(p(onTime), onTime, TODAY)).toBeNull();
    expect(releaseQaText(onTime, TODAY, p(onTime))).toBe("I QA: 0 av 1 lukket · release 27. okt");
    const one = rel({ qaDate: undefined });   // one date: the tempo's day 29.10 is past «Release», and still nothing is added
    expect(releaseExpected(p(one), one, TODAY)).toBe("2026-10-29");
    expect(releaseExpectedLate(p(one), one, TODAY)).toBeNull();
    expect(releaseQaText(one, TODAY, p(one))).toBe("Release 27. okt");
    const out = rel({ qaDate: "2026-10-14", shippedDate: "2026-11-11" });
    expect(releaseExpectedLate(p(out), out, TODAY)).toBeNull();
    expect(releaseQaText(out, TODAY, p(out))).toBe("Sluppet 11. nov");
  });
  it("the burndown carries a second series (not closed yet) and the QA day", () => {
    const d = releaseBurndownData(normalizePlan({ lanes: [], tasks: [], releases: [rel()] }), rel(), TODAY)!;
    expect(d).toMatchObject({ qaDay: "2026-10-20", targetDay: "2026-10-20", releaseDay: "2026-10-27" });   // the ideal line ends at «Klar for QA»
    expect(d.closedActual.at(-1)).toEqual({ day: TODAY, remaining: 8 });   // 10 SP, 2 closed
  });
  it("a closed item without a closed day counts as closed from the day it was developed, so «ikke lukket» never dips below «ikke utviklet»", () => {
    const r = rel({}, [it_(1, "Closed", "Completed", 2, "2026-10-14"), it_(2, "Codereview", "InProgress", 5)]);
    const d = releaseBurndownData(normalizePlan({ lanes: [], tasks: [], releases: [r] }), r, TODAY)!;
    expect(d.closedActual.map((x) => [x.day, x.remaining])).toEqual([["2026-10-12", 7], ["2026-10-13", 7], ["2026-10-14", 5], ["2026-10-15", 5], ["2026-10-16", 5]]);
    d.closedActual.forEach((c, k) => expect(c.remaining).toBeGreaterThanOrEqual(d.actual[k].remaining));
  });
  it("R16 under R18: a late handover moves the delivery by the slip, and its colour follows", () => {
    const at = (r: ReturnType<typeof rel>) => {
      const p = normalizePlan({ lanes: [], tasks: [], releases: [r], deliveries: [{ key: "d1", name: "Skytale 2.0.1", allCustomers: true, customers: [], promisedDate: "2026-10-27", epics: [], releases: ["r1"] }] });
      return [deliveryComputed(p, p.deliveries![0], TODAY).day, deliveryStatus(p, p.deliveries![0], TODAY).code];
    };
    expect(at(rel({}, [it_(1, "QA", "Resolved", 3, "2026-10-12")]))).toEqual(["2026-10-27", "gronn"]);   // handed over on time: the release date
    // «Klar for QA» 14.10 passed with a story still in review (the brief's releaseExpected numbers)
    expect(at(rel({ qaDate: "2026-10-14" }, [it_(2, "Codereview", "InProgress", 5), it_(3, "Closed", "Completed", 2, "2026-10-08", "2026-10-09")]))).toEqual(["2026-10-29", "gul"]);   // two working days late
    expect(at(rel({ qaDate: "2026-10-14" }))).toEqual(["2026-11-11", "rod"]);   // eleven working days late
  });
  it("R16 under R18: a bug developed but not closed is still a bug left", () => {
    const bug = (id: number, state: string, category: string, delivered?: string, closed?: string) => ({ ...it_(id, state, category, 1, delivered, closed), type: "Bug" });
    const p = normalizePlan({ lanes: [], tasks: [], releases: [rel({}, [bug(1, "QA", "Resolved", "2026-10-12"), bug(2, "Resolved", "", "2026-10-12"), bug(3, "Closed", "Completed", "2026-10-12", "2026-10-14")])],
      deliveries: [{ key: "d1", name: "Skytale 2.0.1", allCustomers: true, customers: [], promisedDate: "2026-10-27", epics: [], releases: ["r1"] }] });
    expect(deliveryBugsLeft(p, p.deliveries![0])).toBe(2);   // in QA, and «Resolved» by name (no category); the closed one is not left
  });
});

describe("normalizePlan: sprintCheck (R19)", () => {
  const VALID: SprintCheck = {
    at: "2026-10-17T10:00:00Z",
    current: "Sprint 71",
    next: "Sprint 72",
    statesMissing: true,
    bugs: { open: 40, A: 3, B: 12, C: 15, D: 4, none: 6, inNext: 9, inNextPoints: 14, closedCurrent: 7 },
    issues: { open: 17 },
    release: { label: "2.0.1", bugs: 11, issues: 1 },
    sprints: [
      { name: "Sprint 69", end: "2026-09-25", openBugs: 35, openIssues: 15, created: 12, closed: 10, closedPoints: 21 },
      { name: "Sprint 70", end: "2026-10-09", openBugs: 38, openIssues: 16, created: 14, closed: 11, closedPoints: 24.5 },
    ],
    budget: { points: null, share: 0.45, missing: "capacity" },
    features: { f1: { stories: 6, open: 4, inNext: 2, inNextPoints: 5, inCurrent: 1 } },
  };
  it("keeps a valid sprintCheck as it is", () => {
    expect(normalizePlan({ lanes: [], tasks: [], sprintCheck: structuredClone(VALID) }).sprintCheck).toEqual(VALID);
  });
  /* eslint-disable @typescript-eslint/no-explicit-any -- the spoilers write values the type forbids */
  it.each([
    ["no read time", (c: any) => { delete c.at; }],
    ["a negative count", (c: any) => { c.bugs.C = -1; }],
    ["a count that is not a number", (c: any) => { c.issues.open = "17"; }],
    ["a release count that is not finite", (c: any) => { c.release.bugs = Infinity; }],
    ["a release without a label", (c: any) => { c.release.label = ""; }],
    ["a sprint without a name", (c: any) => { c.sprints[0].name = 7; }],
    ["a sprint end that is not a day", (c: any) => { c.sprints[0].end = "17.10"; }],
    ["a share above 1", (c: any) => { c.budget.share = 1.2; }],
    ["an unknown missing reason", (c: any) => { c.budget.missing = "tid"; }],
    ["a feature count missing", (c: any) => { delete c.features.f1.inCurrent; }],
    ["a next sprint that is not a string", (c: any) => { c.next = 72; }],
  ])("drops the whole sprintCheck on %s", (_, spoil) => {
    const c = structuredClone(VALID); spoil(c);
    expect("sprintCheck" in normalizePlan({ lanes: [], tasks: [], sprintCheck: c })).toBe(false);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  it("keeps a read without a release, and one from before the release was left out (its label counts are dropped)", () => {
    const none = structuredClone(VALID); delete none.release;
    expect(normalizePlan({ lanes: [], tasks: [], sprintCheck: none }).sprintCheck).toEqual(none);
    const old = { ...structuredClone(none), bugs: { ...none.bugs, inRelease: { "2.0.1": 11 } } };
    expect(normalizePlan({ lanes: [], tasks: [], sprintCheck: old }).sprintCheck).toEqual(none);
  });
  it("keeps only the known fields", () => {
    const c = { ...structuredClone(VALID), extra: 1, bugs: { ...structuredClone(VALID).bugs, extra: 2 } };
    expect(normalizePlan({ lanes: [], tasks: [], sprintCheck: c }).sprintCheck).toEqual(VALID);
  });
});

describe("R19: the Sprint tab", () => {
  const U = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
  const sprint = (n: number, start: string, finish: string): Sprint => ({ name: "Sprint " + n, path: "Skytale\\Sprint " + n, start, finish });
  const SPR: Sprint[] = [sprint(70, "2026-09-28", "2026-10-09"), sprint(71, "2026-10-12", "2026-10-23"), sprint(72, "2026-10-26", "2026-11-06"), sprint(73, "2026-11-09", "2026-11-20")];
  const TODAY = "2026-10-16";
  // estimates: likely four and late six weeks after their start; discoveries two weeks long
  const feat = (id: string, lane: string, start: number, over: Partial<PlanTask> = {}): PlanTask =>
    ({ id, lane, label: "Feature " + id.slice(1), kind: "estimate", start, endLikely: start + 4 * WEEK, end: start + 6 * WEEK, deps: [], fv: {}, ...over });
  const discovery = (id: string, lane: string, start: number, state: "utredes" | "ny"): PlanTask =>
    ({ id, lane, label: "Utredning " + id.slice(1), kind: "discovery", state, start, end: start + 2 * WEEK, deps: [], fv: {} });
  const PLAN: Plan = normalizePlan({
    lanes: [{ key: "a", name: "Epic A" }, { key: "b", name: "Epic B" }],
    sprints: { at: "2026-10-16T08:00:00Z", items: SPR },
    tasks: [
      discovery("d1", BACKLOG, U(2026, 10, 12), "utredes"),
      discovery("d2", BACKLOG, U(2026, 10, 19), "ny"),
      discovery("d3", BACKLOG, U(2026, 10, 28), "ny"),
      discovery("d4", "a", U(2026, 11, 16), "utredes"),   // in an epic, after the next sprint: not due
      feat("f1", "a", U(2026, 10, 26), { adoId: 101 }),
      feat("f2", "a", U(2026, 10, 30), { adoId: 102 }),
      feat("f3", "b", U(2026, 10, 5), { adoId: 103 }),
      feat("f4", "b", U(2026, 10, 19), { adoId: 104 }),
      feat("f5", "a", U(2026, 11, 2)),
      feat("f8", "b", U(2026, 11, 2), { adoId: 108 }),
      feat("f6", "a", U(2026, 10, 5), { adoId: 106, state: "levert", deliveredAt: "2026-10-14" }),   // delivered: never due, never in work
      feat("f7", BACKLOG, U(2026, 10, 26), { adoId: 107 }),   // on the shelf (klar): not a feature of an epic
    ],
  });
  const fc = (stories: number, open: number, inNext: number, inNextPoints: number, inCurrent: number) => ({ stories, open, inNext, inNextPoints, inCurrent });
  const HC: SprintCheck = {
    at: "2026-10-17T10:40:00Z",
    current: "Sprint 71",
    next: "Sprint 72",
    bugs: { open: 43, A: 1, B: 12, C: 21, D: 9, none: 0, inNext: 6, inNextPoints: 18, closedCurrent: 7 },
    issues: { open: 17 },
    release: { label: "2.0.1", bugs: 9, issues: 0 },
    sprints: [   // oldest first; only the last two count
      { name: "Sprint 67", end: "2026-08-28", openBugs: 30, openIssues: 12, created: 9, closed: 2, closedPoints: 3 },
      { name: "Sprint 68", end: "2026-09-11", openBugs: 35, openIssues: 14, created: 7, closed: 3, closedPoints: 9 },
      { name: "Sprint 69", end: "2026-09-25", openBugs: 40, openIssues: 15, created: 5, closed: 8, closedPoints: 16 },
      { name: "Sprint 70", end: "2026-10-09", openBugs: 41, openIssues: 16, created: 3, closed: 12, closedPoints: 24 },
    ],
    budget: { points: 53, share: 0.45 },
    features: {},
  };
  const CHECK: SprintCheck = { ...HC, features: { f1: fc(4, 3, 3, 8, 0), f2: fc(2, 2, 0, 0, 0), f3: fc(5, 2, 0, 0, 2), f4: fc(1, 1, 0, 0, 0), gone: fc(1, 1, 1, 1, 0) } };
  const SLIP: Plan = normalizePlan({
    lanes: [{ key: "t", name: "Telenor kan bygge på oss", goalDate: U(2026, 12, 15) }],
    sprints: { at: "2026-10-16T08:00:00Z", items: SPR },
    tasks: [{ id: "x", lane: "t", label: "Kontaktkort", kind: "estimate", start: U(2026, 10, 26), endLikely: U(2026, 11, 27), end: U(2026, 12, 11), deps: [], fv: {} }],
  });

  it("nextSprint: the sprint after the current one, the first after a gap, none after the last", () => {
    expect(nextSprint(SPR, new Date(2026, 9, 16))!.name).toBe("Sprint 72");
    expect(nextSprint(SPR, new Date(2026, 9, 24))!.name).toBe("Sprint 72");   // the weekend between 71 and 72
    expect(nextSprint([...SPR].reverse(), new Date(2026, 9, 16))!.name).toBe("Sprint 72");
    const xmas = [{ name: "Sprint 75", path: "p", start: "2026-12-07", finish: "2026-12-18" }, { name: "Sprint 76", path: "p", start: "2027-01-04", finish: "2027-01-15" }];
    expect(nextSprint(xmas, new Date(2026, 11, 28))!.name).toBe("Sprint 76");
    expect(nextSprint(SPR, new Date(2026, 10, 12))).toBeNull();
    expect(nextSprint(undefined, new Date(2026, 9, 16))).toBeNull();
  });
  it("budgetShare and sprintRangeText", () => {
    expect(budgetShare({ capacity: { mode: "transition", at: "x" } })).toBe(0.45);
    expect(budgetShare({ capacity: { mode: "normal", at: "x" } })).toBe(0.4);
    expect(budgetShare(null)).toBe(0.45);
    expect(sprintRangeText(SPR[2])).toBe("26. okt – 6. nov");
  });
  it("sprintDue: discoveries and features by D6, in start order, a stale cache ignored", () => {
    const due = sprintDue(PLAN, CHECK, TODAY);
    expect(due.sprint!.name).toBe("Sprint 72");
    expect(due.discoveries.map((d) => [d.task.id, d.status])).toEqual([["d1", "i gang"], ["d2", "sent"], ["d3", "ikke startet"]]);
    expect(due.features.map((d) => [d.task.id, d.status])).toEqual([["f3", "planlagt"], ["f4", "sent"], ["f1", "planlagt"], ["f2", "uten stories"], ["f5", "ikke i ADO"], ["f8", "uten stories"]]);
    expect(due.features[2]).toMatchObject({ start: "2026-10-26", inNext: 3, inNextPoints: 8, open: 3 });
    expect(due.discoveries[0].epic).toBeNull();
    expect(due.features[0].epic!.key).toBe("b");
    expect(dueFeatureIds(PLAN, TODAY).sort()).toEqual(["f1", "f2", "f3", "f4", "f8"]);
  });
  it("sprintDue without sprints or without a check", () => {
    expect(sprintDue({ ...PLAN, sprints: undefined }, CHECK, TODAY)).toEqual({ sprint: null, discoveries: [], features: [] });
    expect(sprintDue(PLAN, null, TODAY).features.map((d) => d.status)).toEqual(["sent", "sent", "uten stories", "uten stories", "ikke i ADO", "uten stories"]);
  });
  it("sprintInWork: the features whose bar holds today", () => {
    expect(sprintInWork(PLAN, TODAY).map((t) => t.id)).toEqual(["f3"]);
  });
  it("slipCost: one sprint later moves the end two weeks and turns the epic amber", () => {
    const c = slipCost(SLIP, "x", TODAY)!;
    expect(c).toMatchObject({ weeks: 2, sprint: "Sprint 73", epic: { key: "t", before: "gronn", after: "gul", goalDate: U(2026, 12, 15) } });
    expect(slipCostText(c)).toBe("starter tidligst Sprint 73 → slutt +2 uker → «Telenor kan bygge på oss» blir gul (mål 15. des)");
  });
  it("slipCost: nothing moves for a feature already after the next sprint, none without a sprint after next", () => {
    const late = normalizePlan(structuredClone(SLIP)); const x = late.tasks[0]; x.start = U(2026, 11, 9); x.endLikely = U(2026, 11, 27); x.end = U(2026, 12, 11);
    expect(slipCostText(slipCost(late, "x", TODAY)!)).toBe("starter tidligst Sprint 73 → slutten flytter seg ikke");
    expect(slipCost({ ...SLIP, sprints: { at: "x", items: SPR.slice(0, 3) } }, "x", TODAY)).toBeNull();
  });
  it("slipCostText: no epic, and a colour that stays", () => {
    expect(slipCostText({ weeks: 1, sprint: "Sprint 73", epic: null })).toBe("starter tidligst Sprint 73 → slutt +1 uke");
    expect(slipCostText({ weeks: 2, sprint: "Sprint 73", epic: { key: "a", name: "A", before: "gronn", after: "gronn", goalDate: null } })).toBe("starter tidligst Sprint 73 → slutt +2 uker · «A» er fortsatt grønn");
  });
  it("healthForecast: now, and at the end of the next sprint (D4)", () => {
    expect(healthForecast(HC)).toEqual({ now: 43, endOfNext: { value: 35, closed: 12, created: 4 } });
  });
  it("nextRelease: the first not shipped, by «Release»", () => {
    const rs = [{ key: "a", version: "2.0.0", targetDate: "2026-10-07", shippedDate: "2026-10-07" }, { key: "c", version: "2.0.2", targetDate: "2026-11-20" }, { key: "b", version: "2.0.1", targetDate: "2026-10-27" }];
    expect(nextRelease({ releases: rs } as Plan)!.key).toBe("b");
    expect(nextRelease({ releases: rs.slice(0, 1) } as Plan)).toBeNull();
    expect(nextRelease(null)).toBeNull();
  });
  it("releaseLeftOutText (D2): what the counts leave out", () => {
    expect(releaseLeftOutText(HC)).toBe("Ikke telt: 9 bugs merket 2.0.1, på vei ut med releasen");
    expect(releaseLeftOutText({ ...HC, release: { label: "2.0.1", bugs: 1, issues: 2 } })).toBe("Ikke telt: 1 bug og 2 issues merket 2.0.1, på vei ut med releasen");
    expect(releaseLeftOutText({ ...HC, release: { label: "2.0.1", bugs: 0, issues: 1 } })).toBe("Ikke telt: 1 issue merket 2.0.1, på vei ut med releasen");
    expect(releaseLeftOutText({ ...HC, release: { label: "2.0.1", bugs: 0, issues: 0 } })).toBe("");
    const none: SprintCheck = { ...HC }; delete none.release;
    expect(releaseLeftOutText(none)).toBe("");
    expect(releaseLeftOutText(null)).toBe("");
  });
  it("healthForecast: by count when the bugs had no points; none without a budget or history", () => {
    const noPts = { ...HC, sprints: HC.sprints.map((s) => ({ ...s, closedPoints: 0 })) };
    expect(healthForecast(noPts).endOfNext).toEqual({ value: 37, closed: 10, created: 4 });
    expect(healthForecast({ ...HC, budget: { points: null, share: 0.45, missing: "capacity" } }).endOfNext).toBeNull();
    expect(healthForecast({ ...HC, sprints: [] }).endOfNext).toBeNull();
  });
  it("budgetText and healthStripText", () => {
    expect(budgetText(HC)).toBe("45 % ≈ 24 SP av ~53 · 18 SP planlagt på bugs");
    expect(budgetText({ ...HC, bugs: { ...HC.bugs, inNextPoints: 0 } })).toBe("45 % ≈ 24 SP av ~53 · ingen SP planlagt på bugs ennå");
    expect(budgetText({ ...HC, budget: { points: null, share: 0.45, missing: "capacity" } })).toBe("Ingen budsjett: fyll inn Capacity i ADO for Sprint 72 (Development-timer per dag og fridager)");
    expect(budgetText({ ...HC, budget: { points: null, share: 0.45, missing: "history" } })).toBe("Ingen budsjett: ingen utviklede poeng i de to siste sprintene å regne tempo fra");
    expect(budgetText({ ...HC, next: null, budget: { points: null, share: 0.45 } })).toBe("Ingen budsjett: ingen neste sprint i ADO");
    expect(healthStripText(HC)).toBe("43 åpne bugs · 17 issues");
    expect(healthStripText({ ...HC, bugs: { ...HC.bugs, open: 1 }, issues: { open: 1 } })).toBe("1 åpen bug · 1 issue");
    expect(healthStripText(null)).toBe("");
  });
  it("sprintCheckMarkdown: the head, the lists, a flagged row's cost and the read time", () => {
    const md = sprintCheckMarkdown({ ...PLAN, releases: [{ key: "r", version: "2.0.1", targetDate: "2026-10-22" }] } as Plan, { ...HC, features: CHECK.features, at: "2026-10-17T10:40:00Z" }, TODAY);
    expect(md.split("\n").slice(0, 8).join("\n")).toBe("## Sprint 72 · 26. okt – 6. nov\n\n**App-helse:** 43 åpne bugs (A 1 · B 12 · C 21 · D 9) · 17 issues\n- Ikke telt: 9 bugs merket 2.0.1, på vei ut med releasen\n- Ved slutten av Sprint 72: ≈ 35 (lukker ~12, ~4 nye)\n\n**Budsjett for bugs og issues:** 45 % ≈ 24 SP av ~53 · 18 SP planlagt på bugs\n");
    expect(md).toContain("### Utredninger som skal i gang\n- Hylla › ");
    expect(md).toMatch(/- Epic B › .+ · sent · starter tidligst Sprint 73 → /);
    expect(md.trim().endsWith("_Lest fra ADO 17. okt 12:40_")).toBe(true);
    expect(sprintCheckMarkdown(PLAN, { ...HC, statesMissing: true, at: "2026-10-17T10:40:00Z" }, TODAY)).toContain("_ADOs tilstander ble ikke funnet: alt unntatt Closed og Removed er telt som åpent._");
  });
});
