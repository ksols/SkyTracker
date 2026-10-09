import { describe, it, expect, vi } from "vitest";
import { addPredecessorLink, AdoRequestError, createAdoClient, createWorkItem, resolveIterationPath } from "./client";

const res = (status: number, body: unknown, text?: string) => ({ ok: status >= 200 && status < 300, status, text: async () => text ?? JSON.stringify(body) });
const client = (fetchMock: ReturnType<typeof vi.fn>) => createAdoClient("Bearer t0k", fetchMock as unknown as typeof fetch);

describe("createAdoClient", () => {
  it("GETs a work item with relations, bearer auth, and returns null on 404", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, { id: 7, fields: {}, relations: [] })).mockResolvedValueOnce(res(404, { message: "gone" }));
    expect((await client(f).get(7))!.id).toBe(7);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://dev.azure.com/SkytaleAS/_apis/wit/workitems/7?$expand=relations&api-version=7.1");
    expect(init.headers.Authorization).toBe("Bearer t0k");
    expect(await client(f).get(8)).toBeNull();
  });
  it("batches ids 200 at a time with relations expanded and missing ids omitted", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { value: [{ id: 1, fields: {} }] }));
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const out = await client(f).batch(ids);
    expect(f).toHaveBeenCalledTimes(2);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.ids.length).toBe(200);
    expect(body.$expand).toBe("relations");
    expect(body.errorPolicy).toBe("omit");
    expect(out.length).toBe(2);
    expect(await client(f).batch([])).toEqual([]);
  });
  it("creates with the json-patch content type on the project url and patches on the org url", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { id: 4321, fields: {} }));
    const c = client(f);
    expect((await c.create("User Story", [{ op: "add", path: "/fields/System.Title", value: "x" }])).id).toBe(4321);
    expect(String(f.mock.calls[0][0])).toBe("https://dev.azure.com/SkytaleAS/Skytale/_apis/wit/workitems/$User%20Story?api-version=7.1");
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBe("application/json-patch+json");
    await c.patch(4321, [{ op: "add", path: "/fields/System.Title", value: "y" }]);
    expect(String(f.mock.calls[1][0])).toBe("https://dev.azure.com/SkytaleAS/_apis/wit/workitems/4321?api-version=7.1");
    expect(f.mock.calls[1][1].method).toBe("PATCH");
  });
  it("reads a git item's content and returns null when the file is missing", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, { path: "/spec/X/estimate.yaml", content: "likely_weeks: 4\n" })).mockResolvedValueOnce(res(404, { message: "TF401174" }));
    const c = client(f);
    expect(await c.gitItem("repo1", "/spec/X/estimate.yaml")).toBe("likely_weeks: 4\n");
    expect(String(f.mock.calls[0][0])).toBe("https://dev.azure.com/SkytaleAS/Skytale/_apis/git/repositories/repo1/items?path=%2Fspec%2FX%2Festimate.yaml&includeContent=true&api-version=7.1");
    expect(await c.gitItem("repo1", "/spec/X/estimate.yaml")).toBeNull();
  });
  it("turns a sign-in page or a 401 into AdoRequestError 401 and other failures into their status", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(200, null, "<!DOCTYPE html><html>sign in</html>")).mockResolvedValueOnce(res(401, { message: "no" })).mockResolvedValueOnce(res(400, { message: "bad field" }));
    const c = client(f);
    await expect(c.get(1)).rejects.toMatchObject({ name: "AdoRequestError", status: 401 });
    await expect(c.get(1)).rejects.toBeInstanceOf(AdoRequestError);
    await expect(c.get(1)).rejects.toMatchObject({ status: 400 });
  });
});

describe("the board's create-in-ADO helpers", () => {
  it("createWorkItem posts the card patch and returns the id", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { id: 99, fields: {} }));
    expect(await createWorkItem(client(f), { title: "My card", description: "d", tags: ["Backend", "SkyTracker"], iterationPath: "Skytale\\Sprint 64" })).toBe(99);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toContainEqual({ op: "add", path: "/fields/System.IterationPath", value: "Skytale\\Sprint 64" });
  });
  it("resolveIterationPath matches the sprint among the iteration nodes", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { name: "Skytale", children: [{ name: "Sprint 63" }, { name: "Sprint 64" }] }));
    expect(await resolveIterationPath(client(f), 64)).toBe("Skytale\\Sprint 64");
    expect(await resolveIterationPath(client(f), 99)).toBeNull();
  });
  it("addPredecessorLink patches a relations/- add op pointing at the blocker", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { id: 10, fields: {} }));
    await addPredecessorLink(client(f), 10, 20);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body[0]).toEqual({ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Dependency-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/20" } });
  });
});
