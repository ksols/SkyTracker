// The sprint report (PROS-SPRINT-01 day 10: what was built, which discoveries moved on, spans that changed) and the
// weekly digest for Slack, both from the same data as the compare mode: the plan now, the events since a point.
import { dayText, exportMarkdown, type PathEvent } from "./compare";
import { epicStatus, epicWindowText, fmtDate, goalText, progressSignal, progressText, windowLabel, type EpicStatusCode } from "./epic-tools.js";
import { REASON_LABEL, type ReasonCode } from "./events";
import type { Plan, PlanTask } from "./merge";

const COLOUR: Record<string, string> = { gronn: "grønn", gul: "gul", rod: "rød" };
const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const DISCOVERY_MOVES = new Set(["feature.estimert", "feature.estimat-hentet"]);
const isDiscoveryMove = (e: PathEvent) =>
  DISCOVERY_MOVES.has(e.code) || (e.code === "feature.tilstand" && ["utredes", "klar", "aktiv"].includes(String(e.after)));
const stamp = (e: PathEvent) => " (" + (e.changeset?.editor || e.editor || "system") + ", " + dayText(e.changeset?.at || e.at) + ")";

/** Features delivered in the period: a «levert» transition in the path, or a delivery day on or after the period's first event. */
function delivered(plan: Plan, path: PathEvent[]): PlanTask[] {
  const byEvent = new Set(path.filter((e) => e.code === "feature.tilstand" && e.after === "levert").map((e) => e.targetId));
  const since = path.length ? path.map((e) => e.at.slice(0, 10)).sort()[0] : null;
  return plan.tasks.filter((t) => t.state === "levert" && (byEvent.has(t.id) || (since !== null && !!t.deliveredAt && t.deliveredAt >= since)));
}
const progressLine = (t: PlanTask, s: { code: string; done: number; elapsed: number }) =>
  ((t.progress?.pointsTotal ?? 0) > 0 ? (t.progress!.pointsDone ?? 0) + " av " + t.progress!.pointsTotal + " poeng" : (t.progress?.pct ?? 0) + " %") +
  " · " + progressText(t, s) + " · " + COLOUR[s.code] + (windowLabel(t) ? " · leveres " + windowLabel(t) : "");

export type ReportArgs = { title: string; strip: string; path: PathEvent[]; plan: Plan; laneName: (key: string) => string; todayUnit: number };
export function sprintReportMarkdown(a: ReportArgs): string {
  const where = (t: PlanTask) => a.laneName(t.lane) + " › " + t.label;
  const sections: string[] = [];
  const done = delivered(a.plan, a.path);
  if (done.length) sections.push("\n## Levert\n" + done.map((t) => "- " + where(t) + ": levert" + (t.deliveredAt ? " " + fmtDate(new Date(t.deliveredAt)) : "")).join("\n") + "\n");
  const progress = a.plan.tasks.map((t) => ({ t, s: progressSignal(t, a.todayUnit) })).filter((x): x is { t: PlanTask; s: NonNullable<ReturnType<typeof progressSignal>> } => !!x.s);
  if (progress.length) sections.push("\n## Fremdrift per feature\n" + progress.map(({ t, s }) => "- " + where(t) + ": " + progressLine(t, s)).join("\n") + "\n");
  const moved = a.path.filter(isDiscoveryMove);
  if (moved.length) sections.push("\n## Utredninger som kom videre\n" + moved.map((e) => "- " + e.targetLabel + ": " + e.summary + stamp(e)).join("\n") + "\n");
  const rest = exportMarkdown(a.title, a.strip, a.path.filter((e) => !isDiscoveryMove(e)), a.laneName).split("\n").slice(3).join("\n");
  return "# " + a.title + "\n\n" + a.strip + "\n" + sections.join("") + rest;
}

export type DigestArgs = { plan: Plan; strip: string; path: PathEvent[]; todayUnit: number; week: number; url?: string };
export function digestText(a: DigestArgs): string {
  const open = a.plan.lanes.filter((l) => l.state !== "avsluttet");
  const codes = new Map(open.map((l) => [l.key, epicStatus(a.plan, l.key).code as EpicStatusCode]));
  const count = (c: EpicStatusCode) => [...codes.values()].filter((x) => x === c).length;
  const g = count("gronn"), y = count("gul"), r = count("rod"), v = open.length - g - y - r;
  const lines = ["*Tidslinjen, uke " + a.week + "* — " + g + " grønn" + (g === 1 ? "" : "e") + " · " + y + " gul" + (y === 1 ? "" : "e") + " · " + r + " rød" + (r === 1 ? "" : "e") + " · " + v + " venter"];
  for (const l of open) {
    const c = codes.get(l.key);
    if (c !== "gul" && c !== "rod") continue;
    const why = a.path
      .filter((e) => (e.laneKey === l.key || e.targetId === l.key) && e.changeset?.reasonCode && e.changeset.reasonCode !== "ingen")
      .sort((x, z) => (z.changeset.at > x.changeset.at ? 1 : -1))[0];
    const whyText = why ? " — " + REASON_LABEL[why.changeset.reasonCode as ReasonCode] + (why.changeset.reason ? ": " + why.changeset.reason : "") + stamp(why) : "";
    const window = epicWindowText(a.plan, l.key);
    lines.push((c === "rod" ? "🔴 " : "🟡 ") + l.name + ": " + [window ? lower(window) : "", lower(goalText(l))].filter(Boolean).join(", ") + whyText);
  }
  lines.push(a.strip);
  const done = delivered(a.plan, a.path);
  if (done.length) lines.push("Levert denne uken: " + done.map((t) => t.label + (t.deliveredAt ? " (" + fmtDate(new Date(t.deliveredAt)) + ")" : "")).join(", "));
  if (a.url) lines.push("<" + a.url + "|Tidslinjen>");
  return lines.join("\n");
}
