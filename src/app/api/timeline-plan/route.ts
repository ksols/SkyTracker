import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mergePlans, type Plan } from "@/features/timeline/merge";
import { planDelta } from "@/features/timeline/plan-delta";
import type { Prisma } from "@/generated/prisma/client";

// Shared state for the /timeline tool (epic roadmap). One row (id "epics");
// the old company plan stays in row "default", untouched.
// GET → { role, user, plan: { data, version, updatedAt, updatedBy } | null }
// PUT → body { data }; writers only. The server FIELD-MERGES the incoming
//       plan with the stored one (see features/timeline/merge.ts): every
//       task field group carries its own version number, highest wins,
//       so concurrent editors only ever "lose" a field both raced on.
//       Responds with the merged plan — the client applies it.

const PLAN_ID = "epics";
const PLAN_SCHEMA = "epics-v1";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const plan = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  return Response.json(
    {
      role: session.role ?? "reader",
      user: session.user?.name ?? session.user?.email ?? null,
      plan: plan
        ? { data: plan.data, version: plan.version, updatedAt: plan.updatedAt, updatedBy: plan.updatedBy }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });

  let body: { data?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const incoming = body.data as Plan | null | undefined;
  if (!incoming || !Array.isArray(incoming.lanes) || !Array.isArray(incoming.tasks)) {
    return Response.json({ error: "invalid plan: expected { lanes: [], tasks: [] }" }, { status: 400 });
  }
  if (incoming.schema !== undefined && incoming.schema !== PLAN_SCHEMA) {
    return Response.json({ error: "unknown plan schema" }, { status: 400 });
  }
  const updatedBy = session.user?.name ?? session.user?.email ?? null;

  // read-merge-write with a version guard; retry on write races
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
    if (!stored) {
      try {
        const created = await prisma.timelinePlan.create({
          data: { id: PLAN_ID, data: incoming as unknown as Prisma.InputJsonValue, version: 1, updatedBy },
        });
        return Response.json({ version: created.version, updatedAt: created.updatedAt, data: incoming });
      } catch {
        continue; // someone else created it first — retry as merge
      }
    }
    const merged = mergePlans(stored.data as unknown as Plan, incoming);
    const updated = await prisma.timelinePlan.updateMany({
      where: { id: PLAN_ID, version: stored.version },
      data: { data: merged as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy },
    });
    if (updated.count === 1) {
      await logChanges(stored.data as unknown as Plan, merged, updatedBy);
      return Response.json({ version: stored.version + 1, data: merged });
    }
  }
  return Response.json({ error: "contention — try again" }, { status: 409 });
}

// The change log is best-effort: a failed log write must never fail the save.
async function logChanges(before: Plan, after: Plan, editor: string | null) {
  try {
    const changes = planDelta(before, after);
    if (!changes.length) return;
    await prisma.timelineChange.createMany({
      data: changes.map((c) => ({
        taskId: c.taskId,
        taskLabel: c.taskLabel,
        kind: c.kind,
        groups: c.groups?.join(",") ?? null,
        before: (c.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (c.after ?? undefined) as Prisma.InputJsonValue | undefined,
        editor,
      })),
    });
  } catch {
    // tabellen kan mangle før migrasjonen er kjørt — lagringen skal uansett lykkes
  }
}
