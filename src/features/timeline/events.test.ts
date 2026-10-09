import { describe, expect, it } from "vitest";
import { adoEvent, diffPlans, movedKeys, needsReason, REASON_LABEL } from "./events";
import { dateToUnit, normalizePlan } from "./epic-tools.js";
import type { Plan, PlanLane, PlanTask } from "./merge";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const est = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "e", lane: "x", label: "Est", kind: "estimate", start: 4, endLikely: 5, end: 6, deps: [], fv: {}, ...over });
const disc = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "d", lane: "x", label: "Disc", kind: "discovery", start: 2, end: 3, deps: [], fv: {}, ...over });
const lane = (key: string, over: Partial<PlanLane> = {}): PlanLane => ({ key, name: "Epic " + key.toUpperCase(), ...over });
const plan = (lanes: PlanLane[], tasks: PlanTask[]): Plan => normalizePlan({ lanes, tasks, deleted: {} });
const one = (lanes: PlanLane[], tasks: PlanTask[] = []) => plan(lanes, tasks);
const codes = (ev: ReturnType<typeof diffPlans>) => ev.map((e) => e.code);

describe("movedKeys", () => {
  it("one move = one key; identical = none", () => {
    expect(movedKeys(["a", "b", "c", "d", "e"], ["e", "a", "b", "c", "d"])).toEqual(["e"]);
    expect(movedKeys(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
    expect(movedKeys(["a", "b", "c"], ["a", "c", "b"]).length).toBe(1);
    expect(movedKeys(["a", "b"], ["b", "x", "a"]).length).toBe(1); // x is new, ignored
  });
});

describe("diffPlans: epics", () => {
  it("identical plans, fv bumps and editor stamps are not events", () => {
    const b = one([lane("x")], [est({ fv: { tid: 1 }, editedBy: "A" })]);
    const a = one([lane("x")], [est({ fv: { tid: 4, label: 2 }, editedBy: "B", editedAt: "2026-10-08" })]);
    expect(diffPlans(b, a)).toEqual([]);
  });

  it("goal date: set, changed, provisional → firm, removed", () => {
    const dec = D(2026, 12, 15), jan = D(2027, 1, 15);
    const s = diffPlans(one([lane("x")]), one([lane("x", { goalDate: dec })]));
    expect(s).toEqual([expect.objectContaining({ code: "epic.maldato", targetType: "epic", targetId: "x", summary: "Måldato satt: 15. des" })]);
    expect(diffPlans(one([lane("x", { goalDate: dec })]), one([lane("x", { goalDate: jan })]))[0].summary).toBe("Måldato: 15. des → 15. jan");
    expect(diffPlans(one([lane("x", { goalDate: dec, goalProvisional: true })]), one([lane("x", { goalDate: dec })]))[0].summary).toBe("Foreløpig mål 15. des → endelig måldato");
    expect(diffPlans(one([lane("x", { goalDate: dec, goalProvisional: true })]), one([lane("x", { goalDate: jan, goalProvisional: true })]))[0].summary).toBe("Foreløpig mål: 15. des → 15. jan");
    expect(diffPlans(one([lane("x", { goalDate: dec })]), one([lane("x")]))[0].summary).toBe("Måldato fjernet (var 15. des)");
  });

  it("name, metric, external date, ado id, new and deleted epics", () => {
    const ev = diffPlans(
      one([lane("x", { name: "Gammel" }), lane("y")], [est({ lane: "y" }), est({ id: "e2", lane: "y" })]),
      one([lane("x", { name: "Ny", metric: "3 kunder", externalDate: true, adoId: 4791 }), lane("z")]),
    );
    expect(codes(ev)).toEqual(["epic.navn", "epic.maltall", "epic.ekstern", "epic.ado", "epic.ny", "epic.slettet"]);
    expect(ev.map((e) => e.summary)).toEqual([
      "Navn: «Gammel» → «Ny»", "Måltall satt: 3 kunder", "Merket som ekstern dato", "ADO-id: #4791", "Ny epic", "Epic slettet (med 2 features)",
    ]);
  });

  it("one reorder = one epic.prioritet, placed before the lane it now precedes", () => {
    const b = one([lane("a", { priority: 1 }), lane("b", { priority: 2 }), lane("c", { priority: 3 })]);
    const a = one([lane("a", { priority: 2 }), lane("b", { priority: 3 }), lane("c", { priority: 1 })]);
    const ev = diffPlans(b, a);
    expect(ev).toEqual([expect.objectContaining({ code: "epic.prioritet", targetId: "c", before: 3, after: 1, summary: "Prioritet: 3 → 1 (foran «Epic A»)" })]);
    const last = diffPlans(a, b);
    expect(last[0].summary).toBe("Prioritet: 1 → 3 (sist)");
  });
});

describe("diffPlans: features", () => {
  it("a plain drag is feature.flyttet only; a right-handle drag is feature.spenn only; a left-handle drag is both", () => {
    const b = one([lane("x")], [est({ start: 4, endLikely: 5, end: 6 })]);
    const moved = diffPlans(b, one([lane("x")], [est({ start: 4.5, endLikely: 5.5, end: 6.5 })]));
    expect(codes(moved)).toEqual(["feature.flyttet"]);
    expect(moved[0].summary).toMatch(/^Flyttet 2 uker senere: start \d+\. [a-zæøå]+ → \d+\. [a-zæøå]+$/);
    const widened = diffPlans(b, one([lane("x")], [est({ start: 4, endLikely: 5, end: 6.5 })]));
    expect(widened).toEqual([expect.objectContaining({ code: "feature.spenn", before: { likely: 4, late: 8 }, after: { likely: 4, late: 10 }, summary: "Spenn: 4–8 → 4–10 uker (utvidet 2 uker)" })]);
    const left = diffPlans(b, one([lane("x")], [est({ start: 4.25, endLikely: 5, end: 6 })]));
    expect(codes(left)).toEqual(["feature.flyttet", "feature.spenn"]);
    expect(left[1].summary).toBe("Spenn: 4–8 → 3–7 uker (krympet 1 uke)");
    const likelyOnly = diffPlans(b, one([lane("x")], [est({ start: 4, endLikely: 5.5, end: 6 })]));
    expect(likelyOnly[0].summary).toBe("Spenn: 4–8 → 6–8 uker (sannsynlig 4 → 6 uker)");
  });

  it("discovery end, kind changes, new and deleted", () => {
    const b = one([lane("x")], [disc({ start: 2, end: 3 })]);
    expect(diffPlans(b, one([lane("x")], [disc({ start: 2, end: 3.5 })]))[0].summary).toMatch(/^Utredning slutt: \d+\. [a-zæøå]+ → \d+\. [a-zæøå]+ \(2 uker senere\)$/);
    const estimated = diffPlans(b, one([lane("x")], [est({ id: "d", label: "Disc", start: 2, endLikely: 3, end: 3.5 })]));
    expect(estimated.map((e) => e.code)).toEqual(["feature.estimert", "feature.tilstand"]);   // in an epic, an estimate is aktiv
    expect(estimated[0].summary).toBe("Utredet: estimat 4–6 uker");
    const back = diffPlans(one([lane("x")], [est({})]), one([lane("x")], [disc({ id: "e", label: "Est", start: 4, end: 5 })]));
    expect(codes(back)).toEqual(["feature.utredning", "feature.tilstand"]);
    const fresh = diffPlans(one([lane("x")]), one([lane("x")], [disc({ id: "n", label: "Ny" }), est({ id: "m", label: "M" })]));
    expect(fresh.map((e) => e.summary)).toEqual([expect.stringMatching(/^Ny utredning \(til /), "Ny feature (4–8 uker)"]);
    const gone = diffPlans(one([lane("x")], [est({}), disc({})]), one([lane("x")]));
    expect(gone.map((e) => e.summary)).toEqual(["Feature slettet", "Utredning slettet"]);
  });

  it("lane change gives feature.epic only; an order change inside the lane gives one feature.prioritet", () => {
    const b = one([lane("x"), lane("y")], [est({ id: "a", order: 1 }), est({ id: "b", order: 2 }), est({ id: "c", order: 3 })]);
    const moved = diffPlans(b, one([lane("x"), lane("y")], [est({ id: "a", order: 1 }), est({ id: "b", lane: "y", order: 1 }), est({ id: "c", order: 3 })]));
    expect(moved).toEqual([expect.objectContaining({ code: "feature.epic", targetId: "b", summary: "Flyttet fra «Epic X» til «Epic Y»" })]);
    const reordered = diffPlans(b, one([lane("x"), lane("y")], [est({ id: "a", order: 2 }), est({ id: "b", order: 3 }), est({ id: "c", order: 1 })]));
    expect(reordered).toEqual([expect.objectContaining({ code: "feature.prioritet", targetId: "c", summary: "Prioritet i epicen: 3 → 1" })]);
  });

  it("dependencies, ado id, name", () => {
    const b = one([lane("x")], [est({ id: "a", label: "A" }), est({ id: "b", label: "B", deps: ["a"] }), est({ id: "c", label: "C" })]);
    const a = one([lane("x")], [est({ id: "a", label: "A2", adoId: 1 }), est({ id: "b", label: "B", deps: ["c"] }), est({ id: "c", label: "C" })]);
    // labels are resolved in the AFTER plan, so the removed blocker shows its new name
    expect(diffPlans(b, a).map((e) => e.summary)).toEqual(["Navn: «A» → «A2»", "ADO-id: #1", "Blokkeres nå av «C»", "Avhengighet til «A2» fjernet"]);
  });

  it("a push caused by a dependency is attributed to the blocker", () => {
    const b = one([lane("x")], [est({ id: "a", label: "IAM", start: 4, endLikely: 5, end: 6 }), est({ id: "b", label: "Roller", start: 6, endLikely: 7, end: 8, deps: ["a"] })]);
    const a = one([lane("x")], [est({ id: "a", label: "IAM", start: 4.5, endLikely: 5.5, end: 6.5 }), est({ id: "b", label: "Roller", start: 6.5, endLikely: 7.5, end: 8.5, deps: ["a"] })]);
    const ev = diffPlans(b, a, { causes: { b: "dep:a" } });
    expect(ev[0]).toMatchObject({ targetId: "a", cause: "bruker" });
    expect(ev[1]).toMatchObject({ targetId: "b", code: "feature.flyttet", cause: "avhengighet", causeRef: "a", summary: "Flyttet 2 uker av avhengighet «IAM»" });
  });

  it("source seed collapses everything into one plan.seed event", () => {
    const ev = diffPlans(one([]), one([lane("x"), lane("y")], [est({}), disc({})]), { source: "seed" });
    expect(ev).toEqual([expect.objectContaining({ code: "plan.seed", targetType: "plan", cause: "system", summary: "Eksempel-epics lastet inn (2 epics, 2 features)" })]);
  });
});

describe("needsReason", () => {
  const dec = D(2026, 12, 15), jan = D(2027, 1, 15);
  const first = (b: Plan, a: Plan, o?: { causes?: Record<string, string> }) => diffPlans(b, a, o)[0];
  it("asks for goal changes but not the first goal, widened spans but not narrowed, moves of a week or more later, lane changes, epic reorders, deleted estimates", () => {
    expect(needsReason(first(one([lane("x")]), one([lane("x", { goalDate: dec })])))).toBe(false);
    expect(needsReason(first(one([lane("x", { goalDate: dec })]), one([lane("x", { goalDate: jan })])))).toBe(true);
    expect(needsReason(first(one([lane("x", { goalDate: dec, goalProvisional: true })]), one([lane("x", { goalDate: dec })])))).toBe(true);
    const b = one([lane("x")], [est({ start: 4, endLikely: 5, end: 6 })]);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4, endLikely: 5, end: 6.5 })])))).toBe(true);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4, endLikely: 5, end: 5.5 })])))).toBe(false);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4.25, endLikely: 5.25, end: 6.25 })])))).toBe(true);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4.1, endLikely: 5.1, end: 6.1 })])))).toBe(false);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 3, endLikely: 4, end: 5 })])))).toBe(false);
    expect(needsReason(first(b, one([lane("x")], [est({ start: 4.5, endLikely: 5.5, end: 6.5 })]), { causes: { e: "dep:z" } }))).toBe(false);
    const d = one([lane("x")], [disc({ start: 2, end: 3 })]);
    expect(needsReason(first(d, one([lane("x")], [disc({ start: 2, end: 3.25 })])))).toBe(true);
    expect(needsReason(first(d, one([lane("x")], [disc({ start: 2, end: 2.5 })])))).toBe(false);
    expect(needsReason(first(one([lane("x"), lane("y")], [est({})]), one([lane("x"), lane("y")], [est({ lane: "y" })])))).toBe(true);
    expect(needsReason(first(one([lane("a", { priority: 1 }), lane("b", { priority: 2 })]), one([lane("a", { priority: 2 }), lane("b", { priority: 1 })])))).toBe(true);
    expect(needsReason(first(one([lane("x")], [est({})]), one([lane("x")])))).toBe(true);
    expect(needsReason(first(one([lane("x")], [disc({})]), one([lane("x")])))).toBe(false);
  });
  it("labels exist for every reason code", () => {
    expect(REASON_LABEL.prioritering).toBe("Prioritert om i produktforum");
    expect(REASON_LABEL.ingen).toBe("Uten begrunnelse");
  });
});

describe("diffPlans: lifecycle", () => {
  const shelf = (over: Partial<PlanTask>) => est({ lane: "_backlog", ...over });
  it("feature states, owner, buffer and raw changes get events with the process's words", () => {
    const b = one([lane("x")], [disc({ id: "w", lane: "_backlog", state: "ny" })]);
    const started = one([lane("x")], [disc({ id: "w", lane: "_backlog", assignee: "THM", start: 2, end: 3 })]);
    expect(diffPlans(b, started).map((e) => [e.code, e.summary])).toEqual([
      ["feature.tilstand", expect.stringMatching(/^Utredning startet \(til \d+\. [a-zæøå]+\)$/)], ["feature.eier", "Eier: THM"],
    ]);
    const ready = one([lane("x")], [shelf({ id: "w", label: "Disc", assignee: "THM", start: 2, endLikely: 3, end: 3.5, raw: { likely: 4, late: 6 } })]);
    expect(diffPlans(started, ready).map((e) => e.code)).toEqual(["feature.estimert", "feature.tilstand", "feature.raw"]);
    expect(diffPlans(started, ready).map((e) => e.summary)).toEqual(["Utredet: estimat 4–6 uker", "Klar for veikart", "Utredningen sa 4–6 uker"]);
    const placed = one([lane("x")], [est({ id: "w", label: "Disc", assignee: "THM", start: 2, endLikely: 3.25, end: 3.75, raw: { likely: 4, late: 6 }, bufferWeeks: 1, committedRange: { likely: 5, late: 7, start: 2 }, activatedAt: "2026-11-05" })]);
    expect(diffPlans(ready, placed).map((e) => e.summary)).toEqual([
      "Flyttet fra «Klar for veikart» til «Epic X»", "Spenn: 4–6 → 5–7 uker (utvidet 1 uke)", "Aktiv: lagt i epicen med lovet spenn 5–7 uker", "Buffer: 0 → 1 uke",
    ]);
    const back = one([lane("x")], [shelf({ id: "w", label: "Disc", assignee: "THM", start: 2, endLikely: 3.25, end: 3.75, raw: { likely: 4, late: 6 }, bufferWeeks: 1 })]);
    expect(diffPlans(placed, back).map((e) => e.summary)).toEqual(["Flyttet fra «Epic X» til «Klar for veikart»", "Tilbake på hylla: klar for veikart"]);
    const delivered = one([lane("x")], [est({ id: "w", label: "Disc", assignee: "THM", start: 2, endLikely: 3.25, end: 3.75, raw: { likely: 4, late: 6 }, bufferWeeks: 1, state: "levert", deliveredAt: "2026-12-03" })]);
    expect(diffPlans(placed, delivered).map((e) => e.summary)).toEqual(["Levert 3. des"]);
  });

  it("epic states: chosen, closed with an outcome, back to proposal; closing asks for a reason", () => {
    const prop = one([lane("x", { state: "forslag" })]), act = one([lane("x", { state: "aktiv" })]);
    const closed = one([lane("x", { state: "avsluttet", outcome: "nådd", closedReason: "3 kunder i drift" })]);
    expect(diffPlans(prop, act)[0]).toMatchObject({ code: "epic.tilstand", summary: "Valgt i produktforum" });
    expect(diffPlans(act, closed)[0].summary).toBe("Avsluttet: nådd – 3 kunder i drift");
    expect(diffPlans(act, one([lane("x", { state: "avsluttet", outcome: "endret" })]))[0].summary).toBe("Avsluttet: endret");
    expect(diffPlans(act, prop)[0].summary).toBe("Tilbake til forslag");
    expect(needsReason(diffPlans(act, closed)[0])).toBe(true);
    expect(needsReason(diffPlans(prop, act)[0])).toBe(true);
  });
});

describe("the mirror's events", () => {
  it("a changeset from ADO carries cause ado on every diff event and never asks for a reason", () => {
    const b = one([lane("x")], [est({ state: "aktiv" })]);
    const a = one([lane("x")], [est({ state: "levert", deliveredAt: "2026-12-03" })]);
    const ev = diffPlans(b, a, { source: "ado" });
    expect(ev.map((e) => [e.code, e.cause, e.summary])).toEqual([["feature.tilstand", "ado", "Levert 3. des"]]);
    expect(ev.some(needsReason)).toBe(false);
  });
  it("an estimate pulled from Skytale.Specs is «Estimat hentet fra utredningen», with the buffer named when it stayed", () => {
    const b = one([lane("x")], [est({ bufferWeeks: 1, raw: { likely: 4, late: 6 } })]);
    const a = one([lane("x")], [est({ bufferWeeks: 1, raw: { likely: 5, late: 8, source: "specs", pulledAt: "2026-10-09T08:00:00.000Z" } })]);
    const ev = diffPlans(b, a);
    expect(ev.filter((e) => e.code === "feature.estimat-hentet").map((e) => e.summary)).toEqual(["Estimat hentet fra utredningen: 5–8 (uendret buffer 1 uke)"]);
    expect(ev.some((e) => e.code === "feature.raw")).toBe(false);
  });
  it("a sprint goal set or changed is plan.sprintmaal", () => {
    const b = one([lane("x")]), a = { ...one([lane("x")]), sprintGoals: { "Sprint 71": { text: "Tråder i beta", at: "2026-10-09T08:00:00.000Z" } } };
    expect(diffPlans(b, a).map((e) => [e.code, e.targetLabel, e.summary])).toEqual([["plan.sprintmaal", "Sprint 71", "Sprintmål Sprint 71: «Tråder i beta»"]]);
  });
  it("adoEvent builds a system event with cause ado", () => {
    expect(adoEvent("ado.push", { targetType: "feature", targetId: "k", targetLabel: "Kapasitet", laneKey: "l" }, "Pushet til ADO #4791 (Feature opprettet)", { after: { adoId: 4791 } }))
      .toEqual({ targetType: "feature", targetId: "k", targetLabel: "Kapasitet", laneKey: "l", code: "ado.push", cause: "ado", summary: "Pushet til ADO #4791 (Feature opprettet)", after: { adoId: 4791 } });
  });
});

describe("feature.fremdrift", () => {
  it("points, percent, nothing when equal, cause ado when ADO wrote it", () => {
    const b = one([lane("x")], [est({ state: "aktiv" })]);
    const pts = one([lane("x")], [est({ state: "aktiv", progress: { pointsDone: 13, pointsTotal: 21, at: "t", source: "manuell" } })]);
    expect(diffPlans(b, pts).map((e) => [e.code, e.cause, e.summary])).toEqual([["feature.fremdrift", "bruker", "Fremdrift: 13 av 21 poeng"]]);
    const pct = one([lane("x")], [est({ state: "aktiv", progress: { pct: 60, at: "t", source: "manuell" } })]);
    expect(diffPlans(b, pct).map((e) => e.summary)).toEqual(["Fremdrift: 60 %"]);
    expect(diffPlans(pts, one([lane("x")], [est({ state: "aktiv", progress: { pointsDone: 13, pointsTotal: 21, at: "later", source: "manuell" } })]))).toEqual([]);
    const ado = one([lane("x")], [est({ state: "aktiv", progress: { pointsDone: 5, pointsTotal: 21, sprint: "Sprint 71", at: "t", source: "ado" } })]);
    expect(diffPlans(pts, ado).map((e) => [e.code, e.cause])).toEqual([["feature.fremdrift", "ado"]]);
  });
});

describe("the queue's events (stage 6)", () => {
  it("a queue push is cause avhengighet with the earlier feature named; pins and the mix are logged", () => {
    const b = one([lane("x")], [est({ id: "a", label: "A", assignee: "THM" }), est({ id: "b", label: "B", start: 4, endLikely: 5, end: 6, assignee: "THM" })]);
    const a = one([lane("x")], [est({ id: "a", label: "A", assignee: "THM" }), est({ id: "b", label: "B", start: 6, endLikely: 7, end: 8, assignee: "THM" })]);
    const ev = diffPlans(b, a, { causes: { b: "queue:a" } });
    expect(ev.map((e) => [e.code, e.cause, e.causeRef, e.summary])).toEqual([["feature.flyttet", "avhengighet", "a", "Flyttet 8 uker: i kø bak «A» (THM)"]]);
    expect(ev.some(needsReason)).toBe(false);
    const pinned = one([lane("x")], [est({ id: "a", label: "A", pinned: true })]);
    expect(diffPlans(one([lane("x")], [est({ id: "a", label: "A" })]), pinned).map((e) => [e.code, e.summary])).toEqual([["feature.ko", "Overstyrer køen"]]);
    expect(diffPlans(pinned, one([lane("x")], [est({ id: "a", label: "A" })])).map((e) => e.summary)).toEqual(["Følger køen igjen"]);
    const mixed = { ...one([lane("x")]), capacity: { mode: "normal" as const, at: "t" } };
    expect(diffPlans(one([lane("x")]), mixed).map((e) => [e.code, e.summary])).toEqual([["plan.kapasitet", "Sprintmiks: overgang (55 % til features) → normal (60 %)"]]);
  });
});

describe("diffPlans: an import from ADO", () => {
  it("marks the new items as ADO's and says where they came from", () => {
    const b = one([lane("x")], []);
    const a = one([lane("x"), lane("ado4802", { name: "Bedre samhandling i chats", adoId: 4802 })], [disc({ id: "ado4566", lane: "ado4802", label: "Message threading and replies", adoId: 4566 })]);
    const ev = diffPlans(b, a, { source: "import" });
    expect(codes(ev)).toEqual(["epic.ny", "feature.ny"]);
    expect(ev.map((e) => e.cause)).toEqual(["ado", "ado"]);
    expect(ev[0].summary.startsWith("Hentet fra ADO #4802 · ")).toBe(true);
    expect(ev[1].summary.startsWith("Hentet fra ADO #4566 · ")).toBe(true);
    expect(ev[1].summary).toContain("Ny utredning");
  });
  it("a plain save of a new feature with an ADO id typed by hand reads as the user's", () => {
    const b = one([lane("x")], []);
    const a = one([lane("x")], [disc({ id: "t", adoId: 4566 })]);
    const ev = diffPlans(b, a);
    expect(ev[0].cause).toBe("bruker");
    expect(ev[0].summary.startsWith("Hentet")).toBe(false);
  });
});

describe("diffPlans: wishes (the intake)", () => {
  const w = (id: string, over: Record<string, unknown> = {}) => ({ id, title: "Kontaktkort for bedrifter", status: "ubehandlet", source: "kunde", ...over });
  const withWishes = (wishes: Record<string, unknown>[]) => normalizePlan({ lanes: [], tasks: [], deleted: {}, wishes });
  it("a new wish is registered, a decision is logged with owner, class and forum, a no carries its reason, a removal is logged; none asks for a reason", () => {
    const b = withWishes([w("a"), w("b", { title: "Levetid på meldinger" }), w("c", { title: "Maps" }), w("d", { title: "Vekk" })]);
    const a = withWishes([w("n", { title: "Ny sak", source: "investor" }), w("a", { status: "utred", owner: "THM", sizeClass: "M", forum: "Produktforum 5. nov" }), w("b", { title: "Levetid på meldinger", status: "senere", forum: "Produktforum 5. nov" }), w("c", { title: "Maps", status: "nei", reason: "Utenfor strategien" })]);
    const ev = diffPlans(b, a);
    expect(ev.map((e) => [e.code, e.targetType, e.summary])).toEqual([
      ["onske.registrert", "onske", "Nytt ønske «Ny sak» (investor)"],
      ["onske.besluttet", "onske", "Utred nå: «Kontaktkort for bedrifter» · THM, M · Produktforum 5. nov"],
      ["onske.besluttet", "onske", "Senere: «Levetid på meldinger» · Produktforum 5. nov"],
      ["onske.besluttet", "onske", "Nei: «Maps» – Utenfor strategien"],
      ["onske.slettet", "onske", "Ønske slettet: «Vekk»"],
    ]);
    expect(ev.every((e) => e.laneKey === null && e.cause === "bruker" && !needsReason(e))).toBe(true);
    expect(ev[1].before).toEqual({ status: "ubehandlet" });
    expect(ev[1].after).toEqual({ status: "utred", owner: "THM", sizeClass: "M", forum: "Produktforum 5. nov", reason: null });
  });
  it("an edit of the title or note is not an event; nothing changes → nothing", () => {
    const b = withWishes([w("a")]);
    const a = withWishes([w("a", { title: "Kontaktkort", note: "mer tekst" })]);
    expect(diffPlans(b, a)).toEqual([]);
  });
});

describe("diffPlans: a queue push behind a discovery", () => {
  it("reads «i kø bak utredning «D» (THM)»", () => {
    const b = one([lane("x")], [est({ id: "f", start: 4, endLikely: 5, end: 5.5, assignee: "THM", state: "aktiv" }), disc({ id: "d", label: "D", assignee: "THM", start: 4.25, end: 4.75 })]);
    const a = one([lane("x")], [est({ id: "f", start: 4.75, endLikely: 5.75, end: 6.25, assignee: "THM", state: "aktiv" }), disc({ id: "d", label: "D", assignee: "THM", start: 4.25, end: 4.75 })]);
    const ev = diffPlans(b, a, { causes: { f: "queue:d" } });
    expect(ev.length).toBe(1);
    expect(ev[0].summary).toBe("Flyttet 3 uker: i kø bak utredning «D» (THM)");
    expect(ev[0].causeRef).toBe("d");
  });
});
