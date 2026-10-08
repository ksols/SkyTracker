# Timeline baselines and compare (R1b, stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A writer can mark a baseline («Produktforum 5. nov»), anyone can compare the plan with a baseline or a date, see ghost bars and a summary strip («Siden produktforum 5. nov: 2 måldatoer flyttet · 3 spenn utvidet …»), read the «Siden sist» list with reasons, and export it as markdown.

**Architecture:** Stage 1 already stores daily snapshots and events. Stage 2 adds named baselines (`TimelineSnapshot kind = baseline`, no schema change), two routes (`/api/timeline-snapshots`, `/api/timeline-compare`) and one pure module `compare.ts` that turns a net diff + the event path into the summary strip and the export text (unit-tested, used by the route). The page gets «Merk baseline…», «Sammenlign med ▾», the compare bar, ghost bars/goals, «ny» chips, struck-through deleted rows and the «Siden sist» list.

**Tech Stack:** as stage 1 (Next.js 16 route handlers, Prisma 7, plain-JS page, vitest, Playwright smokes in the scratchpad).

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §3 (snapshots), §4.4, §4.6, §5 R1b. Stage 1 plan: `docs/superpowers/plans/2026-10-08-timeline-history-r1a.md` (same conventions).

## Global Constraints

- Same as stage 1: branch `feat/planning-system`, commit per task, no attribution; never a Prisma migrate/db command with the worktree `.env` (none is needed here: no schema change); smokes from the scratchpad (`/private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad`), Playwright via `createRequire("/Users/dnumreig/ptt-e2e/package.json")`.
- Norwegian in the UI and in every stored or exported sentence; English in code and commits.
- The compare route computes net and path with the same `diffPlans` as the history (spec §4.4: one implementation).
- Ghost elements never receive pointer events and never change `barRefs`/`rowRefs` semantics for live tasks.

## Review Focus

1. A date with no snapshot (before the first save, or a day nobody edited): the compare must explain «Ingen plan lagret fra den dagen» instead of failing; test in Task 1 (`snapshotForDay`) and Task 2 (404 body).
2. A baseline taken, then a feature deleted: the compare shows a struck-through row with the ghost bar and the strip counts «1 fjernet»; smoke S10.
3. Export when nothing moved: the strip says «ingen endringer» and the export has the title and the sentence, no empty sections; Task 1 test.
4. Compare mode survives a remote update (poll) and the page's own saves: ghosts are redrawn from the cached baseline, the strip is refreshed from the server; Task 4 wires `refreshCompare()` into `applyRemote` and `pushPlan`.
5. Readers can compare but not mark baselines: `#baselineBtn` hidden unless `canWrite`; the POST route answers 403 for readers (Task 2 code, Task 3 markup).

---

### Task 1: `compare.ts`: summary, strip sentence, export markdown, snapshot-for-day

**Files:**
- Create: `src/features/timeline/compare.ts`
- Test: `src/features/timeline/compare.test.ts`

**Interfaces:**
- Consumes: `PlanEvent`, `REASON_LABEL` (events.ts); `fmtDate`, `unitToDate` (epic-tools.js).
- Produces: `PathEvent`, `CompareSummary`, `summarizeNet(net, path)`, `summaryLine(label, s)`, `exportMarkdown(title, strip, path, laneName)`, `snapshotForDay(snapshots, day)`, `sinceLabel(baseline)`.

- [ ] **Step 1: Write the failing tests** (`src/features/timeline/compare.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { exportMarkdown, sinceLabel, snapshotForDay, summarizeNet, summaryLine, type PathEvent } from "./compare";
import type { PlanEvent } from "./events";

const ev = (code: PlanEvent["code"], over: Partial<PlanEvent> = {}): PlanEvent =>
  ({ targetType: code.startsWith("epic") ? "epic" : "feature", targetId: "t", targetLabel: "T", laneKey: "x", code, cause: "bruker", summary: code, ...over });
const path = (over: Partial<PathEvent> & { code: PlanEvent["code"] }): PathEvent =>
  ({ ...ev(over.code), at: "2026-11-06T10:00:00.000Z", editor: "GO", changeset: { id: "cs1", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: null, reasonCode: null, source: "bruker" }, ...over });

describe("summarizeNet", () => {
  it("counts goal moves, widened spans only, lane changes, reorders, later moves, new and removed, and changesets without a reason", () => {
    const net = [
      ev("epic.maldato"), ev("epic.maldato"),
      ev("feature.spenn", { before: { likely: 4, late: 6 }, after: { likely: 4, late: 8 } }),
      ev("feature.spenn", { before: { likely: 4, late: 6 }, after: { likely: 3, late: 5 } }),
      ev("feature.epic"), ev("epic.prioritet"), ev("feature.prioritet"),
      ev("feature.flyttet", { before: { start: 4 }, after: { start: 4.5 } }),
      ev("feature.flyttet", { before: { start: 4 }, after: { start: 3.5 } }),
      ev("feature.ny"), ev("epic.slettet"), ev("feature.slettet"),
    ];
    const p = [
      path({ code: "feature.spenn", changeset: { id: "a", at: "", editor: "GO", reason: null, reasonCode: "ingen", source: "bruker" } }),
      path({ code: "feature.flyttet", changeset: { id: "a", at: "", editor: "GO", reason: null, reasonCode: "ingen", source: "bruker" } }),
      path({ code: "epic.maldato", changeset: { id: "b", at: "", editor: "GO", reason: "Telenor", reasonCode: "ekstern", source: "bruker" } }),
    ];
    expect(summarizeNet(net, p)).toEqual({ maldatoer: 2, spenn: 1, byttetEpic: 1, prioriteringer: 2, flyttet: 1, nye: 1, fjernet: 2, mangler: 1 });
  });
});

describe("summaryLine and sinceLabel", () => {
  it("lists only the non-zero parts in the spec's order and wording", () => {
    const s = { maldatoer: 2, spenn: 3, byttetEpic: 1, prioriteringer: 2, flyttet: 0, nye: 0, fjernet: 0, mangler: 4 };
    expect(summaryLine("produktforum 5. nov", s)).toBe("Siden produktforum 5. nov: 2 måldatoer flyttet · 3 spenn utvidet · 1 feature byttet epic · 2 prioriteringer · 4 begrunnelser mangler");
    expect(summaryLine("5. nov", { maldatoer: 1, spenn: 0, byttetEpic: 0, prioriteringer: 0, flyttet: 1, nye: 2, fjernet: 1, mangler: 0 }))
      .toBe("Siden 5. nov: 1 måldato flyttet · 1 feature flyttet senere · 2 nye · 1 fjernet");
    expect(summaryLine("5. nov", { maldatoer: 0, spenn: 0, byttetEpic: 0, prioriteringer: 0, flyttet: 0, nye: 0, fjernet: 0, mangler: 0 })).toBe("Siden 5. nov: ingen endringer");
  });
  it("sinceLabel lowercases a baseline label's first letter and names a daily snapshot by its day", () => {
    expect(sinceLabel({ kind: "baseline", label: "Produktforum 5. nov", at: "2026-11-05T09:00:00.000Z", day: null })).toBe("produktforum 5. nov");
    expect(sinceLabel({ kind: "dag", label: null, at: "2026-11-05T07:12:00.000Z", day: "2026-11-05" })).toBe("5. nov");
  });
});

describe("exportMarkdown", () => {
  it("groups the path by section, adds reasons and the missing-reason list, skips empty sections", () => {
    const p: PathEvent[] = [
      path({ code: "epic.maldato", targetType: "epic", targetId: "x", targetLabel: "Telenor", summary: "Måldato: 15. des → 15. jan",
        changeset: { id: "b", at: "2026-11-06T10:00:00.000Z", editor: "GO", reason: "Telenor flyttet piloten", reasonCode: "ekstern", source: "bruker" } }),
      path({ code: "feature.spenn", targetLabel: "Kapasitet", summary: "Spenn: 4–7 → 4–9 uker (utvidet 2 uker)",
        changeset: { id: "a", at: "2026-11-06T11:00:00.000Z", editor: "THM", reason: null, reasonCode: "ingen", source: "bruker" } }),
      path({ code: "feature.flyttet", targetLabel: "Roller", summary: "Flyttet 2 uker av avhengighet «IAM»", cause: "avhengighet", causeRef: "iam",
        changeset: { id: "a", at: "2026-11-06T11:00:00.000Z", editor: "THM", reason: null, reasonCode: "ingen", source: "bruker" } }),
    ];
    const md = exportMarkdown("Siden produktforum 5. nov", "Siden produktforum 5. nov: 1 måldato flyttet · 1 spenn utvidet · 1 begrunnelse mangler", p, (k) => k === "x" ? "Telenor" : "Epic");
    expect(md.startsWith("# Siden produktforum 5. nov\n\nSiden produktforum 5. nov: 1 måldato flyttet")).toBe(true);
    expect(md).toContain("## Måldatoer\n- Telenor: Måldato: 15. des → 15. jan — Ekstern dato endret: Telenor flyttet piloten (GO, 6. nov)");
    expect(md).toContain("## Spenn\n- Epic › Kapasitet: Spenn: 4–7 → 4–9 uker (utvidet 2 uker) — begrunnelse mangler (THM, 6. nov)");
    expect(md).toContain("## Flyttet\n- Epic › Roller: Flyttet 2 uker av avhengighet «IAM» — avhengighet (THM, 6. nov)");
    expect(md).toContain("## Begrunnelser mangler\n- 6. nov, THM: Spenn: 4–7 → 4–9 uker (utvidet 2 uker); Flyttet 2 uker av avhengighet «IAM»");
    expect(md).not.toContain("## Prioritet");
    expect(exportMarkdown("Siden 5. nov", "Siden 5. nov: ingen endringer", [], () => "")).toBe("# Siden 5. nov\n\nSiden 5. nov: ingen endringer\n");
  });
});

describe("snapshotForDay", () => {
  const snaps = [
    { id: "d1", kind: "dag", day: "2026-11-03", at: "2026-11-03T08:00:00.000Z" },
    { id: "b1", kind: "baseline", day: null, at: "2026-11-05T09:00:00.000Z" },
    { id: "d2", kind: "dag", day: "2026-11-06", at: "2026-11-06T07:00:00.000Z" },
  ];
  it("takes the day's own snapshot, else the first one after that day, else null", () => {
    expect(snapshotForDay(snaps, "2026-11-03")!.id).toBe("d1");
    expect(snapshotForDay(snaps, "2026-11-04")!.id).toBe("b1");
    expect(snapshotForDay(snaps, "2026-11-06")!.id).toBe("d2");
    expect(snapshotForDay(snaps, "2026-11-07")).toBeNull();
    expect(snapshotForDay([], "2026-11-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/timeline/compare.test.ts`
Expected: FAIL: cannot find module `./compare`.

- [ ] **Step 3: Write `src/features/timeline/compare.ts`**

```ts
// Compare mode (spec §4.4): the net movement since a baseline (diffPlans of the two plans)
// and the path of events in between, turned into the summary strip and the export text.
// Pure functions; the route calls them, vitest pins the wording.
import { REASON_LABEL, type PlanEvent, type ReasonCode } from "./events";
import { osloDay } from "./history";

export type PathChangeset = { id: string; at: string; editor: string | null; reason: string | null; reasonCode: string | null; source: string };
export type PathEvent = PlanEvent & { at: string; editor: string | null; changeset: PathChangeset };
export type CompareSummary = { maldatoer: number; spenn: number; byttetEpic: number; prioriteringer: number; flyttet: number; nye: number; fjernet: number; mangler: number };
type SnapshotLike = { id: string; kind: string; day: string | null; at: string | Date };

const widened = (e: PlanEvent) => {
  const b = e.before as { likely: number; late: number } | undefined, a = e.after as { likely: number; late: number } | undefined;
  return !!b && !!a && (a.late > b.late || a.likely > b.likely);
};
const later = (e: PlanEvent) => {
  const b = e.before as { start: number } | undefined, a = e.after as { start: number } | undefined;
  return !!b && !!a && a.start > b.start + 1e-9;
};

export function summarizeNet(net: PlanEvent[], path: PathEvent[]): CompareSummary {
  const count = (f: (e: PlanEvent) => boolean) => net.filter(f).length;
  return {
    maldatoer: count((e) => e.code === "epic.maldato"),
    spenn: count((e) => e.code === "feature.spenn" && widened(e)),
    byttetEpic: count((e) => e.code === "feature.epic"),
    prioriteringer: count((e) => e.code === "epic.prioritet" || e.code === "feature.prioritet"),
    flyttet: count((e) => e.code === "feature.flyttet" && later(e)),
    nye: count((e) => e.code === "feature.ny" || e.code === "epic.ny"),
    fjernet: count((e) => e.code === "feature.slettet" || e.code === "epic.slettet"),
    mangler: new Set(path.filter((e) => e.changeset?.reasonCode === "ingen").map((e) => e.changeset.id)).size,
  };
}

const n = (c: number, one: string, many: string) => c + " " + (c === 1 ? one : many);
export function summaryLine(label: string, s: CompareSummary): string {
  const parts: string[] = [];
  if (s.maldatoer) parts.push(n(s.maldatoer, "måldato flyttet", "måldatoer flyttet"));
  if (s.spenn) parts.push(n(s.spenn, "spenn utvidet", "spenn utvidet"));
  if (s.byttetEpic) parts.push(n(s.byttetEpic, "feature byttet epic", "features byttet epic"));
  if (s.prioriteringer) parts.push(n(s.prioriteringer, "prioritering", "prioriteringer"));
  if (s.flyttet) parts.push(n(s.flyttet, "feature flyttet senere", "features flyttet senere"));
  if (s.nye) parts.push(n(s.nye, "ny", "nye"));
  if (s.fjernet) parts.push(n(s.fjernet, "fjernet", "fjernet"));
  if (s.mangler) parts.push(n(s.mangler, "begrunnelse mangler", "begrunnelser mangler"));
  return "Siden " + label + ": " + (parts.length ? parts.join(" · ") : "ingen endringer");
}

const MND = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
export function dayText(iso: string | Date): string {
  const d = new Date(iso);
  const [y, m, day] = osloDay(d).split("-").map(Number);
  void y;
  return day + ". " + MND[m - 1];
}
export function sinceLabel(b: { kind: string; label: string | null; at: string | Date; day: string | null }): string {
  if (b.kind === "baseline" && b.label) return b.label.charAt(0).toLowerCase() + b.label.slice(1);
  return dayText(b.at);
}

const SECTIONS: [string, PlanEvent["code"][]][] = [
  ["Måldatoer", ["epic.maldato"]],
  ["Spenn", ["feature.spenn", "feature.estimert"]],
  ["Flyttet", ["feature.flyttet", "feature.utredning-slutt"]],
  ["Prioritet", ["epic.prioritet", "feature.prioritet", "feature.epic"]],
  ["Nye og fjernet", ["epic.ny", "epic.slettet", "feature.ny", "feature.slettet", "feature.utredning"]],
];
export function exportMarkdown(title: string, strip: string, path: PathEvent[], laneName: (key: string) => string): string {
  const where = (e: PathEvent) => (e.targetType === "feature" && e.laneKey ? laneName(e.laneKey) + " › " : "") + e.targetLabel;
  const why = (e: PathEvent) => {
    if (e.cause === "avhengighet") return "avhengighet";
    const c = e.changeset?.reasonCode;
    if (!c || c === "ingen") return "begrunnelse mangler";
    return REASON_LABEL[c as ReasonCode] + (e.changeset.reason ? ": " + e.changeset.reason : "");
  };
  const stamp = (e: PathEvent) => " (" + (e.changeset?.editor || e.editor || "system") + ", " + dayText(e.changeset?.at || e.at) + ")";
  let md = "# " + title + "\n\n" + strip + "\n";
  for (const [heading, codes] of SECTIONS) {
    const rows = path.filter((e) => codes.includes(e.code));
    if (!rows.length) continue;
    md += "\n## " + heading + "\n" + rows.map((e) => "- " + where(e) + ": " + e.summary + " — " + why(e) + stamp(e)).join("\n") + "\n";
  }
  const missing = new Map<string, PathEvent[]>();
  for (const e of path) if (e.changeset?.reasonCode === "ingen") (missing.get(e.changeset.id) ?? missing.set(e.changeset.id, []).get(e.changeset.id)!).push(e);
  if (missing.size) {
    md += "\n## Begrunnelser mangler\n" + [...missing.values()].map((evs) =>
      "- " + dayText(evs[0].changeset.at) + ", " + (evs[0].changeset.editor || "system") + ": " + evs.map((e) => e.summary).join("; ")).join("\n") + "\n";
  }
  return md;
}

/** The day's own daily snapshot, else the earliest snapshot after that day (a later daily one or a baseline), else null. */
export function snapshotForDay<T extends SnapshotLike>(snapshots: T[], day: string): T | null {
  const own = snapshots.find((s) => s.kind === "dag" && s.day === day);
  if (own) return own;
  const after = snapshots
    .filter((s) => osloDay(new Date(s.at)) > day)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return after[0] ?? null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/timeline/compare.test.ts` → Expected: PASS (5 tests). If `exportMarkdown`'s missing list order differs, keep the path order (events arrive newest first; the test uses one changeset).

- [ ] **Step 5: Commit**

```bash
git add src/features/timeline/compare.ts src/features/timeline/compare.test.ts
git commit -m "timeline: compare summary, strip sentence, export markdown and snapshot-for-day (pure)"
```

---

### Task 2: Routes: `/api/timeline-snapshots` (GET, POST) and `/api/timeline-compare` (GET)

**Files:**
- Create: `src/app/api/timeline-snapshots/route.ts`
- Create: `src/app/api/timeline-compare/route.ts`

**Interfaces:**
- Consumes: `diffPlans` (events.ts), `normalizePlan` (epic-tools.js), `summarizeNet`, `summaryLine`, `exportMarkdown`, `sinceLabel`, `snapshotForDay` (Task 1), Prisma `timelineSnapshot`, `timelineChangeset`, `timelinePlan`.
- Produces: `GET /api/timeline-snapshots → { snapshots: [{ id, at, kind, day, label, planVersion, createdBy }] }` (newest first, 100); `POST { label } → { id, at, label }` (writers; logs `plan.baseline`); `GET /api/timeline-compare?from=<id | YYYY-MM-DD> → { baseline: { id, at, kind, day, label, data }, net, path, summary, strip, exportText }`, 404 `{ error: "no-snapshot", message }` when nothing matches, 400 without `from`.

- [ ] **Step 1: Write `src/app/api/timeline-snapshots/route.ts`**

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Baselines of the shared timeline plan (spec §4.4). Daily snapshots are written by the save path
// (features/timeline/history.ts); named baselines are created here.
// GET → { snapshots: [{ id, at, kind, day, label, planVersion, createdBy }] } newest first (no plan data)
// POST { label } (writers) → { id, at, label }; logs one changeset with a plan.baseline event.

const PLAN_ID = "epics";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const snapshots = await prisma.timelineSnapshot.findMany({
      orderBy: { at: "desc" },
      take: 100,
      select: { id: true, at: true, kind: true, day: true, label: true, planVersion: true, createdBy: true },
    });
    return Response.json({ snapshots }, NO_STORE);
  } catch {
    return Response.json({ snapshots: [] }, NO_STORE);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "writer") return Response.json({ error: "read-only" }, { status: 403 });
  let body: { label?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  if (!label) return Response.json({ error: "label is required" }, { status: 400 });
  const plan = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  if (!plan) return Response.json({ error: "no plan yet" }, { status: 404 });
  const createdBy = session.user?.name ?? session.user?.email ?? null;
  const snap = await prisma.timelineSnapshot.create({
    data: { kind: "baseline", label, planVersion: plan.version, data: plan.data as Prisma.InputJsonValue, createdBy },
    select: { id: true, at: true, label: true },
  });
  try {
    await prisma.timelineChangeset.create({
      data: {
        editor: createdBy, source: "bruker", planVersion: plan.version, eventCount: 1,
        events: { create: [{ editor: createdBy, targetType: "plan", targetId: snap.id, targetLabel: label, laneKey: null, code: "plan.baseline", cause: "bruker", summary: "Baseline «" + label + "»" }] },
      },
    });
  } catch { /* the baseline exists; the log is best effort */ }
  return Response.json(snap, NO_STORE);
}
```

- [ ] **Step 2: Write `src/app/api/timeline-compare/route.ts`**

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { diffPlans } from "@/features/timeline/events";
import { exportMarkdown, sinceLabel, snapshotForDay, summarizeNet, summaryLine, type PathEvent } from "@/features/timeline/compare";
import { normalizePlan } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";

// Compare the current plan with a baseline (spec §4.4).
// GET ?from=<snapshot id | YYYY-MM-DD>
//   → { baseline: { id, at, kind, day, label, data }, net: PlanEvent[], path: PathEvent[], summary, strip, exportText }
//   net  = diffPlans(baseline plan, current plan): what differs now
//   path = the events logged since the baseline, with their changesets (reasons)

const PLAN_ID = "epics";
const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const from = new URL(req.url).searchParams.get("from") ?? "";
  if (!from) return Response.json({ error: "from is required" }, { status: 400 });

  let id = from;
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const all = await prisma.timelineSnapshot.findMany({ select: { id: true, kind: true, day: true, at: true } });
    const pick = snapshotForDay(all, from);
    if (!pick) return Response.json({ error: "no-snapshot", message: "Ingen plan lagret fra den dagen eller senere." }, { status: 404 });
    id = pick.id;
  }
  const baseline = await prisma.timelineSnapshot.findUnique({ where: { id } });
  if (!baseline) return Response.json({ error: "no-snapshot", message: "Fant ikke baselinen." }, { status: 404 });
  const current = await prisma.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  if (!current) return Response.json({ error: "no plan yet" }, { status: 404 });

  const before = normalizePlan(clone(baseline.data)) as Plan;
  const after = normalizePlan(clone(current.data)) as Plan;
  const net = diffPlans(before, after);
  const rows = await prisma.timelineEvent.findMany({
    where: { at: { gt: baseline.at } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: 500,
    include: { changeset: { select: { id: true, at: true, editor: true, reason: true, reasonCode: true, source: true } } },
  });
  const path = rows as unknown as PathEvent[];
  const summary = summarizeNet(net, path);
  const label = sinceLabel(baseline);
  const strip = summaryLine(label, summary);
  const names = new Map<string, string>();
  for (const l of [...before.lanes, ...after.lanes]) names.set(l.key, l.name);
  const exportText = exportMarkdown("Siden " + label, strip, path, (k) => names.get(k) ?? k);
  return Response.json({
    baseline: { id: baseline.id, at: baseline.at, kind: baseline.kind, day: baseline.day, label: baseline.label, data: baseline.data },
    net, path, summary, strip, exportText,
  }, NO_STORE);
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit` → Expected: clean. If `normalizePlan` typing complains about `unknown`, the `as Plan` casts above cover it; `clone` keeps Prisma's JSON out of the mutating normaliser.
Run: `npx next build 2>&1 | grep -E "timeline-|error"` → Expected: `/api/timeline-compare` and `/api/timeline-snapshots` listed, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/timeline-snapshots/route.ts src/app/api/timeline-compare/route.ts
git commit -m "timeline: baselines (list, create) and compare route with net diff, path, summary strip and export"
```

---

### Task 3: Page: «Merk baseline…», «Sammenlign med ▾», the compare bar, «Siden sist», export

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Test: `<scratchpad>/hosted-history-smoke.mjs` (mock endpoints + S9)

**Interfaces:**
- Consumes: the three routes (Task 2); `askDialog(title, msg, { input, placeholder, confirmText })` returns the typed text; `downloadFile`, `setSaveNote`, `esc`, `el`, `getLane`, `fmtDate`, `unitToDate`, `REASON_LABEL` (stage 1).
- Produces: `cmp` (null or `{ id, label, at, lanes: {key→lane}, tasks: {id→task}, strip, path, exportText }`), `loadSnapshots()`, `startCompare(from)`, `refreshCompare()`, `endCompare()`, `renderCompareBar()`; DOM `#baselineBtn`, `#cmpSelect`, `#cmpDate`, `#cmpBar`, `#cmpStrip`, `#cmpSince`, `#cmpExport`, `#cmpClose`, `#cmpList`.

- [ ] **Step 1: Mock endpoints + failing scenario S9** (in `hosted-history-smoke.mjs`)

Add to the imports: `import { exportMarkdown, sinceLabel, snapshotForDay, summarizeNet, summaryLine } from "/Users/dnumreig/Skytale/SkyTracker-wt-epics/src/features/timeline/compare.ts";` and `import { normalizePlan } from "/Users/dnumreig/Skytale/SkyTracker-wt-epics/src/features/timeline/epic-tools.js";`.
Add state `const snapshots = [];` next to `changesets`, and in `record(...)` before the changeset is pushed, write the daily snapshot: `const day = new Date().toISOString().slice(0, 10); if (!snapshots.some((s) => s.kind === "dag" && s.day === day)) snapshots.push({ id: "snap" + (++seq), at: new Date(Date.now() + seq).toISOString(), kind: "dag", day, label: null, planVersion: version - 1, data: JSON.parse(JSON.stringify(before)) });`
Add routes before the `/__events` route:

```js
  if (req.method === "GET" && url.pathname === "/api/timeline-snapshots")
    return send(200, JSON.stringify({ snapshots: [...snapshots].reverse().map(({ data, ...s }) => s) }));
  if (req.method === "POST" && url.pathname === "/api/timeline-snapshots") {
    const { label } = await body();
    if (!label || !stored) return send(400, "{}");
    const snap = { id: "snap" + (++seq), at: new Date(Date.now() + seq).toISOString(), kind: "baseline", day: null, label, planVersion: stored.version, data: JSON.parse(JSON.stringify(stored.data)) };
    snapshots.push(snap);
    const cs = { id: "cs" + (++seq), at: snap.at, editor: "Test Bruker", source: "bruker", reason: null, reasonCode: null, planVersion: stored.version, eventCount: 1 };
    changesets.push(cs);
    events.push({ id: "ev" + (++seq), seq, changesetId: cs.id, at: cs.at, editor: cs.editor, targetType: "plan", targetId: snap.id, targetLabel: label, laneKey: null, code: "plan.baseline", cause: "bruker", summary: "Baseline «" + label + "»", changeset: cs });
    return send(200, JSON.stringify({ id: snap.id, at: snap.at, label }));
  }
  if (req.method === "GET" && url.pathname === "/api/timeline-compare") {
    const from = url.searchParams.get("from") || "";
    const pick = /^\d{4}-\d{2}-\d{2}$/.test(from) ? snapshotForDay(snapshots, from) : snapshots.find((s) => s.id === from);
    if (!pick || !stored) return send(404, JSON.stringify({ error: "no-snapshot", message: "Ingen plan lagret fra den dagen eller senere." }));
    const before = normalizePlan(JSON.parse(JSON.stringify(pick.data))), after = normalizePlan(JSON.parse(JSON.stringify(stored.data)));
    const net = diffPlans(before, after);
    const path = events.filter((e) => e.at > pick.at).sort((a, b) => b.seq - a.seq);
    const summary = summarizeNet(net, path), label = sinceLabel(pick), strip = summaryLine(label, summary);
    const names = new Map([...before.lanes, ...after.lanes].map((l) => [l.key, l.name]));
    return send(200, JSON.stringify({ baseline: { id: pick.id, at: pick.at, kind: pick.kind, day: pick.day, label: pick.label, data: pick.data }, net, path, summary, strip, exportText: exportMarkdown("Siden " + label, strip, path, (k) => names.get(k) ?? k) }));
  }
```

Replace `// __LATER_SCENARIOS__` with:

```js
// S9: mark a baseline → move Telenor's goal (reason ekstern) and widen F-24 (skip) → compare: strip, ghost bar, ghost goal, list, export
const f24Left0 = parseFloat(await page.$eval('.bar[data-id="f24"]', (e) => e.style.left));
await page.click("#baselineBtn"); await page.waitForSelector("#dlgBack.open");
assert(/^Produktforum \d+\. [a-z]+$/.test(await page.inputValue("#dlgInput")), "default baseline label");
await page.fill("#dlgInput", "Produktforum 5. nov"); await page.click("#dlgYes");
await page.waitForFunction(() => [...document.querySelectorAll("#cmpSelect option")].some((o) => /Produktforum 5\. nov/.test(o.textContent)));
ev = await evs();
assert(ev.events.some((e) => e.code === "plan.baseline" && e.summary === "Baseline «Produktforum 5. nov»"), "plan.baseline logged");
await page.click('.lane-label[data-key="telenor"] .ln'); await page.waitForSelector("#epicBack.open");
await page.fill("#epGoal", "2027-01-15"); await page.click("#epSave");
await page.waitForSelector("#reasonBack.open"); await page.click('#reasonCodes button[data-code="ekstern"]'); await page.fill("#reasonText", "Telenor flyttet piloten"); await page.click("#reasonSave"); await reasonClosed(); await savedNote();
await dragBar("f24", 48, true); await page.waitForSelector("#reasonBack.open"); await page.click("#reasonSkip"); await reasonClosed(); await savedNote();
const baselineId = (await (await fetch(BASE + "/api/timeline-snapshots")).json()).snapshots.find((s) => s.kind === "baseline").id;
await page.selectOption("#cmpSelect", baselineId);
await page.waitForSelector("#cmpBar:not([hidden])");
const strip = await page.$eval("#cmpStrip", (e) => e.textContent);
assert(/^Siden produktforum 5\. nov: 1 måldato flyttet · 1 spenn utvidet · 1 begrunnelse mangler$/.test(strip), "summary strip: " + strip);
const ghost = await page.$('.bar.ghost[data-id="f24"]');
assert(ghost && Math.abs(parseFloat(await ghost.evaluate((e) => e.style.left)) - f24Left0) < 0.5, "ghost bar at the baseline position");
assert(await page.$('.lane-band .goal-line.ghost'), "ghost goal marker drawn for the moved goal");
await page.click("#cmpSince"); await page.waitForSelector("#cmpList:not([hidden])");
const list = await page.$eval("#cmpList", (e) => e.textContent);
assert(/Telenor kan bygge på oss/.test(list) && /Ekstern dato endret – Telenor flyttet piloten/.test(list) && /Begrunnelse mangler/.test(list), "siden sist list with reasons: " + list.slice(0, 200));
const cmpJson = await (await fetch(BASE + "/api/timeline-compare?from=" + baselineId)).json();
assert(/## Måldatoer\n- Telenor kan bygge på oss: Måldato: 15\. des → 15\. jan — Ekstern dato endret: Telenor flyttet piloten/.test(cmpJson.exportText), "export has the goal line");
assert(/## Spenn\n- Telenor kan bygge på oss › API for integrasjoner \(F-24\): Spenn: 6–9 → 6–11 uker \(utvidet 2 uker\) — begrunnelse mangler/.test(cmpJson.exportText), "export has the span line");
await page.click("#cmpExport");
await page.waitForFunction(() => /kopiert|lastet ned/.test(document.getElementById("dirtyNote").textContent));
console.log("S9 ok:", strip);

// __LATER_SCENARIOS__
```

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: S1–S8 ok, then a timeout on `#baselineBtn`.

- [ ] **Step 2: CSS and markup**

Append to `<style>` (after `.lane-label .metric{…}`):

```css
  /* ---------- sammenligning ---------- */
  .cmp-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0 0;padding:8px 12px;border:1px solid var(--accent);border-radius:6px;background:var(--accent-soft);font-size:12px;color:var(--text)}
  .cmp-bar[hidden]{display:none}
  .cmp-bar b{font-weight:600}
  .cmp-bar .sp{flex:1}
  .cmp-list{margin:8px 0 0;border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:10px 14px;font-size:13px}
  .cmp-list[hidden]{display:none}
  .cmp-list h4{font-size:12px;font-weight:600;margin:10px 0 4px;color:var(--text)}
  .cmp-list h4:first-child{margin-top:0}
  .cmp-list .row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;padding:2px 0 2px 10px;border-left:2px solid var(--line-soft)}
  .cmp-list .row .who{font-size:11px;color:var(--text-3)}
  .cmp-list .empty{color:var(--text-4)}
  #cmpSelect,#cmpDate{font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--line);border-radius:4px;background:var(--input-bg);color:var(--text);max-width:240px}
  #cmpDate[hidden]{display:none}
```

Top bar: before `<button id="exportBtn">Eksporter (JSON)</button>` insert
```html
    <button id="baselineBtn" title="Lagre planen slik den er nå, som et punkt å sammenligne med">Merk baseline…</button>
    <select id="cmpSelect" title="Sammenlign planen med et tidligere punkt"><option value="">Sammenlign med …</option></select>
    <input id="cmpDate" type="date" hidden title="Planen slik den var om morgenen denne dagen">
```
After `<div class="link-banner" id="linkBanner">…</div>` insert
```html
  <div class="cmp-bar" id="cmpBar" hidden>
    <span id="cmpStrip"></span><span class="sp"></span>
    <button id="cmpSince">Siden sist</button>
    <button id="cmpExport" title="Kopier listen som tekst (markdown)">Eksporter</button>
    <button class="text" id="cmpClose">Avslutt sammenligning</button>
  </div>
  <div class="cmp-list" id="cmpList" hidden></div>
```

- [ ] **Step 3: JS: baselines and compare state** (new section after the «historikk» section, before `/* ================== feature-editor ================== */`)

```js
  /* ================== baseline og sammenligning ================== */
  const cmpBar = $('cmpBar'), cmpStrip = $('cmpStrip'), cmpList = $('cmpList'), cmpSelect = $('cmpSelect'), cmpDate = $('cmpDate');
  let cmp = null;   // { id, label, at, lanes, tasks, strip, path, exportText } når sammenligning er på
  $('baselineBtn').hidden = !HOSTED; cmpSelect.hidden = !HOSTED;
  function defaultBaselineLabel(){ const d = new Date(); return 'Produktforum ' + d.getDate() + '. ' + MND_S[d.getMonth()]; }
  async function loadSnapshots(){
    if(!HOSTED) return;
    try{
      const r = await fetch('api/timeline-snapshots', {cache:'no-store'});
      if(!r.ok) return;
      const list = (await r.json()).snapshots.filter(s => s.kind === 'baseline');
      const cur = cmp ? cmp.id : '';
      cmpSelect.innerHTML = '<option value="">Sammenlign med …</option>' +
        list.map(s => '<option value="' + esc(s.id) + '">' + esc(s.label) + ' · ' + esc(fmtDate(new Date(s.at))) + '</option>').join('') +
        '<option value="__date">Dato …</option>';
      cmpSelect.value = cur;
    }catch(e){}
  }
  $('baselineBtn').addEventListener('click', async () => {
    const label = await askDialog('Merk baseline', 'Planen slik den er nå lagres som et punkt å sammenligne med.', {input:true, placeholder:'Produktforum 5. nov', confirmText:'Lagre'});
    if(label === false || label === null) return;
    const text = String(label).trim() || defaultBaselineLabel();
    try{
      const r = await fetch('api/timeline-snapshots', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ label: text })});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      setSaveNote('baseline «' + text + '» lagret');
      await loadSnapshots();
      refreshHistoryBadge();
    }catch(e){ askDialog('Kunne ikke lagre baselinen', 'Prøv igjen om litt.', {confirmText:'OK', noCancel:true}); }
  });
  async function startCompare(from){
    try{
      const r = await fetch('api/timeline-compare?from=' + encodeURIComponent(from), {cache:'no-store'});
      const j = await r.json();
      if(!r.ok){ endCompare(); askDialog('Ingen sammenligning', j.message || 'Fant ingen plan å sammenligne med.', {confirmText:'OK', noCancel:true}); return; }
      const base = normalizePlan(JSON.parse(JSON.stringify(j.baseline.data)));
      cmp = {
        id: j.baseline.id, at: j.baseline.at, label: j.baseline.label || fmtDate(new Date(j.baseline.at)),
        lanes: Object.fromEntries(base.lanes.map(l => [l.key, l])), tasks: Object.fromEntries(base.tasks.map(t => [t.id, t])),
        strip: j.strip, path: j.path, exportText: j.exportText,
      };
      renderCompareBar();
      render();
    }catch(e){ endCompare(); setSaveNote('kunne ikke hente sammenligningen'); }
  }
  async function refreshCompare(){ if(cmp) await startCompare(cmp.id); }
  function endCompare(){
    cmp = null;
    cmpBar.hidden = true; cmpList.hidden = true;
    cmpSelect.value = ''; cmpDate.hidden = true;
    render();
  }
  function renderCompareBar(){
    cmpBar.hidden = false;
    cmpStrip.innerHTML = '<b>' + esc(cmp.strip) + '</b>';
    if(!cmpList.hidden) renderCompareList();
  }
  function renderCompareList(){
    const byLane = new Map();
    cmp.path.forEach(e => {
      const key = e.laneKey || '';
      if(!byLane.has(key)) byLane.set(key, []);
      byLane.get(key).push(e);
    });
    if(!cmp.path.length){ cmpList.innerHTML = '<div class="empty">Ingen endringer siden ' + esc(cmp.label) + '.</div>'; return; }
    let html = '';
    byLane.forEach((evs, key) => {
      const lane = key ? (getLane(key) || cmp.lanes[key]) : null;
      html += '<h4>' + esc(lane ? lane.name : 'Planen') + '</h4>' + evs.map(e => {
        const cs = e.changeset || {};
        const why = e.cause === 'avhengighet' ? '<span class="chip cause">avhengighet' + (e.causeRef ? ': ' + esc((getTask(e.causeRef) || cmp.tasks[e.causeRef] || {label: e.causeRef}).label) : '') + '</span>'
          : cs.reasonCode && cs.reasonCode !== 'ingen' ? '<span class="chip reason">' + esc(REASON_LABEL[cs.reasonCode] || cs.reasonCode) + (cs.reason ? ' – ' + esc(cs.reason) : '') + '</span>'
          : cs.reasonCode === 'ingen' ? '<span class="chip reason missing">Begrunnelse mangler</span>' : '';
        return '<div class="row"><span>' + (e.targetType === 'feature' ? esc(e.targetLabel) + ': ' : '') + esc(e.summary) + '</span>' + why +
          '<span class="who">' + esc(cs.editor || e.editor || 'system') + ' · ' + esc(fmtWhen(cs.at || e.at)) + '</span></div>';
      }).join('');
    });
    cmpList.innerHTML = html;
  }
  cmpSelect.addEventListener('change', () => {
    const v = cmpSelect.value;
    if(v === '__date'){ cmpDate.hidden = false; cmpDate.value = ''; setTimeout(() => cmpDate.focus(), 0); return; }
    cmpDate.hidden = true;
    if(!v){ endCompare(); return; }
    startCompare(v);
  });
  cmpDate.addEventListener('change', () => { if(cmpDate.value) startCompare(cmpDate.value); });
  $('cmpSince').addEventListener('click', () => { cmpList.hidden = !cmpList.hidden; if(!cmpList.hidden) renderCompareList(); });
  $('cmpClose').addEventListener('click', endCompare);
  $('cmpExport').addEventListener('click', async () => {
    if(!cmp) return;
    try{
      await navigator.clipboard.writeText(cmp.exportText);
      setSaveNote('«Siden sist» kopiert som tekst');
    }catch(e){
      downloadFile('siden-' + cmp.label.replace(/[^\wæøåÆØÅ-]+/g, '-').toLowerCase() + '.md', cmp.exportText, 'text/markdown');
      setSaveNote('«Siden sist» lastet ned som tekst');
    }
  });
```

Wiring: in `initServerPlan` after `refreshHistoryBadge();` add `loadSnapshots();`. In `applyRemote` after `render();` add `if(cmp) refreshCompare();`. In `pushPlan` after `refreshHistoryBadge();` add `if(cmp) refreshCompare();`. Escape chain: before the `!histDrawer.hidden` branch add `else if(cmp && !cmpList.hidden) cmpList.hidden = true;`.

- [ ] **Step 4: Run S9 (the ghost assertions still fail: Task 4)**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: S9 passes the strip assertion and fails on «ghost bar at the baseline position».

- [ ] **Step 5: Commit**

```bash
git add src/app/timeline/timeline.html
git commit -m "timeline page: mark baselines, compare with a baseline or a date, summary strip, «Siden sist» list, export"
```

---

### Task 4: Page: ghost bars, ghost goal markers, «ny» chips, struck-through deleted rows

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Test: `<scratchpad>/hosted-history-smoke.mjs` (S9 ghost assertions, new S10)

**Interfaces:**
- Consumes: `cmp` (Task 3), `render()`, `position()`, `x()`, `MONTH_W`, `rowRefs`.
- Produces: DOM `.bar.ghost[data-id]`, `.goal-line.ghost`, `.chip.new`, `.task-label.gone`, `.row.gone`.

- [ ] **Step 1: Add S10** (replace `// __LATER_SCENARIOS__`; keep the marker at the end)

```js
// S10: in compare mode a new feature gets «ny», a deleted one stays as a struck-through row with its ghost; the strip counts them; closing clears all ghosts
await page.click('.lane-label[data-key="telenor"] .add-feature'); await page.waitForSelector("#editorBack.open"); await page.click("#edCancel"); await savedNote();
await page.waitForFunction(() => document.querySelector('.task-label .chip.new'));
await page.hover('.task-label[data-id="f24"]'); await page.click('.task-label[data-id="f24"] .row-actions .del'); await page.waitForSelector("#dlgBack.open"); await page.click("#dlgYes");
await page.waitForSelector("#reasonBack.open"); await page.click("#reasonSkip"); await reasonClosed(); await savedNote();
await page.waitForFunction(() => document.querySelector('.task-label.gone'));
assert(await page.$eval('.task-label.gone .t', (e) => e.textContent) === "API for integrasjoner (F-24)", "deleted feature shown struck through");
assert(await page.$('.row.gone .bar.ghost[data-id="f24"]'), "deleted feature keeps its ghost bar");
await page.waitForFunction(() => /1 ny · 1 fjernet/.test(document.getElementById("cmpStrip").textContent));
await page.click("#cmpClose");
await page.waitForSelector("#cmpBar", { state: "hidden" });
assert(!(await page.$(".bar.ghost")) && !(await page.$(".task-label.gone")) && !(await page.$(".chip.new")), "no ghosts after closing the compare");
console.log("S10 ok");

// __LATER_SCENARIOS__
```

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: fails in S9 on the ghost bar (not yet drawn).

- [ ] **Step 2: CSS**

Append:
```css
  .bar.ghost{opacity:.35;pointer-events:none;z-index:1;cursor:default;filter:none}
  .bar.ghost .h{display:none}
  .goal-line.ghost{background:none;border-left:2px dashed var(--goal);opacity:.6;z-index:2}
  .task-label.gone .t{text-decoration:line-through;color:var(--text-4)}
  .task-label.gone .d{color:var(--text-4)}
  .row.gone{background:repeating-linear-gradient(135deg,transparent 0 6px,var(--line-soft) 6px 7px)}
  .chip.new{background:var(--ado-bg);color:var(--ado-fg)}
```

- [ ] **Step 3: Ghosts in `render()`**

Add a helper before `function render(){`:

```js
  function ghostBar(t){   // en falmet kopi av linjen slik den sto i baselinen
    const g = el('div', 'bar ghost ' + t.kind);
    g.dataset.id = t.id;
    const left = x(t.start), width = Math.max(14, (t.end - t.start) * MONTH_W);
    g.style.left = left + 'px'; g.style.width = width + 'px';
    if(t.kind === 'estimate'){
      const lw = Math.max(0, Math.min(width, (t.endLikely - t.start) * MONTH_W));
      g.innerHTML = '<div class="seg likely" style="width:' + lw + 'px"></div><div class="seg late" style="width:' + Math.max(0, width - lw) + 'px"></div>';
    }
    g.title = 'Baseline: ' + rangeText(t);
    return g;
  }
```

In the lane loop, after `if(hasGoal){ … }` for the lane band (the block ending `chart.appendChild(lb);` → insert before `chart.appendChild(lb);`):
```js
      if(cmp){
        const bl = cmp.lanes[lane.key];
        if(bl && typeof bl.goalDate === 'number' && (!hasGoal || Math.abs(bl.goalDate - lane.goalDate) > 1e-9)){
          const gg = el('div', 'goal-line ghost'); gg.style.left = x(bl.goalDate) + 'px'; gg.title = 'Baseline: ' + goalText(bl); lb.appendChild(gg);
        }
      }
```

In the task loop, after `const bar = el('div', 'bar ' + t.kind);` … `row.appendChild(bar);` → insert before `row.appendChild(bar);`:
```js
        if(cmp){
          const bt = cmp.tasks[t.id];
          if(bt && bt.lane === t.lane && (Math.abs(bt.start - t.start) > 1e-9 || Math.abs(bt.end - t.end) > 1e-9 || Math.abs((bt.endLikely || 0) - (t.endLikely || 0)) > 1e-9)) row.appendChild(ghostBar(bt));
          if(!bt) tt.insertAdjacentHTML('beforeend', ' <span class="chip new" title="Fantes ikke i baselinen">ny</span>');
        }
```
(`tt` is the `.t` span created above; keep its text node first.)

After the `laneTasks(lane.key).forEach(t => { … });` loop and before the lane loop's closing `});`, add the deleted rows:
```js
      if(cmp){
        const liveIds = new Set(state.tasks.map(t => t.id));
        Object.values(cmp.tasks).filter(bt => bt.lane === lane.key && !liveIds.has(bt.id)).forEach(bt => {
          const tl = el('div', 'task-label gone');
          tl.dataset.id = bt.id;
          tl.innerHTML = '<span class="t">' + esc(bt.label) + '</span><span class="d">Fjernet siden baselinen · ' + esc(rangeText(bt)) + '</span>';
          labels.appendChild(tl);
          const row = el('div', 'row gone');
          row.style.width = CHART_W + 'px';
          row.appendChild(ghostBar(bt));
          chart.appendChild(row);
        });
      }
```

`drawArrows` reads `rowRefs` only for live tasks; the extra rows just shift offsets, which `offsetTop` already reflects.

- [ ] **Step 4: Run the smokes and the theme shots**

Run: `npx tsx <scratchpad>/hosted-history-smoke.mjs` → Expected: `S9 ok: … S10 ok … OK`.
Run: `node <scratchpad>/ui-smoke.mjs` → Expected: `OK` (file:// mode: `cmp` stays null, the new controls are hidden).
Run: `node <scratchpad>/theme-shots.mjs` → Expected: `theme shots OK`.
Run: `npx tsx <scratchpad>/hosted-smoke.mjs` → Expected: `OK (PUTs: 6)` after adding to its mock: `if (url.pathname === "/api/timeline-snapshots") return send(200, JSON.stringify({ snapshots: [] }));` (the page lists baselines on load).

- [ ] **Step 5: Commit**

```bash
git add src/app/timeline/timeline.html
git commit -m "timeline page: ghost bars and goal markers, «ny» chips and struck-through deleted rows in compare mode"
```

---

### Task 5: Stage verification, review, PR text section

- [ ] **Step 1: Full suite**

```bash
npx vitest run && npx tsc --noEmit && npx next build
node <scratchpad>/ui-smoke.mjs && npx tsx <scratchpad>/hosted-smoke.mjs && npx tsx <scratchpad>/hosted-history-smoke.mjs
```
Expected: vitest green (compare tests included), tsc clean, build lists `/api/timeline-compare` and `/api/timeline-snapshots`, three smokes `OK`.

- [ ] **Step 2: Review the stage's commits** (inline, `/review-branch` style, range = stage-2 commits)

Fix Critical and Important findings with a failing test first; minors to the ledger.

- [ ] **Step 3: PR text** — append to `~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body-planning-system.md`:

```markdown
## Stage 2 · Baselines and compare

A writer marks a **baseline** («Merk baseline…», default label «Produktforum 5. nov»; logged as `plan.baseline`). Anyone picks
«Sammenlign med ▾» (a baseline or a date; a date resolves to that day's daily snapshot or the next one) and the page draws
**ghost bars** where features stood, a dashed ghost goal marker where a goal moved, «ny» on features that did not exist and
struck-through rows for deleted ones. The strip reads «Siden produktforum 5. nov: 2 måldatoer flyttet · 3 spenn utvidet · 1
feature byttet epic · 2 prioriteringer · 4 begrunnelser mangler»; «Siden sist» lists the events per epic with their reasons;
«Eksporter» copies the markdown (sections Måldatoer · Spenn · Flyttet · Prioritet · Nye og fjernet · Begrunnelser mangler).

- Server: `GET/POST /api/timeline-snapshots`, `GET /api/timeline-compare?from=` (net = `diffPlans(baseline, now)`, path = the
  events since, summary/strip/export from `compare.ts`). No schema change.
- Verification: vitest on `compare.ts` (counts, wording, export sections, snapshot-for-day); hosted history smoke S9–S10.
```

- [ ] **Step 4: Ledger**

`Stage 2: complete (…)`; then write the stage-3 plan (spec §5 R2: lifecycle and the forum shelf).

---
