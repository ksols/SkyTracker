import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Serves the shared epic-tools module (time unit, status, dependency push,
// seed) to the hosted timeline page. The same file is imported by vitest, so
// the browser and the tests always run identical logic.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  const js = readFileSync(path.join(process.cwd(), "src/features/timeline/epic-tools.js"), "utf8");
  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
