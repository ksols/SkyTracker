import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { diffPlans } from "@/features/timeline/events";
import { exportMarkdown, sinceLabel, snapshotForDay, summarizeNet, summaryLine, type PathEvent } from "@/features/timeline/compare";
import { normalizePlan } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";

// Compare the current plan with a baseline (spec §4.4).
// GET ?from=<snapshot id | YYYY-MM-DD>
//   → { baseline: { id, at, kind, day, label, data }, net: PlanEvent[], path: PathEvent[], summary, strip, exportText }
//   net  = diffPlans(baseline plan, current plan): what differs now
//   path = the events logged since the baseline, with their changesets (reasons)

const PLAN_ID = "epics";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const from = new URL(req.url).searchParams.get("from") ?? "";
  if (!from) return Response.json({ error: "from is required" }, { status: 400 });

  let id = from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const all = await prisma.timelineSnapshot.findMany({ select: { id: true, kind: true, day: true, at: true } });
    const pick = snapshotForDay(all, from);
    if (!pick) return Response.json({ error: "no-snapshot", message: "Ingen plan lagret fra den dagen eller senere." }, { status: 404 });
    id = pick.id;
  }
  const baseline = await prisma.timelineSnapshot.findUnique({ where: { id } });
  if (!baseline) return Response.json({ error: "no-snapshot", message: "Fant ikke baselinen." }, { status: 404 });
  const current = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  if (!current) return Response.json({ error: "no plan yet" }, { status: 404 });

  const before = normalizePlan(clone(baseline.data)) as Plan;
  const after = normalizePlan(clone(current.data)) as Plan;
  const net = diffPlans(before, after);
  const rows = await prisma.timelineEvent.findMany({
    where: { at: { gt: baseline.at }, NOT: { code: "plan.baseline", targetId: baseline.id } },   // the baseline's own event is not a change since itself
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: 500,
    include: { changeset: { select: { id: true, at: true, editor: true, reason: true, reasonCode: true, source: true } } },
  });
  const path = rows as unknown as PathEvent[];
  const summary = summarizeNet(net, path);
  const label = sinceLabel(baseline);
  const strip = summaryLine(label, summary);
  const names = new Map<string, string>();
  for (const l of [...before.lanes, ...after.lanes]) names.set(l.key, l.name);
  const exportText = exportMarkdown("Siden " + label, strip, path, (k) => names.get(k) ?? k);
  return Response.json({
    baseline: { id: baseline.id, at: baseline.at, kind: baseline.kind, day: baseline.day, label: baseline.label, data: baseline.data },
    net, path, summary, strip, exportText,
  }, NO_STORE);
}
