// The investor numbers (spec R6), straight from the plan and its history: the plan as it stands, gjennomføringsevne
// (delivered inside the span the forum was promised) and målopnåelse (closed epics by outcome, with the reasons).
// Pure; the route serves json, markdown or the slide; the page's «Investorer» drawer shows the same data.
import { dayText, type PathEvent } from "./compare";
import { dayKey, epicStatus, epicWindowText, goalText, unitToDate, WEEK } from "./epic-tools.js";
import { REASON_LABEL, type ReasonCode } from "./events";
import type { Plan } from "./merge";

export type InvestorWindow = { since: string; until: string };
export type PlanLine = { key: string; name: string; metric: string; goal: string; colour: string; window: string };
export type DeliveryItem = { id: string; label: string; lane: string; deliveredAt: string; committedEnd: string | null; inside: boolean | null };
export type Delivery = { delivered: number; withCommitment: number; inside: number; ratio: number | null; items: DeliveryItem[] };
export type GoalEpic = { key: string; name: string; outcome: string | null; closedReason: string | null; closedAt: string | null; reasons: string[] };
export type Goals = { counts: { "nådd": number; "ikke nådd": number; endret: number }; epics: GoalEpic[] };
export type InvestorData = { window: InvestorWindow; plan: PlanLine[]; delivery: Delivery; goals: Goals; generatedAt: string };

const COLOUR: Record<string, string> = { gronn: "grønn", gul: "gul", rod: "rød", venter: "venter på utredning", "ingen-mal": "uten måldato", tom: "tom" };
const pct = (r: number | null) => (r === null ? "–" : Math.round(r * 100) + " %");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Two quarters back, to today. */
export function defaultWindow(today: Date): InvestorWindow {
  return { since: dayKey(new Date(today.getFullYear(), today.getMonth() - 6, today.getDate())), until: dayKey(today) };
}

export function planNow(plan: Plan): PlanLine[] {
  return plan.lanes.filter((l) => l.state !== "avsluttet").map((l) => {
    const code = epicStatus(plan, l.key).code;
    return { key: l.key, name: l.name, metric: l.metric ?? "", goal: goalText(l), colour: COLOUR[code] ?? code, window: epicWindowText(plan, l.key) };
  });
}

export function deliveryAbility(plan: Plan, w: InvestorWindow): Delivery {
  const items: DeliveryItem[] = plan.tasks
    .filter((t) => t.state === "levert" && !!t.deliveredAt && t.deliveredAt >= w.since && t.deliveredAt <= w.until)
    .map((t) => {
      const committedEnd = t.committedRange ? dayKey(unitToDate(t.committedRange.start + t.committedRange.late * WEEK)) : null;
      return { id: t.id, label: t.label, lane: t.lane, deliveredAt: t.deliveredAt!, committedEnd, inside: committedEnd ? t.deliveredAt! <= committedEnd : null };
    });
  const withCommitment = items.filter((i) => i.inside !== null).length;
  const inside = items.filter((i) => i.inside === true).length;
  return { delivered: items.length, withCommitment, inside, ratio: withCommitment ? inside / withCommitment : null, items };
}

const reasonSuffix = (e: PathEvent) => {
  const c = e.changeset?.reasonCode;
  if (!c || c === "ingen") return "";
  return " — " + REASON_LABEL[c as ReasonCode] + (e.changeset.reason ? ": " + e.changeset.reason : "") + " (" + (e.changeset.editor || e.editor || "system") + ", " + dayText(e.changeset.at || e.at) + ")";
};
export function goalAttainment(plan: Plan, events: PathEvent[]): Goals {
  const counts = { "nådd": 0, "ikke nådd": 0, endret: 0 };
  const epics = plan.lanes.filter((l) => l.state === "avsluttet").map((l) => {
    if (l.outcome && l.outcome in counts) counts[l.outcome]++;
    const reasons = events
      .filter((e) => e.targetType === "epic" && e.targetId === l.key && (e.code === "epic.tilstand" || e.code === "epic.maldato"))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      .map((e) => e.summary + reasonSuffix(e));
    return { key: l.key, name: l.name, outcome: l.outcome ?? null, closedReason: l.closedReason ?? null, closedAt: l.closedAt ?? null, reasons };
  });
  return { counts, epics };
}

export function investorData(plan: Plan, events: PathEvent[], window: InvestorWindow): InvestorData {
  return { window, plan: planNow(plan), delivery: deliveryAbility(plan, window), goals: goalAttainment(plan, events), generatedAt: new Date().toISOString() };
}

const windowText = (w: InvestorWindow) => dayText(w.since) + " – " + dayText(w.until);
const deliveryLine = (d: Delivery) =>
  d.inside + " av " + d.withCommitment + " levert innenfor lovet spenn (" + pct(d.ratio) + ")" + (d.delivered - d.withCommitment ? " · " + (d.delivered - d.withCommitment) + " levert uten lovet spenn" : "");
const countsLine = (g: Goals) => "nådd " + g.counts["nådd"] + " · ikke nådd " + g.counts["ikke nådd"] + " · endret " + g.counts.endret;
const goalLine = (e: GoalEpic) => e.name + ": " + (e.outcome ?? "uten utfall") + (e.closedReason ? " – " + e.closedReason : "") + (e.closedAt ? " (" + dayText(e.closedAt) + ")" : "");
const planLine = (p: PlanLine) => p.name + ": " + [p.colour, p.metric, p.goal, p.window].filter(Boolean).join(" · ");
const laneName = (plan: PlanLine[], key: string) => plan.find((p) => p.key === key)?.name ?? key;

export function investorMarkdown(d: InvestorData): string {
  let md = "# Tidslinjen for investorer\n\n";
  md += "## Planen nå\n" + (d.plan.length ? d.plan.map((p) => "- " + planLine(p)).join("\n") : "- ingen aktive epics") + "\n\n";
  md += "## Gjennomføringsevne (" + windowText(d.window) + ")\n" + deliveryLine(d.delivery) + "\n";
  if (d.delivery.items.length) md += d.delivery.items.map((i) => "- " + laneName(d.plan, i.lane) + " › " + i.label + ": levert " + dayText(i.deliveredAt) +
    (i.committedEnd ? ", lovet senest " + dayText(i.committedEnd) + (i.inside ? " – innenfor" : " – utenfor") : " – uten lovet spenn")).join("\n") + "\n";
  md += "\n## Målopnåelse\n" + countsLine(d.goals) + "\n";
  md += (d.goals.epics.length ? d.goals.epics.map((e) => "- " + goalLine(e) + e.reasons.map((r) => "\n  - " + r).join("")).join("\n") : "- ingen avsluttede epics") + "\n";
  return md;
}

/** One 1280×720 slide, self-contained. */
export function investorHtml(d: InvestorData): string {
  const colourCss: Record<string, string> = { "grønn": "#4ade80", gul: "#fbbf24", "rød": "#f87171" };
  const dot = (c: string) => '<span class="dot" style="background:' + (colourCss[c] ?? "#94a3b8") + '"></span>';
  const planHtml = d.plan.length
    ? d.plan.map((p) => "<li>" + dot(p.colour) + "<b>" + esc(p.name) + "</b>" + (p.metric ? '<span class="m">' + esc(p.metric) + "</span>" : "") + '<span class="s">' + esc([p.goal, p.window].filter(Boolean).join(" · ")) + "</span></li>").join("")
    : "<li>ingen aktive epics</li>";
  const goalsHtml = d.goals.epics.length
    ? d.goals.epics.map((e) => "<li><b>" + esc(e.name) + "</b>: " + esc((e.outcome ?? "uten utfall") + (e.closedReason ? " – " + e.closedReason : "")) + (e.reasons.length ? '<span class="s">' + esc(e.reasons[e.reasons.length - 1]) + "</span>" : "") + "</li>").join("")
    : "<li>ingen avsluttede epics</li>";
  return "<!doctype html><html lang=\"nb\"><head><meta charset=\"utf-8\"><title>Tidslinjen for investorer</title><style>" +
    "body{margin:0;background:#0d123e;color:#fff;font-family:-apple-system,Segoe UI,Inter,sans-serif}" +
    ".slide{width:1280px;height:720px;box-sizing:border-box;padding:48px 56px;display:grid;grid-template-columns:1.2fr 1fr 1fr;grid-template-rows:auto 1fr;gap:24px 40px}" +
    "h1{grid-column:1/-1;margin:0;font-size:30px;font-weight:600}h1 small{font-size:14px;font-weight:400;opacity:.7;margin-left:14px}" +
    "h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin:0 0 12px}" +
    "ul{list-style:none;margin:0;padding:0}li{margin:0 0 10px;font-size:15px;line-height:1.35}li b{font-weight:600}" +
    ".m{display:block;font-size:13px;opacity:.85}.s{display:block;font-size:12px;opacity:.65}" +
    ".dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle}" +
    ".big{font-size:72px;font-weight:700;line-height:1;margin:6px 0 10px}.sub{font-size:14px;opacity:.8}" +
    "</style></head><body><div class=\"slide\" style=\"width:1280px;height:720px\">" +
    "<h1>Tidslinjen for investorer<small>" + esc(windowText(d.window)) + "</small></h1>" +
    "<section><h2>Planen nå</h2><ul>" + planHtml + "</ul></section>" +
    "<section><h2>Gjennomføringsevne</h2><div class=\"big\">" + esc(pct(d.delivery.ratio)) + "</div><div class=\"sub\">" + esc(deliveryLine(d.delivery)) + "</div></section>" +
    "<section><h2>Målopnåelse</h2><div class=\"sub\">" + esc(countsLine(d.goals)) + "</div><ul>" + goalsHtml + "</ul></section>" +
    "</div></body></html>";
}
