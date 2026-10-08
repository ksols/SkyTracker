// Glue between a save and the history tables: sanitise the client's note,
// compute the events, write the daily snapshot (plan as it was before the
// first change of the day), the changeset and its events. Best effort: the
// caller must never fail a save because logging failed.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Plan } from "./merge";
import { diffPlans, needsReason, REASON_CODES, type PlanEvent } from "./events";

export type SaveNote = { reason?: string; reasonCode?: string; causes?: Record<string, string>; source?: string };
const SOURCES = ["bruker", "seed", "import", "ado", "system"];
const REASON_MAX = 500;

export function parseNote(raw: unknown): SaveNote {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const note: SaveNote = {};
  if (typeof r.reason === "string" && r.reason.trim()) note.reason = r.reason.trim().slice(0, REASON_MAX);
  if (typeof r.reasonCode === "string" && (REASON_CODES as readonly string[]).includes(r.reasonCode)) note.reasonCode = r.reasonCode;
  if (r.causes && typeof r.causes === "object") {
    const causes: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.causes as Record<string, unknown>)) if (typeof v === "string" && v.length < 100) causes[k] = v;
    if (Object.keys(causes).length) note.causes = causes;
  }
  if (typeof r.source === "string" && SOURCES.includes(r.source)) note.source = r.source;
  return note;
}

export function osloDay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const json = (v: unknown): Prisma.InputJsonValue | undefined => (v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue));

export async function recordChangeset(
  db: PrismaClient,
  args: { before: Plan; after: Plan; beforeVersion: number; afterVersion: number; editor: string | null; note: SaveNote },
): Promise<string | null> {
  const events: PlanEvent[] = diffPlans(args.before, args.after, { causes: args.note.causes, source: args.note.source });
  if (!events.length) return null;
  const day = osloDay(new Date());
  const hasDaily = await db.timelineSnapshot.findFirst({ where: { kind: "dag", day }, select: { id: true } });
  if (!hasDaily) {
    try {
      await db.timelineSnapshot.create({ data: { kind: "dag", day, planVersion: args.beforeVersion, data: args.before as unknown as Prisma.InputJsonValue } });
    } catch { /* a concurrent save won the unique (kind, day) race: fine */ }
  }
  const reasonCode = args.note.reasonCode ?? (events.some(needsReason) ? "ingen" : null);
  const cs = await db.timelineChangeset.create({
    data: {
      editor: args.editor,
      source: args.note.source ?? "bruker",
      reason: args.note.reason ?? null,
      reasonCode,
      planVersion: args.afterVersion,
      eventCount: events.length,
      events: {
        create: events.map((e) => ({
          editor: args.editor,
          targetType: e.targetType, targetId: e.targetId, targetLabel: e.targetLabel, laneKey: e.laneKey,
          code: e.code, before: json(e.before), after: json(e.after),
          cause: e.cause, causeRef: e.causeRef ?? null, summary: e.summary,
        })),
      },
    },
    select: { id: true },
  });
  return cs.id;
}
