import { describe, expect, it } from "vitest";
import type { AdoWorkItem } from "./client";
import { IMPORT_WIQL, importItems, initialsFor, listImportable, type ImportCandidate } from "./import";
import { adoValue, featureFields, planFieldWrites } from "./plan-mappers";
import { BACKLOG, dateToUnit, normalizePlan, WEEK } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const NOW = new Date(2026, 9, 9, 14, 0); // 9 Oct 2026
const PEOPLE = { THM: "thm@skytale.no", KSO: "kso@skytale.no", GO: "go@skytale.no" };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00Z`;

// Shaped like the ADO inventory of 09.10.2026 (Epic #4802 active, #4566 threading in Discovery, QA Area containers …)
const wi = (id: number, type: "Epic" | "Feature", title: string, state: string, extra: Record<string, unknown> = {}, parent?: number): AdoWorkItem => ({
  id,
  fields: { "System.WorkItemType": type, "System.Title": title, "System.State": state, ...(parent ? { "System.Parent": parent } : {}), ...extra },
  relations: parent ? [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/" + parent }] : [],
});
const ITEMS: Record<number, AdoWorkItem> = Object.fromEntries([
  wi(4491, "Epic", "Overgang 2.0", "Active", { "Microsoft.VSTS.Scheduling.TargetDate": iso(2026, 9, 20) }),
  wi(4802, "Epic", "Bedre samhandling i chats", "Active", { "Microsoft.VSTS.Scheduling.TargetDate": iso(2026, 11, 1), "System.Description": "<div>Chat som holder tritt</div>" }),
  wi(4803, "Epic", "Neste år", "New"),
  wi(4406, "Feature", "QA Area: Chat", "New"),
  wi(4413, "Feature", "QA Area: Platform / Build", "Closed"),
  wi(4585, "Feature", "Offline queue behavior", "New", {}, 4413),
  wi(4566, "Feature", "Message threading and replies", "Discovery", {
    "System.AssignedTo": { displayName: "Tor Håkon Moen", uniqueName: "thm@skytale.no" },
    "Microsoft.VSTS.Scheduling.StartDate": iso(2026, 11, 2), "Microsoft.VSTS.Scheduling.TargetDate": iso(2026, 11, 27),
    "System.Description": "<div>Tr&aring;der i kanaler.</div><div>Svar p&aring; meldinger.</div>",
  }, 4802),
  wi(4742, "Feature", "Calls", "Discovery", { "System.AssignedTo": { displayName: "Gjermund Østby", uniqueName: "go@skytale.no" } }),
  wi(4789, "Feature", "Delte kanaler mellom organisasjoner", "Discovery", { "System.AssignedTo": { displayName: "Ola Nordmann", uniqueName: "ola@example.org" } }),
  wi(4790, "Feature", "Fjernsletting av enhet", "New"),
  wi(4492, "Feature", "File sharing in chat", "Active", { "Microsoft.VSTS.Scheduling.StartDate": iso(2026, 10, 12), "Microsoft.VSTS.Scheduling.TargetDate": iso(2026, 11, 20) }, 4802),
  wi(4493, "Feature", "Aktiv uten epic", "Active"),
  wi(1234, "Feature", "Levert i fjor", "Resolved"),
].map((w) => [w.id, w]));
const client = (ids: number[]) => ({
  calls: [] as string[],
  async wiql(q: string) { this.calls.push(q); return ids; },
  async batch(want: number[]) { return want.map((id) => ITEMS[id]).filter(Boolean); },
});
const plan = (over: Partial<Plan> = {}): Plan =>
  normalizePlan({ lanes: [{ key: "overgang", name: "Overgang 2.0", adoId: 4491 }], tasks: [{ id: "calls", lane: BACKLOG, label: "Calls", kind: "discovery", state: "utredes", start: 2, end: 3, deps: [], fv: {}, adoId: 4742 }], deleted: {}, ...over });

const ALL = [4491, 4802, 4803, 4406, 4585, 4566, 4742, 4789, 4790, 4492, 4493, 1234];

describe("listImportable", () => {
  it("asks ADO for open epics and features and lists the ones the plan does not hold", async () => {
    const c = client(ALL);
    const out = await listImportable(plan(), c, PEOPLE, NOW);
    expect(c.calls).toEqual([IMPORT_WIQL]);
    expect(out.map((x) => x.id)).toEqual([4802, 4803, 4406, 4585, 4566, 4789, 4790, 4492, 4493]); // not 4491/4742 (held), not 1234 (Resolved)
  });
  it("flags «QA Area» containers as not suggested and carries the parent's title even when the parent is closed", async () => {
    const out = await listImportable(plan(), client(ALL), PEOPLE, NOW);
    const by = Object.fromEntries(out.map((x) => [x.id, x])) as Record<number, ImportCandidate>;
    expect(by[4406].suggested).toBe(false);
    expect(by[4790].suggested).toBe(true);
    expect(by[4585].parentId).toBe(4413);
    expect(by[4585].parentTitle).toBe("QA Area: Platform / Build");
    expect(by[4566].parentTitle).toBe("Bedre samhandling i chats");
  });
  it("says in words what each item becomes", async () => {
    const out = await listImportable(plan(), client(ALL), PEOPLE, NOW);
    const by = Object.fromEntries(out.map((x) => [x.id, x.mapping]));
    expect(by[4802]).toBe("Epic · aktiv · måldato 1. nov");
    expect(by[4803]).toBe("Epic · forslag");
    expect(by[4790]).toBe("Registrert på hylla");
    expect(by[4566]).toBe("Utredes · THM · til 27. nov · i «Bedre samhandling i chats»");
    expect(by[4789]).toBe("Utredes · ON · til 24. okt"); // no dates: two plan weeks (quarter months) from today on the week grid, initials from the name
    expect(by[4492]).toBe("Aktiv i «Bedre samhandling i chats»");
    expect(by[4493]).toBe("Klar for veikart (ingen epic)");
  });
  it("keeps ADO's text without markup and the snapshot of the owned fields", async () => {
    const out = await listImportable(plan(), client(ALL), PEOPLE, NOW);
    const t = out.find((x) => x.id === 4566)!;
    expect(t.description).toBe("Tråder i kanaler.\nSvar på meldinger.");
    expect(t.assignedEmail).toBe("thm@skytale.no");
    expect(t.snapshot).toEqual({ title: "Message threading and replies", description: adoValue(ITEMS[4566], "description"), state: "Discovery", targetDate: "2026-11-27", startDate: "2026-11-02", tags: null });
  });
});

describe("initialsFor", () => {
  it("prefers the people map, then the display name, never empty", () => {
    expect(initialsFor("thm@skytale.no", "Tor Håkon Moen", PEOPLE)).toBe("THM");
    expect(initialsFor("GO@Skytale.no", "Gjermund Østby", PEOPLE)).toBe("GO");
    expect(initialsFor("ola@example.org", "Ola Nordmann", PEOPLE)).toBe("ON");
    expect(initialsFor(null, "Kari", PEOPLE)).toBe("K");
    expect(initialsFor(null, null, PEOPLE)).toBeNull();
  });
});

describe("importItems", () => {
  const listed = () => listImportable(plan(), client(ALL), PEOPLE, NOW);
  it("New → «ny» on the shelf; Discovery → «utredes» with owner, dates and text; nothing is pushed", async () => {
    const items = await listed();
    const r = importItems(plan(), items, [4790, 4566, 4789], { people: PEOPLE, now: NOW });
    const ny = r.plan.tasks.find((t) => t.adoId === 4790)!;
    expect([ny.state, ny.kind, ny.lane, ny.label]).toEqual(["ny", "discovery", BACKLOG, "Fjernsletting av enhet"]);
    const thm = r.plan.tasks.find((t) => t.adoId === 4566)!;
    expect([thm.state, thm.kind, thm.assignee, thm.lane]).toEqual(["utredes", "discovery", "THM", BACKLOG]); // parent 4802 not chosen and not in the plan
    expect(thm.start).toBeCloseTo(D(2026, 11, 2), 6);
    expect(thm.end).toBeCloseTo(D(2026, 11, 27), 6);
    expect(thm.description).toBe("Tråder i kanaler.\nSvar på meldinger.");
    expect(thm.ado?.snapshot).toEqual(items.find((x) => x.id === 4566)!.snapshot);
    const ola = r.plan.tasks.find((t) => t.adoId === 4789)!;
    expect(ola.assignee).toBe("ON");
    expect(ola.start).toBeCloseTo(Math.round(dateToUnit(NOW) / WEEK) * WEEK, 6);
    expect(ola.end).toBeCloseTo(ola.start + 2 * WEEK, 6);
    expect(r.imported.map((x) => x.adoId)).toEqual([4566, 4789, 4790]); // in ADO's listing order
  });
  it("Active → «aktiv» in its epic when the epic comes along, «klar» on the shelf when it does not", async () => {
    const items = await listed();
    const r = importItems(plan(), items, [4802, 4492, 4493], { people: PEOPLE, now: NOW });
    const lane = r.plan.lanes.find((l) => l.adoId === 4802)!;
    expect([lane.name, lane.state]).toEqual(["Bedre samhandling i chats", "aktiv"]);
    expect(lane.goalDate).toBeCloseTo(D(2026, 11, 1), 6);
    expect(lane.description).toBe("Chat som holder tritt");
    const fs = r.plan.tasks.find((t) => t.adoId === 4492)!;
    expect([fs.state, fs.kind, fs.lane]).toEqual(["aktiv", "estimate", lane.key]);
    expect(fs.start).toBeCloseTo(D(2026, 10, 12), 6);
    expect(fs.end).toBeCloseTo(D(2026, 11, 20), 6);
    expect(fs.endLikely).toBeCloseTo(fs.end, 6);
    expect(fs.committedRange).toBeTruthy();
    const loose = r.plan.tasks.find((t) => t.adoId === 4493)!;
    expect([loose.state, loose.lane]).toEqual(["klar", BACKLOG]);
    expect(loose.endLikely).toBeCloseTo(loose.start + 4 * WEEK, 6);
    expect(loose.end).toBeCloseTo(loose.start + 6 * WEEK, 6);
  });
  it("a feature whose epic is already in the plan lands in that lane; an id already held is skipped", async () => {
    const items = await listed();
    const p = plan({ lanes: [{ key: "overgang", name: "Overgang 2.0", adoId: 4491 }, { key: "chat", name: "Chat", adoId: 4802 }] });
    const r = importItems(p, items, [4566, 4742], { people: PEOPLE, now: NOW });
    expect(r.plan.tasks.find((t) => t.adoId === 4566)!.lane).toBe("chat");
    expect(r.plan.tasks.filter((t) => t.adoId === 4742).length).toBe(1);
    expect(r.imported.map((x) => x.adoId)).toEqual([4566]);
  });
  it("Epic New → forslag; the result survives normalizePlan; a second listing no longer offers what was imported", async () => {
    const items = await listed();
    const r = importItems(plan(), items, [4803, 4790], { people: PEOPLE, now: NOW });
    expect(r.plan.lanes.find((l) => l.adoId === 4803)!.state).toBe("forslag");
    const again = normalizePlan(JSON.parse(JSON.stringify(r.plan)));
    expect(again.tasks.find((t) => t.adoId === 4790)!.lane).toBe(BACKLOG);
    const second = await listImportable(again, client(ALL), PEOPLE, NOW);
    expect(second.map((x) => x.id)).not.toContain(4790);
    expect(second.map((x) => x.id)).not.toContain(4803);
  });
  it("the next push writes nothing for an untouched imported feature (decision 5)", async () => {
    const items = await listed();
    const r = importItems(plan(), items, [4802, 4566], { people: PEOPLE, now: NOW });
    const t = r.plan.tasks.find((t) => t.adoId === 4566)!;
    const { writes, conflicts } = planFieldWrites(featureFields(r.plan, t), ITEMS[4566], t.ado!.snapshot);
    expect(conflicts).toEqual([]);
    expect(writes).toEqual({});
  });
});
