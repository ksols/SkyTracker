import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REASON_CODES, REASON_LABEL, type ReasonCode } from "@/features/timeline/events";
import type { Prisma } from "@/generated/prisma/client";

// History of the shared timeline plan, newest first.
// GET ?lane=<laneKey>&target=<id>&before=<ISO>&limit=60
//   → { events: [{ …TimelineEvent, changeset: { id, at, editor, source, reason, reasonCode, eventCount } }], missing14d }
//   missing14d = changesets of the last 14 days that needed a reason and got none (reasonCode "ingen").
// PATCH { changesetId, reason, reasonCode } (writers) → adds a reason afterwards and logs it as plan.begrunnelse.

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60));
  const before = url.searchParams.get("before");
  const lane = url.searchParams.get("lane");
  const target = url.searchParams.get("target");
  const where: Prisma.TimelineEventWhereInput = {};
  if (before) where.at = { lt: new Date(before) };
  if (lane) where.laneKey = lane;
  if (target) where.targetId = target;

  try {
    const [events, missing14d] = await Promise.all([
      prisma.timelineEvent.findMany({
        where,
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take: limit,
        include: { changeset: { select: { id: true, at: true, editor: true, source: true, reason: true, reasonCode: true, eventCount: true } } },
      }),
      prisma.timelineChangeset.count({ where: { reasonCode: "ingen", at: { gte: new Date(Date.now() - 14 * 86400000) } } }),
    ]);
    return Response.json({ events, missing14d }, NO_STORE);
  } catch {
    return Response.json({ events: [], missing14d: 0 }, NO_STORE); // tables missing before the migration ran
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  let body: { changesetId?: unknown; reason?: unknown; reasonCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const changesetId = typeof body.changesetId === "string" ? body.changesetId : "";
  const reasonCode = typeof body.reasonCode === "string" && (REASON_CODES as readonly string[]).includes(body.reasonCode) && body.reasonCode !== "ingen"
    ? (body.reasonCode as ReasonCode) : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!changesetId || !reasonCode) return Response.json({ error: "changesetId and a reason code are required" }, { status: 400 });
  const editor = session.user?.name ?? session.user?.email ?? null;
  try {
    await prisma.timelineChangeset.update({ where: { id: changesetId }, data: { reason: reason || null, reasonCode } });
    await prisma.timelineEvent.create({
      data: {
        changesetId, editor, targetType: "plan", targetId: changesetId, targetLabel: "Begrunnelse", laneKey: null,
        code: "plan.begrunnelse", cause: "system",
        summary: "Begrunnelse lagt til: " + REASON_LABEL[reasonCode] + (reason ? " – " + reason : ""),
      },
    });
    return Response.json({ ok: true }, NO_STORE);
  } catch {
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
