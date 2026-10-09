import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAdoClient } from "@/features/ado/client";
import { adoErrorResponse, NO_STORE } from "@/features/ado/http";
import { refreshSprints } from "@/features/ado/push";
import { adoAuthFor, defaultTokenDeps } from "@/features/ado/token";
import { commitPlan, readPlan } from "@/features/timeline/plan-store";

// The sprint ruler's data: ADO's iteration nodes, cached in the plan (`sprints`) for half a day so readers
// and later page loads draw it without a token. POST (any signed-in person)
//   → { version, data, sprints } when the cache was refreshed · { unchanged: true, sprints } otherwise

export async function POST() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const stored = await readPlan(prisma);
  if (!stored) return Response.json({ unchanged: true, sprints: [] }, NO_STORE);
  const editor = session.user?.name ?? session.user?.email ?? null;
  try {
    const client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma)));
    const r = await refreshSprints(stored.data, client, new Date());
    if (!r.changed) return Response.json({ unchanged: true, sprints: r.sprints }, NO_STORE);
    const c = await commitPlan(prisma, { stored, after: r.plan, editor, note: { source: "ado" } });
    if (!c) return Response.json({ unchanged: true, sprints: r.sprints }, NO_STORE); // someone saved first: the next load retries
    return Response.json({ version: c.version, data: r.plan, sprints: r.sprints }, NO_STORE);
  } catch (e) {
    return adoErrorResponse(e);
  }
}
