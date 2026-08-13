import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Buffer trend per milestone: one row per ISO week per milestone (upserted on
// save). Feeds the dashboard's buffer-health sparkline.

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const snapshots = await prisma.bufferSnapshot.findMany({
      orderBy: [{ milestoneId: "asc" }, { week: "asc" }],
    });
    return Response.json({ snapshots }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ snapshots: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
