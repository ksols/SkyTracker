import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Serves the intake page («Inntak», spec R7b): the list of wishes PreSales registers and produktforum decides.
// Vanilla HTML/JS like the timeline, same Entra login, same plan API (the wishes live in the plan JSON).
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  const html = readFileSync(path.join(process.cwd(), "src/app/inntak/inntak.html"), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
