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
