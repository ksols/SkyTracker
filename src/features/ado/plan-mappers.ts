// Pure mapping between the plan and ADO work items: the fields SkyTracker owns on an Epic / Feature /
// discovery story, the per-field decision write · skip · conflict against the snapshot of the last push
// (spec §5 R3: conflicts are listed, never overwritten), and the JSON patches.
import type { Plan, PlanLane, PlanTask } from "@/features/timeline/merge";
import { bufferLabel, epicWindowText, fmtDate, goalText, unitToDate, windowLabel } from "@/features/timeline/epic-tools.js";
import { ADO_PARENT_REL, ADO_PREDECESSOR_REL, adoWorkItemApiUrl } from "./config";
import type { AdoWorkItem, JsonPatch } from "./client";

export const F = {
  title: "System.Title",
  description: "System.Description",
  state: "System.State",
  targetDate: "Microsoft.VSTS.Scheduling.TargetDate",
  startDate: "Microsoft.VSTS.Scheduling.StartDate",
  assignedTo: "System.AssignedTo",
} as const;
export type OwnedField = "title" | "description" | "state" | "targetDate" | "startDate";
export const OWNED_FIELDS: OwnedField[] = ["title", "description", "state", "targetDate", "startDate"];
export const FIELD_LABEL: Record<OwnedField, string> = { title: "Tittel", description: "Beskrivelse", state: "Tilstand", targetDate: "Måldato", startDate: "Startdato" };
export type Snapshot = Partial<Record<OwnedField, string | null>>;
export type Fields = Snapshot & { parentAdoId?: number | null; assignedTo?: string | null };
export type Conflict = { field: OwnedField; ours: string | null; theirs: string | null };

// ADO's Agile process in the Skytale project (checked 09.10.2026): New · Active · Resolved · Discovery · Closed · Removed.
// `levert` is only ever read from ADO (Resolved/Closed): the push never writes a state for it.
export const FEATURE_STATE_TO_ADO: Record<string, string | null> = { ny: "New", utredes: "Discovery", klar: "New", aktiv: "Active", levert: null };
export const EPIC_STATE_TO_ADO: Record<string, string> = { forslag: "New", aktiv: "Active", avsluttet: "Closed" };

/** ADO stores dates as UTC midnight of the calendar day. */
export function unitToAdoDate(u: number): string {
  const d = unitToDate(u);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "T00:00:00Z";
}
export const adoDay = (v: unknown): string | null => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
// ADO re-encodes what it stores (entities for «», –, →, &, nbsp; <div> for <p>): compare the text, not the markup.
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "–", mdash: "—", rarr: "→",
  aring: "å", Aring: "Å", oslash: "ø", Oslash: "Ø", aelig: "æ", AElig: "Æ", eacute: "é", Eacute: "É", egrave: "è", uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö", auml: "ä", Auml: "Ä", hellip: "…", copy: "©", bull: "•" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(parseInt(e[1].toLowerCase() === "x" ? e.slice(2) : e.slice(1), e[1].toLowerCase() === "x" ? 16 : 10)) : ENTITY[e] ?? ENTITY[e.toLowerCase()] ?? m);
export const normHtml = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/ /g, " ").replace(/\s+/g, " ").trim();
/** ADO's HTML as plain text: block ends become line breaks, entities are decoded, whitespace is collapsed per line. */
export const htmlToText = (s: string) =>
  decodeEntities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
/** Plain text back to ADO's HTML: one paragraph per line. */
export const textToHtml = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => "<p>" + esc(l) + "</p>").join("");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const span = (r: { likely: number; late: number }) => (r.likely === r.late ? String(r.late) : r.likely + "–" + r.late);

export function epicDescription(plan: Plan, lane: PlanLane): string {
  if (lane.description) return textToHtml(lane.description);   // the epic's own text (imported or typed) is what ADO shows
  const parts = ["<p>Planlagt i Tidslinjen (SkyTracker).</p>"];
  if (lane.metric) parts.push("<p>Måltall: " + esc(lane.metric) + "</p>");
  const win = epicWindowText(plan, lane.key);
  parts.push("<p>" + esc((win ? win + " · " : "") + goalText(lane) + (lane.externalDate ? " (ekstern dato)" : "")) + "</p>");
  return parts.join("");
}
export function featureDescription(plan: Plan, task: PlanTask): string {
  if (task.description) return textToHtml(task.description);   // the feature's own text (imported or typed) is what ADO shows
  const lane = plan.lanes.find((l) => l.key === task.lane);
  const parts = ["<p>Planlagt i Tidslinjen (SkyTracker)" + (lane ? " under epicen " + esc(lane.name) : "") + ".</p>"];
  if (task.kind === "discovery") {
    parts.push("<p>Utredning til " + esc(fmtDate(unitToDate(task.end))) + (task.assignee ? ", eier " + esc(task.assignee) : "") + ".</p>");
  } else {
    parts.push("<p>Spenn: " + esc(bufferLabel(task)) + " → " + esc(windowLabel(task)) + ".</p>");
    // the raw estimate stays visible in ADO as text until the estimate fields exist (decision 4)
    if (task.raw) parts.push("<p>Utredning sa " + esc(span(task.raw)) + " uker.</p>");
  }
  return parts.join("");
}
export function epicFields(plan: Plan, lane: PlanLane): Fields {
  return {
    title: lane.name,
    description: epicDescription(plan, lane),
    state: EPIC_STATE_TO_ADO[lane.state ?? "aktiv"],
    targetDate: typeof lane.goalDate === "number" ? unitToAdoDate(lane.goalDate) : null,
    startDate: null,
  };
}
export function featureFields(plan: Plan, task: PlanTask): Fields {
  const lane = plan.lanes.find((l) => l.key === task.lane);
  return {
    title: task.label,
    description: featureDescription(plan, task),
    state: FEATURE_STATE_TO_ADO[task.state ?? "aktiv"] ?? null,
    targetDate: unitToAdoDate(task.end),
    startDate: unitToAdoDate(task.start),
    parentAdoId: lane?.adoId ?? null,
  };
}
export function storyFields(task: PlanTask, people: Record<string, string>): Fields {
  const email = task.assignee ? people[task.assignee.toUpperCase()] ?? null : null;
  return {
    title: "Utredning: " + task.label + (task.assignee && !email ? " (" + task.assignee + ")" : ""),
    description: "<p>Discovery-story fra Tidslinjen (SkyTracker). Sluttdatoen er utredningens sluttdato.</p>",
    state: null,
    targetDate: unitToAdoDate(task.end),
    startDate: unitToAdoDate(task.start),
    assignedTo: email,
  };
}

/** ADO's value of an owned field, normalised the way the snapshot stores it. */
export function adoValue(item: AdoWorkItem | null, f: OwnedField): string | null {
  if (!item) return null;
  const v = item.fields[F[f]];
  if (f === "targetDate" || f === "startDate") return adoDay(v);
  if (f === "description") return normHtml(typeof v === "string" ? v : "") || null;
  return typeof v === "string" ? v : null;
}
const norm = (f: OwnedField, v: string | null | undefined): string | null =>
  v === undefined || v === null ? null : f === "targetDate" || f === "startDate" ? adoDay(v) : f === "description" ? normHtml(v) || null : v;
const same = (f: OwnedField, a: string | null | undefined, b: string | null | undefined) => norm(f, a) === norm(f, b);

/** Per field: ours null → never written; equal to ADO → skipped; ADO still holds what we wrote last (or we never
 *  wrote) → written; ADO changed since our last push and differs from ours → conflict (written only with force). */
export function planFieldWrites(fields: Fields, current: AdoWorkItem | null, snapshot: Snapshot | null, force = false): { writes: Partial<Record<OwnedField, string>>; conflicts: Conflict[] } {
  const writes: Partial<Record<OwnedField, string>> = {};
  const conflicts: Conflict[] = [];
  for (const f of OWNED_FIELDS) {
    const ours = fields[f] ?? null;
    if (ours === null) continue;
    const theirs = adoValue(current, f);
    if (same(f, ours, theirs)) continue;
    const adoChanged = current !== null && snapshot !== null && !same(f, theirs, snapshot[f]);
    if (adoChanged && !force) conflicts.push({ field: f, ours: norm(f, ours), theirs });
    else writes[f] = ours;
  }
  return { writes, conflicts };
}
/** What the snapshot says after a push: ours for every non-conflicting field we have, the old value where ADO won. */
export function snapshotAfter(fields: Fields, conflicts: Conflict[], prev: Snapshot | null): Snapshot {
  const out: Snapshot = { ...(prev ?? {}) };
  for (const f of OWNED_FIELDS) {
    if (conflicts.some((c) => c.field === f)) continue;
    const v = norm(f, fields[f]);
    if (v !== null) out[f] = v;
  }
  return out;
}
export function fieldPatch(writes: Partial<Record<OwnedField, string>>, extra: { assignedTo?: string | null } = {}): JsonPatch[] {
  const ops: JsonPatch[] = [];
  for (const f of OWNED_FIELDS) if (writes[f] !== undefined) ops.push({ op: "add", path: "/fields/" + F[f], value: writes[f] });
  if (extra.assignedTo) ops.push({ op: "add", path: "/fields/" + F.assignedTo, value: extra.assignedTo });
  return ops;
}
export const relTarget = (r: { url: string }) => parseInt(r.url.split("/").pop() ?? "", 10);
/** The parent is replaced when wrong (ADO allows one); predecessors are only ever added, never removed. */
export function relationPatch(current: AdoWorkItem | null, wanted: { parent?: number | null; predecessors?: number[] }): JsonPatch[] {
  const ops: JsonPatch[] = [];
  const rels = current?.relations ?? [];
  if (wanted.parent) {
    const idx = rels.findIndex((r) => r.rel === ADO_PARENT_REL);
    if (idx >= 0 && relTarget(rels[idx]) !== wanted.parent) ops.push({ op: "remove", path: "/relations/" + idx });
    if (idx < 0 || relTarget(rels[idx]) !== wanted.parent) ops.push({ op: "add", path: "/relations/-", value: { rel: ADO_PARENT_REL, url: adoWorkItemApiUrl(wanted.parent) } });
  }
  const have = new Set(rels.filter((r) => r.rel === ADO_PREDECESSOR_REL).map(relTarget));
  for (const id of wanted.predecessors ?? []) if (!have.has(id)) ops.push({ op: "add", path: "/relations/-", value: { rel: ADO_PREDECESSOR_REL, url: adoWorkItemApiUrl(id) } });
  return ops;
}
