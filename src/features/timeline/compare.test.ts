import { describe, expect, it } from "vitest";
import { exportMarkdown, sinceLabel, snapshotForDay, summarizeNet, summaryLine, type PathEvent } from "./compare";
import type { PlanEvent } from "./events";

const ev = (code: PlanEvent["code"], over: Partial<PlanEvent> = {}): PlanEvent =>
  ({ targetType: code.startsWith("epic") ? "epic" : "feature", targetId: "t", targetLabel: "T", laneKey: "x", code, cause: "bruker", summary: code, ...over });
const path = (over: Partial<PathEvent> & { code: PlanEvent["code"] }): PathEvent =>
  ({ ...ev(over.code), at: "2026-11-06T10:00:00.000Z", editor: "GO", changeset: { id: "cs1", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: null, reasonCode: null, source: "bruker" }, ...over });

describe("summarizeNet", () => {
  it("counts goal moves, widened spans only, lane changes, reorders, later moves, new and removed, and changesets without a reason", () => {
    const net = [
      ev("epic.maldato"), ev("epic.maldato"),
      ev("feature.spenn", { before: { likely: 4, late: 6 }, after: { likely: 4, late: 8 } }),
      ev("feature.spenn", { before: { likely: 4, late: 6 }, after: { likely: 3, late: 5 } }),
      ev("feature.epic"), ev("epic.prioritet"), ev("feature.prioritet"),
      ev("feature.flyttet", { before: { start: 4 }, after: { start: 4.5 } }),
      ev("feature.flyttet", { before: { start: 4 }, after: { start: 3.5 } }),
      ev("feature.ny"), ev("epic.slettet"), ev("feature.slettet"),
    ];
    const p = [
      path({ code: "feature.spenn", changeset: { id: "a", at: "", editor: "GO", reason: null, reasonCode: "ingen", source: "bruker" } }),
      path({ code: "feature.flyttet", changeset: { id: "a", at: "", editor: "GO", reason: null, reasonCode: "ingen", source: "bruker" } }),
      path({ code: "epic.maldato", changeset: { id: "b", at: "", editor: "GO", reason: "Telenor", reasonCode: "ekstern", source: "bruker" } }),
    ];
    expect(summarizeNet(net, p)).toEqual({ maldatoer: 2, spenn: 1, byttetEpic: 1, prioriteringer: 2, flyttet: 1, nye: 1, fjernet: 2, mangler: 1 });
  });
});

describe("summaryLine and sinceLabel", () => {
  it("lists only the non-zero parts in the spec's order and wording", () => {
    const s = { maldatoer: 2, spenn: 3, byttetEpic: 1, prioriteringer: 2, flyttet: 0, nye: 0, fjernet: 0, mangler: 4 };
    expect(summaryLine("produktforum 5. nov", s)).toBe("Siden produktforum 5. nov: 2 måldatoer flyttet · 3 spenn utvidet · 1 feature byttet epic · 2 prioriteringer · 4 begrunnelser mangler");
    expect(summaryLine("5. nov", { maldatoer: 1, spenn: 0, byttetEpic: 0, prioriteringer: 0, flyttet: 1, nye: 2, fjernet: 1, mangler: 0 }))
      .toBe("Siden 5. nov: 1 måldato flyttet · 1 feature flyttet senere · 2 nye · 1 fjernet");
    expect(summaryLine("5. nov", { maldatoer: 0, spenn: 0, byttetEpic: 0, prioriteringer: 0, flyttet: 0, nye: 0, fjernet: 0, mangler: 0 })).toBe("Siden 5. nov: ingen endringer");
  });
  it("sinceLabel lowercases a baseline label's first letter and names a daily snapshot by its day", () => {
    expect(sinceLabel({ kind: "baseline", label: "Produktforum 5. nov", at: "2026-11-05T09:00:00.000Z", day: null })).toBe("produktforum 5. nov");
    expect(sinceLabel({ kind: "dag", label: null, at: "2026-11-05T07:12:00.000Z", day: "2026-11-05" })).toBe("5. nov");
  });
});

describe("exportMarkdown", () => {
  it("groups the path by section, adds reasons and the missing-reason list, skips empty sections", () => {
    const p: PathEvent[] = [
      path({ code: "epic.maldato", targetType: "epic", targetId: "x", targetLabel: "Telenor", summary: "Måldato: 15. des → 15. jan",
        changeset: { id: "b", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: "Telenor flyttet piloten", reasonCode: "ekstern", source: "bruker" } }),
      path({ code: "feature.spenn", targetLabel: "Kapasitet", summary: "Spenn: 4–7 → 4–9 uker (utvidet 2 uker)",
        changeset: { id: "a", at: "2026-11-06T11:00:00.000Z", editor: "THM", reason: null, reasonCode: "ingen", source: "bruker" } }),
      path({ code: "feature.flyttet", targetLabel: "Roller", summary: "Flyttet 2 uker av avhengighet «IAM»", cause: "avhengighet", causeRef: "iam",
        changeset: { id: "a", at: "2026-11-06T11:00:00.000Z", editor: "THM", reason: null, reasonCode: "ingen", source: "bruker" } }),
    ];
    const md = exportMarkdown("Siden produktforum 5. nov", "Siden produktforum 5. nov: 1 måldato flyttet · 1 spenn utvidet · 1 begrunnelse mangler", p, (k) => k === "x" ? "Telenor" : "Epic");
    expect(md.startsWith("# Siden produktforum 5. nov\n\nSiden produktforum 5. nov: 1 måldato flyttet")).toBe(true);
    expect(md).toContain("## Måldatoer\n- Telenor: Måldato: 15. des → 15. jan — Ekstern dato endret: Telenor flyttet piloten (GO, 6. nov)");
    expect(md).toContain("## Spenn\n- Telenor › Kapasitet: Spenn: 4–7 → 4–9 uker (utvidet 2 uker) — begrunnelse mangler (THM, 6. nov)");
    expect(md).toContain("## Flyttet\n- Telenor › Roller: Flyttet 2 uker av avhengighet «IAM» — avhengighet (THM, 6. nov)");
    expect(md).toContain("## Begrunnelser mangler\n- 6. nov, THM: Spenn: 4–7 → 4–9 uker (utvidet 2 uker); Flyttet 2 uker av avhengighet «IAM»");
    expect(md).not.toContain("## Prioritet");
    expect(exportMarkdown("Siden 5. nov", "Siden 5. nov: ingen endringer", [], () => "")).toBe("# Siden 5. nov\n\nSiden 5. nov: ingen endringer\n");
  });
});

describe("snapshotForDay", () => {
  const snaps = [
    { id: "d1", kind: "dag", day: "2026-11-03", at: "2026-11-03T08:00:00.000Z" },
    { id: "b1", kind: "baseline", day: null, at: "2026-11-05T09:00:00.000Z" },
    { id: "d2", kind: "dag", day: "2026-11-06", at: "2026-11-06T07:00:00.000Z" },
  ];
  it("takes the day's own snapshot, else the first one after that day, else null", () => {
    expect(snapshotForDay(snaps, "2026-11-03")!.id).toBe("d1");
    expect(snapshotForDay(snaps, "2026-11-04")!.id).toBe("b1");
    expect(snapshotForDay(snaps, "2026-11-06")!.id).toBe("d2");
    expect(snapshotForDay(snaps, "2026-11-07")).toBeNull();
    expect(snapshotForDay([], "2026-11-01")).toBeNull();
  });
});
