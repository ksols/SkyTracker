import { describe, expect, it } from "vitest";
import { planDelta } from "./plan-delta";
import type { Plan, PlanTask } from "./merge";

function task(over: Partial<PlanTask>): PlanTask {
  return {
    id: "t1",
    lane: "x",
    label: "Oppgave",
    kind: "estimate",
    start: 1,
    endLikely: 1.5,
    end: 2,
    deps: [],
    fv: {},
    ...over,
  };
}
const plan = (tasks: PlanTask[]): Plan => ({
  lanes: [{ key: "x", name: "Epic X" }],
  tasks,
  deleted: {},
});

describe("planDelta — hva endret en lagring", () => {
  it("identiske planer gir tom delta", () => {
    expect(planDelta(plan([task({})]), plan([task({})]))).toEqual([]);
  });

  it("flyttet oppgave rapporteres som endret med tid-gruppen", () => {
    const d = planDelta(plan([task({ start: 1, end: 2 })]), plan([task({ start: 3, endLikely: 3.5, end: 4 })]));
    expect(d).toEqual([
      expect.objectContaining({ kind: "endret", taskId: "t1", groups: ["tid"] }),
    ]);
    expect(d[0].before).toMatchObject({ start: 1 });
    expect(d[0].after).toMatchObject({ start: 3 });
  });

  it("flere grupper på samme oppgave samles i én oppføring", () => {
    const d = planDelta(plan([task({})]), plan([task({ label: "Nytt", adoId: 4742 })]));
    expect(d[0].groups).toEqual(["label", "meta"]);
  });

  it("ny og slettet oppgave rapporteres", () => {
    const d = planDelta(plan([task({ id: "borte" })]), plan([task({ id: "fersk", label: "Ny rad" })]));
    expect(d).toEqual([
      expect.objectContaining({ kind: "ny", taskId: "fersk", taskLabel: "Ny rad" }),
      expect.objectContaining({ kind: "slettet", taskId: "borte" }),
    ]);
  });

  it("deps i annen rekkefølge og fv-bumps er ikke endringer", () => {
    const before = plan([task({ deps: ["a", "b"], fv: { tid: 1 } })]);
    const after = plan([task({ deps: ["b", "a"], fv: { tid: 5, label: 2 } })]);
    expect(planDelta(before, after)).toEqual([]);
  });
});
