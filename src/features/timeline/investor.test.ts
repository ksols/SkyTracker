import { describe, expect, it } from "vitest";
import type { PathEvent } from "./compare";
import { dateToUnit, dayKey, normalizePlan, unitToDate } from "./epic-tools.js";
import type { PlanEvent } from "./events";
import type { Plan, PlanLane, PlanTask } from "./merge";
import { defaultWindow, deliveryAbility, goalAttainment, investorData, investorHtml, investorMarkdown, planNow } from "./investor";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const addDays = (day: string, n: number) => { const [y, m, d] = day.split("-").map(Number); return dayKey(new Date(y, m - 1, d + n)); };
const CR = { likely: 4, late: 6, start: D(2026, 10, 5) };
const END = dayKey(unitToDate(CR.start + CR.late * 0.25)); // the committed late end, as a day
const WINDOW = { since: "2026-04-09", until: "2026-12-31" };
const lane = (key: string, name: string, over: Partial<PlanLane> = {}): PlanLane => ({ key, name, ...over });
const levert = (id: string, lane: string, deliveredAt: string, withRange = true): PlanTask =>
  ({ id, lane, label: "F " + id, kind: "estimate", start: CR.start, endLikely: CR.start + 1, end: CR.start + 1.5, deps: [], fv: {}, state: "levert", deliveredAt, ...(withRange ? { committedRange: CR } : {}) });
function plan(): Plan {
  return normalizePlan({
    lanes: [
      lane("telenor", "Telenor kan bygge på oss", { goalDate: D(2026, 12, 15), metric: "3 kunder i drift", priority: 1 }),
      lane("samtaler", "Samtaler du kan stole på", { priority: 2 }),
      lane("pilot", "Telenor pilot", { state: "avsluttet", outcome: "nådd", closedReason: "Pilot i drift", closedAt: "2026-10-01", priority: 3 }),
      lane("drift", "Vi ser nedetid før kunden", { state: "avsluttet", outcome: "ikke nådd", closedReason: "Nedprioritert", closedAt: "2026-09-30", priority: 4 }),
    ],
    tasks: [
      levert("kap", "telenor", addDays(END, 1)),
      levert("fil", "telenor", END),
      levert("old", "telenor", "2026-03-01"),
      levert("free", "telenor", "2026-11-02", false),
      { id: "act", lane: "telenor", label: "Aktiv", kind: "estimate", start: D(2026, 11, 2), endLikely: D(2026, 11, 2) + 1, end: D(2026, 11, 2) + 1.25, deps: [], fv: {}, state: "aktiv" },
    ],
    deleted: {},
  });
}
const ev = (over: Partial<PathEvent> & { code: PlanEvent["code"]; targetId: string }): PathEvent => ({
  targetType: "epic", targetLabel: over.targetId, laneKey: over.targetId, cause: "bruker", summary: over.code, at: "2026-11-06T10:00:00.000Z", editor: "GO",
  changeset: { id: "cs", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: null, reasonCode: null, source: "bruker" }, ...over,
});
const events = (): PathEvent[] => [
  ev({ code: "epic.maldato", targetId: "pilot", targetLabel: "Telenor pilot", summary: "Måldato: 15. des → 15. jan", changeset: { id: "a", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: "Telenor flyttet piloten", reasonCode: "ekstern", source: "bruker" } }),
  ev({ code: "epic.tilstand", targetId: "pilot", targetLabel: "Telenor pilot", summary: "Avsluttet: nådd – Pilot i drift", at: "2026-11-07T10:00:00.000Z", changeset: { id: "b", at: "2026-11-07T10:00:00.000Z", editor: "GO", reason: null, reasonCode: "omfang", source: "bruker" } }),
  ev({ code: "epic.maldato", targetId: "telenor", targetLabel: "Telenor kan bygge på oss", summary: "Måldato satt: 15. des" }),
];

describe("deliveryAbility", () => {
  it("counts deliveries in the window, inside or outside the committed span (the end day counts), the ones without a span apart", () => {
    const r = deliveryAbility(plan(), WINDOW);
    expect(r).toMatchObject({ delivered: 3, withCommitment: 2, inside: 1, ratio: 0.5 });
    expect(r.items.map((i) => [i.id, i.inside])).toEqual([["kap", false], ["fil", true], ["free", null]]);
    expect(r.items[1].committedEnd).toBe(END);
    expect(r.items[2].committedEnd).toBeNull();
  });
  it("no deliveries: zeros and a null ratio", () => {
    expect(deliveryAbility(plan(), { since: "2027-01-01", until: "2027-03-31" })).toEqual({ delivered: 0, withCommitment: 0, inside: 0, ratio: null, items: [] });
  });
});

describe("goalAttainment", () => {
  it("counts closed epics by outcome and attaches the forum's reason and the logged reasons", () => {
    const g = goalAttainment(plan(), events());
    expect(g.counts).toEqual({ "nådd": 1, "ikke nådd": 1, endret: 0 });
    expect(g.epics.map((e) => e.key)).toEqual(["pilot", "drift"]);
    expect(g.epics[0]).toMatchObject({ name: "Telenor pilot", outcome: "nådd", closedReason: "Pilot i drift", closedAt: "2026-10-01" });
    expect(g.epics[0].reasons).toEqual([
      "Måldato: 15. des → 15. jan — Ekstern dato endret: Telenor flyttet piloten (GO, 6. nov)",
      "Avsluttet: nådd – Pilot i drift — Omfanget endret (GO, 7. nov)",
    ]);
    expect(g.epics[1].reasons).toEqual([]);
  });
});

describe("planNow, defaultWindow and the exports", () => {
  it("lists the open epics with måltall, måldato, colour and window in priority order", () => {
    const p = planNow(plan());
    expect(p.length).toBe(2);
    expect(p[0]).toMatchObject({ key: "telenor", name: "Telenor kan bygge på oss", metric: "3 kunder i drift", goal: "Måldato 15. des", colour: "grønn" });
    expect(p[0].window).toMatch(/^Leveres uke \d+–\d+$/);
    expect(p[1]).toMatchObject({ key: "samtaler", metric: "", colour: "tom", window: "" });
  });
  it("defaultWindow spans two quarters back to today", () => {
    expect(defaultWindow(new Date(2026, 9, 9))).toEqual({ since: "2026-04-09", until: "2026-10-09" });
  });
  it("the markdown has the four sections with the numbers; the slide carries them too; an empty plan still renders", () => {
    const data = investorData(plan(), events(), WINDOW);
    const md = investorMarkdown(data);
    expect(md.startsWith("# Tidslinjen for investorer\n")).toBe(true);
    expect(md).toContain("## Planen nå\n");
    expect(md).toContain("- Telenor kan bygge på oss: grønn · 3 kunder i drift · Måldato 15. des · Leveres uke");
    expect(md).toContain("## Gjennomføringsevne (9. apr – 31. des)\n1 av 2 levert innenfor lovet spenn (50 %) · 1 levert uten lovet spenn\n");
    expect(md).toContain("## Målopnåelse\nnådd 1 · ikke nådd 1 · endret 0\n- Telenor pilot: nådd – Pilot i drift (1. okt)\n  - Måldato: 15. des → 15. jan — Ekstern dato endret: Telenor flyttet piloten (GO, 6. nov)\n");
    const html = investorHtml(data);
    expect(html).toContain("50 %");
    expect(html).toContain("Telenor pilot");
    expect(html).toContain("width:1280px");
    const empty = investorMarkdown(investorData({ lanes: [], tasks: [] }, [], WINDOW));
    expect(empty).toContain("## Planen nå\n- ingen aktive epics\n");
    expect(empty).toContain("0 av 0 levert innenfor lovet spenn (–)");
    expect(empty).toContain("## Målopnåelse\nnådd 0 · ikke nådd 0 · endret 0\n- ingen avsluttede epics\n");
    expect(investorHtml(investorData({ lanes: [], tasks: [] }, [], WINDOW))).toContain("<html");
  });
});
