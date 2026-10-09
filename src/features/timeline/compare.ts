// Compare mode (spec §4.4): the net movement since a baseline (diffPlans of the two plans)
// and the path of events in between, turned into the summary strip and the export text.
// Pure functions; the route calls them, vitest pins the wording.
import { REASON_LABEL, type PlanEvent, type ReasonCode } from "./events";
import { osloDay } from "./history";

export type PathChangeset = { id: string; at: string; editor: string | null; reason: string | null; reasonCode: string | null; source: string };
export type PathEvent = PlanEvent & { at: string; editor: string | null; changeset: PathChangeset };
export type CompareSummary = { maldatoer: number; spenn: number; byttetEpic: number; prioriteringer: number; flyttet: number; nye: number; fjernet: number; onsker: number; mangler: number };
type SnapshotLike = { id: string; kind: string; day: string | null; at: string | Date };

const widened = (e: PlanEvent) => {
  const b = e.before as { likely: number; late: number } | undefined, a = e.after as { likely: number; late: number } | undefined;
  return !!b && !!a && (a.late > b.late || a.likely > b.likely);
};
const later = (e: PlanEvent) => {
  const b = e.before as { start: number } | undefined, a = e.after as { start: number } | undefined;
  return !!b && !!a && a.start > b.start + 1e-9;
};

export function summarizeNet(net: PlanEvent[], path: PathEvent[]): CompareSummary {
  const count = (f: (e: PlanEvent) => boolean) => net.filter(f).length;
  return {
    maldatoer: count((e) => e.code === "epic.maldato"),
    spenn: count((e) => e.code === "feature.spenn" && widened(e)),
    byttetEpic: count((e) => e.code === "feature.epic"),
    prioriteringer: count((e) => e.code === "epic.prioritet" || e.code === "feature.prioritet"),
    flyttet: count((e) => e.code === "feature.flyttet" && later(e)),
    nye: count((e) => e.code === "feature.ny" || e.code === "epic.ny"),
    fjernet: count((e) => e.code === "feature.slettet" || e.code === "epic.slettet"),
    onsker: count((e) => e.code === "onske.besluttet"),
    mangler: new Set(path.filter((e) => e.changeset?.reasonCode === "ingen").map((e) => e.changeset.id)).size,
  };
}

const n = (c: number, one: string, many: string) => c + " " + (c === 1 ? one : many);
export function summaryLine(label: string, s: CompareSummary): string {
  const parts: string[] = [];
  if (s.maldatoer) parts.push(n(s.maldatoer, "måldato flyttet", "måldatoer flyttet"));
  if (s.spenn) parts.push(n(s.spenn, "spenn utvidet", "spenn utvidet"));
  if (s.byttetEpic) parts.push(n(s.byttetEpic, "feature byttet epic", "features byttet epic"));
  if (s.prioriteringer) parts.push(n(s.prioriteringer, "prioritering", "prioriteringer"));
  if (s.flyttet) parts.push(n(s.flyttet, "feature flyttet senere", "features flyttet senere"));
  if (s.nye) parts.push(n(s.nye, "ny", "nye"));
  if (s.onsker) parts.push(n(s.onsker, "ønske behandlet", "ønsker behandlet"));
  if (s.fjernet) parts.push(n(s.fjernet, "fjernet", "fjernet"));
  if (s.mangler) parts.push(n(s.mangler, "begrunnelse mangler", "begrunnelser mangler"));
  return "Siden " + label + ": " + (parts.length ? parts.join(" · ") : "ingen endringer");
}

const MND = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
export function dayText(iso: string | Date): string {
  const [, m, day] = osloDay(new Date(iso)).split("-").map(Number);
  return day + ". " + MND[m - 1];
}
export function sinceLabel(b: { kind: string; label: string | null; at: string | Date; day: string | null }): string {
  if ((b.kind === "baseline" || b.kind === "sprint") && b.label) return b.label.charAt(0).toLowerCase() + b.label.slice(1);
  return dayText(b.at);
}

const SECTIONS: [string, PlanEvent["code"][]][] = [
  ["Måldatoer", ["epic.maldato"]],
  ["Spenn", ["feature.spenn", "feature.estimert", "feature.buffer", "feature.raw", "feature.estimat-hentet"]],
  ["Flyttet", ["feature.flyttet", "feature.utredning-slutt"]],
  ["Prioritet", ["epic.prioritet", "feature.prioritet", "feature.epic"]],
  ["Tilstand", ["epic.tilstand", "feature.tilstand", "feature.eier"]],
  ["Fremdrift", ["feature.fremdrift"]],
  ["Nye og fjernet", ["epic.ny", "epic.slettet", "feature.ny", "feature.slettet", "feature.utredning"]],
  ["ADO", ["ado.push", "ado.konflikt", "ado.lest", "feature.ado", "epic.ado"]],
  ["Sprintmål", ["plan.sprintmaal"]],
];
const SHELF_NAME = "Klar for veikart";   // the reserved lane key never leaks into a text people read
export function exportMarkdown(title: string, strip: string, path: PathEvent[], laneName: (key: string) => string): string {
  const where = (e: PathEvent) => (e.targetType === "feature" && e.laneKey ? (e.laneKey === "_backlog" ? SHELF_NAME : laneName(e.laneKey)) + " › " : "") + e.targetLabel;
  const why = (e: PathEvent) => {
    if (e.cause === "avhengighet") return "avhengighet";
    if (e.cause === "ado") return "ADO";
    const c = e.changeset?.reasonCode;
    if (!c || c === "ingen") return "begrunnelse mangler";
    return REASON_LABEL[c as ReasonCode] + (e.changeset.reason ? ": " + e.changeset.reason : "");
  };
  const stamp = (e: PathEvent) => " (" + (e.changeset?.editor || e.editor || "system") + ", " + dayText(e.changeset?.at || e.at) + ")";
  let md = "# " + title + "\n\n" + strip + "\n";
  for (const [heading, codes] of SECTIONS) {
    const rows = path.filter((e) => codes.includes(e.code));
    if (!rows.length) continue;
    // plan-level lines (a sprint goal, a baseline) carry no reason: there is nothing to justify
    md += "\n## " + heading + "\n" + rows.map((e) => "- " + where(e) + ": " + e.summary + (e.targetType === "plan" ? "" : " — " + why(e)) + stamp(e)).join("\n") + "\n";
  }
  const missing = new Map<string, PathEvent[]>();
  for (const e of path) {
    if (e.changeset?.reasonCode !== "ingen") continue;
    if (!missing.has(e.changeset.id)) missing.set(e.changeset.id, []);
    missing.get(e.changeset.id)!.push(e);
  }
  if (missing.size) {
    md += "\n## Begrunnelser mangler\n" + [...missing.values()].map((evs) =>
      "- " + dayText(evs[0].changeset.at) + ", " + (evs[0].changeset.editor || "system") + ": " + evs.map((e) => e.summary).join("; ")).join("\n") + "\n";
  }
  return md;
}

/** The day's own daily snapshot, else the earliest snapshot after that day (a later daily one or a baseline), else null. */
export function snapshotForDay<T extends SnapshotLike>(snapshots: T[], day: string): T | null {
  const own = snapshots.find((s) => s.kind === "dag" && s.day === day);
  if (own) return own;
  const after = snapshots
    .filter((s) => osloDay(new Date(s.at)) > day)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return after[0] ?? null;
}
