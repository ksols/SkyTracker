# Provision Future ADO Sprints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A re-runnable CLI script that previews and (with `--apply`) creates upcoming 2-week sprints in Azure DevOps — both the iteration node and its Dev Team backlog registration.

**Architecture:** Pure cadence logic (`scripts/lib/sprint-cadence.ts`) is unit-tested and free of I/O. A thin ADO client (`scripts/lib/ado-iterations.ts`) does the REST calls. The entry script (`scripts/provision-sprints.ts`) parses args, fetches existing iterations, computes the plan, prints it, and on `--apply` creates + registers each sprint.

**Tech Stack:** TypeScript run via `tsx`, `dotenv` for `.env`, `fetch` against ADO REST `api-version=7.1`, vitest for the pure logic.

**Verified ADO facts (live 2026-05-27):**
- Org `https://dev.azure.com/SkytaleAS`, project `Skytale`, team `Dev Team`.
- Credential: `ADO_PAT` (broader scope) from `.env`. Auth `Basic base64(":" + PAT)`.
- Create node: `POST {org}/Skytale/_apis/wit/classificationnodes/iterations?api-version=7.1` body `{ name, attributes: { startDate, finishDate } }` → returns `{ identifier: <GUID>, ... }`.
- Register: `POST {org}/Skytale/Dev Team/_apis/work/teamsettings/iterations?api-version=7.1` body `{ id: <identifier GUID> }`.
- Sprints are Monday → second Friday (start + 11 days); latest is `Sprint 65` (2026-05-18 → 2026-05-29). Dates are ISO `…T00:00:00Z` in node `attributes`.
- ADO responses carry a UTF-8 BOM — always parse via `res.json()`.

---

## File Structure

- `scripts/lib/sprint-cadence.ts` — pure date/plan logic (create).
- `scripts/lib/sprint-cadence.test.ts` — unit tests (create).
- `scripts/lib/ado-iterations.ts` — ADO REST calls (create).
- `scripts/provision-sprints.ts` — CLI entry (create).
- `vitest.config.ts` — include `scripts/**/*.test.ts` (create or modify).
- `package.json` — add `tsx` devDep + `provision-sprints` script (modify).

---

## Task 1: Test/runner setup

**Files:**
- Create or modify: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install tsx (and vitest if not already present)**

Run: `npm install -D tsx vitest`
Expected: both in devDependencies (no-op for any already installed).

- [ ] **Step 2: Ensure vitest scans scripts and src**

Create/replace `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add scripts to package.json**

In `package.json` `"scripts"`, ensure these exist:

```jsonc
"test": "vitest run",
"provision-sprints": "tsx scripts/provision-sprints.ts"
```

- [ ] **Step 4: Verify runner**

Run: `npm test`
Expected: vitest runs (no failures; "no test files" is fine until Task 2).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add tsx runner and provision-sprints script entry"
```

---

## Task 2: Pure cadence logic (TDD)

**Files:**
- Create: `scripts/lib/sprint-cadence.ts`
- Test: `scripts/lib/sprint-cadence.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/sprint-cadence.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scripts/lib/sprint-cadence.test.ts`
Expected: FAIL — `./sprint-cadence` cannot be resolved.

- [ ] **Step 3: Implement the cadence logic**

Create `scripts/lib/sprint-cadence.ts`:

```ts
export type PlannedSprint = {
  number: number;
  name: string;
  start: Date;
  finish: Date;
};

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date: Date, n: number) => new Date(date.getTime() + n * DAY);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** First Monday strictly after `date` (UTC). getUTCDay(): Sun=0..Sat=6, Mon=1. */
export function nextMondayAfter(date: Date): Date {
  let d = addDays(date, 1);
  while (d.getUTCDay() !== 1) d = addDays(d, 1);
  return d;
}

export function computeSprintPlan(input: {
  lastNumber: number;
  lastFinish: Date;
  count: number;
  skip: string[];
}): PlannedSprint[] {
  const skip = new Set(input.skip);
  const plan: PlannedSprint[] = [];
  let start = nextMondayAfter(input.lastFinish);

  for (let i = 0; i < input.count; i++) {
    while (skip.has(isoDay(start))) start = addDays(start, 7);
    const finish = addDays(start, 11); // Monday → second Friday
    const number = input.lastNumber + i + 1;
    plan.push({ number, name: `Sprint ${number}`, start, finish });
    start = nextMondayAfter(finish);
  }
  return plan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scripts/lib/sprint-cadence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sprint-cadence.ts scripts/lib/sprint-cadence.test.ts
git commit -m "feat(sprints): pure 2-week cadence planner with skip weeks (TDD)"
```

---

## Task 3: ADO iterations client

**Files:**
- Create: `scripts/lib/ado-iterations.ts`

- [ ] **Step 1: Implement the client**

Create `scripts/lib/ado-iterations.ts`:

```ts
const ORG = "https://dev.azure.com/SkytaleAS";
const PROJECT = "Skytale";
const TEAM = "Dev Team";
const API = "7.1";

function authHeader(): string {
  const pat = process.env.ADO_PAT;
  if (!pat) throw new Error("ADO_PAT is not set (needed to manage iterations)");
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

async function adoFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ADO ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export type ExistingIteration = { name: string; startDate?: string; finishDate?: string };

/** All "Sprint N" iteration nodes (direct children of the project root). */
export async function listSprintIterations(): Promise<ExistingIteration[]> {
  const url = `${ORG}/${PROJECT}/_apis/wit/classificationnodes/iterations?$depth=2&api-version=${API}`;
  const root = (await adoFetch(url)) as {
    children?: { name: string; attributes?: { startDate?: string; finishDate?: string } }[];
  };
  return (root.children ?? [])
    .filter((c) => /^Sprint \d+/.test(c.name))
    .map((c) => ({ name: c.name, startDate: c.attributes?.startDate, finishDate: c.attributes?.finishDate }));
}

/** Create the iteration classification node; returns its GUID identifier. */
export async function createIterationNode(name: string, start: Date, finish: Date): Promise<string> {
  const url = `${ORG}/${PROJECT}/_apis/wit/classificationnodes/iterations?api-version=${API}`;
  const body = {
    name,
    attributes: { startDate: start.toISOString(), finishDate: finish.toISOString() },
  };
  const node = (await adoFetch(url, { method: "POST", body: JSON.stringify(body) })) as {
    identifier: string;
  };
  return node.identifier;
}

/** Register a created iteration node (by GUID) as a Dev Team backlog iteration. */
export async function registerTeamIteration(identifier: string): Promise<void> {
  const url = `${ORG}/${PROJECT}/${encodeURIComponent(TEAM)}/_apis/work/teamsettings/iterations?api-version=${API}`;
  await adoFetch(url, { method: "POST", body: JSON.stringify({ id: identifier }) });
}
```

- [ ] **Step 2: Typecheck the script tree**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/ado-iterations.ts
git commit -m "feat(sprints): ADO client for listing/creating/registering iterations"
```

---

## Task 4: CLI entry script

**Files:**
- Create: `scripts/provision-sprints.ts`

- [ ] **Step 1: Implement the CLI**

Create `scripts/provision-sprints.ts`:

```ts
import "dotenv/config";
import { computeSprintPlan, type PlannedSprint } from "./lib/sprint-cadence";
import {
  listSprintIterations,
  createIterationNode,
  registerTeamIteration,
} from "./lib/ado-iterations";

function parseArgs(argv: string[]) {
  const args = { count: 6, skip: [] as string[], apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--count") args.count = parseInt(argv[++i], 10);
    else if (a === "--skip") args.skip = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!Number.isFinite(args.count) || args.count < 1) throw new Error("--count must be a positive integer");
  return args;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function latestSprint(existing: { name: string; finishDate?: string }[]) {
  let lastNumber = 0;
  let lastFinish = new Date(0);
  for (const it of existing) {
    const m = it.name.match(/^Sprint (\d+)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > lastNumber) {
      lastNumber = n;
      lastFinish = it.finishDate ? new Date(it.finishDate) : lastFinish;
    }
  }
  if (lastNumber === 0) throw new Error("No existing 'Sprint N' iterations found to anchor the cadence");
  return { lastNumber, lastFinish };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const existing = await listSprintIterations();
  const existingNames = new Set(existing.map((e) => e.name));
  const { lastNumber, lastFinish } = latestSprint(existing);

  const plan = computeSprintPlan({ lastNumber, lastFinish, count: args.count, skip: args.skip });

  console.log(`\nLatest existing: Sprint ${lastNumber} (ends ${isoDay(lastFinish)})`);
  console.log(args.apply ? "Mode: APPLY\n" : "Mode: DRY RUN (use --apply to create)\n");
  for (const s of plan) {
    const exists = existingNames.has(s.name);
    console.log(`  ${s.name.padEnd(12)} ${isoDay(s.start)} → ${isoDay(s.finish)}${exists ? "   [exists, skip]" : ""}`);
  }
  console.log("");

  if (!args.apply) return;

  let failures = 0;
  const toCreate = plan.filter((s) => !existingNames.has(s.name));
  for (const s of toCreate) {
    try {
      const identifier = await createIterationNode(s.name, s.start, s.finish);
      try {
        await registerTeamIteration(identifier);
        console.log(`  created + registered ${s.name}`);
      } catch (e) {
        failures++;
        console.error(`  ${s.name}: node created but team registration FAILED — ${(e as Error).message}`);
      }
    } catch (e) {
      failures++;
      console.error(`  ${s.name}: create FAILED — ${(e as Error).message}`);
    }
  }
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
```

Note: `PlannedSprint` is imported for type clarity even if only used structurally; keep it if the linter is satisfied, otherwise drop the unused import.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Dry-run against live ADO**

Run: `npm run provision-sprints`
Expected: prints "Latest existing: Sprint 65 (ends 2026-05-29)", "Mode: DRY RUN", and a list starting with `Sprint 66  2026-06-01 → 2026-06-12`. Nothing is created.

- [ ] **Step 4: Verify skip handling (dry run)**

Run: `npm run provision-sprints -- --count 2 --skip 2026-06-01`
Expected: `Sprint 66  2026-06-08 → 2026-06-19` then `Sprint 67  2026-06-22 → 2026-07-03` (the June 1 week is skipped).

- [ ] **Step 5: Commit**

```bash
git add scripts/provision-sprints.ts
git commit -m "feat(sprints): provision-sprints CLI (dry-run, skip weeks, --apply)"
```

---

## Task 5: Live apply + verification

**Files:** none (verification task)

- [ ] **Step 1: Apply a single sprint**

Run: `npm run provision-sprints -- --count 1 --apply`
Expected: prints `created + registered Sprint 66` and exits 0.

- [ ] **Step 2: Confirm append semantics (NOT idempotent)**

Run: `npm run provision-sprints -- --count 1 --apply`
Expected: anchors on the now-latest Sprint 66 and creates **Sprint 67** — each
`--apply` appends beyond the latest existing sprint; it does not no-op. The
dry-run (run without `--apply`) is the safety check before any append.

- [ ] **Step 3: Confirm in ADO**

In the ADO sprints UI for **Dev Team** (or via the team iterations API), confirm `Sprint 66` exists with dates 2026-06-01 → 2026-06-12 and is a planable backlog iteration.

- [ ] **Step 4: Run the unit suite once more**

Run: `npm test`
Expected: cadence tests PASS.

---

## Self-review notes
- Spec coverage: re-runnable script (T4), 2-week cadence + skip weeks (T2), dry-run default + `--apply` + `--count`/`--skip` (T4), node create + team registration (T3/T5), `ADO_PAT` credential (T3). All covered.
- Append semantics (NOT idempotent): each `--apply` appends N sprints beyond the latest; the dry-run is the safety guard. The existing-name filter only guards manual out-of-band collisions. Confirmed live during T5.
- Pure logic is TDD-tested; network calls verified live (no brittle HTTP mocking of admin endpoints beyond the dry run).
- `vitest.config.ts` include list is shared with the work-item-creation plan; if both branches merge, keep the union `["src/**/*.test.ts", "scripts/**/*.test.ts"]`.
