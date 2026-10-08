import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Baselines of the shared timeline plan (spec §4.4). Daily snapshots are written by the save path
// (features/timeline/history.ts); named baselines are created here.
// GET → { snapshots: [{ id, at, kind, day, label, planVersion, createdBy }] } newest first (no plan data)
// POST { label } (writers) → { id, at, label }; logs one changeset with a plan.baseline event.

const PLAN_ID = "epics";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const snapshots = await prisma.timelineSnapshot.findMany({
      orderBy: { at: "desc" },
      take: 100,
      select: { id: true, at: true, kind: true, day: true, label: true, planVersion: true, createdBy: true },
    });
    return Response.json({ snapshots }, NO_STORE);
  } catch {
    return Response.json({ snapshots: [] }, NO_STORE);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  let body: { label?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  if (!label) return Response.json({ error: "label is required" }, { status: 400 });
  const plan = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  if (!plan) return Response.json({ error: "no plan yet" }, { status: 404 });
  const createdBy = session.user?.name ?? session.user?.email ?? null;
  const snap = await prisma.timelineSnapshot.create({
    data: { kind: "baseline", label, planVersion: plan.version, data: plan.data as Prisma.InputJsonValue, createdBy },
    select: { id: true, at: true, label: true },
  });
  try {
    await prisma.timelineChangeset.create({
      data: {
        editor: createdBy, source: "bruker", planVersion: plan.version, eventCount: 1,
        events: { create: [{ editor: createdBy, targetType: "plan", targetId: snap.id, targetLabel: label, laneKey: null, code: "plan.baseline", cause: "bruker", summary: "Baseline «" + label + "»" }] },
      },
    });
  } catch { /* the baseline exists; the log is best effort */ }
  return Response.json(snap, NO_STORE);
}
