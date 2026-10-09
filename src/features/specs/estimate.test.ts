import { describe, expect, it } from "vitest";
import { estimatePath, parseEstimateYaml, SPEC_FOLDER_RE } from "./estimate";

describe("parseEstimateYaml (decision 3: likely_weeks, late_weeks, points, estimated_by, date)", () => {
  it("reads the five keys, tolerating quotes, comments and blank lines", () => {
    expect(parseEstimateYaml('# estimat etter utredning\nlikely_weeks: 4\nlate_weeks: "6"  # senest\n\npoints: 13\nestimated_by: THM\ndate: 2026-10-09\n'))
      .toEqual({ likely: 4, late: 6, points: 13, estimatedBy: "THM", date: "2026-10-09" });
  });
  it("needs both week numbers, orders them, rounds, and ignores a malformed date", () => {
    expect(parseEstimateYaml("late_weeks: 3\nlikely_weeks: 5.4\ndate: next week")).toEqual({ likely: 3, late: 5 });
    expect(parseEstimateYaml("likely_weeks: 4")).toBeNull();
    expect(parseEstimateYaml("likely_weeks: 0\nlate_weeks: 2")).toBeNull();
    expect(parseEstimateYaml("")).toBeNull();
  });
  it("estimatePath and the folder rule", () => {
    expect(estimatePath("Threading")).toBe("/spec/Threading/estimate.yaml");
    expect(SPEC_FOLDER_RE.test("QR-Onboarding-V2")).toBe(true);
    expect(SPEC_FOLDER_RE.test("../x")).toBe(false);
  });
});
