import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAdoClient } from "@/features/ado/client";
import { peopleMap } from "@/features/ado/config";
import { adoErrorResponse, NO_STORE } from "@/features/ado/http";
import { importItems, listImportable } from "@/features/ado/import";
import { adoAuthFor, defaultTokenDeps } from "@/features/ado/token";
import { commitPlan, readPlan } from "@/features/timeline/plan-store";

// «Hent fra ADO» (spec R7a): the Epics and Features that already live in ADO, brought into the plan. Never writes to
// ADO. POST (writers)
//   { list: true } → { items: ImportCandidate[] }
//   { ids: number[] } → the chosen ones as lanes and tasks: { version, data, imported, changesetId }
// The candidates are read from ADO again on import: nothing the browser sends is trusted beyond the ids.

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  const stored = await readPlan(prisma);
  if (!stored) return Response.json({ error: "no-plan", message: "Ingen delt plan ennå. Last inn eksempel-epics eller lag en epic først." }, { status: 404, ...NO_STORE });
  let body: { list?: boolean; ids?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* an empty body lists */ }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is number => Number.isInteger(x) && (x as number) > 0) : [];
  const editor = session.user?.name ?? session.user?.email ?? null;
  const people = peopleMap(process.env);
  try {
    const client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma)));
    const items = await listImportable(stored.data, client, people);
    if (!ids.length) return Response.json({ items }, NO_STORE);
    const r = importItems(stored.data, items, ids, { people, now: new Date() });
    if (!r.imported.length) return Response.json({ error: "nothing", message: "Ingenting å hente: alt du valgte ligger allerede i planen." }, { status: 400, ...NO_STORE });
    const c = await commitPlan(prisma, { stored, after: r.plan, editor, note: { source: "import" } });
    if (!c) return Response.json({ error: "contention", message: "Noen andre lagret samtidig. Prøv igjen." }, { status: 409, ...NO_STORE });
    return Response.json({ version: c.version, data: r.plan, imported: r.imported, changesetId: c.changesetId }, NO_STORE);
  } catch (e) {
    return adoErrorResponse(e);
  }
}
