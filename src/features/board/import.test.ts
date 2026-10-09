import { describe, expect, it } from "vitest";
import { cardsToImport, importCards, type OldCard, type OldDependency } from "./import";
import { BACKLOG, dateToUnit, normalizePlan, WEEK } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";

const NOW = new Date(2026, 9, 9, 14, 0);
const card = (over: Partial<OldCard>): OldCard => ({
  id: "c1", title: "Kort", description: null, taskType: "FEATURE", estimateType: "NONE", estimateDate: null, estimateWeeks: null,
  isGap: false, tags: [{ name: "Backend", applicable: true }, { name: "Frontend", applicable: false }], adoWorkItemId: null, completedAt: null,
  columnTitle: "Backlog", columnPosition: 0, position: 0, ...over,
});
const CARDS: OldCard[] = [
  card({ id: "c1", title: "Kontaktkort", description: "Kort med rolle", taskType: "FEATURE", estimateType: "WEEKS", estimateWeeks: 3, position: 1 }),
  card({ id: "c2", title: "Revisjon NSR", taskType: "WORK_ITEM", estimateType: "HARD_DATE", estimateDate: new Date(2026, 11, 15), tags: [{ name: "Backend", applicable: true }, { name: "Frontend", applicable: true }], position: 0 }),
  card({ id: "c3", title: "Bare en idé", taskType: "OTHER", estimateType: "SCOPES", tags: [], position: 2 }),
  card({ id: "c4", title: "Gjort i sommer", taskType: "MAINTENANCE", estimateType: "WEEKS", estimateWeeks: 2, completedAt: new Date(2026, 7, 20), adoWorkItemId: 4321, columnTitle: "Ferdig", columnPosition: 2, position: 0 }),
  card({ id: "c5", title: "Hull", isGap: true }),
  card({ id: "c6", title: "Feilretting", taskType: "BUG", estimateType: "WEEKS", estimateWeeks: 1, columnTitle: "Neste", columnPosition: 1, position: 0 }),
];
const DEPS: OldDependency[] = [{ blockerCardId: "c2", blockedCardId: "c1" }, { blockerCardId: "c5", blockedCardId: "c1" }, { blockerCardId: "c9", blockedCardId: "c1" }];
const empty = (): Plan => normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [], deleted: {} });

describe("cardsToImport", () => {
  it("lists every card except gaps and the ones already imported", () => {
    const p = normalizePlan({ lanes: [], tasks: [{ id: "t", lane: BACKLOG, label: "Kontaktkort", kind: "estimate", start: 2, endLikely: 3, end: 3, deps: [], fv: {}, cardId: "c1" }], deleted: {} });
    expect(cardsToImport(p, CARDS).map((c) => c.id)).toEqual(["c2", "c3", "c4", "c6"]);
  });
});

describe("importCards", () => {
  const r = importCards(empty(), CARDS, DEPS, { now: NOW });
  const by = Object.fromEntries(r.plan.tasks.map((t) => [t.cardId as string, t]));
  it("weeks become a range with likely = late on the shelf, klar for veikart; the card id is kept", () => {
    const t = by.c1;
    expect([t.kind, t.state, t.lane, t.label, t.description]).toEqual(["estimate", "klar", BACKLOG, "Kontaktkort", "Kort med rolle"]);
    expect(t.raw).toEqual({ likely: 3, late: 3, source: "brettet" });
    expect(t.end - t.start).toBeCloseTo(3 * WEEK, 6);
    expect(t.endLikely).toBeCloseTo(t.end, 6);
    expect(t.areas).toEqual(["Backend"]);
    expect(t.type).toBeUndefined();
    expect(t.cardId).toBe("c1");
  });
  it("a hard date becomes a fixed end; the type follows the card's type; applicable tags become areas", () => {
    const t = by.c2;
    expect([t.kind, t.state, t.fixedEnd, t.type]).toEqual(["estimate", "klar", true, "teknisk"]);
    expect(t.end).toBeCloseTo(dateToUnit(new Date(2026, 11, 15)), 6);
    expect(t.endLikely).toBeCloseTo(t.end, 6);
    expect(t.areas).toEqual(["Backend", "Frontend"]);
  });
  it("scopes and none are registered wishes; a completed card is levert with its day, the user story noted", () => {
    expect([by.c3.kind, by.c3.state]).toEqual(["discovery", "ny"]);
    expect(by.c3.areas).toBeUndefined();
    const d = by.c4;
    expect([d.state, d.deliveredAt, d.type]).toEqual(["levert", "2026-08-20", "vedlikehold"]);
    expect(d.description).toContain("ADO user story #4321");
    expect(d.adoId).toBeUndefined();
  });
  it("a bug becomes teknisk; dependencies between imported cards become deps, others are dropped; gaps are skipped", () => {
    expect(by.c6.type).toBe("teknisk");
    expect(by.c1.deps).toEqual([by.c2.id]);
    expect(r.plan.tasks.some((t) => t.label === "Hull")).toBe(false);
    expect(r.imported.map((x) => x.cardId)).toEqual(["c2", "c1", "c3", "c6", "c4"]); // column order, then position
  });
  it("is idempotent: a second run imports nothing new", () => {
    const again = importCards(r.plan, CARDS, DEPS, { now: NOW });
    expect(again.imported).toEqual([]);
    expect(again.plan.tasks.length).toBe(r.plan.tasks.length);
    expect(normalizePlan(JSON.parse(JSON.stringify(r.plan))).tasks.find((t) => t.cardId === "c1")!.cardId).toBe("c1");
  });
});
