# ADO Work-Item Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SkyTracker optionally create a matching Azure DevOps work item when a card is added (with sprint, tags, and dependency links), and show a link to the work item on attached cards.

**Architecture:** A pure ADO module (`src/features/ado/`) holds config, payload mappers, and a `fetch`-based REST client. Board server actions orchestrate: create the card locally first, then best-effort sync to ADO and store the returned work item id on the card. The card UI renders a click-isolated badge linking to ADO.

**Tech Stack:** Next.js 16 server actions, Prisma 7, Zod, `fetch` against the ADO REST API (`api-version=7.1`), vitest for unit tests.

**Resolved ADO facts (verified live 2026-05-27):**
- Org `https://dev.azure.com/SkytaleAS`, project `Skytale`, `api-version=7.1`.
- Work item create: `POST {org}/{project}/_apis/wit/workitems/${TYPE}` with `Content-Type: application/json-patch+json`. v1 always uses type `User Story`.
- Auth: `Authorization: Basic base64(":" + PAT)`, PAT from `SKYTRACKER_ADO_PAT` (Work Items read+write).
- "Blocked by" → relation `System.LinkTypes.Dependency-Reverse` (Predecessor).
- Iteration paths are `Skytale\Sprint <n>` but some have suffixes (`Sprint 57 (Bugweek)`) — resolve by matching, never string-build.
- ADO responses carry a UTF-8 BOM; always parse via `res.json()` (handles it) — never hand-roll BOM stripping.

---

## File Structure

- `prisma/schema.prisma` — add `adoWorkItemId Int?` to `Card` (modify).
- `src/features/ado/config.ts` — constants, URL builders, PAT/auth header (create).
- `src/features/ado/mappers.ts` — pure payload builders + iteration matcher (create).
- `src/features/ado/mappers.test.ts` — unit tests for mappers (create).
- `src/features/ado/client.ts` — `fetch`-based REST client (create).
- `src/features/ado/client.test.ts` — unit tests with mocked `fetch` (create).
- `src/features/board/actions.ts` — internal `syncCardToAdo`, extend `createCard`, add `createCardInAdo` action (modify).
- `src/components/board/AddCardForm.tsx` — opt-in checkbox + sprint field (modify).
- `src/components/board/Card.tsx` — ADO badge (modify).
- `src/components/board/EditCardModal.tsx` — "Create in ADO" button + badge (modify).
- `vitest.config.ts`, `package.json`, `.env.example` — test runner + env docs (create/modify).

---

## Task 1: Test runner setup (vitest)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: vitest added to devDependencies.

- [ ] **Step 2: Create vitest config (node env, no jsdom)**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test scripts to package.json**

In `package.json` `"scripts"`, add:

```jsonc
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify the runner works (no tests yet)**

Run: `npm test`
Expected: vitest runs and reports "No test files found" (exit 0) or similar — confirms the runner is wired.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test runner"
```

---

## Task 2: Schema — add adoWorkItemId to Card

**Files:**
- Modify: `prisma/schema.prisma` (the `Card` model, near line 128)

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, inside `model Card`, after the `tags` line, add:

```prisma
  adoWorkItemId  Int?         // Azure DevOps work item id when linked
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name add_ado_work_item_id`
Expected: a new migration is created under `prisma/migrations/` and applied; Prisma client regenerates.

- [ ] **Step 3: Verify the generated client has the field**

Run: `grep -n "adoWorkItemId" src/generated/prisma/models.ts`
Expected: the field appears on the Card model type.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat(db): add Card.adoWorkItemId"
```

---

## Task 3: ADO config module

**Files:**
- Create: `src/features/ado/config.ts`

- [ ] **Step 1: Write the config module**

Create `src/features/ado/config.ts`:

```ts
// Azure DevOps connection config. Server-only — reads SKYTRACKER_ADO_PAT.
export const ADO_ORG_URL = "https://dev.azure.com/SkytaleAS";
export const ADO_PROJECT = "Skytale";
export const ADO_API_VERSION = "7.1";

/** Work item type created for every SkyTracker card (v1). */
export const ADO_WORK_ITEM_TYPE = "User Story";

/** "Blocked by" maps to a Predecessor link in ADO. */
export const ADO_PREDECESSOR_REL = "System.LinkTypes.Dependency-Reverse";

export const adoProjectUrl = () => `${ADO_ORG_URL}/${ADO_PROJECT}`;

/** Browser-facing URL for a work item (used by the card badge). */
export const adoWorkItemEditUrl = (id: number) =>
  `${ADO_ORG_URL}/${ADO_PROJECT}/_workitems/edit/${id}`;

/** REST resource URL for a work item (used as a link relation target). */
export const adoWorkItemApiUrl = (id: number) =>
  `${ADO_ORG_URL}/_apis/wit/workItems/${id}`;

export function adoPat(): string {
  const pat = process.env.SKYTRACKER_ADO_PAT;
  if (!pat) throw new Error("SKYTRACKER_ADO_PAT is not set");
  return pat;
}

export function adoAuthHeader(): string {
  return `Basic ${Buffer.from(`:${adoPat()}`).toString("base64")}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/features/ado/config.ts
git commit -m "feat(ado): add ADO connection config"
```

---

## Task 4: Pure mappers (TDD)

**Files:**
- Create: `src/features/ado/mappers.ts`
- Test: `src/features/ado/mappers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/ado/mappers.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/features/ado/mappers.test.ts`
Expected: FAIL — `./mappers` cannot be resolved / exports undefined.

- [ ] **Step 3: Implement the mappers**

Create `src/features/ado/mappers.ts`:

```ts
import type { CardTag } from "@/features/board/types";

export type AdoFieldPatch = { op: "add"; path: string; value: string };

export function cardTagsToAdoTags(tags: CardTag[]): string[] {
  const applicable = tags.filter((t) => t.applicable).map((t) => t.name);
  return [...applicable, "SkyTracker"];
}

export function buildAttributionDescription(
  description: string | null,
  userName: string,
): string {
  const stamp = `<i>Created from SkyTracker by ${userName}</i>`;
  return description ? `${description}<br><br>${stamp}` : stamp;
}

/** Find the iteration node name for a sprint number, tolerating suffixes
 *  like "Sprint 57 (Bugweek)" while never matching "Sprint 60" for 6. */
export function matchIterationName(names: string[], sprintNumber: number): string | null {
  const re = new RegExp(`^Sprint ${sprintNumber}(\\s|\\(|$)`);
  return names.find((n) => re.test(n)) ?? null;
}

export function buildWorkItemPatch(input: {
  title: string;
  description: string;
  tags: string[];
  iterationPath: string | null;
}): AdoFieldPatch[] {
  const patch: AdoFieldPatch[] = [
    { op: "add", path: "/fields/System.Title", value: input.title },
  ];
  if (input.description) {
    patch.push({ op: "add", path: "/fields/System.Description", value: input.description });
  }
  if (input.tags.length > 0) {
    patch.push({ op: "add", path: "/fields/System.Tags", value: input.tags.join("; ") });
  }
  if (input.iterationPath) {
    patch.push({ op: "add", path: "/fields/System.IterationPath", value: input.iterationPath });
  }
  return patch;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/features/ado/mappers.test.ts`
Expected: PASS (all 7 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/features/ado/mappers.ts src/features/ado/mappers.test.ts
git commit -m "feat(ado): payload mappers + iteration matcher (TDD)"
```

---

## Task 5: ADO REST client (TDD with mocked fetch)

**Files:**
- Create: `src/features/ado/client.ts`
- Test: `src/features/ado/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/ado/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/features/ado/client.test.ts`
Expected: FAIL — `./client` cannot be resolved.

- [ ] **Step 3: Implement the client**

Create `src/features/ado/client.ts`:

```ts
import {
  ADO_API_VERSION,
  ADO_PREDECESSOR_REL,
  ADO_WORK_ITEM_TYPE,
  adoAuthHeader,
  adoProjectUrl,
  adoProjectUrl as _proj, // keep import grouped
  adoWorkItemApiUrl,
  ADO_ORG_URL,
  ADO_PROJECT,
} from "./config";
import { buildWorkItemPatch, matchIterationName } from "./mappers";

async function adoFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: adoAuthHeader(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ADO request failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

export async function createWorkItem(input: {
  title: string;
  description: string;
  tags: string[];
  iterationPath: string | null;
}): Promise<number> {
  const patch = buildWorkItemPatch(input);
  const url = `${adoProjectUrl()}/_apis/wit/workitems/$${encodeURIComponent(
    ADO_WORK_ITEM_TYPE,
  )}?api-version=${ADO_API_VERSION}`;
  const res = await adoFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patch),
  });
  const body = (await res.json()) as { id: number };
  return body.id;
}

export async function resolveIterationPath(sprintNumber: number): Promise<string | null> {
  const url = `${adoProjectUrl()}/_apis/wit/classificationnodes/iterations?$depth=2&api-version=${ADO_API_VERSION}`;
  const res = await adoFetch(url, { method: "GET" });
  const root = (await res.json()) as { children?: { name: string }[] };
  const names = (root.children ?? []).map((c) => c.name);
  const match = matchIterationName(names, sprintNumber);
  return match ? `${ADO_PROJECT}\\${match}` : null;
}

export async function addPredecessorLink(
  blockedWorkItemId: number,
  blockerWorkItemId: number,
): Promise<void> {
  const url = `${adoProjectUrl()}/_apis/wit/workitems/${blockedWorkItemId}?api-version=${ADO_API_VERSION}`;
  const patch = [
    {
      op: "add",
      path: "/relations/-",
      value: { rel: ADO_PREDECESSOR_REL, url: adoWorkItemApiUrl(blockerWorkItemId) },
    },
  ];
  await adoFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patch),
  });
}
```

Note: remove the duplicate/aliased `adoProjectUrl as _proj` and unused `ADO_ORG_URL` import if your linter flags them — keep only what's used (`ADO_API_VERSION`, `ADO_PREDECESSOR_REL`, `ADO_WORK_ITEM_TYPE`, `adoAuthHeader`, `adoProjectUrl`, `adoWorkItemApiUrl`, `ADO_PROJECT`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/features/ado/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint the new module**

Run: `npx tsc --noEmit && npx eslint src/features/ado`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/ado/client.ts src/features/ado/client.test.ts
git commit -m "feat(ado): REST client for work item create/link/iteration (TDD)"
```

---

## Task 6: Server-action orchestration

**Files:**
- Modify: `src/features/board/actions.ts`

- [ ] **Step 1: Add imports at the top of the file**

After the existing imports in `src/features/board/actions.ts`, add:

```ts
import { createWorkItem, resolveIterationPath, addPredecessorLink } from "@/features/ado/client";
import { cardTagsToAdoTags, buildAttributionDescription } from "@/features/ado/mappers";
```

- [ ] **Step 2: Add the internal sync helper**

In `src/features/board/actions.ts`, in the "Cards" section (after `createCard`), add:

```ts
/**
 * Best-effort sync of a card to a new ADO work item. Throws on failure so
 * callers can decide whether to surface or swallow. Writes adoWorkItemId back.
 */
async function syncCardToAdo(
  cardId: string,
  sprintNumber: number | null,
  userName: string,
): Promise<number> {
  const card = await prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    include: { blockedBy: { include: { blockerCard: true } } },
  });
  if (card.adoWorkItemId) return card.adoWorkItemId;

  const iterationPath = sprintNumber ? await resolveIterationPath(sprintNumber) : null;
  const workItemId = await createWorkItem({
    title: card.title,
    description: buildAttributionDescription(card.description, userName),
    tags: cardTagsToAdoTags(parseTags(card.tags)),
    iterationPath,
  });

  // Link blockers that already exist in ADO (Predecessor). Skip the rest.
  for (const dep of card.blockedBy) {
    if (dep.blockerCard.adoWorkItemId) {
      try {
        await addPredecessorLink(workItemId, dep.blockerCard.adoWorkItemId);
      } catch (e) {
        logError("ADO_LINK_FAILED", userName, e);
      }
    }
  }

  await prisma.card.update({ where: { id: cardId }, data: { adoWorkItemId: workItemId } });
  return workItemId;
}
```

- [ ] **Step 3: Extend createCard to accept the opt-in fields**

In `createCard`, replace the `createCardSchema` parse block and creation so it reads the two new fields and best-effort syncs. Update the schema:

```ts
const createCardSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  createInAdo: z.enum(["true", "false"]).optional(),
  sprintNumber: z.string().optional().or(z.literal("")),
});
```

And inside `createCard`, change the parse + add the sync after the existing `audit(...)` call (before `revalidatePath("/")`):

```ts
    const { columnId, title, createInAdo, sprintNumber } = createCardSchema.parse({
      columnId: formData.get("columnId"),
      title: formData.get("title"),
      createInAdo: formData.get("createInAdo") ?? undefined,
      sprintNumber: formData.get("sprintNumber") ?? undefined,
    });
```

```ts
    if (createInAdo === "true") {
      const n = sprintNumber ? parseInt(sprintNumber, 10) : null;
      try {
        await syncCardToAdo(card.id, Number.isNaN(n as number) ? null : n, userName ?? "Unknown");
      } catch (e) {
        // Never block local card creation on ADO availability.
        logError("ADO_SYNC_FAILED", userName, e);
      }
    }
```

- [ ] **Step 4: Add the explicit (error-surfacing) action for retry/attach-later**

At the end of the "Cards" section, add:

```ts
export type AdoSyncResult = { ok: true; workItemId: number } | { ok: false; error: string };

export async function createCardInAdo(cardId: string, sprintNumber: number | null): Promise<AdoSyncResult> {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const workItemId = await syncCardToAdo(cardId, sprintNumber, userName ?? "Unknown");
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId }, select: { boardId: true } });
    await audit(card.boardId, session, "ADO_WORK_ITEM_CREATED", "Card", cardId, { workItemId, sprintNumber });
    log("ADO_WORK_ITEM_CREATED", userName, { cardId, workItemId });
    revalidatePath("/");
    return { ok: true, workItemId };
  } catch (e) {
    logError("ADO_WORK_ITEM_CREATED", userName, e);
    return { ok: false, error: e instanceof Error ? e.message : "ADO sync failed" };
  }
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/features/board/actions.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/board/actions.ts
git commit -m "feat(board): sync new cards to ADO work items (opt-in + retry action)"
```

---

## Task 7: Add-card form opt-in UI

**Files:**
- Modify: `src/components/board/AddCardForm.tsx`

- [ ] **Step 1: Replace the form with the opt-in version**

Replace the entire body of `src/components/board/AddCardForm.tsx`:

```tsx
import { createCard } from "@/features/board/actions";

export function AddCardForm({ columnId }: { columnId: string }) {
  return (
    <form
      action={createCard}
      className="border border-dashed border-slate-300 dark:border-ocean-4 rounded-md p-2 flex flex-col gap-2"
    >
      <input type="hidden" name="columnId" value={columnId} />
      <input
        name="title"
        type="text"
        required
        maxLength={200}
        placeholder="+ New card"
        className="w-full bg-transparent text-sm text-slate-700 dark:text-skyblue-3 placeholder:text-slate-400 dark:placeholder:text-ocean-5 focus:outline-none"
      />
      <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-ocean-6">
        <label className="flex items-center gap-1">
          <input type="hidden" name="createInAdo" value="false" />
          <input type="checkbox" name="createInAdo" value="true" className="accent-ocean-5" />
          ADO
        </label>
        <input
          name="sprintNumber"
          type="number"
          min={1}
          placeholder="Sprint #"
          className="w-20 bg-transparent border-b border-slate-200 dark:border-ocean-4 focus:outline-none"
        />
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/board/AddCardForm.tsx
git commit -m "feat(board): add-card opt-in to create ADO work item with sprint"
```

---

## Task 8: Card badge linking to ADO

**Files:**
- Modify: `src/components/board/Card.tsx`

- [ ] **Step 1: Import the URL builder**

At the top of `src/components/board/Card.tsx`, add:

```tsx
import { adoWorkItemEditUrl } from "@/features/ado/config";
```

- [ ] **Step 2: Render the badge in the badge row**

In `Card.tsx`, inside the `flex items-center gap-1.5` badge row (after the `codeReview` badge, before the closing `</div>` at line ~74), add:

```tsx
            {card.adoWorkItemId && (
              <a
                href={adoWorkItemEditUrl(card.adoWorkItemId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-sky-100 text-sky-700 dark:bg-ocean-4 dark:text-skyblue-2 hover:underline"
              >
                #{card.adoWorkItemId}
              </a>
            )}
```

Both `onClick` and `onPointerDown` stop propagation so the badge opens ADO instead of the edit modal / starting a drag (consistent with the PR #2 fix).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (relies on Task 2's `adoWorkItemId` field).

- [ ] **Step 4: Commit**

```bash
git add src/components/board/Card.tsx
git commit -m "feat(board): show ADO work item badge linking out from cards"
```

---

## Task 9: EditCardModal — create/attach + badge

**Files:**
- Modify: `src/components/board/EditCardModal.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/board/EditCardModal.tsx`, extend the imports:

```tsx
import { useState, useTransition } from "react";
import { createCardInAdo } from "@/features/board/actions";
import { adoWorkItemEditUrl } from "@/features/ado/config";
```

(Keep existing imports; `updateCard`, `deleteCard`, etc. stay.)

- [ ] **Step 2: Add an ADO section component**

Above the `EditCardModal` function (or below it), add a focused subcomponent:

```tsx
function AdoSection({ card }: { card: CardModel }) {
  const [sprint, setSprint] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (card.adoWorkItemId) {
    return (
      <div className="text-xs text-slate-600 dark:text-skyblue-2">
        ADO:{" "}
        <a
          href={adoWorkItemEditUrl(card.adoWorkItemId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ocean-5 dark:text-skyblue-1 hover:underline"
        >
          #{card.adoWorkItemId}
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        value={sprint}
        onChange={(e) => setSprint(e.target.value)}
        placeholder="Sprint #"
        className="w-24 border border-slate-300 dark:border-ocean-4 rounded px-2 py-1 text-sm bg-white dark:bg-ocean-3 text-ocean-1 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-5"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const n = sprint ? parseInt(sprint, 10) : null;
            const res = await createCardInAdo(card.id, Number.isNaN(n as number) ? null : n);
            if (!res.ok) setError(res.error);
          })
        }
        className="px-3 py-1.5 text-sm font-medium rounded bg-ocean-5 text-white hover:bg-ocean-6 transition disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create in ADO"}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Render the section in the modal**

In `EditCardModal`'s JSX, add a bordered block just before the footer (`<div className="flex items-center justify-between pt-2 border-t ...">`):

```tsx
          <fieldset className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-ocean-4">
            <legend className="text-xs font-medium text-slate-600 dark:text-skyblue-2 mb-1">Azure DevOps</legend>
            <AdoSection card={card} />
          </fieldset>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/board/EditCardModal.tsx`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/board/EditCardModal.tsx
git commit -m "feat(board): create/attach ADO work item from edit modal"
```

---

## Task 10: Env docs + final verification

**Files:**
- Modify: `.env.example` (create if absent)

- [ ] **Step 1: Document the env var**

Add to `.env.example`:

```
# Azure DevOps PAT with Work Items (Read & Write). Used server-side to create
# work items from SkyTracker cards.
SKYTRACKER_ADO_PAT=""
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all mappers + client tests PASS.

- [ ] **Step 3: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds. (The pre-existing `GapCard.tsx` lint warning is unrelated.)

- [ ] **Step 4: Manual end-to-end (requires a real DB + valid SKYTRACKER_ADO_PAT in .env)**

1. `npm run dev`, sign in as a writer.
2. Add a card with the **ADO** box checked and **Sprint #** = a current sprint (e.g. 64). Confirm a `#<id>` badge appears and links to the work item; verify in ADO the item is a User Story in `Skytale\Sprint 64` with `Backend`/`SkyTracker` tags.
3. On a card with a blocker that already has an ADO id, confirm a **Predecessor** link is created on the new work item.
4. Open an unlinked card → **Create in ADO** → confirm it attaches and the badge shows; clicking the badge opens ADO (does not open the modal).

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "docs: document SKYTRACKER_ADO_PAT env var"
```

---

## Self-review notes
- Spec coverage: schema (T2), App-PAT auth (T3), opt-in add (T6/T7), all→User Story (T3 const + mappers), tags/sprint/dependency mapping (T4/T5/T6), write-back + badge (T6/T8), retry/attach (T6/T9), env (T10). All covered.
- The pre-existing `GapCard.tsx` lint error is out of scope and untouched.
- Iteration path and Predecessor link type use live-verified values; iteration is resolved by match (handles suffixed sprint names).
