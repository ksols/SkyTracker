import { describe, it, expect } from "vitest";
import { nextMondayAfter, computeSprintPlan } from "./sprint-cadence";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (date: Date) => date.toISOString();

describe("nextMondayAfter", () => {
  it("returns the next Monday strictly after a Friday", () => {
    // 2026-05-29 is a Friday → next Monday is 2026-06-01
    expect(iso(nextMondayAfter(d("2026-05-29")))).toBe(iso(d("2026-06-01")));
  });
  it("returns the following Monday when given a Monday (strictly after)", () => {
    expect(iso(nextMondayAfter(d("2026-06-01")))).toBe(iso(d("2026-06-08")));
  });
});

describe("computeSprintPlan", () => {
  const base = { lastNumber: 65, lastFinish: d("2026-05-29"), skip: [] as string[] };

  it("continues the 2-week cadence from the last sprint", () => {
    const plan = computeSprintPlan({ ...base, count: 2 });
    expect(plan).toEqual([
      { number: 66, name: "Sprint 66", start: d("2026-06-01"), finish: d("2026-06-12") },
      { number: 67, name: "Sprint 67", start: d("2026-06-15"), finish: d("2026-06-26") },
    ]);
  });

  it("inserts a one-week break when a start Monday is skipped", () => {
    // Skip 2026-06-01 → Sprint 66 shifts to start the following Monday.
    const plan = computeSprintPlan({ ...base, count: 1, skip: ["2026-06-01"] });
    expect(plan[0]).toEqual({
      number: 66, name: "Sprint 66", start: d("2026-06-08"), finish: d("2026-06-19"),
    });
  });
});
