import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdoWorkItem, IterationNode } from "./client";
import { deliveredDay, parseSprints, readStories } from "./sync";

const fixture = <T>(name: string): T => JSON.parse(readFileSync(path.join(process.cwd(), "src/features/ado/fixtures", name), "utf8")) as T;

describe("parseSprints", () => {
  it("keeps the dated «Sprint N» nodes, as days, sorted by start", () => {
    const s = parseSprints(fixture<IterationNode>("iterations.json"));
    expect(s.map((x) => x.name)).toEqual(["Sprint 68", "Sprint 69", "Sprint 70", "Sprint 71"]);
    expect(s[3]).toEqual({ name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-16" });
  });
});

describe("readStories and deliveredDay", () => {
  const items = fixture<AdoWorkItem[]>("feature-with-stories.json");
  const byId = new Map(items.map((w) => [w.id, w]));
  const feature = byId.get(4742)!;
  it("counts the child stories without the discovery story, sums points, points done, and names the latest sprint", () => {
    expect(readStories(feature, byId, 4794)).toEqual({ count: 2, pointsTotal: 8, pointsDone: 3, iteration: "Sprint 71" });
    expect(readStories(feature, byId).count).toBe(3);
  });
  it("deliveredDay is the ClosedDate day for Closed, ResolvedDate for Resolved, null otherwise", () => {
    expect(deliveredDay({ id: 1, fields: { "System.State": "Closed", "Microsoft.VSTS.Common.ClosedDate": "2026-12-03T14:12:00Z" } })).toBe("2026-12-03");
    expect(deliveredDay({ id: 1, fields: { "System.State": "Resolved", "Microsoft.VSTS.Common.ResolvedDate": "2026-12-01T09:00:00Z" } })).toBe("2026-12-01");
    expect(deliveredDay({ id: 1, fields: { "System.State": "Active" } })).toBeNull();
  });
});
