import { describe, expect, it } from "vitest";
import { dateToUnit } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";
import type { AdoClient, AdoWorkItem, JsonPatch } from "./client";
import { pushItem, PushFailed, refreshPlan, refreshSprints } from "./push";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const NOW = new Date("2026-10-09T08:00:00.000Z");
const OPTS = { people: { THM: "thm@skytale.no" }, now: NOW };
function plan(): Plan {
  return {
    lanes: [{ key: "telenor", name: "Telenor", goalDate: D(2026, 12, 15), state: "aktiv", priority: 1, v: 1 }],
    tasks: [
      { id: "kap", lane: "telenor", label: "Kapasitet", kind: "estimate", start: D(2026, 11, 2), endLikely: D(2026, 11, 2) + 1, end: D(2026, 11, 2) + 1.5, state: "aktiv", deps: ["iam"], order: 2, fv: { tid: 1 } },
      { id: "iam", lane: "telenor", label: "IAM", kind: "discovery", start: D(2026, 10, 19), end: D(2026, 11, 13), state: "utredes", assignee: "THM", order: 1, fv: { tid: 1 } },
    ],
  };
}
/** An in-memory ADO: items by id, patches applied, ids from 5000. */
function fakeAdo(seed: AdoWorkItem[] = []) {
  const items = new Map(seed.map((w) => [w.id, w]));
  let next = 5000;
  const apply = (w: AdoWorkItem, patch: JsonPatch[]) => {
    for (const op of patch) {
      if (op.path.startsWith("/fields/")) w.fields[op.path.slice(8)] = op.value;
      else if (op.path === "/relations/-") (w.relations ??= []).push(op.value as { rel: string; url: string });
      else if (op.op === "remove") w.relations!.splice(parseInt(op.path.split("/").pop()!, 10), 1);
    }
  };
  const calls: string[] = [];
  const client: AdoClient = {
    get: async (id) => { calls.push("get " + id); return items.get(id) ?? null; },
    batch: async (ids) => { calls.push("batch " + ids.join(",")); return ids.map((id) => items.get(id)).filter((w): w is AdoWorkItem => !!w); },
    create: async (type, patch) => { calls.push("create " + type); const w: AdoWorkItem = { id: next++, fields: { "System.WorkItemType": type, "System.State": "New" }, relations: [] }; apply(w, patch); items.set(w.id, w); return w; },
    patch: async (id, patch) => { calls.push("patch " + id); const w = items.get(id)!; apply(w, patch); return w; },
    iterations: async () => ({ name: "Skytale", children: [{ name: "Sprint 71", attributes: { startDate: "2026-10-05T00:00:00Z", finishDate: "2026-10-16T00:00:00Z" } }] }),
    gitItem: async () => null,
  };
  return { items, client, calls };
}

describe("pushItem", () => {
  it("creates the epic first, then the feature parented to it with its predecessor, and the discovery story when utredes; records ids, snapshots and events", async () => {
    const ado = fakeAdo();
    const r = await pushItem(plan(), { kind: "feature", id: "iam" }, ado.client, OPTS);
    expect(r.items.map((i) => [i.kind, i.action, i.adoId])).toEqual([["epic", "create", 5000], ["feature", "create", 5001], ["story", "create", 5002]]);
    const lane = r.plan.lanes[0], iam = r.plan.tasks.find((t) => t.id === "iam")!;
    expect(lane.adoId).toBe(5000);
    expect(lane.v).toBe(2);
    expect(lane.ado!.snapshot.title).toBe("Telenor");
    expect(iam.adoId).toBe(5001);
    expect(iam.fv).toEqual({ tid: 1, meta: 1, ado: 1 });
    expect(iam.ado!.storyId).toBe(5002);
    expect(iam.ado!.pushedAt).toBe(NOW.toISOString());
    const feature = ado.items.get(5001)!;
    expect(feature.fields["System.State"]).toBe("Discovery");
    expect(feature.relations).toContainEqual({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/5000" });
    const story = ado.items.get(5002)!;
    expect(story.fields["System.Title"]).toBe("Utredning: IAM");
    expect(story.fields["System.AssignedTo"]).toBe("thm@skytale.no");
    expect(story.relations).toContainEqual({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/5001" });
    expect(r.events.map((e) => [e.code, e.cause, e.summary])).toEqual([
      ["ado.push", "ado", "Pushet til ADO #5000 (Epic opprettet)"],
      ["ado.push", "ado", "Pushet til ADO #5001 (Feature opprettet, discovery-story #5002)"],
    ]);
    // the blocked feature now links its predecessor; the epic is not pushed again
    const r2 = await pushItem(r.plan, { kind: "feature", id: "kap" }, ado.client, OPTS);
    expect(ado.items.get(5003)!.relations).toContainEqual({ rel: "System.LinkTypes.Dependency-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/5001" });
    expect(r2.items.find((i) => i.kind === "epic")).toBeUndefined();
  });
  it("a second push with nothing changed sends nothing; a change in SkyTracker is written; a change in ADO is a conflict, listed and kept out of the patch; force overwrites", async () => {
    const ado = fakeAdo();
    const r1 = await pushItem(plan(), { kind: "feature", id: "kap" }, ado.client, OPTS);
    ado.calls.length = 0;
    const r2 = await pushItem(r1.plan, { kind: "feature", id: "kap" }, ado.client, OPTS);
    expect(r2.items.map((i) => [i.kind, i.action])).toEqual([["feature", "none"]]);
    expect(ado.calls.filter((c) => c.startsWith("patch") || c.startsWith("create"))).toEqual([]);
    expect(r2.events[0].summary).toBe("Pushet til ADO #5001 (ingen endringer)");
    const p3 = r2.plan;
    p3.tasks.find((t) => t.id === "kap")!.label = "Kapasitet 2.0";
    ado.items.get(5001)!.fields["System.State"] = "Resolved"; // someone moved it in ADO
    const r3 = await pushItem(p3, { kind: "feature", id: "kap" }, ado.client, OPTS);
    const f = r3.items.find((i) => i.kind === "feature")!;
    expect(f.action).toBe("update");
    expect(f.patch).toEqual([{ op: "add", path: "/fields/System.Title", value: "Kapasitet 2.0" }]);
    expect(f.conflicts).toEqual([{ field: "state", ours: "Active", theirs: "Resolved" }]);
    expect(r3.plan.tasks.find((t) => t.id === "kap")!.ado!.conflicts).toEqual([{ field: "state", ours: "Active", theirs: "Resolved" }]);
    expect(r3.events.map((e) => e.code)).toEqual(["ado.push", "ado.konflikt"]);
    expect(r3.events[1].summary).toBe("Konflikt med ADO: Tilstand er «Resolved» i ADO, «Active» her – ikke overskrevet");
    const r4 = await pushItem(r3.plan, { kind: "feature", id: "kap" }, ado.client, { ...OPTS, force: true });
    expect(ado.items.get(5001)!.fields["System.State"]).toBe("Active");
    expect(r4.plan.tasks.find((t) => t.id === "kap")!.ado!.conflicts).toBeUndefined();
  });
  it("dry run: the patches, no create or patch call; without a client it still builds the patches", async () => {
    const ado = fakeAdo();
    const r = await pushItem(plan(), { kind: "epic", id: "telenor" }, ado.client, { ...OPTS, dry: true });
    expect(r.items[0].action).toBe("create");
    expect(r.items[0].patch.some((p) => p.path === "/fields/System.Title")).toBe(true);
    expect(ado.calls.some((c) => c.startsWith("create"))).toBe(false);
    expect(r.plan.lanes[0].adoId).toBeUndefined();
    expect(r.events).toEqual([]);
    const r2 = await pushItem(plan(), { kind: "feature", id: "kap" }, null, { ...OPTS, dry: true });
    expect(r2.items.map((i) => i.kind)).toEqual(["epic", "feature"]);
  });
  it("a shelf feature cannot be pushed; a failure after the epic was created is reported with the partial plan", async () => {
    const p = plan();
    p.tasks[0].lane = "_backlog";
    await expect(pushItem(p, { kind: "feature", id: "kap" }, fakeAdo().client, OPTS)).rejects.toThrow("on-shelf");
    const ado = fakeAdo();
    let n = 0;
    const failing: AdoClient = { ...ado.client, create: async (type, patch) => { if (++n === 2) throw new Error("boom"); return ado.client.create(type, patch); } };
    const err = await pushItem(plan(), { kind: "feature", id: "kap" }, failing, OPTS).catch((e) => e);
    expect(err).toBeInstanceOf(PushFailed);
    expect((err as PushFailed).partial.plan.lanes[0].adoId).toBe(5000);
    expect((err as PushFailed).partial.items.map((i) => i.kind)).toEqual(["epic"]);
  });
});

describe("refreshPlan", () => {
  it("reads stories, points and sprint under each feature, turns Closed into levert, lists new conflicts once and logs ado.lest", async () => {
    const ado = fakeAdo();
    const pushed = await pushItem(plan(), { kind: "feature", id: "kap" }, ado.client, OPTS);
    const storyA: AdoWorkItem = { id: 7001, fields: { "System.WorkItemType": "User Story", "System.State": "Closed", "Microsoft.VSTS.Scheduling.StoryPoints": 3, "System.IterationPath": "Skytale\\Sprint 70" } };
    const storyB: AdoWorkItem = { id: 7002, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "Microsoft.VSTS.Scheduling.StoryPoints": 5, "System.IterationPath": "Skytale\\Sprint 71" } };
    ado.items.set(7001, storyA);
    ado.items.set(7002, storyB);
    const feature = ado.items.get(5001)!;
    feature.relations!.push(
      { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/7001" },
      { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/7002" },
    );
    feature.fields["System.Title"] = "Kapasitet (ADO)";
    const r = await refreshPlan(pushed.plan, ado.client, NOW);
    const kap = r.plan.tasks.find((t) => t.id === "kap")!;
    expect(kap.ado!.stories).toEqual({ count: 2, pointsTotal: 8, pointsDone: 3, iteration: "Sprint 71", at: NOW.toISOString() });
    expect(r.conflicts).toEqual([{ kind: "feature", id: "kap", label: "Kapasitet", field: "title", ours: "Kapasitet", theirs: "Kapasitet (ADO)" }]);
    expect(r.read).toEqual({ epics: 1, features: 1, stories: 2, levert: 0 });
    expect(r.events.map((e) => e.code)).toEqual(["ado.konflikt", "ado.lest"]);
    expect(r.events[1].summary).toBe("Lest fra ADO: 1 epic, 1 feature, 2 stories, 1 konflikt");
    expect(kap.fv!.ado).toBe(2);
    // the same conflict is not logged twice; Closed → levert with the day
    feature.fields["System.State"] = "Closed";
    feature.fields["Microsoft.VSTS.Common.ClosedDate"] = "2026-12-03T10:00:00Z";
    const r2 = await refreshPlan(r.plan, ado.client, NOW);
    const kap2 = r2.plan.tasks.find((t) => t.id === "kap")!;
    expect(kap2.state).toBe("levert");
    expect(kap2.deliveredAt).toBe("2026-12-03");
    expect(kap2.fv!.state).toBe(1);
    expect(r2.events.map((e) => e.code)).toEqual(["ado.lest"]);
    expect(r2.read.levert).toBe(1);
  });
});

describe("refreshSprints", () => {
  it("fetches when the cache is missing or older than the max age, otherwise leaves the plan alone", async () => {
    const ado = fakeAdo();
    const r = await refreshSprints(plan(), ado.client, NOW);
    expect(r.changed).toBe(true);
    expect(r.plan.sprints).toEqual({ at: NOW.toISOString(), items: [{ name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-16" }] });
    const r2 = await refreshSprints(r.plan, ado.client, new Date(NOW.getTime() + 3600 * 1000));
    expect(r2.changed).toBe(false);
    expect(r2.sprints.length).toBe(1);
    expect((await refreshSprints(r.plan, ado.client, new Date(NOW.getTime() + 13 * 3600 * 1000))).changed).toBe(true);
  });
});
