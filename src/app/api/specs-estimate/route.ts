import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAdoClient } from "@/features/ado/client";
import { SPECS_REPO_ID } from "@/features/ado/config";
import { adoErrorResponse, NO_STORE } from "@/features/ado/http";
import { adoAuthFor, defaultTokenDeps } from "@/features/ado/token";
import { estimatePath, parseEstimateYaml, SPEC_FOLDER_RE } from "@/features/specs/estimate";
import { readPlan } from "@/features/timeline/plan-store";

// «Hent estimat fra utredningen»: reads the raw range (likely/late weeks, points, who, date) from the
// feature's estimate.yaml in Skytale.Specs, as the signed-in person (spec §3 «ADO access», decision 3).
// GET ?id=<feature id>&folder=<optional override of the stored specPath>
//   → 200 { raw: { likely, late, points?, estimatedBy?, date? }, path }
//   → 404 no-feature | no-spec | no-file · 422 bad-yaml · 401 ado-login · 502 ado

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const override = url.searchParams.get("folder")?.trim() ?? "";
  if (override && !SPEC_FOLDER_RE.test(override)) return Response.json({ error: "bad-folder", message: "Mappenavnet kan bare ha bokstaver, tall, punktum, bindestrek og understrek." }, { status: 400, ...NO_STORE });
  const stored = await readPlan(prisma);
  const task = stored?.data.tasks.find((t) => t.id === id);
  if (!task) return Response.json({ error: "no-feature", message: "Fant ikke featuren i planen." }, { status: 404, ...NO_STORE });
  const folder = override || task.specPath;
  if (!folder) return Response.json({ error: "no-spec", message: "Featuren har ingen spec-mappe i Skytale.Specs. Skriv mappenavnet i feltet over og prøv igjen." }, { status: 404, ...NO_STORE });
  const path = estimatePath(folder);
  try {
    const client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma)));
    const text = await client.gitItem(SPECS_REPO_ID, path);
    if (text === null) return Response.json({ error: "no-file", message: "Fant ikke " + path.slice(1) + " i Skytale.Specs. Utredningen legger den der når estimatet er klart." }, { status: 404, ...NO_STORE });
    const raw = parseEstimateYaml(text);
    if (!raw) return Response.json({ error: "bad-yaml", message: "estimate.yaml mangler likely_weeks og late_weeks." }, { status: 422, ...NO_STORE });
    return Response.json({ raw, path }, NO_STORE);
  } catch (e) {
    return adoErrorResponse(e);
  }
}
