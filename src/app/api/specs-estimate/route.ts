import { auth } from "@/lib/auth";

// «Hent estimat fra utredningen»: reads the raw range (likely/late weeks, points, who, date) from the
// feature's estimate.yaml in Skytale.Specs. Stage 4 wires the reader (ADO Git API with the signed-in
// person's Entra token); until then the page shows this message and the forum types the range in.
// GET ?id=<feature id> → 501 { error: "not-yet", message }

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(
    { error: "not-yet", message: "Henting fra Skytale.Specs kommer i etappe 4. Skriv inn spennet fra utredningen så lenge." },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}
