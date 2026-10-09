// The stored plan for server-side writers (the ADO routes): read, then commit with the version guard
// and log the changeset. The PUT route keeps its own merge path (api/timeline-plan).
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Plan } from "./merge";
import { recordChangeset, type SaveNote } from "./history";
import type { PlanEvent } from "./events";
import { notifyTurns } from "./notify";

export const PLAN_ID = "epics";
export type StoredPlan = { data: Plan; version: number };

export async function readPlan(db: PrismaClient): Promise<StoredPlan | null> {
  const row = await db.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  return row ? { data: row.data as unknown as Plan, version: row.version } : null;
}

/** null = someone else saved first (the caller answers 409 and the page retries). The log is best effort. */
export async function commitPlan(
  db: PrismaClient,
  args: { stored: StoredPlan; after: Plan; editor: string | null; note: SaveNote; extraEvents?: PlanEvent[] },
): Promise<{ version: number; changesetId: string | null } | null> {
  const updated = await db.timelinePlan.updateMany({
    where: { id: PLAN_ID, version: args.stored.version },
    data: { data: args.after as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: args.editor },
  });
  if (updated.count !== 1) return null;
  let changesetId: string | null = null;
  try {
    changesetId = await recordChangeset(db, { before: args.stored.data, after: args.after, beforeVersion: args.stored.version, afterVersion: args.stored.version + 1, editor: args.editor, note: args.note, extraEvents: args.extraEvents });
  } catch { /* best effort: tables missing or a transient DB error never fails the write */ }
  void notifyTurns(args.stored.data, args.after, { editor: args.editor, reason: args.note.reason, reasonCode: args.note.reasonCode });
  return { version: args.stored.version + 1, changesetId };
}
