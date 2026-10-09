import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAdoClient, type AdoClient } from "@/features/ado/client";
import { peopleMap } from "@/features/ado/config";
import { adoErrorResponse, NO_STORE } from "@/features/ado/http";
import { pushItem, PushFailed } from "@/features/ado/push";
import { adoAuthFor, AdoLoginRequired, defaultTokenDeps } from "@/features/ado/token";
import { commitPlan, readPlan } from "@/features/timeline/plan-store";

// Push one epic or feature to ADO as the signed-in person (spec §5 R3, §3 «ADO access»).
// POST { kind: "epic" | "feature", id, force? }  (?dry=1 returns the patches without sending; needs no token)
//   → 200 { version, data, items, changesetId } · dry: 200 { dry: true, items, note? }
//   → 400 on-shelf · 404 · 401 ado-login · 409 contention · 502 ado (what succeeded is committed first)

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  let body: { kind?: unknown; id?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const kind = body.kind === "epic" || body.kind === "feature" ? body.kind : null;
  const id = typeof body.id === "string" && body.id ? body.id : null;
  if (!kind || !id) return Response.json({ error: "invalid target", message: "Oppgi kind (epic | feature) og id." }, { status: 400 });
  const stored = await readPlan(prisma);
  if (!stored) return Response.json({ error: "no-plan", message: "Ingen delt plan ennå." }, { status: 404, ...NO_STORE });
  const editor = session.user?.name ?? session.user?.email ?? null;

  let client: AdoClient | null = null;
  let note: string | undefined;
  try {
    client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma)));
  } catch (e) {
    if (!(e instanceof AdoLoginRequired) || !dry) return adoErrorResponse(e);
    note = "Tørrkjøring uten ADO-token: patchene antar at ingenting er endret i ADO.";
  }
  const opts = { dry, force: body.force === true, people: peopleMap(process.env), now: new Date() };
  try {
    const r = await pushItem(stored.data, { kind, id }, client, opts);
    if (dry) return Response.json({ dry: true, items: r.items, ...(note ? { note } : {}) }, NO_STORE);
    const c = await commitPlan(prisma, { stored, after: r.plan, editor, note: { source: "ado" }, extraEvents: r.events });
    if (!c) return Response.json({ error: "contention", message: "Noen andre lagret samtidig. Prøv igjen." }, { status: 409, ...NO_STORE });
    return Response.json({ version: c.version, data: r.plan, items: r.items, changesetId: c.changesetId }, NO_STORE);
  } catch (e) {
    if (e instanceof PushFailed) {
      // nothing is left half-way unrecorded: what did reach ADO is saved with its id before the error is reported
      if (!dry && e.partial.items.length) await commitPlan(prisma, { stored, after: e.partial.plan, editor, note: { source: "ado" }, extraEvents: e.partial.events }).catch(() => null);
      return adoErrorResponse(e.cause, { items: e.partial.items });
    }
    if (e instanceof Error && e.message === "on-shelf") return Response.json({ error: "on-shelf", message: "Legg featuren i en epic først; hylla speiles ikke til ADO." }, { status: 400, ...NO_STORE });
    if (e instanceof Error && (e.message === "no-feature" || e.message === "no-epic")) return Response.json({ error: e.message, message: "Fant ikke elementet i planen." }, { status: 404, ...NO_STORE });
    return adoErrorResponse(e);
  }
}
