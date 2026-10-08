import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { mergePlans, type Plan } from "@/features/timeline/merge";
import { parseNote, recordChangeset } from "@/features/timeline/history";
import type { Prisma } from "@/generated/prisma/client";

// Shared state for the /timeline tool (epic roadmap). One row (id "epics");
// the old company plan stays in row "default", untouched.
// GET → { role, user, plan: { data, version, updatedAt, updatedBy } | null }
// PUT → body { data, note? }; writers only. The server FIELD-MERGES the incoming
//       plan with the stored one (see features/timeline/merge.ts): every
//       task field group carries its own version number, highest wins,
//       so concurrent editors only ever "lose" a field both raced on.
//       Every save is diffed against the stored plan and logged as one
//       changeset (reason from `note`) with its events (features/timeline/history.ts).
//       Responds with { version, data: merged, changesetId } — the client applies it.

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

  let body: { data?: unknown; note?: unknown };
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
  const note = parseNote(body.note);
  const updatedBy = session.user?.name ?? session.user?.email ?? null;
  const EMPTY: Plan = { schema: PLAN_SCHEMA, lanes: [], tasks: [], deleted: {}, deletedLanes: {} };

  // read-merge-write with a version guard; retry on write races
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
    if (!stored) {
      try {
        const created = await prisma.timelinePlan.create({
          data: { id: PLAN_ID, data: incoming as unknown as Prisma.InputJsonValue, version: 1, updatedBy },
        });
        const changesetId = await logHistory(EMPTY, incoming, 0, created.version, updatedBy, note);
        return Response.json({ version: created.version, updatedAt: created.updatedAt, data: incoming, changesetId });
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
      const changesetId = await logHistory(stored.data as unknown as Plan, merged, stored.version, stored.version + 1, updatedBy, note);
      return Response.json({ version: stored.version + 1, data: merged, changesetId });
    }
  }
  return Response.json({ error: "contention — try again" }, { status: 409 });
}

// The history is best-effort: a failed log write must never fail the save.
async function logHistory(before: Plan, after: Plan, beforeVersion: number, afterVersion: number, editor: string | null, note: ReturnType<typeof parseNote>) {
  try {
    return await recordChangeset(prisma, { before, after, beforeVersion, afterVersion, editor, note });
  } catch {
    return null; // tables missing before the migration ran, or a transient DB error
  }
}
