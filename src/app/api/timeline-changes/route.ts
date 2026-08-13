import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Change log for the shared timeline plan — newest first.
// GET ?limit=50&before=<ISO> → { changes: [{id, taskId, taskLabel, kind, groups, before, after, editor, at}] }

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const before = url.searchParams.get("before");

  try {
    const changes = await prisma.timelineChange.findMany({
      where: before ? { at: { lt: new Date(before) } } : undefined,
      orderBy: { at: "desc" },
      take: limit,
    });
    return Response.json({ changes }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // tabellen finnes ikke før migrasjonen er kjørt
    return Response.json({ changes: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
