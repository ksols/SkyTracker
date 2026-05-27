import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWorkItem, resolveIterationPath, addPredecessorLink } from "./client";

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => {
  process.env.SKYTRACKER_ADO_PAT = "test-pat";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWorkItem", () => {
  it("POSTs a json-patch document and returns the new id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: 4321 }));
    vi.stubGlobal("fetch", fetchMock);

    const id = await createWorkItem({
      title: "My card",
      description: "d",
      tags: ["Backend", "SkyTracker"],
      iterationPath: "Skytale\\Sprint 64",
    });

    expect(id).toBe(4321);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/_apis/wit/workitems/$User%20Story");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json-patch+json");
    expect(init.headers["Authorization"]).toMatch(/^Basic /);
  });

  it("throws with status text on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "denied" } as Response));
    await expect(createWorkItem({ title: "x", description: "", tags: [], iterationPath: null }))
      .rejects.toThrow(/401/);
  });
});

describe("resolveIterationPath", () => {
  it("returns Skytale\\<name> for a matched sprint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({
      name: "Skytale",
      children: [{ name: "Sprint 63" }, { name: "Sprint 64" }],
    })));
    expect(await resolveIterationPath(64)).toBe("Skytale\\Sprint 64");
  });
  it("returns null when the sprint is not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ name: "Skytale", children: [] })));
    expect(await resolveIterationPath(99)).toBeNull();
  });
});

describe("addPredecessorLink", () => {
  it("PATCHes a relations/- add op pointing at the blocker work item", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: 10 }));
    vi.stubGlobal("fetch", fetchMock);
    await addPredecessorLink(10, 20);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/_apis/wit/workitems/10");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body);
    expect(body[0].path).toBe("/relations/-");
    expect(body[0].value.rel).toBe("System.LinkTypes.Dependency-Reverse");
    expect(body[0].value.url).toContain("/_apis/wit/workItems/20");
  });
});
