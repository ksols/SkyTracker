import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAdoClient } from "@/features/ado/client";
import { adoErrorResponse, NO_STORE } from "@/features/ado/http";
import { refreshPlan } from "@/features/ado/push";
import { adoAuthFor, defaultTokenDeps } from "@/features/ado/token";
import { commitPlan, readPlan } from "@/features/timeline/plan-store";

// Read back from ADO everything that has an ADO id: stories, points and sprint under each feature,
// Resolved/Closed → «levert», and the fields someone changed in ADO after our last push (conflicts:
// listed, never overwritten). POST (writers) → { version, data, conflicts, read, changesetId }

export async function POST() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  const stored = await readPlan(prisma);
  if (!stored) return Response.json({ error: "no-plan", message: "Ingen delt plan ennå." }, { status: 404, ...NO_STORE });
  const editor = session.user?.name ?? session.user?.email ?? null;
  try {
    const client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma)));
    const r = await refreshPlan(stored.data, client, new Date());
    const c = await commitPlan(prisma, { stored, after: r.plan, editor, note: { source: "ado" }, extraEvents: r.events });
    if (!c) return Response.json({ error: "contention", message: "Noen andre lagret samtidig. Prøv igjen." }, { status: 409, ...NO_STORE });
    return Response.json({ version: c.version, data: r.plan, conflicts: r.conflicts, read: r.read, changesetId: c.changesetId }, NO_STORE);
  } catch (e) {
    return adoErrorResponse(e);
  }
}
