import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PathEvent } from "@/features/timeline/compare";
import { normalizePlan } from "@/features/timeline/epic-tools.js";
import { defaultWindow, investorData, investorHtml, investorMarkdown } from "@/features/timeline/investor";
import type { Plan } from "@/features/timeline/merge";
import { readPlan } from "@/features/timeline/plan-store";

// The investor numbers (spec R6): the plan now, gjennomføringsevne over a window (default: the last two quarters),
// målopnåelse with the forum's reasons from the epic events.
// GET ?since=YYYY-MM-DD&until=YYYY-MM-DD&format=json|md|html (any signed-in person)

const NO_STORE = { "Cache-Control": "no-store" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const d = defaultWindow(new Date());
  const since = DAY.test(p.get("since") ?? "") ? p.get("since")! : d.since;
  const until = DAY.test(p.get("until") ?? "") ? p.get("until")! : d.until;
  const format = p.get("format") ?? "json";
  const stored = await readPlan(prisma);
  if (!stored) return Response.json({ error: "no-plan", message: "Ingen delt plan ennå." }, { status: 404, headers: NO_STORE });
  const plan = normalizePlan(clone(stored.data)) as Plan;
  const rows = await prisma.timelineEvent.findMany({
    where: { targetType: "epic", code: { in: ["epic.tilstand", "epic.maldato"] } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    take: 1000,
    include: { changeset: { select: { id: true, at: true, editor: true, reason: true, reasonCode: true, source: true } } },
  });
  const data = investorData(plan, rows as unknown as PathEvent[], { since, until });
  if (format === "md") return new Response(investorMarkdown(data), { headers: { "Content-Type": "text/markdown; charset=utf-8", ...NO_STORE } });
  if (format === "html") return new Response(investorHtml(data), { headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
  return Response.json({ ...data, markdown: investorMarkdown(data) }, { headers: NO_STORE });
}
