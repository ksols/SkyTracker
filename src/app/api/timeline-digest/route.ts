import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dayText, snapshotForDay, summarizeNet, summaryLine, type PathEvent } from "@/features/timeline/compare";
import { dateToUnit, isoWeek, normalizePlan } from "@/features/timeline/epic-tools.js";
import { diffPlans } from "@/features/timeline/events";
import { osloDay } from "@/features/timeline/history";
import type { Plan } from "@/features/timeline/merge";
import { postSlack } from "@/features/timeline/notify";
import { readPlan } from "@/features/timeline/plan-store";
import { digestText } from "@/features/timeline/report";

// The weekly digest (spec R4): the colours now, the yellow and red epics with their reasons, what moved since
// `days` ago (the daily snapshot of that day), what was delivered.
// GET ?days=7 (signed in) → { text, since } · 404 no-snapshot
// POST (a writer, or the header x-cron-secret = CRON_SECRET for a scheduler) → posts to SLACK_WEBHOOK_URL → { sent, text }

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

async function build(days: number): Promise<{ text: string; since: string } | null> {
  const now = new Date();
  const since = osloDay(new Date(now.getTime() - days * 86400000));
  const all = await prisma.timelineSnapshot.findMany({ select: { id: true, kind: true, day: true, at: true } });
  const pick = snapshotForDay(all, since);
  if (!pick) return null;
  const baseline = await prisma.timelineSnapshot.findUnique({ where: { id: pick.id } });
  const current = await readPlan(prisma);
  if (!baseline || !current) return null;
  const before = normalizePlan(clone(baseline.data)) as Plan;
  const after = normalizePlan(clone(current.data)) as Plan;
  const rows = await prisma.timelineEvent.findMany({
    where: { at: { gt: baseline.at }, NOT: { code: "plan.baseline", targetId: baseline.id } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: 500,
    include: { changeset: { select: { id: true, at: true, editor: true, reason: true, reasonCode: true, source: true } } },
  });
  const path = rows as unknown as PathEvent[];
  const strip = summaryLine(dayText(since), summarizeNet(diffPlans(before, after), path));
  const base = process.env.SKYTRACKER_URL?.trim().replace(/\/$/, "");
  return { text: digestText({ plan: after, strip, path, todayUnit: dateToUnit(now), week: isoWeek(now), url: base ? base + "/timeline" : undefined }), since };
}
const daysOf = (req: Request) => Math.min(31, Math.max(1, parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10) || 7));

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const d = await build(daysOf(req));
  if (!d) return Response.json({ error: "no-snapshot", message: "Ingen plan lagret så langt tilbake." }, { status: 404, ...NO_STORE });
  return Response.json(d, NO_STORE);
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  const cron = !!secret && !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  if (!cron) {
    const session = await auth();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  }
  const hook = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!hook) return Response.json({ error: "no-webhook", message: "SLACK_WEBHOOK_URL er ikke satt." }, { status: 503, ...NO_STORE });
  const d = await build(daysOf(req));
  if (!d) return Response.json({ error: "no-snapshot", message: "Ingen plan lagret så langt tilbake." }, { status: 404, ...NO_STORE });
  const sent = await postSlack(hook, d.text);
  return Response.json({ sent, text: d.text, since: d.since }, { status: sent ? 200 : 502, ...NO_STORE });
}
