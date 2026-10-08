import { describe, expect, it } from "vitest";
import { osloDay, parseNote } from "./history";

describe("history helpers", () => {
  it("osloDay gives the calendar day in Europe/Oslo", () => {
    expect(osloDay(new Date("2026-10-08T22:30:00Z"))).toBe("2026-10-09"); // 00:30 in Oslo (CEST)
    expect(osloDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01"); // 00:30 CET
    expect(osloDay(new Date("2026-10-08T10:00:00Z"))).toBe("2026-10-08");
  });

  it("parseNote keeps only known fields and codes, trims and caps the text", () => {
    expect(parseNote(undefined)).toEqual({});
    expect(parseNote({ reason: "  Flere noder  ", reasonCode: "utredning", causes: { b: "dep:a", c: 42 }, source: "seed", extra: 1 }))
      .toEqual({ reason: "Flere noder", reasonCode: "utredning", causes: { b: "dep:a" }, source: "seed" });
    expect(parseNote({ reasonCode: "bogus", source: "hacker" })).toEqual({});
    expect(parseNote({ reason: "x".repeat(600) }).reason!.length).toBe(500);
  });
});
