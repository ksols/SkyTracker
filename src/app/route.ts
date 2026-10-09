import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// The feature board (spec R9): the plan's features as a Kanban over the lifecycle. Vanilla HTML/JS like the
// timeline and the intake, same Entra login, same plan API. It replaced the card board on 09.10.2026.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  const html = readFileSync(path.join(process.cwd(), "src/app/board.html"), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
