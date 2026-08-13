import { describe, expect, it } from "vitest";
import { bufferStatuses, computeImportDiff, depClosure, IMPORT_GROUP_PROPS, laneEconomy, milestoneCost, planEconomy } from "./plan-tools.js";
import { GROUP_PROPS, mergePlans, type Plan, type PlanTask } from "./merge";

function task(over: Partial<PlanTask>): PlanTask {
  return {
    id: "t1",
    lane: "produkt",
    label: "Oppgave",
    start: 1,
    end: 2,
    deps: [],
    subtasks: [],
    fv: {},
    ...over,
  };
}
function plan(tasks: PlanTask[], over: Partial<Plan> = {}): Plan {
  return { lanes: [{ key: "produkt", name: "Produkt" }], tasks, deleted: {}, ...over };
}

describe("computeImportDiff — endringsoppdaging", () => {
  it("identiske planer gir ingen endringer og urørt fv", () => {
    const current = plan([task({ id: "a", fv: { tid: 3 } })]);
    const incoming = plan([task({ id: "a", fv: { tid: 3 } })]);
    const r = computeImportDiff(current, incoming);
    expect(r.changes).toEqual([]);
    expect(r.plan.tasks[0].fv).toEqual({ tid: 3 });
  });

  it("flyttet oppgave bumper tid-gruppen fra GJELDENDE fv — filens fv ignoreres", () => {
    const current = plan([task({ id: "a", start: 1, end: 2, fv: { tid: 5 } })]);
    const incoming = plan([task({ id: "a", start: 3, end: 4, fv: { tid: 99 } })]);
    const r = computeImportDiff(current, incoming);
    const a = r.plan.tasks[0];
    expect(a.start).toBe(3);
    expect(a.fv!.tid).toBe(6);
    expect(r.changes).toEqual([
      expect.objectContaining({ kind: "endret", id: "a", groups: ["tid"] }),
    ]);
  });

  it("navneendring bumper kun label-gruppen", () => {
    const current = plan([task({ id: "a", fv: { label: 1, tid: 2 } })]);
    const incoming = plan([task({ id: "a", label: "Nytt navn" })]);
    const r = computeImportDiff(current, incoming);
    expect(r.plan.tasks[0].fv).toEqual({ label: 2, tid: 2 });
    expect(r.changes[0]).toMatchObject({ kind: "endret", groups: ["label"] });
  });

  it("statusendring (status/årsak/tidspunkt) bumper status-gruppen", () => {
    const current = plan([task({ id: "a", status: "gronn" })]);
    const incoming = plan([
      task({ id: "a", status: "gul", statusCause: "Ekstern blokkering" }),
    ]);
    const r = computeImportDiff(current, incoming);
    expect(r.plan.tasks[0].status).toBe("gul");
    expect(r.plan.tasks[0].fv!.status).toBe(1);
  });

  it("deps sammenlignes uavhengig av rekkefølge", () => {
    const current = plan([task({ id: "a", deps: ["x", "y"] })]);
    const incoming = plan([task({ id: "a", deps: ["y", "x"] })]);
    expect(computeImportDiff(current, incoming).changes).toEqual([]);
    const added = plan([task({ id: "a", deps: ["x", "y", "z"] })]);
    const r = computeImportDiff(current, added);
    expect(r.plan.tasks[0].fv!.deps).toBe(1);
  });

  it("endrede delmål bumper subtasks og avleder start/slutt fra delmålene", () => {
    const current = plan([task({ id: "a", start: 1, end: 2 })]);
    const incoming = plan([
      task({
        id: "a",
        start: 0, // inkonsistent med delmålene — skal avledes
        end: 9,
        subtasks: [
          { id: "s1", label: "Del 1", start: 2, end: 3 },
          { id: "s2", label: "Del 2", start: 3, end: 5 },
        ],
      }),
    ]);
    const r = computeImportDiff(current, incoming);
    const a = r.plan.tasks[0];
    expect(a.start).toBe(2);
    expect(a.end).toBe(5);
    expect(a.fv!.subtasks).toBe(1);
  });

  it("ny oppgave får fv 1 på alle grupper og meldes som ny", () => {
    const current = plan([]);
    const incoming = plan([task({ id: "ny1", label: "Fersk rad" })]);
    const r = computeImportDiff(current, incoming);
    expect(r.changes).toEqual([
      expect.objectContaining({ kind: "ny", id: "ny1", label: "Fersk rad" }),
    ]);
    for (const g of ["tid", "label", "status", "deps", "subtasks", "meta"]) {
      expect(r.plan.tasks[0].fv![g as keyof typeof r.plan.tasks[0]["fv"]]).toBe(1);
    }
  });

  it("gjeninnført oppgave bumpes forbi tombstonen så den overlever fletting", () => {
    const current = plan([], { deleted: { ny1: 3 } });
    const incoming = plan([task({ id: "ny1" })]);
    const r = computeImportDiff(current, incoming);
    const t = r.plan.tasks[0];
    expect(Math.max(...Object.values(t.fv!))).toBe(4);
    // og den overlever en faktisk mergePlans mot en plan med tombstonen
    const merged = mergePlans(plan([], { deleted: { ny1: 3 } }), r.plan);
    expect(merged.tasks.map((x) => x.id)).toContain("ny1");
  });

  it("oppgave som mangler i importen tombstones forbi sin maxFv", () => {
    const current = plan([task({ id: "borte", fv: { tid: 2, label: 4 } })]);
    const incoming = plan([]);
    const r = computeImportDiff(current, incoming);
    expect(r.plan.tasks).toEqual([]);
    expect(r.plan.deleted!.borte).toBe(5);
    expect(r.changes).toEqual([
      expect.objectContaining({ kind: "slettet", id: "borte" }),
    ]);
  });

  it("SkyTracker-speilrader som mangler i importen bevares i stedet for å slettes", () => {
    const st = task({ id: "st1", source: "skytracker", label: "ST-rad" });
    const current = plan([st]);
    const incoming = plan([]);
    const r = computeImportDiff(current, incoming);
    expect(r.plan.tasks.map((t) => t.id)).toEqual(["st1"]);
    expect(r.plan.deleted).toEqual({});
    expect(r.changes).toEqual([
      expect.objectContaining({ kind: "bevart", id: "st1" }),
    ]);
  });

  it("lane-omdøping bumper lane-versjonen; nye og manglende lanes håndteres", () => {
    const current: Plan = {
      lanes: [
        { key: "produkt", name: "Produkt", v: 1 },
        { key: "org", name: "Organisasjon" },
      ],
      tasks: [],
      deleted: {},
    };
    const incoming: Plan = {
      lanes: [
        { key: "produkt", name: "Produkt & tech" },
        { key: "nylane", name: "Ny strøm" },
      ],
      tasks: [],
      deleted: {},
    };
    const r = computeImportDiff(current, incoming);
    const byKey = Object.fromEntries(r.plan.lanes.map((l) => [l.key, l]));
    expect(byKey.produkt).toMatchObject({ name: "Produkt & tech", v: 2 });
    expect(byKey.org).toBeDefined(); // manglende lane beholdes
    expect(byKey.nylane).toBeDefined();
  });

  it("stempler redaktør kun på endrede og nye oppgaver", () => {
    const current = plan([
      task({ id: "a", editedBy: "Gammel", editedAt: "2026-01-01T00:00:00Z" }),
      task({ id: "b", editedBy: "Gammel", editedAt: "2026-01-01T00:00:00Z" }),
    ]);
    const incoming = plan([
      task({ id: "a", editedBy: "Gammel", editedAt: "2026-01-01T00:00:00Z" }),
      task({ id: "b", start: 4, end: 5, editedBy: "Gammel", editedAt: "2026-01-01T00:00:00Z" }),
    ]);
    const r = computeImportDiff(current, incoming, {
      editor: "Kari Nordmann",
      now: "2026-08-12T10:00:00Z",
    });
    const a = r.plan.tasks.find((t) => t.id === "a")!;
    const b = r.plan.tasks.find((t) => t.id === "b")!;
    expect(a.editedBy).toBe("Gammel");
    expect(b.editedBy).toBe("Kari Nordmann");
    expect(b.editedAt).toBe("2026-08-12T10:00:00Z");
  });

  it("tombstones fra filen beholdes som union med gjeldende", () => {
    const current = plan([], { deleted: { x: 2 } });
    const incoming = plan([], { deleted: { x: 1, y: 7 } });
    const r = computeImportDiff(current, incoming);
    expect(r.plan.deleted).toEqual({ x: 2, y: 7 });
  });

  it("feltgruppene er identiske med merge.ts sine (ingen drift)", () => {
    expect(IMPORT_GROUP_PROPS).toEqual(GROUP_PROPS);
  });
});

describe("bufferStatuses — føring 1.5: buffer per milepæl (1 uke = 0.25 enheter)", () => {
  it("milepæler uten buffer utelates; intakt buffer gir 0 brukt", () => {
    const p = plan([
      task({ id: "jobb", start: 0, end: 1 }),                                    // kjede slutter ved 1
      task({ id: "m1", start: 2, end: 2, milestone: true, deps: ["jobb"], buffer: 4 }), // 4 uker = 1 enhet: trygg sone til 1
      task({ id: "m2", start: 5, end: 5, milestone: true }),                     // ingen buffer
    ]);
    const s = bufferStatuses(p);
    expect(s.map((x) => x.taskId)).toEqual(["m1"]);
    expect(s[0]).toMatchObject({ bufferWeeks: 4, usedWeeks: 0, overrunWeeks: 0 });
  });

  it("delvis brukt: kjeden har spist to av fire uker", () => {
    const p = plan([
      task({ id: "jobb", start: 0, end: 1.5 }),  // 0.5 enheter inn i bufferen = 2 uker
      task({ id: "m", start: 2, end: 2, milestone: true, deps: ["jobb"], buffer: 4 }),
    ]);
    expect(bufferStatuses(p)[0]).toMatchObject({ usedWeeks: 2, overrunWeeks: 0 });
  });

  it("overskridelse: kjeden går forbi måldatoen", () => {
    const p = plan([
      task({ id: "jobb", start: 0, end: 2.5 }),  // 0.5 enheter forbi mål = 2 uker overskridelse
      task({ id: "m", start: 2, end: 2, milestone: true, deps: ["jobb"], buffer: 4 }),
    ]);
    expect(bufferStatuses(p)[0]).toMatchObject({ usedWeeks: 4, overrunWeeks: 2 });
  });

  it("transitiv kjede teller — ikke bare direkte deps", () => {
    const p = plan([
      task({ id: "a", start: 0, end: 1.75 }),
      task({ id: "b", start: 0, end: 0.5, deps: ["a"] }),   // b sin end er tidlig, men a drar kjeden
      task({ id: "m", start: 2, end: 2, milestone: true, deps: ["b"], buffer: 4 }),
    ]);
    expect(bufferStatuses(p)[0].usedWeeks).toBe(3);
  });

  it("milepæl uten koblede oppgaver har urørt buffer", () => {
    const p = plan([task({ id: "m", start: 2, end: 2, milestone: true, buffer: 2 })]);
    expect(bufferStatuses(p)[0]).toMatchObject({ usedWeeks: 0, overrunWeeks: 0 });
  });
});

describe("økonomi — valgfri kost/inntjening med opprulling", () => {
  const p = plan([
    task({ id: "a", lane: "produkt", cost: 100_000 }),
    task({ id: "b", lane: "produkt", cost: 50_000, deps: ["a"] }),
    task({ id: "c", lane: "org" }),                                   // uten kost
    task({ id: "m", lane: "kommers", milestone: true, deps: ["b"], cost: 25_000, revenue: 1_000_000 }),
  ]);

  it("planEconomy summerer kost og inntjening over hele planen", () => {
    expect(planEconomy(p)).toEqual({ cost: 175_000, revenue: 1_000_000 });
  });

  it("milestoneCost = egen kost + hele avhengighetskjeden", () => {
    expect(milestoneCost(p, "m")).toBe(175_000);
  });

  it("laneEconomy summerer per bane og hopper over baner uten tall", () => {
    const lanes = laneEconomy(p);
    expect(lanes.produkt).toEqual({ cost: 150_000, revenue: 0 });
    expect(lanes.kommers).toEqual({ cost: 25_000, revenue: 1_000_000 });
    expect(lanes.org).toBeUndefined();
  });
});

describe("depClosure — transitiv avhengighetskjede", () => {
  it("finner direkte og indirekte forgjengere, uten duplikater eller sykler", () => {
    const p = plan([
      task({ id: "a" }),
      task({ id: "b", deps: ["a"] }),
      task({ id: "c", deps: ["b", "a"] }),
      task({ id: "m", deps: ["c"], milestone: true }),
      task({ id: "urelatert" }),
    ]);
    const ids = depClosure(p, "m").map((t) => t.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
    expect(depClosure(p, "a")).toEqual([]);
  });
});
