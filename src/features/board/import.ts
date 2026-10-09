// The old card board's cards as features on the shelf, once (spec R9 §6). Pure mapping over Card-shaped rows;
// the route reads the rows from Prisma. A card's `adoWorkItemId` is a User Story and is not carried over.
import type { Plan, PlanTask } from "@/features/timeline/merge";
import { BACKLOG, dateToUnit, normalizeAreas, normalizePlan, WEEK } from "@/features/timeline/epic-tools.js";

export type OldCard = {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  estimateType: string;
  estimateDate: Date | string | null;
  estimateWeeks: number | null;
  isGap: boolean;
  tags: unknown;
  adoWorkItemId: number | null;
  completedAt: Date | string | null;
  columnTitle?: string | null;
  columnPosition?: number | null;
  position: number;
};
export type OldDependency = { blockerCardId: string; blockedCardId: string };
export type ImportedCard = { id: string; cardId: string; label: string };

const TYPE: Record<string, PlanTask["type"] | undefined> = { FEATURE: undefined, OTHER: undefined, WORK_ITEM: "teknisk", BUG: "teknisk", MAINTENANCE: "vedlikehold" };
const day = (v: Date | string | null): string | null => {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const unitOf = (v: Date | string | null): number | null => {
  const s = day(v);
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return dateToUnit(new Date(y, m - 1, d));
};
const applicableAreas = (tags: unknown): string[] =>
  normalizeAreas(Array.isArray(tags) ? tags.filter((t): t is { name: string; applicable: boolean } => !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string" && (t as { applicable?: unknown }).applicable === true).map((t) => t.name) : []);
const snapWeek = (u: number) => Math.round(u / WEEK) * WEEK;

/** Every card that is not a gap and has not been imported yet (a task carries its `cardId`). */
export function cardsToImport(plan: Plan, cards: OldCard[]): OldCard[] {
  const held = new Set(plan.tasks.map((t) => t.cardId).filter((x): x is string => typeof x === "string"));
  return cards.filter((c) => !c.isGap && !held.has(c.id));
}

/** The cards as tasks on the shelf, in column order then position; dependencies between imported cards become deps. */
export function importCards(plan: Plan, cards: OldCard[], deps: OldDependency[], opts: { now: Date }): { plan: Plan; imported: ImportedCard[] } {
  const p: Plan = JSON.parse(JSON.stringify(plan));
  const todo = cardsToImport(p, cards).sort((a, b) => (a.columnPosition ?? 0) - (b.columnPosition ?? 0) || a.position - b.position);
  const start = snapWeek(dateToUnit(opts.now));
  const nowIso = opts.now.toISOString();
  const byCard = new Map<string, PlanTask>();
  p.tasks.forEach((t) => { if (typeof t.cardId === "string") byCard.set(t.cardId, t); });
  const imported: ImportedCard[] = [];
  let order = Math.max(0, ...p.tasks.filter((t) => t.lane === BACKLOG).map((t) => t.order ?? 0));
  for (const c of todo) {
    const t: PlanTask = { id: "card" + c.id, lane: BACKLOG, label: c.title.trim() || "Uten navn", kind: "discovery", start, end: start + WEEK, deps: [], fv: { state: 1, meta: 1, tid: 1 }, order: ++order, cardId: c.id, editedAt: nowIso };
    const weeks = c.estimateType === "WEEKS" && c.estimateWeeks && c.estimateWeeks > 0 ? Math.round(c.estimateWeeks) : null;
    const hard = c.estimateType === "HARD_DATE" ? unitOf(c.estimateDate) : null;
    if (weeks !== null) {
      t.kind = "estimate"; t.state = "klar"; t.raw = { likely: weeks, late: weeks, source: "brettet" };
      t.endLikely = t.end = start + weeks * WEEK;
    } else if (hard !== null) {
      t.kind = "estimate"; t.state = "klar"; t.fixedEnd = true;
      t.endLikely = t.end = Math.max(start + WEEK, hard);
    } else {
      t.state = "ny";
    }
    const done = day(c.completedAt);
    if (done) { t.state = "levert"; t.deliveredAt = done; if (t.kind === "discovery") { t.kind = "estimate"; t.endLikely = t.end; } }
    const type = TYPE[c.taskType];
    if (type) t.type = type;
    const areas = applicableAreas(c.tags);
    if (areas.length) t.areas = areas;
    const text = [c.description?.trim() || "", c.adoWorkItemId ? `(Fra det gamle brettet: ADO user story #${c.adoWorkItemId})` : ""].filter(Boolean).join("\n");
    if (text) t.description = text;
    p.tasks.push(t);
    byCard.set(c.id, t);
    imported.push({ id: t.id, cardId: c.id, label: t.label });
  }
  const fresh = new Set(imported.map((x) => x.cardId));
  for (const d of deps) {
    const blocked = byCard.get(d.blockedCardId), blocker = byCard.get(d.blockerCardId);
    if (!blocked || !blocker || blocked.id === blocker.id) continue;
    if (!fresh.has(d.blockedCardId) && !fresh.has(d.blockerCardId)) continue;
    if (!(blocked.deps ?? []).includes(blocker.id)) blocked.deps = [...(blocked.deps ?? []), blocker.id];
  }
  return { plan: normalizePlan(p), imported };
}
