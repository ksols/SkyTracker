import { describe, expect, it } from "vitest";
import { osloDay, parseNote, recordChangeset } from "./history";
import { dayKey } from "./epic-tools.js";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Plan } from "./merge";

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

function fakeDb() {
  const created: Record<string, unknown>[] = [];
  const changesets: Record<string, unknown>[] = [];
  const db = {
    timelineSnapshot: {
      findFirst: async ({ where }: { where: { kind: string; day: string } }) => (created.some((c) => c.kind === where.kind && c.day === where.day) ? { id: "s" } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: "s" + created.length }; },
    },
    timelineChangeset: { create: async ({ data }: { data: Record<string, unknown> }) => { changesets.push(data); return { id: "cs" + changesets.length }; } },
  };
  return { db: db as unknown as PrismaClient, created, changesets };
}
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return dayKey(d); };
const P = (tasks: Plan["tasks"], extra: Partial<Plan> = {}): Plan => ({ lanes: [{ key: "x", name: "X" }], tasks, deleted: {}, ...extra });
const T = (label: string): Plan["tasks"][number] => ({ id: "t1", lane: "x", label, kind: "estimate", start: 4, endLikely: 5, end: 6, deps: [], fv: {} });

describe("recordChangeset", () => {
  it("the first save inside a sprint writes the sprint baseline (the plan as it was) once, next to the daily snapshot", async () => {
    const sprints = { at: new Date().toISOString(), items: [{ name: "Sprint 71", path: "p", start: shift(-3), finish: shift(10) }] };
    const { db, created } = fakeDb();
    const before = P([T("A")], { sprints }), after = P([T("B")], { sprints });
    expect(await recordChangeset(db, { before, after, beforeVersion: 3, afterVersion: 4, editor: "GO", note: {} })).toBe("cs1");
    expect(created.map((c) => c.kind)).toEqual(["dag", "sprint"]);
    expect(created[1]).toMatchObject({ kind: "sprint", day: shift(-3), label: "Sprintstart Sprint 71", planVersion: 3 });
    await recordChangeset(db, { before: after, after: P([T("C")], { sprints }), beforeVersion: 4, afterVersion: 5, editor: "GO", note: {} });
    expect(created.length).toBe(2);
  });
  it("extraEvents are stored in the same changeset after the diff's events", async () => {
    const { db, changesets } = fakeDb();
    const extra = { targetType: "feature" as const, targetId: "t1", targetLabel: "B", laneKey: "x", code: "ado.push" as const, cause: "ado" as const, summary: "Pushet til ADO #1" };
    await recordChangeset(db, { before: P([T("A")]), after: P([T("B")]), beforeVersion: 1, afterVersion: 2, editor: "GO", note: { source: "ado" }, extraEvents: [extra] });
    const data = changesets[0] as { eventCount: number; source: string; events: { create: { code: string }[] } };
    expect(data.eventCount).toBe(2);
    expect(data.source).toBe("ado");
    expect(data.events.create.map((e) => e.code)).toEqual(["feature.navn", "ado.push"]);
  });
});
