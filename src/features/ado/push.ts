// The mirror, as pure functions over a cloned plan: push one epic or feature (creating the parent epic
// and the discovery story when needed), refresh everything that has an ADO id, refresh the sprint cache.
// The routes read the stored plan, call these, commit with the version guard and log the events.
import { BACKLOG } from "@/features/timeline/epic-tools.js";
import type { AdoConflict, LaneAdo, Plan, PlanLane, PlanTask, Sprint, TaskAdo } from "@/features/timeline/merge";
import { adoEvent, type PlanEvent } from "@/features/timeline/events";
import type { AdoClient, AdoWorkItem, JsonPatch } from "./client";
import { ADO_CHILD_REL, ADO_WORK_ITEM_TYPE } from "./config";
import { epicFields, featureFields, fieldPatch, FIELD_LABEL, planFieldWrites, relationPatch, relTarget, snapshotAfter, storyFields, type Fields, type OwnedField } from "./plan-mappers";
import { deliveredDay, parseSprints, readStories } from "./sync";

export type PushTarget = { kind: "epic" | "feature"; id: string };
export type PushedItem = { kind: "epic" | "feature" | "story"; id: string; label: string; adoId: number | null; action: "create" | "update" | "none"; type: string; patch: JsonPatch[]; conflicts: AdoConflict[] };
export type PushResult = { plan: Plan; items: PushedItem[]; events: PlanEvent[] };
export type PushOpts = { dry?: boolean; force?: boolean; people: Record<string, string>; now: Date };
/** Thrown when a later step failed after an earlier one wrote to ADO: `partial` holds what did succeed, for the caller to commit. */
export class PushFailed extends Error {
  constructor(public partial: PushResult, public cause: unknown) {
    super("push-failed");
    this.name = "PushFailed";
  }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bump = (t: PlanTask, g: "meta" | "ado" | "state") => { t.fv = t.fv ?? {}; t.fv[g] = (t.fv[g] ?? 0) + 1; };
const bumpLane = (l: PlanLane) => { l.v = (l.v ?? 0) + 1; };
const n = (c: number, one: string, many: string) => c + " " + (c === 1 ? one : many);
const conflictLine = (c: AdoConflict) => FIELD_LABEL[c.field as OwnedField] + " er «" + (c.theirs ?? "") + "» i ADO, «" + (c.ours ?? "") + "» her";
type Target = Pick<PlanEvent, "targetType" | "targetId" | "targetLabel" | "laneKey">;
type OneResult = { id: number | null; action: PushedItem["action"]; patch: JsonPatch[]; conflicts: AdoConflict[]; ado: LaneAdo };

async function pushOne(client: AdoClient | null, type: string, adoId: number | null, fields: Fields, prev: LaneAdo | null, rels: { parent?: number | null; predecessors?: number[] }, opts: PushOpts): Promise<OneResult> {
  const current = adoId && client ? await client.get(adoId) : null;
  const { writes, conflicts } = planFieldWrites(fields, current, prev?.snapshot ?? null, opts.force);
  const patch = [...fieldPatch(writes, { assignedTo: fields.assignedTo }), ...relationPatch(current, rels)];
  const action: PushedItem["action"] = !adoId ? "create" : patch.length ? "update" : "none";
  let id = adoId;
  if (!opts.dry && client && action !== "none") id = (action === "create" ? await client.create(type, patch) : await client.patch(id!, patch)).id;
  const ado: LaneAdo = { pushedAt: opts.now.toISOString(), snapshot: snapshotAfter(fields, conflicts, prev?.snapshot ?? null) };
  if (conflicts.length) ado.conflicts = conflicts;
  return { id, action, patch, conflicts, ado };
}
function pushEvents(t: Target, r: OneResult, typeName: string, story?: { id: number | null; action: PushedItem["action"] }): PlanEvent[] {
  const what = r.action === "create" ? typeName + " opprettet" : r.action === "update" ? n(r.patch.length, "endring", "endringer") : "ingen endringer";
  const storyText = story?.action === "create" ? ", discovery-story #" + story.id : "";
  const ev = [adoEvent("ado.push", t, "Pushet til ADO #" + r.id + " (" + what + storyText + ")", { after: { adoId: r.id, action: r.action } })];
  for (const c of r.conflicts) ev.push(adoEvent("ado.konflikt", t, "Konflikt med ADO: " + conflictLine(c) + " – ikke overskrevet", { before: c.theirs, after: c.ours, causeRef: c.field }));
  return ev;
}

export async function pushItem(plan: Plan, target: PushTarget, client: AdoClient | null, opts: PushOpts): Promise<PushResult> {
  const p = clone(plan);
  const result: PushResult = { plan: p, items: [], events: [] };
  const pushEpic = async (lane: PlanLane) => {
    const r = await pushOne(client, "Epic", lane.adoId ?? null, epicFields(p, lane), lane.ado ?? null, {}, opts);
    result.items.push({ kind: "epic", id: lane.key, label: lane.name, adoId: r.id, action: r.action, type: "Epic", patch: r.patch, conflicts: r.conflicts });
    if (opts.dry) return;
    if (r.id && lane.adoId !== r.id) lane.adoId = r.id;
    lane.ado = r.ado;
    bumpLane(lane);
    result.events.push(...pushEvents({ targetType: "epic", targetId: lane.key, targetLabel: lane.name, laneKey: lane.key }, r, "Epic"));
  };
  if (target.kind === "epic") {
    const lane = p.lanes.find((l) => l.key === target.id);
    if (!lane) throw new Error("no-epic");
    await pushEpic(lane);
    return result;
  }
  const task = p.tasks.find((t) => t.id === target.id);
  if (!task) throw new Error("no-feature");
  if (task.lane === BACKLOG) throw new Error("on-shelf");
  const lane = p.lanes.find((l) => l.key === task.lane);
  if (!lane) throw new Error("no-epic");
  try {
    if (!lane.adoId) await pushEpic(lane); // the parent must exist first
    const parent = lane.adoId ?? null;
    const predecessors = (task.deps ?? []).map((d) => p.tasks.find((t) => t.id === d)?.adoId).filter((x): x is number => !!x);
    const r = await pushOne(client, "Feature", task.adoId ?? null, featureFields(p, task), task.ado ?? null, { parent, predecessors }, opts);
    result.items.push({ kind: "feature", id: task.id, label: task.label, adoId: r.id, action: r.action, type: "Feature", patch: r.patch, conflicts: r.conflicts });
    if (!opts.dry) { // record the feature's id and snapshot now: a failure in the story step must never lose them (a lost id means a duplicate next time)
      if (r.id && task.adoId !== r.id) { task.adoId = r.id; bump(task, "meta"); }
      const next: TaskAdo = { ...r.ado };
      if (task.ado?.storyId) next.storyId = task.ado.storyId;
      if (task.ado?.stories) next.stories = task.ado.stories;
      task.ado = next;
      bump(task, "ado");
    }
    let story: { id: number | null; action: PushedItem["action"] } | undefined;
    if (task.state === "utredes") { // the discovery story under the feature: owner and end date; SkyTracker's, so no conflict detection
      const s = await pushOne(client, ADO_WORK_ITEM_TYPE, task.ado?.storyId ?? null, storyFields(task, opts.people), null, { parent: r.id }, opts);
      result.items.push({ kind: "story", id: task.id, label: "Utredning: " + task.label, adoId: s.id, action: s.action, type: ADO_WORK_ITEM_TYPE, patch: s.patch, conflicts: [] });
      story = { id: s.id, action: s.action };
      if (!opts.dry && s.id && task.ado) task.ado.storyId = s.id;
    }
    if (opts.dry) return result;
    result.events.push(...pushEvents({ targetType: "feature", targetId: task.id, targetLabel: task.label, laneKey: task.lane }, r, "Feature", story));
    return result;
  } catch (e) {
    throw new PushFailed(result, e);
  }
}

export type RefreshConflict = AdoConflict & { kind: "epic" | "feature"; id: string; label: string };
export type RefreshResult = { plan: Plan; conflicts: RefreshConflict[]; read: { epics: number; features: number; stories: number; levert: number }; events: PlanEvent[] };

export async function refreshPlan(plan: Plan, client: AdoClient, now: Date): Promise<RefreshResult> {
  const p = clone(plan);
  const ids = new Set<number>();
  p.lanes.forEach((l) => { if (l.adoId) ids.add(l.adoId); });
  p.tasks.forEach((t) => { if (t.adoId) ids.add(t.adoId); if (t.ado?.storyId) ids.add(t.ado.storyId); });
  const byId = new Map((ids.size ? await client.batch([...ids]) : []).map((w) => [w.id, w]));
  const childIds = new Set<number>();
  for (const t of p.tasks) for (const r of (t.adoId && byId.get(t.adoId)?.relations) || []) if (r.rel === ADO_CHILD_REL && !byId.has(relTarget(r))) childIds.add(relTarget(r));
  for (const w of childIds.size ? await client.batch([...childIds]) : []) byId.set(w.id, w);
  const events: PlanEvent[] = [], conflicts: RefreshConflict[] = [], read = { epics: 0, features: 0, stories: 0, levert: 0 };
  const check = (t: Target & { kind: "epic" | "feature" }, fields: Fields, prev: LaneAdo | undefined, current: AdoWorkItem): AdoConflict[] => {
    const c = planFieldWrites(fields, current, prev?.snapshot ?? null).conflicts;
    const old = new Set((prev?.conflicts ?? []).map((x) => x.field));
    for (const x of c) {
      conflicts.push({ ...x, kind: t.kind, id: t.targetId, label: t.targetLabel });
      if (!old.has(x.field)) events.push(adoEvent("ado.konflikt", t, "Konflikt med ADO: " + conflictLine(x) + " – ikke overskrevet", { before: x.theirs, after: x.ours, causeRef: x.field }));
    }
    return c;
  };
  const withConflicts = <A extends LaneAdo>(prev: A | undefined, c: AdoConflict[]): A => {
    const next = { ...(prev ?? ({ pushedAt: "", snapshot: {} } as A)) };
    if (c.length) next.conflicts = c; else delete next.conflicts;
    return next;
  };
  for (const l of p.lanes) {
    const w = l.adoId ? byId.get(l.adoId) : undefined;
    if (!w) continue;
    read.epics++;
    const next = withConflicts(l.ado, check({ kind: "epic", targetType: "epic", targetId: l.key, targetLabel: l.name, laneKey: l.key }, epicFields(p, l), l.ado, w));
    if (JSON.stringify(next) !== JSON.stringify(l.ado)) { l.ado = next; bumpLane(l); }
  }
  for (const t of p.tasks) {
    const w = t.adoId ? byId.get(t.adoId) : undefined;
    if (!w) continue;
    read.features++;
    // Resolved/Closed in ADO is the one transition ADO owns: adopt it before comparing, so it is never a conflict
    const day = deliveredDay(w);
    if (day && t.state !== "levert") { t.state = "levert"; t.deliveredAt = day; bump(t, "state"); read.levert++; }
    const next = withConflicts(t.ado, check({ kind: "feature", targetType: "feature", targetId: t.id, targetLabel: t.label, laneKey: t.lane }, featureFields(p, t), t.ado, w));
    const stories = readStories(w, byId, t.ado?.storyId);
    read.stories += stories.count;
    const strip = (a?: TaskAdo) => JSON.stringify({ ...(a ?? {}), stories: a?.stories ? { ...a.stories, at: "" } : undefined });
    next.stories = { ...stories, at: now.toISOString() };
    if (strip(next) !== strip(t.ado)) { t.ado = next; bump(t, "ado"); }
  }
  const parts = [n(read.epics, "epic", "epics"), n(read.features, "feature", "features"), n(read.stories, "story", "stories")];
  if (read.levert) parts.push(read.levert + " levert");
  if (conflicts.length) parts.push(n(conflicts.length, "konflikt", "konflikter"));
  events.push(adoEvent("ado.lest", { targetType: "plan", targetId: "plan", targetLabel: "Planen", laneKey: null }, "Lest fra ADO: " + parts.join(", "), { after: read }));
  return { plan: p, conflicts, read, events };
}

/** The sprint list from ADO's iteration nodes, cached in the plan for half a day (readers and file:// draw from the cache). */
export async function refreshSprints(plan: Plan, client: AdoClient, now: Date, maxAgeMs = 12 * 3600 * 1000): Promise<{ plan: Plan; changed: boolean; sprints: Sprint[] }> {
  const at = plan.sprints?.at ? new Date(plan.sprints.at).getTime() : 0;
  if (plan.sprints && now.getTime() - at < maxAgeMs) return { plan, changed: false, sprints: plan.sprints.items };
  const items = parseSprints(await client.iterations());
  const p = clone(plan);
  p.sprints = { at: now.toISOString(), items };
  return { plan: p, changed: true, sprints: items };
}
