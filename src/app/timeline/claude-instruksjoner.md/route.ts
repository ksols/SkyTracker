import { readFileSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// Serves the self-contained instruction file for editing the timeline plan
// JSON in a local Claude session. Downloaded as part of the "Claude package"
// from the timeline tool, so it must not assume any local repo or folder.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) redirect("/login");
  const md = readFileSync(
    path.join(process.cwd(), "src/features/timeline/claude-instruksjoner.md"),
    "utf8",
  );
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
