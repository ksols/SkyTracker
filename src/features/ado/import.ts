// «Hent fra ADO»: the Epics and Features that already live in ADO, listed for the forum and brought into the plan.
// Pure mapping (spec R7a, decision 5): nothing is written to ADO; an imported item carries a snapshot equal to ADO's
// owned fields, so the next push only writes what someone changes in the tool afterwards.
import type { Plan, PlanLane, PlanTask } from "@/features/timeline/merge";
import { BACKLOG, dateToUnit, fmtDate, normalizePlan, OWNER_DEFAULT, unitToDate, WEEK } from "@/features/timeline/epic-tools.js";
import type { AdoClient, AdoWorkItem } from "./client";
import { ADO_PARENT_REL } from "./config";
import { adoDay, adoValue, htmlToText, OWNED_FIELDS, relTarget, type Snapshot } from "./plan-mappers";

export const IMPORT_WIQL =
  "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('Epic', 'Feature') " +
  "AND [System.State] NOT IN ('Closed', 'Removed', 'Resolved') ORDER BY [System.WorkItemType], [System.Id]";

export type ImportCandidate = {
  id: number;
  type: "Epic" | "Feature";
  title: string;
  state: string;
  assignedTo: string | null;
  assignedEmail: string | null;
  startDate: string | null;
  targetDate: string | null;
  parentId: number | null;
  parentTitle: string | null;
  /** ADO's description as plain text, paragraphs as line breaks. */
  description: string;
  /** ADO's owned fields as the push's snapshot stores them. */
  snapshot: Snapshot;
  /** Checked by default in the dialog (every listed item today; the «QA Area» hats are not listed at all). */
  suggested: boolean;
  /** What the item becomes, in words. */
  mapping: string;
};
export type ImportedItem = { kind: "epic" | "feature"; id: string; adoId: number; label: string };

const SKIP_STATES = new Set(["Closed", "Removed", "Resolved"]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const snapWeek = (u: number) => Math.round(u / WEEK) * WEEK;
const dayUnit = (day: string | null): number | null => {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  return dateToUnit(new Date(y, m - 1, d));
};
const parentOf = (w: AdoWorkItem): number | null => {
  const rel = (w.relations ?? []).find((r) => r.rel === ADO_PARENT_REL);
  if (rel) { const id = relTarget(rel); if (Number.isFinite(id)) return id; }
  const f = w.fields["System.Parent"];
  return typeof f === "number" ? f : null;
};
const assignedOf = (w: AdoWorkItem): { name: string | null; email: string | null } => {
  const a = w.fields["System.AssignedTo"];
  if (!a || typeof a !== "object") return { name: null, email: null };
  const o = a as { displayName?: unknown; uniqueName?: unknown };
  return { name: str(o.displayName), email: str(o.uniqueName) };
};

/** Initials for an assignee: the people map by e-mail, else the first letter of each word of the name. */
export function initialsFor(email: string | null, name: string | null, people: Record<string, string>): string | null {
  if (email) {
    const hit = Object.entries(people).find(([, v]) => v.toLowerCase() === email.toLowerCase());
    if (hit) return hit[0];
  }
  if (name) {
    const ini = name.split(/[\s-]+/).map((w) => w[0]).filter(Boolean).join("").toUpperCase();
    if (ini) return ini;
  }
  return null;
}

function snapshotOf(w: AdoWorkItem): Snapshot {
  const out: Snapshot = {};
  for (const f of OWNED_FIELDS) out[f] = adoValue(w, f);
  return out;
}

/** Everything open in ADO that the plan does not hold, with the parent's title and the mapping in words. */
export async function listImportable(plan: Plan, client: Pick<AdoClient, "wiql" | "batch">, people: Record<string, string>, now: Date = new Date()): Promise<ImportCandidate[]> {
  const held = new Set<number>();
  plan.lanes.forEach((l) => { if (l.adoId) held.add(l.adoId); });
  plan.tasks.forEach((t) => { if (t.adoId) held.add(t.adoId); });
  const ids = await client.wiql(IMPORT_WIQL);
  const items = ids.length ? await client.batch(ids) : [];
  const byId = new Map(items.map((w) => [w.id, w]));
  const missingParents = new Set<number>();
  for (const w of items) { const p = parentOf(w); if (p && !byId.has(p)) missingParents.add(p); }
  for (const w of missingParents.size ? await client.batch([...missingParents]) : []) byId.set(w.id, w);
  const laneNames = new Map<number, string>();
  plan.lanes.forEach((l) => { if (l.adoId) laneNames.set(l.adoId, l.name); });
  const listedEpics = new Map<number, string>();
  for (const w of items) if (w.fields["System.WorkItemType"] === "Epic" && !held.has(w.id)) listedEpics.set(w.id, str(w.fields["System.Title"]) ?? "");
  const today = snapWeek(dateToUnit(now));

  const out: ImportCandidate[] = [];
  for (const w of items) {
    const type = w.fields["System.WorkItemType"];
    if ((type !== "Epic" && type !== "Feature") || held.has(w.id)) continue;
    const state = str(w.fields["System.State"]) ?? "";
    if (SKIP_STATES.has(state)) continue;
    const title = str(w.fields["System.Title"]) ?? "#" + w.id;
    if (/^QA Area/i.test(title)) continue;   // QA's hats for the bugs and issues they report: not features, never imported (GO 12.10)
    const parentId = parentOf(w);
    const parent = parentId ? byId.get(parentId) : undefined;
    const parentTitle = parentId ? laneNames.get(parentId) ?? (parent ? str(parent.fields["System.Title"]) : null) : null;
    const who = assignedOf(w);
    const targetDate = adoDay(w.fields["Microsoft.VSTS.Scheduling.TargetDate"]);
    const startDate = adoDay(w.fields["Microsoft.VSTS.Scheduling.StartDate"]);
    const epicName = parentId ? laneNames.get(parentId) ?? listedEpics.get(parentId) ?? null : null;
    let mapping: string;
    if (type === "Epic") mapping = state === "Active" ? "Epic · aktiv" + (targetDate ? " · måldato " + fmtDate(unitToDate(dayUnit(targetDate)!)) : "") : "Epic · forslag";
    else if (state === "Discovery") {
      const start = dayUnit(startDate) ?? today;
      const end = dayUnit(targetDate) ?? start + 2 * WEEK;
      mapping = "Utredes" + (initialsFor(who.email, who.name, people) ? " · " + initialsFor(who.email, who.name, people) : "") + " · til " + fmtDate(unitToDate(end)) + (epicName ? " · i «" + epicName + "»" : "");
    } else if (state === "Active") mapping = epicName ? "Aktiv i «" + epicName + "»" : "Klar for veikart (ingen epic)";
    else mapping = "Registrert på hylla";
    out.push({
      id: w.id, type, title, state, assignedTo: who.name, assignedEmail: who.email, startDate, targetDate, parentId, parentTitle,
      description: htmlToText(typeof w.fields["System.Description"] === "string" ? (w.fields["System.Description"] as string) : ""),
      snapshot: snapshotOf(w), suggested: true, mapping,
    });
  }
  return out;
}

/** The chosen candidates as lanes and tasks in a new plan. Epics first, so a feature finds its parent. */
export function importItems(plan: Plan, items: ImportCandidate[], ids: number[], opts: { people: Record<string, string>; now: Date }): { plan: Plan; imported: ImportedItem[] } {
  const p: Plan = JSON.parse(JSON.stringify(plan));
  const chosen = new Set(ids);
  const imported: ImportedItem[] = [];
  const laneByAdo = new Map<number, PlanLane>();
  p.lanes.forEach((l) => { if (l.adoId) laneByAdo.set(l.adoId, l); });
  const heldTasks = new Set<number>();
  p.tasks.forEach((t) => { if (t.adoId) heldTasks.add(t.adoId); });
  const nowIso = opts.now.toISOString();
  const today = snapWeek(dateToUnit(opts.now));
  const ado = (c: ImportCandidate) => ({ pushedAt: nowIso, snapshot: { ...c.snapshot } });

  for (const c of items) {
    if (c.type !== "Epic" || !chosen.has(c.id) || laneByAdo.has(c.id)) continue;
    const lane: PlanLane = { key: "ado" + c.id, name: c.title, owner: OWNER_DEFAULT, v: 1, state: c.state === "Active" ? "aktiv" : "forslag", adoId: c.id, ado: ado(c) };
    const goal = dayUnit(c.targetDate);
    if (goal !== null) lane.goalDate = goal;
    if (c.description) lane.description = c.description;
    p.lanes.push(lane);
    laneByAdo.set(c.id, lane);
    imported.push({ kind: "epic", id: lane.key, adoId: c.id, label: c.title });
  }
  for (const c of items) {
    if (c.type !== "Feature" || !chosen.has(c.id) || heldTasks.has(c.id)) continue;
    const lane = c.parentId ? laneByAdo.get(c.parentId) : undefined;
    const start = dayUnit(c.startDate) ?? today;
    const base: PlanTask = { id: "ado" + c.id, lane: lane ? lane.key : BACKLOG, label: c.title, kind: "discovery", start, end: start + WEEK, deps: [], fv: { state: 1 }, adoId: c.id, ado: ado(c) };
    if (c.description) base.description = c.description;
    if (c.state === "Discovery") {
      base.state = "utredes";
      base.startedAt = nowIso;
      base.end = Math.max(start + WEEK, dayUnit(c.targetDate) ?? start + 2 * WEEK);
      const who = initialsFor(c.assignedEmail, c.assignedTo, opts.people);
      if (who) base.assignee = who;
    } else if (c.state === "Active") {
      base.kind = "estimate";
      const target = dayUnit(c.targetDate);
      base.end = target !== null ? Math.max(start + WEEK, target) : start + 6 * WEEK;
      base.endLikely = target !== null ? base.end : start + 4 * WEEK;
      if (lane) {
        base.state = "aktiv";
        base.committedRange = { likely: Math.round((base.endLikely - start) / WEEK), late: Math.round((base.end - start) / WEEK), start };
        base.activatedAt = nowIso.slice(0, 10);
      } else base.state = "klar";
    } else {
      base.state = "ny";
      base.lane = BACKLOG;
    }
    p.tasks.push(base);
    heldTasks.add(c.id);
    imported.push({ kind: "feature", id: base.id, adoId: c.id, label: c.title });
  }
  return { plan: normalizePlan(p), imported };
}
