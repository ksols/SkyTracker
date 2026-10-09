import { describe, expect, it } from "vitest";
import { dateToUnit } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";
import type { AdoWorkItem } from "./client";
import { adoValue, epicFields, featureFields, fieldPatch, planFieldWrites, relationPatch, snapshotAfter, storyFields, unitToAdoDate, type Fields } from "./plan-mappers";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const plan: Plan = {
  lanes: [{ key: "telenor", name: "Telenor kan bygge på oss", goalDate: D(2026, 12, 15), metric: "3 kunder i drift", externalDate: true, state: "aktiv", adoId: 4700, priority: 1 }],
  tasks: [
    { id: "kap", lane: "telenor", label: "Kapasitet", kind: "estimate", start: D(2026, 11, 2), endLikely: D(2026, 11, 2) + 5 * 0.25, end: D(2026, 11, 2) + 7 * 0.25, bufferWeeks: 1, raw: { likely: 4, late: 6 }, state: "aktiv", deps: ["iam"], order: 1 },
    { id: "iam", lane: "telenor", label: "IAM", kind: "discovery", start: D(2026, 10, 19), end: D(2026, 11, 13), state: "utredes", assignee: "THM", adoId: 4701, order: 2 },
  ],
};
const item = (fields: Record<string, unknown>, relations: { rel: string; url: string }[] = []): AdoWorkItem => ({ id: 1, fields, relations });

describe("fields", () => {
  it("dates are the calendar day at UTC midnight", () => {
    expect(unitToAdoDate(D(2026, 12, 15))).toBe("2026-12-15T00:00:00Z");
  });
  it("an epic: title, state, TargetDate = goal, description with måltall and the window", () => {
    const f = epicFields(plan, plan.lanes[0]);
    expect(f.title).toBe("Telenor kan bygge på oss");
    expect(f.state).toBe("Active");
    expect(f.targetDate).toBe("2026-12-15T00:00:00Z");
    expect(f.startDate).toBeNull();
    expect(f.description).toContain("Måltall: 3 kunder i drift");
    expect(f.description).toContain("Måldato 15. des (ekstern dato)");
  });
  it("a feature: Discovery for utredes, dates from start/end, parent = the epic's id, the estimate as text", () => {
    const kap = featureFields(plan, plan.tasks[0]);
    expect(kap.state).toBe("Active");
    expect(kap.parentAdoId).toBe(4700);
    expect(kap.startDate).toBe("2026-11-02T00:00:00Z");
    expect(kap.description).toContain("Spenn: 4–6 uker + 1 uke buffer → uke");
    expect(kap.description).toContain("Utredning sa 4–6 uker.");
    const iam = featureFields(plan, plan.tasks[1]);
    expect(iam.state).toBe("Discovery");
    expect(iam.targetDate).toBe("2026-11-13T00:00:00Z");
    expect(iam.description).toContain("Utredning til 13. nov, eier THM.");
  });
  it("the discovery story: assignee resolved through the people map, otherwise in the title", () => {
    expect(storyFields(plan.tasks[1], { THM: "thm@skytale.no" })).toMatchObject({ title: "Utredning: IAM", assignedTo: "thm@skytale.no", targetDate: "2026-11-13T00:00:00Z" });
    expect(storyFields(plan.tasks[1], {})).toMatchObject({ title: "Utredning: IAM (THM)", assignedTo: null });
  });
});

describe("planFieldWrites: write, skip or conflict per field", () => {
  const ours: Fields = { title: "Kapasitet", description: "<p>Planlagt i Tidslinjen (SkyTracker).</p>", state: "Active", targetDate: "2026-12-20T00:00:00Z", startDate: null };
  it("with no item in ADO everything SkyTracker has a value for is written; null values are never written", () => {
    const { writes, conflicts } = planFieldWrites(ours, null, null);
    expect(Object.keys(writes)).toEqual(["title", "description", "state", "targetDate"]);
    expect(conflicts).toEqual([]);
  });
  it("equal values are skipped: dates by day, descriptions by their text", () => {
    const cur = item({ "System.Title": "Kapasitet", "System.Description": "<div>Planlagt i Tidslinjen (SkyTracker).</div>", "System.State": "Active", "Microsoft.VSTS.Scheduling.TargetDate": "2026-12-20T00:00:00Z" });
    expect(planFieldWrites(ours, cur, { title: "Kapasitet", description: "Planlagt i Tidslinjen (SkyTracker).", state: "Active", targetDate: "2026-12-20" }).writes).toEqual({});
  });
  it("ADO changed since our last push and differs from ours: conflict, not written; force writes it anyway", () => {
    const cur = item({ "System.Title": "Kapasitet v2", "System.State": "Active", "Microsoft.VSTS.Scheduling.TargetDate": "2026-12-20T00:00:00Z" });
    const snap = { title: "Kapasitet", state: "Active", targetDate: "2026-12-20" };
    const r = planFieldWrites({ ...ours, description: null }, cur, snap);
    expect(r.conflicts).toEqual([{ field: "title", ours: "Kapasitet", theirs: "Kapasitet v2" }]);
    expect(r.writes).toEqual({});
    expect(planFieldWrites({ ...ours, description: null }, cur, snap, true).writes).toEqual({ title: "Kapasitet" });
  });
  it("ADO unchanged since our push but SkyTracker edited: written (no conflict); ADO changed to exactly our value: skipped", () => {
    const cur = item({ "System.Title": "Kapasitet", "System.State": "New" });
    expect(planFieldWrites({ title: "Kapasitet", state: "Active" }, cur, { title: "Kapasitet", state: "New" }).writes).toEqual({ state: "Active" });
    const cur2 = item({ "System.Title": "Kapasitet v2" });
    expect(planFieldWrites({ title: "Kapasitet v2" }, cur2, { title: "Kapasitet" })).toEqual({ writes: {}, conflicts: [] });
  });
  it("an existing item without a snapshot (first push of a hand-typed ADO id) is treated as ours to write", () => {
    const cur = item({ "System.Title": "Something else" });
    expect(planFieldWrites({ title: "Kapasitet" }, cur, null).writes).toEqual({ title: "Kapasitet" });
  });
  it("snapshotAfter keeps the previous value for a conflicting field and ours elsewhere, normalised", () => {
    const snap = snapshotAfter({ title: "Kapasitet", description: "<p>a  b</p>", targetDate: "2026-12-20T00:00:00Z", state: "Active" }, [{ field: "title", ours: "Kapasitet", theirs: "v2" }], { title: "Old" });
    expect(snap).toEqual({ title: "Old", description: "a b", targetDate: "2026-12-20", state: "Active" });
  });
});

describe("patches", () => {
  it("fieldPatch adds one op per written field plus AssignedTo when given", () => {
    expect(fieldPatch({ title: "T", targetDate: "2026-12-20T00:00:00Z" }, { assignedTo: "thm@skytale.no" })).toEqual([
      { op: "add", path: "/fields/System.Title", value: "T" },
      { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: "2026-12-20T00:00:00Z" },
      { op: "add", path: "/fields/System.AssignedTo", value: "thm@skytale.no" },
    ]);
  });
  it("relationPatch adds a missing parent, replaces a wrong one, and adds only the missing predecessors", () => {
    const url = (id: number) => "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/" + id;
    expect(relationPatch(null, { parent: 4700, predecessors: [4701] })).toEqual([
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: url(4700) } },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Dependency-Reverse", url: url(4701) } },
    ]);
    const cur = item({}, [{ rel: "System.LinkTypes.Related", url: url(1) }, { rel: "System.LinkTypes.Hierarchy-Reverse", url: url(4600) }, { rel: "System.LinkTypes.Dependency-Reverse", url: url(4701) }]);
    expect(relationPatch(cur, { parent: 4700, predecessors: [4701, 4702] })).toEqual([
      { op: "remove", path: "/relations/1" },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: url(4700) } },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Dependency-Reverse", url: url(4702) } },
    ]);
    expect(relationPatch(cur, { parent: 4600, predecessors: [4701] })).toEqual([]);
  });
});

describe("review: what ADO hands back", () => {
  it("a description ADO re-encoded (entities, nbsp, other tags) compares equal to what we wrote", () => {
    const ours: Fields = { description: "<p>Planlagt i Tidslinjen (SkyTracker) under epicen «Telenor & co».</p><p>Spenn: 4–6 uker + 1 uke buffer → uke 49–51.</p>" };
    const cur = item({ "System.Description": "<div>Planlagt&nbsp;i Tidslinjen (SkyTracker) under epicen &#171;Telenor &amp; co&#187;.</div><div>Spenn: 4&#8211;6 uker + 1 uke buffer &#8594; uke 49&#8211;51.</div>" });
    expect(planFieldWrites(ours, cur, { description: "x" })).toEqual({ writes: {}, conflicts: [] });
  });
});

describe("areas as ADO tags (R9)", () => {
  it("areas push as System.Tags; ADO's tags compare in canonical order and case; no tags → nothing written", () => {
    const t = { ...plan.tasks[0], areas: ["iOS", "Backend"] };
    const f = featureFields(plan, t);
    expect(f.tags).toBe("Backend; iOS");
    expect(featureFields(plan, plan.tasks[0]).tags).toBeNull();
    expect(adoValue(item({ "System.Tags": "ios; backend " }), "tags")).toBe("Backend; iOS");
    expect(adoValue(item({}), "tags")).toBeNull();
    const w = planFieldWrites({ tags: "Backend; iOS" }, item({ "System.Tags": "backend; ios" }), { tags: "Backend; iOS" });
    expect(w.writes).toEqual({});
    expect(w.conflicts).toEqual([]);
    expect(fieldPatch({ tags: "Backend; iOS" })).toEqual([{ op: "add", path: "/fields/System.Tags", value: "Backend; iOS" }]);
  });
});
