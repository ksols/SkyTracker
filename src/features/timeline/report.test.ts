import { describe, expect, it } from "vitest";
import type { PathEvent } from "./compare";
import { dateToUnit, normalizePlan } from "./epic-tools.js";
import type { PlanEvent } from "./events";
import type { Plan, PlanTask } from "./merge";
import { digestText, sprintReportMarkdown } from "./report";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const G = D(2027, 2, 15); // the goal: 15 Feb
const TODAY = G - 2.5;
const est = (id: string, lane: string, label: string, start: number, likely: number, late: number, over: Partial<PlanTask> = {}): PlanTask =>
  ({ id, lane, label, kind: "estimate", start, endLikely: likely, end: late, deps: [], fv: {}, ...over });
function plan(withProgress = true, withDelivery = true): Plan {
  return normalizePlan({
    lanes: [{ key: "telenor", name: "Telenor", goalDate: G }, { key: "samtaler", name: "Samtaler", goalDate: G }],
    tasks: [
      est("kap", "telenor", "Kapasitet", G - 3.5, G - 1.5, G + 0.5, withProgress ? { progress: { pointsDone: 5, pointsTotal: 21, at: "t", source: "ado" } } : {}),
      est("fil2", "samtaler", "Fil 2", G - 3.5, G - 2, G - 1),
      ...(withDelivery ? [est("fildeling", "samtaler", "Fildeling", G - 5, G - 4.5, G - 4, { state: "levert", deliveredAt: "2026-11-06" })] : []),
    ],
    deleted: {},
  });
}
const ev = (over: Partial<PathEvent> & { code: PlanEvent["code"] }): PathEvent => ({
  targetType: "feature", targetId: "t", targetLabel: "T", laneKey: "telenor", cause: "bruker", summary: over.code, at: "2026-11-06T10:00:00.000Z", editor: "GO",
  changeset: { id: "cs", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: null, reasonCode: null, source: "bruker" }, ...over,
});
const path = (): PathEvent[] => [
  ev({ code: "feature.spenn", targetId: "kap", targetLabel: "Kapasitet", summary: "Spenn: 4–7 → 4–9 uker (utvidet 2 uker)", before: { likely: 4, late: 7 }, after: { likely: 4, late: 9 },
    changeset: { id: "a", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: "Flere noder", reasonCode: "utredning", source: "bruker" } }),
  ev({ code: "feature.tilstand", targetId: "kontakt", targetLabel: "Kontaktkort", laneKey: "_backlog", summary: "Klar for veikart", before: "utredes", after: "klar", editor: "THM",
    changeset: { id: "b", at: "2026-11-06T11:00:00.000Z", editor: "THM", reason: null, reasonCode: null, source: "bruker" } }),
];
const laneName = (k: string) => ({ telenor: "Telenor", samtaler: "Samtaler" })[k] ?? k;
const STRIP = "Siden sprintstart Sprint 71: 1 spenn utvidet";

describe("sprintReportMarkdown", () => {
  it("adds deliveries, progress per feature and the discoveries that moved on before the compare export's sections, in that order", () => {
    const md = sprintReportMarkdown({ title: "Sprintrapport Sprint 71", strip: STRIP, path: path(), plan: plan(), laneName, todayUnit: TODAY });
    expect(md.startsWith("# Sprintrapport Sprint 71\n\n" + STRIP + "\n")).toBe(true);
    expect(md).toContain("## Levert\n- Samtaler › Fildeling: levert 6. nov\n");
    expect(md).toMatch(/## Fremdrift per feature\n- Telenor › Kapasitet: 5 av 21 poeng · fremdrift 24 % · tid 50 % · gul · leveres uke \d+–\d+\n/);
    expect(md).toContain("## Utredninger som kom videre\n- Kontaktkort: Klar for veikart (THM, 6. nov)\n");
    expect(md).toContain("## Spenn\n- Telenor › Kapasitet: Spenn: 4–7 → 4–9 uker (utvidet 2 uker) — Utredningen viste mer/mindre arbeid: Flere noder (GO, 6. nov)");
    const order = ["## Levert", "## Fremdrift per feature", "## Utredninger som kom videre", "## Spenn"].map((h) => md.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(md).not.toContain("## Tilstand"); // the discovery's transition is reported once, under «Utredninger som kom videre»
  });
  it("omits the sections that have nothing to say", () => {
    const md = sprintReportMarkdown({ title: "Rapport siden 5. nov", strip: "Siden 5. nov: ingen endringer", path: [], plan: plan(false, false), laneName, todayUnit: TODAY });
    expect(md).toBe("# Rapport siden 5. nov\n\nSiden 5. nov: ingen endringer\n");
  });
});

describe("digestText", () => {
  it("counts the colours, names the yellow and red epics with their window, goal and latest reason, repeats the strip, lists deliveries and links", () => {
    const text = digestText({ plan: plan(), strip: STRIP, path: path(), todayUnit: TODAY, week: 46, url: "https://x/timeline" });
    const lines = text.split("\n");
    expect(lines[0]).toBe("*Tidslinjen, uke 46* — 1 grønn · 1 gul · 0 røde · 0 venter");
    expect(lines[1]).toMatch(/^🟡 Telenor: leveres uke \d+–\d+, måldato 15\. feb — Utredningen viste mer\/mindre arbeid: Flere noder \(GO, 6\. nov\)$/);
    expect(lines[2]).toBe(STRIP);
    expect(lines[3]).toBe("Levert denne uken: Fildeling (6. nov)");
    expect(lines[4]).toBe("<https://x/timeline|Tidslinjen>");
    expect(lines.length).toBe(5);
  });
  it("without yellow or red epics, deliveries or a url, only the header and the strip remain", () => {
    const quiet = normalizePlan({ lanes: [{ key: "s", name: "S", goalDate: G }], tasks: [est("f", "s", "F", G - 3, G - 2, G - 1)], deleted: {} });
    expect(digestText({ plan: quiet, strip: "Siden 5. nov: ingen endringer", path: [], todayUnit: TODAY, week: 46 })).toBe("*Tidslinjen, uke 46* — 1 grønn · 0 gule · 0 røde · 0 venter\nSiden 5. nov: ingen endringer");
  });
});
