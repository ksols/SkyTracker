import { describe, it, expect } from "vitest";
import {
  cardTagsToAdoTags,
  buildAttributionDescription,
  matchIterationName,
  buildWorkItemPatch,
} from "./mappers";

describe("cardTagsToAdoTags", () => {
  it("keeps only applicable tags and always appends SkyTracker", () => {
    const tags = [
      { name: "Backend", applicable: true },
      { name: "Frontend", applicable: false },
    ];
    expect(cardTagsToAdoTags(tags)).toEqual(["Backend", "SkyTracker"]);
  });
});

describe("buildAttributionDescription", () => {
  it("appends an attribution line to the description", () => {
    expect(buildAttributionDescription("hello", "Ada Lovelace")).toBe(
      "hello<br><br><i>Created from SkyTracker by Ada Lovelace</i>",
    );
  });
  it("works with no description", () => {
    expect(buildAttributionDescription(null, "Ada")).toBe(
      "<i>Created from SkyTracker by Ada</i>",
    );
  });
});

describe("matchIterationName", () => {
  const names = ["Sprint 6", "Sprint 60", "Sprint 57 (Bugweek)", "After MVP"];
  it("matches an exact sprint number, not a prefix", () => {
    expect(matchIterationName(names, 6)).toBe("Sprint 6");
    expect(matchIterationName(names, 60)).toBe("Sprint 60");
  });
  it("matches a suffixed sprint", () => {
    expect(matchIterationName(names, 57)).toBe("Sprint 57 (Bugweek)");
  });
  it("returns null when absent", () => {
    expect(matchIterationName(names, 99)).toBeNull();
  });
});

describe("buildWorkItemPatch", () => {
  it("builds a JSON-patch document with title, description, tags, iteration", () => {
    const patch = buildWorkItemPatch({
      title: "My card",
      description: "<i>by X</i>",
      tags: ["Backend", "SkyTracker"],
      iterationPath: "Skytale\\Sprint 64",
    });
    expect(patch).toContainEqual({ op: "add", path: "/fields/System.Title", value: "My card" });
    expect(patch).toContainEqual({ op: "add", path: "/fields/System.Tags", value: "Backend; SkyTracker" });
    expect(patch).toContainEqual({ op: "add", path: "/fields/System.IterationPath", value: "Skytale\\Sprint 64" });
  });
  it("omits iteration when not provided", () => {
    const patch = buildWorkItemPatch({ title: "X", description: "", tags: [], iterationPath: null });
    expect(patch.some((p) => p.path === "/fields/System.IterationPath")).toBe(false);
  });
});
