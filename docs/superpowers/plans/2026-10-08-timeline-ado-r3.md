# Tidslinjen stage 4 (R3): ADO mirror, sprint ruler and the Specs reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything SkyTracker owns (epics, features, states, dates, dependencies, the discovery story) exists in ADO from a button, pressed as the signed-in person; conflicts are listed and never overwritten; ADO's own data (stories, points, sprint, Closed) is read back; the sprints stand on the axis; «Hent estimat fra utredningen» reads `estimate.yaml` from Skytale.Specs.

**Architecture:** The Entra sign-in SkyTracker already has requests the Azure DevOps scope; the Node `jwt` callback keeps the tokens on the `Account` row and `adoAuthFor(session)` hands out a bearer token (refreshing it when needed). A thin `createAdoClient(auth)` wraps the REST calls. The planning logic is pure: `plan-mappers.ts` turns epics/features into ADO fields and JSON patches and decides write / skip / conflict per field against the snapshot of the last push; `sync.ts` parses iterations and reads stories back; `push.ts` runs a push or a refresh over a cloned plan and returns the new plan plus the events. Routes read the stored plan, call the pure function, commit with the version guard and log one changeset (`source: "ado"`). The page adds the buttons, the conflict bar, the sprint ruler and the real estimate pull.

**Tech Stack:** Next.js 16 App Router, Auth.js v5 (Microsoft Entra ID, JWT sessions, Prisma adapter), Prisma 7, vitest, the plain-JS page `src/app/timeline/timeline.html` + `src/features/timeline/epic-tools.js`, Playwright smokes in the scratchpad.

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §3 «ADO access», §3 fields `ado` / `sprints`, §4.1 codes `ado.push` · `ado.konflikt` · `ado.lest` · `feature.estimat-hentet`, §5 R3, §6 decisions 3 (`estimate.yaml`) and 4 (ADO estimate fields: not yet), §8 risks.

## Global Constraints

- No PAT anywhere in the running app: every ADO call carries the signed-in person's Entra token; `ADO_DEV_TOKEN` is the only override and is server-side, local only (spec §3 «ADO access» 5).
- Conflicts are listed, never overwritten: a field ADO changed after our last push is skipped and reported; only an explicit «Push på nytt (overskriv)» writes over it (spec §5 R3 «conflicts are listed, never overwritten»).
- Nothing is pushed half-way without a record: whatever was created before a failure is committed to the plan with its ADO id.
- The estimate fields in ADO (`Custom.EstimateLikelyWeeks`, `Custom.EstimateLateWeeks`) do not exist yet (checked 09.10): the push writes the estimate as text in the description and nothing else (decision 4).
- `estimate.yaml` beside `spec.md`: keys `likely_weeks`, `late_weeks`, `points`, `estimated_by`, `date` (decision 3).
- ADO states (checked 09.10): Epic and Feature have New · Active · Resolved · Discovery · Closed · Removed. Feature `utredes` → Discovery, `ny`/`klar` → New, `aktiv` → Active; epic `forslag` → New, `aktiv` → Active, `avsluttet` → Closed; `levert` is only ever read from Resolved/Closed.
- Norwegian in everything a person reads (summaries, messages, buttons), English in code and commits, no em dashes.
- Additive data only: new merge group `ado`, new task field `specPath` (group `meta`), new plan keys `sprints` and `sprintGoals`; `normalizePlan` tolerates their absence.
- Never the shared database: routes are not run against Postgres in this stage (deferred like stages 1–3); the pure modules carry the tests; the smokes run the real `pushItem` / `refreshPlan` / `refreshSprints` behind a fake ADO.
- Commits per task with `git -c commit.gpgsign=false commit`, no Claude attribution. One branch `feat/planning-system`, no PR before stage 7.

## Review Focus

1. A person signed in before the scope existed presses «Lagre og push til ADO»: expected 401 `ado-login` and the bar «Logg inn på nytt for å koble til ADO» with the link, nothing created (Task 1 test «no row → AdoLoginRequired», Task 7 route mapping).
2. The feature's epic has no ADO id yet: expected the epic is created first and the feature parented to it in the same push; if the feature step then fails, the epic's id is still saved (Task 7 tests «epic first» and «partial push is committed»).
3. Someone renamed the Feature in ADO after the last push, and the planner also renamed it here: expected a conflict on «Tittel», nothing written, listed at the top; editing SkyTracker's title to match ADO clears it on the next refresh without a push (Task 3 tests on `planFieldWrites`).
4. A dry run with no token: expected the patches, no ADO call, and the note that nothing in ADO was read (Task 7 test «dry without a client»).
5. The sprint boundary falls on a weekend or today is outside every sprint: expected «dag N» counts working days only and the label disappears when no sprint is current (Task 4 tests on `sprintDay` / `sprintLabel`).

---

### Task 1: The Entra token: sign-in scope, token storage, `adoAuthFor`, the login link, the tenant permission

**Files:**
- Modify: `src/lib/auth.config.ts` (scope)
- Modify: `src/lib/auth.ts` (Node `jwt` + `session` callbacks)
- Modify: `src/app/login/page.tsx` (`callbackUrl`)
- Create: `src/features/ado/token.ts`
- Test: `src/features/ado/token.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Auth.js `Account` row (`access_token`, `refresh_token`, `expires_at`, `scope` columns exist in `prisma/schema.prisma`).
- Produces: `adoAuthFor(session, deps): Promise<string>` (a `Bearer …` header), `class AdoLoginRequired`, `storeSignInTokens(db, account)`, `defaultTokenDeps(prisma)`, `tokenEndpoint(issuer)`, `ENTRA_PROVIDER = "microsoft-entra-id"`. `session.user.id` is the Auth.js user id.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/ado/token.test.ts
import { describe, expect, it, vi } from "vitest";
import { adoAuthFor, AdoLoginRequired, tokenEndpoint, type TokenDeps } from "./token";

const ENV = { AUTH_MICROSOFT_ENTRA_ID_ID: "cid", AUTH_MICROSOFT_ENTRA_ID_SECRET: "sec", AUTH_MICROSOFT_ENTRA_ID_ISSUER: "https://login.microsoftonline.com/t1/v2.0" };
const row = (over: Partial<{ access_token: string | null; refresh_token: string | null; expires_at: number | null }> = {}) =>
  ({ id: "acc1", access_token: "old", refresh_token: "r1", expires_at: 2000, ...over });
function deps(r: ReturnType<typeof row> | null, env: Record<string, string | undefined> = ENV, tokenResponse: { ok: boolean; body: unknown } = { ok: true, body: { access_token: "new", refresh_token: "r2", expires_in: 3600 } }) {
  const update = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(r);
  const fetchMock = vi.fn().mockResolvedValue({ ok: tokenResponse.ok, status: tokenResponse.ok ? 200 : 400, json: async () => tokenResponse.body });
  const d: TokenDeps = { db: { account: { findFirst, update } }, fetch: fetchMock as unknown as typeof fetch, env, now: () => 1000 * 1000 };
  return { d, update, findFirst, fetchMock };
}
const session = { user: { id: "u1" } };

describe("adoAuthFor", () => {
  it("ADO_DEV_TOKEN overrides everything and never touches the database", async () => {
    const { d, findFirst } = deps(null, { ...ENV, ADO_DEV_TOKEN: "dev" });
    expect(await adoAuthFor(session, d)).toBe("Bearer dev");
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("hands out the stored token while more than two minutes remain", async () => {
    const { d, fetchMock } = deps(row({ expires_at: 2000 }));
    expect(await adoAuthFor(session, d)).toBe("Bearer old");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refreshes against the tenant's v2 token endpoint when fewer than two minutes remain and writes the new pair back", async () => {
    const { d, fetchMock, update } = deps(row({ expires_at: 1050 }));
    expect(await adoAuthFor(session, d)).toBe("Bearer new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    const body = String(init.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=r1");
    expect(body).toContain("499b84ac-1321-427f-aa17-267ca6975798%2Fuser_impersonation");
    expect(update).toHaveBeenCalledWith({ where: { id: "acc1" }, data: { access_token: "new", refresh_token: "r2", expires_at: 1000 + 3600 } });
  });
  it("asks for a new sign-in when there is no account row, no session user, no refresh token, or the refresh is rejected", async () => {
    await expect(adoAuthFor(session, deps(null).d)).rejects.toBeInstanceOf(AdoLoginRequired);
    await expect(adoAuthFor({ user: {} }, deps(row()).d)).rejects.toBeInstanceOf(AdoLoginRequired);
    await expect(adoAuthFor(session, deps(row({ expires_at: 1050, refresh_token: null })).d)).rejects.toBeInstanceOf(AdoLoginRequired);
    await expect(adoAuthFor(session, deps(row({ expires_at: 1050 }), ENV, { ok: false, body: { error: "invalid_grant" } }).d)).rejects.toBeInstanceOf(AdoLoginRequired);
  });
  it("tokenEndpoint turns the issuer into the v2 token endpoint", () => {
    expect(tokenEndpoint("https://login.microsoftonline.com/t1/v2.0")).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    expect(tokenEndpoint("https://login.microsoftonline.com/t1/v2.0/")).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/ado/token.test.ts`
Expected: FAIL — cannot resolve `./token`.

- [ ] **Step 3: Write `token.ts`**

```ts
// src/features/ado/token.ts
// The signed-in person's Azure DevOps token (spec §3 «ADO access»): read from the Auth.js Account row,
// refreshed against Entra when fewer than two minutes remain, never sent to the browser. ADO_DEV_TOKEN
// (local only) overrides it. No PAT anywhere.
import type { PrismaClient } from "@/generated/prisma/client";
import { ADO_SCOPE } from "./config";

export class AdoLoginRequired extends Error {
  constructor(message = "ado-login") { super(message); this.name = "AdoLoginRequired"; }
}
export const ENTRA_PROVIDER = "microsoft-entra-id";
const REFRESH_MARGIN_S = 120;

export type TokenRow = { id: string; access_token: string | null; refresh_token: string | null; expires_at: number | null };
export type TokenDeps = {
  db: { account: {
    findFirst(args: { where: { userId: string; provider: string } }): Promise<TokenRow | null>;
    update(args: { where: { id: string }; data: { access_token: string; refresh_token: string | null; expires_at: number } }): Promise<unknown>;
  } };
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => number;   // ms since epoch
};

export function tokenEndpoint(issuer: string): string {
  return issuer.replace(/\/v2\.0\/?$/, "") + "/oauth2/v2.0/token";
}

export async function adoAuthFor(session: { user?: { id?: string | null } | null } | null, deps: TokenDeps): Promise<string> {
  const dev = deps.env.ADO_DEV_TOKEN?.trim();
  if (dev) return "Bearer " + dev;
  const userId = session?.user?.id;
  if (!userId) throw new AdoLoginRequired();
  const row = await deps.db.account.findFirst({ where: { userId, provider: ENTRA_PROVIDER } });
  if (!row?.access_token) throw new AdoLoginRequired();
  const nowS = Math.floor(deps.now() / 1000);
  if (row.expires_at && row.expires_at - nowS > REFRESH_MARGIN_S) return "Bearer " + row.access_token;
  if (!row.refresh_token) throw new AdoLoginRequired();
  const { AUTH_MICROSOFT_ENTRA_ID_ID: id, AUTH_MICROSOFT_ENTRA_ID_SECRET: secret, AUTH_MICROSOFT_ENTRA_ID_ISSUER: issuer } = deps.env;
  if (!id || !secret || !issuer) throw new AdoLoginRequired("entra-config");
  const res = await deps.fetch(tokenEndpoint(issuer), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "refresh_token", refresh_token: row.refresh_token, scope: ADO_SCOPE + " offline_access openid profile email" }).toString(),
  });
  if (!res.ok) throw new AdoLoginRequired();
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.access_token) throw new AdoLoginRequired();
  const expires_at = nowS + (j.expires_in ?? 3600);
  await deps.db.account.update({ where: { id: row.id }, data: { access_token: j.access_token, refresh_token: j.refresh_token ?? row.refresh_token, expires_at } });
  return "Bearer " + j.access_token;
}

/** Called from the Node jwt callback on every sign-in: the adapter writes the tokens only when it first links the account. */
export async function storeSignInTokens(db: PrismaClient, account: { provider: string; providerAccountId: string; access_token?: string; refresh_token?: string; expires_at?: number; scope?: string }): Promise<void> {
  if (!account.access_token) return;
  await db.account.updateMany({
    where: { provider: account.provider, providerAccountId: account.providerAccountId },
    data: { access_token: account.access_token, refresh_token: account.refresh_token ?? undefined, expires_at: account.expires_at ?? null, scope: account.scope ?? null },
  });
}

export const defaultTokenDeps = (db: PrismaClient): TokenDeps =>
  ({ db: db as unknown as TokenDeps["db"], fetch: (...a: Parameters<typeof fetch>) => fetch(...a), env: process.env, now: () => Date.now() });
```

`config.ts` gets (Task 2 finishes the file; add these two lines now so the import resolves):

```ts
export const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ADO_SCOPE = `${ADO_RESOURCE}/user_impersonation`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/ado/token.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Wire the sign-in**

`src/lib/auth.config.ts`: the provider gets `authorization: { params: { scope: "openid profile email offline_access " + ADO_SCOPE } }` (import `ADO_SCOPE` from `@/features/ado/config`; that file is Edge-safe: constants and a pure function only). Nothing else changes: the id token, the group claim and the role are untouched; the provider's Graph photo fetch gets a 401 from Graph and sets no image (`response.ok` is false, nothing throws).

`src/lib/auth.ts`:

```ts
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import authConfig from "@/lib/auth.config";
import { ENTRA_PROVIDER, storeSignInTokens } from "@/features/ado/token";

// Full Node-runtime config: the Prisma adapter, plus the two things the Edge config cannot do:
// keep the person's ADO tokens on the Account row at every sign-in (spec §3 «ADO access» 2) and
// expose the user id on the session so routes can find that row.
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = authConfig.callbacks.jwt(params);
      if (params.account?.provider === ENTRA_PROVIDER) await storeSignInTokens(prisma, params.account).catch(() => {});
      return token;
    },
    session(params) {
      const session = authConfig.callbacks.session(params);
      if (session.user && params.token.sub) session.user.id = params.token.sub;
      return session;
    },
  },
});
```

`src/app/login/page.tsx`: accept `searchParams: Promise<{ callbackUrl?: string }>`, `const redirectTo = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/"`, pass `{ redirectTo }` to `signIn`. The page's «Logg inn på nytt» link is `/login?callbackUrl=/timeline`.

`.env.example`: delete the `SKYTRACKER_ADO_PAT` block; add

```
# ── Azure DevOps: as the signed-in person, no PAT ────────────
# The app registration «SkyTracker» holds the delegated permission Azure DevOps › user_impersonation;
# each person consents at their next sign-in (or an admin grants it once, see the spec §3 «ADO access»).
# Local override: a token from
#   az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
# It expires after about an hour. Never set it in a deployed environment.
ADO_DEV_TOKEN=""
# Owner initials → ADO identity for the discovery story's AssignedTo; unknown initials go into the story title.
SKYTRACKER_ADO_PEOPLE="THM=thm@skytale.no;KSO=kso@skytale.no;GO=go@skytale.no"
```

- [ ] **Step 6: Tenant: add the delegated permission (spec §3 «ADO access» 6)**

Run:
```bash
az ad app permission add --id 73db25b8-7299-46e3-afd5-95872c1e489a --api 499b84ac-1321-427f-aa17-267ca6975798 --api-permissions ee69721e-6c3a-468f-a9ec-302d16a4c599=Scope
az ad app permission list --id 73db25b8-7299-46e3-afd5-95872c1e489a -o json
```
Expected: the list now holds two resources: Graph `e1fe6dd8-…` (User.Read, unchanged) and `499b84ac-…` with `ee69721e-…` Scope. The admin-wide grant (`az ad app permission grant …`) is GO's call and is NOT run here; per-user consent at sign-in is enough for the local test.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit && npx vitest run src/features/ado`
Expected: tsc clean; the ado tests pass (client/mappers tests still pass, they are untouched until Task 2).

```bash
git add src/lib/auth.config.ts src/lib/auth.ts src/app/login/page.tsx src/features/ado/token.ts src/features/ado/token.test.ts src/features/ado/config.ts .env.example
git -c commit.gpgsign=false commit -m "ado: the signed-in person's Entra token (ADO scope at sign-in, tokens kept on the Account row, adoAuthFor with refresh); no PAT"
```

---

### Task 2: The ADO client, generalised, through the token

**Files:**
- Modify: `src/features/ado/config.ts` (drop the PAT, add relation names, `SPECS_REPO_ID`, `peopleMap`)
- Modify: `src/features/ado/client.ts` (rewrite around `createAdoClient`)
- Modify: `src/features/ado/client.test.ts`
- Modify: `src/features/board/actions.ts:10-11,190-260` (the card → User Story flow uses the person's token)

**Interfaces:**
- Consumes: `adoAuthFor`, `defaultTokenDeps` (Task 1).
- Produces: `createAdoClient(authHeader, fetchImpl?)` → `AdoClient { get(id) · batch(ids) · create(type, patch) · patch(id, patch) · iterations() · gitItem(repoId, path) }`, types `AdoWorkItem { id, rev?, fields, relations? }`, `AdoRelation`, `JsonPatch { op: "add"|"replace"|"remove"; path; value? }`, `IterationNode`, `class AdoRequestError(status, message)`; board helpers `createWorkItem(client, input)`, `resolveIterationPath(client, n)`, `addPredecessorLink(client, blocked, blocker)`; config `ADO_PARENT_REL = "System.LinkTypes.Hierarchy-Reverse"`, `ADO_CHILD_REL = "System.LinkTypes.Hierarchy-Forward"`, `SPECS_REPO_ID`, `peopleMap(env)`.

- [ ] **Step 1: Rewrite the client tests (RED)**

```ts
// src/features/ado/client.test.ts
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
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/features/ado/client.test.ts`
Expected: FAIL — `createAdoClient` / `AdoRequestError` not exported.

- [ ] **Step 3: Write config.ts and client.ts**

```ts
// src/features/ado/config.ts
// Azure DevOps connection constants. Edge-safe (no env, no Node APIs); the token lives in token.ts.
export const ADO_ORG_URL = "https://dev.azure.com/SkytaleAS";
export const ADO_PROJECT = "Skytale";
export const ADO_API_VERSION = "7.1";
export const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ADO_SCOPE = `${ADO_RESOURCE}/user_impersonation`;
/** Skytale.Specs: `spec/<Feature>/spec.md` + `estimate.yaml` (decision 3). */
export const SPECS_REPO_ID = "971ee73e-e3aa-45eb-b23b-359d1cc178e7";
/** Work item type created for every SkyTracker card (the board's flow) and for the discovery story. */
export const ADO_WORK_ITEM_TYPE = "User Story";
export const ADO_PREDECESSOR_REL = "System.LinkTypes.Dependency-Reverse";
export const ADO_PARENT_REL = "System.LinkTypes.Hierarchy-Reverse";
export const ADO_CHILD_REL = "System.LinkTypes.Hierarchy-Forward";
export const adoProjectUrl = () => `${ADO_ORG_URL}/${ADO_PROJECT}`;
export const adoWorkItemEditUrl = (id: number) => `${ADO_ORG_URL}/${ADO_PROJECT}/_workitems/edit/${id}`;
export const adoWorkItemApiUrl = (id: number) => `${ADO_ORG_URL}/_apis/wit/workItems/${id}`;
/** SKYTRACKER_ADO_PEOPLE="THM=thm@skytale.no;KSO=kso@skytale.no" → upper-case initials → e-mail. */
export function peopleMap(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env.SKYTRACKER_ADO_PEOPLE ?? "").split(/[;,]/)) {
    const [k, v] = part.split("=");
    if (k && v && v.includes("@")) out[k.trim().toUpperCase()] = v.trim();
  }
  return out;
}
```

```ts
// src/features/ado/client.ts
// One thin REST client over fetch with the signed-in person's bearer token (token.ts). Used by the
// board's create-in-ADO flow and by the timeline's push/refresh (push.ts). Mirrors the endpoints and
// api-versions of Skytale.QA's client.
import { ADO_API_VERSION, ADO_ORG_URL, ADO_PREDECESSOR_REL, ADO_PROJECT, ADO_WORK_ITEM_TYPE, adoProjectUrl, adoWorkItemApiUrl } from "./config";
import { buildWorkItemPatch, matchIterationName } from "./mappers";

export type JsonPatch = { op: "add" | "replace" | "remove"; path: string; value?: unknown };
export type AdoRelation = { rel: string; url: string; attributes?: Record<string, unknown> };
export type AdoWorkItem = { id: number; rev?: number; fields: Record<string, unknown>; relations?: AdoRelation[] };
export type IterationNode = { id?: number; name: string; path?: string; attributes?: { startDate?: string; finishDate?: string }; children?: IterationNode[] };
export type AdoClient = {
  get(id: number): Promise<AdoWorkItem | null>;
  batch(ids: number[]): Promise<AdoWorkItem[]>;
  create(type: string, patch: JsonPatch[]): Promise<AdoWorkItem>;
  patch(id: number, patch: JsonPatch[]): Promise<AdoWorkItem>;
  iterations(): Promise<IterationNode>;
  gitItem(repoId: string, path: string): Promise<string | null>;
};
export class AdoRequestError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "AdoRequestError"; }
}
const looksLikeHtml = (text: string) => /^[\s﻿]*</.test(text);

export function createAdoClient(authHeader: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): AdoClient {
  async function request<T>(method: string, url: string, body?: unknown, contentType = "application/json", nullOn404 = false): Promise<T | null> {
    const headers: Record<string, string> = { Authorization: authHeader, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = contentType;
    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (res.status === 404 && nullOn404) return null;
    if (looksLikeHtml(text) || res.status === 401 || res.status === 203) throw new AdoRequestError(401, "ADO rejected the token");
    if (!res.ok) throw new AdoRequestError(res.status, `ADO ${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as T) : null;
  }
  const v = "api-version=" + ADO_API_VERSION;
  return {
    get: (id) => request<AdoWorkItem>("GET", `${ADO_ORG_URL}/_apis/wit/workitems/${id}?$expand=relations&${v}`, undefined, undefined, true),
    async batch(ids) {
      const out: AdoWorkItem[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const r = await request<{ value: AdoWorkItem[] }>("POST", `${ADO_ORG_URL}/_apis/wit/workitemsbatch?${v}`, { ids: ids.slice(i, i + 200), $expand: "relations", errorPolicy: "omit" });
        out.push(...(r?.value ?? []));
      }
      return out;
    },
    create: async (type, patch) => (await request<AdoWorkItem>("POST", `${adoProjectUrl()}/_apis/wit/workitems/$${encodeURIComponent(type)}?${v}`, patch, "application/json-patch+json"))!,
    patch: async (id, patch) => (await request<AdoWorkItem>("PATCH", `${ADO_ORG_URL}/_apis/wit/workitems/${id}?${v}`, patch, "application/json-patch+json"))!,
    iterations: async () => (await request<IterationNode>("GET", `${adoProjectUrl()}/_apis/wit/classificationnodes/iterations?$depth=2&${v}`))!,
    async gitItem(repoId, path) {
      const r = await request<{ content?: string }>("GET", `${adoProjectUrl()}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent(path)}&includeContent=true&${v}`, undefined, undefined, true);
      return r?.content ?? null;
    },
  };
}

/* ----- the board's create-in-ADO flow (cards → User Story) ----- */
export async function createWorkItem(client: AdoClient, input: { title: string; description: string; tags: string[]; iterationPath: string | null }): Promise<number> {
  return (await client.create(ADO_WORK_ITEM_TYPE, buildWorkItemPatch(input))).id;
}
export async function resolveIterationPath(client: AdoClient, sprintNumber: number): Promise<string | null> {
  const root = await client.iterations();
  const match = matchIterationName((root.children ?? []).map((c) => c.name), sprintNumber);
  return match ? `${ADO_PROJECT}\\${match}` : null;
}
export async function addPredecessorLink(client: AdoClient, blockedWorkItemId: number, blockerWorkItemId: number): Promise<void> {
  await client.patch(blockedWorkItemId, [{ op: "add", path: "/relations/-", value: { rel: ADO_PREDECESSOR_REL, url: adoWorkItemApiUrl(blockerWorkItemId) } }]);
}
```

`buildWorkItemPatch` in `mappers.ts` returns `AdoFieldPatch[]` (`op: "add"`); it is assignable to `JsonPatch[]`.

`src/features/board/actions.ts`: `syncCardToAdo(session, cardId, sprintNumber, userName)` builds `const client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma)))` and passes it to the three helpers; both callers (`createCard`, `createCardInAdo`) pass their session. The failure path is unchanged (never block local card creation).

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run src/features/ado && npx tsc --noEmit && grep -rn "SKYTRACKER_ADO_PAT\|adoPat\|adoAuthHeader" src`
Expected: ado tests pass; tsc clean; grep finds nothing.

- [ ] **Step 5: Commit**

```bash
git add src/features/ado/config.ts src/features/ado/client.ts src/features/ado/client.test.ts src/features/board/actions.ts
git -c commit.gpgsign=false commit -m "ado: one client over the person's token (get/batch/create/patch/iterations/gitItem); the board's card flow uses it; the PAT is gone"
```

---

### Task 3: Plan → ADO fields, patches and the write/skip/conflict rule

**Files:**
- Create: `src/features/ado/plan-mappers.ts`
- Test: `src/features/ado/plan-mappers.test.ts`

**Interfaces:**
- Consumes: `Plan`, `PlanLane`, `PlanTask` (merge.ts), `AdoWorkItem`, `JsonPatch` (Task 2), `goalText`, `epicWindowText`, `bufferLabel`, `windowLabel`, `rawLabel`, `unitToDate`, `fmtDate` (epic-tools.js).
- Produces: `F` (field reference names), `OWNED_FIELDS`, `FIELD_LABEL`, `type OwnedField`, `type Snapshot`, `type Fields`, `type Conflict { field, ours, theirs }`, `FEATURE_STATE_TO_ADO`, `EPIC_STATE_TO_ADO`, `unitToAdoDate(u)`, `adoDay(v)`, `normHtml(s)`, `epicFields(plan, lane)`, `featureFields(plan, task)`, `storyFields(task, people)`, `adoValue(item, field)`, `planFieldWrites(fields, current, snapshot, force?) → { writes, conflicts }`, `snapshotAfter(fields, conflicts, prev)`, `fieldPatch(writes, extra?)`, `relationPatch(current, { parent?, predecessors? })`, `relTarget(relation)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/ado/plan-mappers.test.ts
import { describe, expect, it } from "vitest";
import { dateToUnit } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";
import type { AdoWorkItem } from "./client";
import { epicFields, featureFields, fieldPatch, planFieldWrites, relationPatch, snapshotAfter, storyFields, unitToAdoDate, type Fields } from "./plan-mappers";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const plan: Plan = {
  lanes: [{ key: "telenor", name: "Telenor kan bygge på oss", goalDate: D(2026, 12, 15), metric: "3 kunder i drift", externalDate: true, state: "aktiv", adoId: 4700, priority: 1 }],
  tasks: [
    { id: "kap", lane: "telenor", label: "Kapasitet", kind: "estimate", start: D(2026, 11, 2), endLikely: D(2026, 11, 2) + 5 * 0.25, end: D(2026, 11, 2) + 7 * 0.25, bufferWeeks: 1, raw: { likely: 4, late: 6 }, state: "aktiv", deps: ["iam"], order: 1 },
    { id: "iam", lane: "telenor", label: "IAM", kind: "discovery", start: D(2026, 10, 19), end: D(2026, 11, 13), state: "utredes", assignee: "THM", adoId: 4701, order: 2 },
  ],
};
const item = (fields: Record<string, unknown>, relations: { rel: string; url: string }[] = []): AdoWorkItem => ({ id: 1, fields, relations });

describe("fields", () => {
  it("dates are the calendar day at UTC midnight", () => {
    expect(unitToAdoDate(D(2026, 12, 15))).toBe("2026-12-15T00:00:00Z");
  });
  it("an epic: title, state, TargetDate = goal, description with måltall and the window", () => {
    const f = epicFields(plan, plan.lanes[0]);
    expect(f.title).toBe("Telenor kan bygge på oss");
    expect(f.state).toBe("Active");
    expect(f.targetDate).toBe("2026-12-15T00:00:00Z");
    expect(f.startDate).toBeNull();
    expect(f.description).toContain("Måltall: 3 kunder i drift");
    expect(f.description).toContain("Måldato 15. des (ekstern dato)");
  });
  it("a feature: Discovery for utredes, dates from start/end, parent = the epic's id, the estimate as text", () => {
    const kap = featureFields(plan, plan.tasks[0]);
    expect(kap.state).toBe("Active");
    expect(kap.parentAdoId).toBe(4700);
    expect(kap.startDate).toBe("2026-11-02T00:00:00Z");
    expect(kap.description).toContain("Spenn: 4–6 uker + 1 uke buffer → uke");
    expect(kap.description).toContain("Utredning sa 4–6 uker.");
    const iam = featureFields(plan, plan.tasks[1]);
    expect(iam.state).toBe("Discovery");
    expect(iam.targetDate).toBe("2026-11-13T00:00:00Z");
    expect(iam.description).toContain("Utredning til 13. nov, eier THM.");
  });
  it("the discovery story: assignee resolved through the people map, otherwise in the title", () => {
    expect(storyFields(plan.tasks[1], { THM: "thm@skytale.no" })).toMatchObject({ title: "Utredning: IAM", assignedTo: "thm@skytale.no", targetDate: "2026-11-13T00:00:00Z" });
    expect(storyFields(plan.tasks[1], {})).toMatchObject({ title: "Utredning: IAM (THM)", assignedTo: null });
  });
});

describe("planFieldWrites: write, skip or conflict per field", () => {
  const ours: Fields = { title: "Kapasitet", description: "<p>Planlagt i Tidslinjen (SkyTracker).</p>", state: "Active", targetDate: "2026-12-20T00:00:00Z", startDate: null };
  it("with no item in ADO everything SkyTracker has a value for is written; null values are never written", () => {
    const { writes, conflicts } = planFieldWrites(ours, null, null);
    expect(Object.keys(writes)).toEqual(["title", "description", "state", "targetDate"]);
    expect(conflicts).toEqual([]);
  });
  it("equal values are skipped: dates by day, descriptions by their text", () => {
    const cur = item({ "System.Title": "Kapasitet", "System.Description": "<div>Planlagt i Tidslinjen (SkyTracker).</div>", "System.State": "Active", "Microsoft.VSTS.Scheduling.TargetDate": "2026-12-20T00:00:00Z" });
    expect(planFieldWrites(ours, cur, { title: "Kapasitet", description: "Planlagt i Tidslinjen (SkyTracker).", state: "Active", targetDate: "2026-12-20" }).writes).toEqual({});
  });
  it("ADO changed since our last push and differs from ours: conflict, not written; force writes it anyway", () => {
    const cur = item({ "System.Title": "Kapasitet v2", "System.State": "Active", "Microsoft.VSTS.Scheduling.TargetDate": "2026-12-20T00:00:00Z" });
    const snap = { title: "Kapasitet", state: "Active", targetDate: "2026-12-20" };
    const r = planFieldWrites({ ...ours, description: null }, cur, snap);
    expect(r.conflicts).toEqual([{ field: "title", ours: "Kapasitet", theirs: "Kapasitet v2" }]);
    expect(r.writes).toEqual({});
    expect(planFieldWrites({ ...ours, description: null }, cur, snap, true).writes).toEqual({ title: "Kapasitet" });
  });
  it("ADO unchanged since our push but SkyTracker edited: written (no conflict); ADO changed to exactly our value: skipped", () => {
    const cur = item({ "System.Title": "Kapasitet", "System.State": "New" });
    expect(planFieldWrites({ title: "Kapasitet", state: "Active" }, cur, { title: "Kapasitet", state: "New" }).writes).toEqual({ state: "Active" });
    const cur2 = item({ "System.Title": "Kapasitet v2" });
    expect(planFieldWrites({ title: "Kapasitet v2" }, cur2, { title: "Kapasitet" })).toEqual({ writes: {}, conflicts: [] });
  });
  it("an existing item without a snapshot (first push of a hand-typed ADO id) is treated as ours to write", () => {
    const cur = item({ "System.Title": "Something else" });
    expect(planFieldWrites({ title: "Kapasitet" }, cur, null).writes).toEqual({ title: "Kapasitet" });
  });
  it("snapshotAfter keeps the previous value for a conflicting field and ours elsewhere, normalised", () => {
    const snap = snapshotAfter({ title: "Kapasitet", description: "<p>a  b</p>", targetDate: "2026-12-20T00:00:00Z", state: "Active" }, [{ field: "title", ours: "Kapasitet", theirs: "v2" }], { title: "Old" });
    expect(snap).toEqual({ title: "Old", description: "a b", targetDate: "2026-12-20", state: "Active" });
  });
});

describe("patches", () => {
  it("fieldPatch adds one op per written field plus AssignedTo when given", () => {
    expect(fieldPatch({ title: "T", targetDate: "2026-12-20T00:00:00Z" }, { assignedTo: "thm@skytale.no" })).toEqual([
      { op: "add", path: "/fields/System.Title", value: "T" },
      { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: "2026-12-20T00:00:00Z" },
      { op: "add", path: "/fields/System.AssignedTo", value: "thm@skytale.no" },
    ]);
  });
  it("relationPatch adds a missing parent, replaces a wrong one, and adds only the missing predecessors", () => {
    const url = (id: number) => "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/" + id;
    expect(relationPatch(null, { parent: 4700, predecessors: [4701] })).toEqual([
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: url(4700) } },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Dependency-Reverse", url: url(4701) } },
    ]);
    const cur = item({}, [{ rel: "System.LinkTypes.Related", url: url(1) }, { rel: "System.LinkTypes.Hierarchy-Reverse", url: url(4600) }, { rel: "System.LinkTypes.Dependency-Reverse", url: url(4701) }]);
    expect(relationPatch(cur, { parent: 4700, predecessors: [4701, 4702] })).toEqual([
      { op: "remove", path: "/relations/1" },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: url(4700) } },
      { op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Dependency-Reverse", url: url(4702) } },
    ]);
    expect(relationPatch(cur, { parent: 4600, predecessors: [4701] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/features/ado/plan-mappers.test.ts`
Expected: FAIL — cannot resolve `./plan-mappers`.

- [ ] **Step 3: Write `plan-mappers.ts`**

```ts
// src/features/ado/plan-mappers.ts
// Pure mapping between the plan and ADO work items: the fields SkyTracker owns on an Epic / Feature /
// discovery story, the per-field decision write · skip · conflict against the snapshot of the last push
// (spec §5 R3: conflicts are listed, never overwritten), and the JSON patches.
import type { Plan, PlanLane, PlanTask } from "@/features/timeline/merge";
import { bufferLabel, epicWindowText, fmtDate, goalText, rawLabel, unitToDate, windowLabel } from "@/features/timeline/epic-tools.js";
import { ADO_PARENT_REL, ADO_PREDECESSOR_REL, adoWorkItemApiUrl } from "./config";
import type { AdoWorkItem, JsonPatch } from "./client";

export const F = {
  title: "System.Title", description: "System.Description", state: "System.State",
  targetDate: "Microsoft.VSTS.Scheduling.TargetDate", startDate: "Microsoft.VSTS.Scheduling.StartDate", assignedTo: "System.AssignedTo",
} as const;
export type OwnedField = "title" | "description" | "state" | "targetDate" | "startDate";
export const OWNED_FIELDS: OwnedField[] = ["title", "description", "state", "targetDate", "startDate"];
export const FIELD_LABEL: Record<OwnedField, string> = { title: "Tittel", description: "Beskrivelse", state: "Tilstand", targetDate: "Måldato", startDate: "Startdato" };
export type Snapshot = Partial<Record<OwnedField, string | null>>;
export type Fields = Snapshot & { parentAdoId?: number | null; assignedTo?: string | null };
export type Conflict = { field: OwnedField; ours: string | null; theirs: string | null };

export const FEATURE_STATE_TO_ADO: Record<string, string> = { ny: "New", utredes: "Discovery", klar: "New", aktiv: "Active", levert: "Closed" };
export const EPIC_STATE_TO_ADO: Record<string, string> = { forslag: "New", aktiv: "Active", avsluttet: "Closed" };

export function unitToAdoDate(u: number): string {
  const d = unitToDate(u);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + "T00:00:00Z";
}
export const adoDay = (v: unknown): string | null => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
export const normHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function epicDescription(plan: Plan, lane: PlanLane): string {
  const parts = ["<p>Planlagt i Tidslinjen (SkyTracker).</p>"];
  if (lane.metric) parts.push("<p>Måltall: " + esc(lane.metric) + "</p>");
  const win = epicWindowText(plan, lane.key);
  parts.push("<p>" + esc((win ? win + " · " : "") + goalText(lane) + (lane.externalDate ? " (ekstern dato)" : "")) + "</p>");
  return parts.join("");
}
export function featureDescription(plan: Plan, task: PlanTask): string {
  const lane = plan.lanes.find((l) => l.key === task.lane);
  const parts = ["<p>Planlagt i Tidslinjen (SkyTracker)" + (lane ? " under epicen " + esc(lane.name) : "") + ".</p>"];
  if (task.kind === "discovery") parts.push("<p>Utredning til " + esc(fmtDate(unitToDate(task.end))) + (task.assignee ? ", eier " + esc(task.assignee) : "") + ".</p>");
  else {
    parts.push("<p>Spenn: " + esc(bufferLabel(task)) + " → " + esc(windowLabel(task)) + ".</p>");
    const r = rawLabel(task);
    if (r) parts.push("<p>" + esc(r.charAt(0).toUpperCase() + r.slice(1)) + " uker.</p>");
  }
  return parts.join("");
}
export function epicFields(plan: Plan, lane: PlanLane): Fields {
  return { title: lane.name, description: epicDescription(plan, lane), state: EPIC_STATE_TO_ADO[lane.state ?? "aktiv"],
    targetDate: typeof lane.goalDate === "number" ? unitToAdoDate(lane.goalDate) : null, startDate: null };
}
export function featureFields(plan: Plan, task: PlanTask): Fields {
  const lane = plan.lanes.find((l) => l.key === task.lane);
  return { title: task.label, description: featureDescription(plan, task), state: FEATURE_STATE_TO_ADO[task.state ?? "aktiv"],
    targetDate: unitToAdoDate(task.end), startDate: unitToAdoDate(task.start), parentAdoId: lane?.adoId ?? null };
}
export function storyFields(task: PlanTask, people: Record<string, string>): Fields {
  const email = task.assignee ? people[task.assignee.toUpperCase()] ?? null : null;
  return { title: "Utredning: " + task.label + (task.assignee && !email ? " (" + task.assignee + ")" : ""),
    description: "<p>Discovery-story fra Tidslinjen (SkyTracker). Sluttdatoen er utredningens sluttdato.</p>",
    state: null, targetDate: unitToAdoDate(task.end), startDate: unitToAdoDate(task.start), assignedTo: email };
}

/** ADO's value of an owned field, normalised the way the snapshot stores it. */
export function adoValue(item: AdoWorkItem | null, f: OwnedField): string | null {
  if (!item) return null;
  const v = item.fields[F[f]];
  if (f === "targetDate" || f === "startDate") return adoDay(v);
  if (f === "description") return normHtml(typeof v === "string" ? v : "") || null;
  return typeof v === "string" ? v : null;
}
const norm = (f: OwnedField, v: string | null | undefined): string | null =>
  v === undefined || v === null ? null : f === "targetDate" || f === "startDate" ? adoDay(v) : f === "description" ? normHtml(v) || null : v;
const same = (f: OwnedField, a: string | null | undefined, b: string | null | undefined) => norm(f, a) === norm(f, b);

/** Per field: ours null → never written; equal to ADO → skipped; ADO still holds what we wrote last (or we never
 *  wrote) → written; ADO changed since our last push and differs from ours → conflict (written only with force). */
export function planFieldWrites(fields: Fields, current: AdoWorkItem | null, snapshot: Snapshot | null, force = false): { writes: Partial<Record<OwnedField, string>>; conflicts: Conflict[] } {
  const writes: Partial<Record<OwnedField, string>> = {};
  const conflicts: Conflict[] = [];
  for (const f of OWNED_FIELDS) {
    const ours = fields[f] ?? null;
    if (ours === null) continue;
    const theirs = adoValue(current, f);
    if (same(f, ours, theirs)) continue;
    const adoChanged = current !== null && snapshot !== null && !same(f, theirs, snapshot[f]);
    if (adoChanged && !force) conflicts.push({ field: f, ours: norm(f, ours), theirs });
    else writes[f] = ours;
  }
  return { writes, conflicts };
}
/** What the snapshot says after a push: ours for every non-conflicting field we have, the old value where ADO won. */
export function snapshotAfter(fields: Fields, conflicts: Conflict[], prev: Snapshot | null): Snapshot {
  const out: Snapshot = { ...(prev ?? {}) };
  for (const f of OWNED_FIELDS) {
    if (conflicts.some((c) => c.field === f)) continue;
    const v = norm(f, fields[f]);
    if (v !== null) out[f] = v;
  }
  return out;
}
export function fieldPatch(writes: Partial<Record<OwnedField, string>>, extra: { assignedTo?: string | null } = {}): JsonPatch[] {
  const ops: JsonPatch[] = [];
  for (const f of OWNED_FIELDS) if (writes[f] !== undefined) ops.push({ op: "add", path: "/fields/" + F[f], value: writes[f] });
  if (extra.assignedTo) ops.push({ op: "add", path: "/fields/" + F.assignedTo, value: extra.assignedTo });
  return ops;
}
export const relTarget = (r: { url: string }) => parseInt(r.url.split("/").pop() ?? "", 10);
export function relationPatch(current: AdoWorkItem | null, wanted: { parent?: number | null; predecessors?: number[] }): JsonPatch[] {
  const ops: JsonPatch[] = [];
  const rels = current?.relations ?? [];
  if (wanted.parent) {
    const idx = rels.findIndex((r) => r.rel === ADO_PARENT_REL);
    if (idx >= 0 && relTarget(rels[idx]) !== wanted.parent) ops.push({ op: "remove", path: "/relations/" + idx });
    if (idx < 0 || relTarget(rels[idx]) !== wanted.parent) ops.push({ op: "add", path: "/relations/-", value: { rel: ADO_PARENT_REL, url: adoWorkItemApiUrl(wanted.parent) } });
  }
  const have = new Set(rels.filter((r) => r.rel === ADO_PREDECESSOR_REL).map(relTarget));
  for (const id of wanted.predecessors ?? []) if (!have.has(id)) ops.push({ op: "add", path: "/relations/-", value: { rel: ADO_PREDECESSOR_REL, url: adoWorkItemApiUrl(id) } });
  return ops;
}
```

- [ ] **Step 4: Run to verify GREEN, then commit**

Run: `npx vitest run src/features/ado/plan-mappers.test.ts`
Expected: PASS 11/11.

```bash
git add src/features/ado/plan-mappers.ts src/features/ado/plan-mappers.test.ts
git -c commit.gpgsign=false commit -m "ado: plan → work item fields and patches; write, skip or conflict per field against the last push's snapshot"
```

---

### Task 4: Reading back: sprints, stories, delivered; the sprint helpers for the page

**Files:**
- Create: `src/features/ado/sync.ts`
- Create: `src/features/ado/fixtures/iterations.json` (trimmed from the recording of 09.10: root «Skytale» + the children Sprint 68–71 with their `attributes`, plus one child without dates)
- Create: `src/features/ado/fixtures/feature-with-stories.json` (a Feature in the recorded shape of #4742 with three `Hierarchy-Forward` children, and the three children: two User Stories with points, one the discovery story)
- Test: `src/features/ado/sync.test.ts`
- Modify: `src/features/timeline/epic-tools.js` (+ `.d.ts`, `.test.ts`): `specPath`, `sprints`, `sprintGoals` in `normalizePlan`; `currentSprint`, `sprintDay`, `sprintLabel`, `dayKey`
- Modify: `src/features/timeline/merge.ts` (types only in this task: `Sprint`, `sprints`, `sprintGoals`, `specPath`, `ado`; the merge rules come in Task 5)

**Interfaces:**
- Consumes: `AdoWorkItem`, `IterationNode` (Task 2), `relTarget` (Task 3), `ADO_CHILD_REL`.
- Produces: `type Sprint { name, path, start, finish }` (merge.ts), `parseSprints(root): Sprint[]`, `readStories(feature, byId, discoveryStoryId?) → { count, pointsTotal, pointsDone, iteration }`, `deliveredDay(item): string | null`, `DONE_STATES`; epic-tools `currentSprint(sprints, date)`, `sprintDay(sprint, date)`, `sprintLabel(sprints, date)`; merge types `TaskAdo`, `LaneAdo`, `AdoConflict`, `Plan.sprints?: { at, items }`, `Plan.sprintGoals?: Record<name, { text, at }>`, `PlanTask.specPath?`, `PlanTask.ado?`, `PlanLane.ado?`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/ado/sync.test.ts
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
```

Add to `src/features/timeline/epic-tools.test.ts`:

```ts
describe("sprints", () => {
  const sprints = [{ name: "Sprint 70", path: "Skytale\\Sprint 70", start: "2026-09-21", finish: "2026-10-02" }, { name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-16" }];
  it("currentSprint finds the sprint containing the day, by calendar day, or null", () => {
    expect(currentSprint(sprints, new Date(2026, 9, 9, 23, 59))!.name).toBe("Sprint 71");
    expect(currentSprint(sprints, new Date(2026, 9, 3))).toBeNull();
    expect(currentSprint([], new Date())).toBeNull();
  });
  it("sprintDay counts working days from the start: Fri 9.10 = 5, the weekend stays 5, Mon 12.10 = 6, Fri 16.10 = 10", () => {
    expect(sprintDay(sprints[1], new Date(2026, 9, 5))).toBe(1);
    expect(sprintDay(sprints[1], new Date(2026, 9, 9))).toBe(5);
    expect(sprintDay(sprints[1], new Date(2026, 9, 10))).toBe(5);
    expect(sprintDay(sprints[1], new Date(2026, 9, 12))).toBe(6);
    expect(sprintDay(sprints[1], new Date(2026, 9, 16))).toBe(10);
  });
  it("sprintLabel reads «Sprint 71 · dag 5» and is empty outside every sprint", () => {
    expect(sprintLabel(sprints, new Date(2026, 9, 9))).toBe("Sprint 71 · dag 5");
    expect(sprintLabel(sprints, new Date(2026, 9, 3))).toBe("");
  });
  it("normalizePlan keeps a valid spec folder, sprints and sprint goals, and drops invalid ones", () => {
    const p = normalizePlan({ lanes: [{ key: "a", name: "A" }], tasks: [
      { id: "t1", lane: "a", label: "x", kind: "estimate", start: 2, end: 3, specPath: "Threading" },
      { id: "t2", lane: "a", label: "y", kind: "estimate", start: 2, end: 3, specPath: "../etc" },
    ], sprints: { at: "2026-10-09T08:00:00.000Z", items: sprints }, sprintGoals: { "Sprint 71": { text: "Tråder i beta", at: "2026-10-09T08:00:00.000Z" }, bad: "x" } });
    expect(p.tasks[0].specPath).toBe("Threading");
    expect(p.tasks[1].specPath).toBeUndefined();
    expect(p.sprints!.items.length).toBe(2);
    expect(Object.keys(p.sprintGoals!)).toEqual(["Sprint 71"]);
    expect(normalizePlan({ lanes: [], tasks: [], sprints: "nope", sprintGoals: 3 })).not.toHaveProperty("sprints");
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/features/ado/sync.test.ts src/features/timeline/epic-tools.test.ts`
Expected: FAIL — `./sync` missing; `currentSprint` is not exported.

- [ ] **Step 3: Write the fixtures, `sync.ts`, the epic-tools helpers and the merge types**

`fixtures/iterations.json`: `{ "name": "Skytale", "children": [ { "name": "After MVP" }, { "name": "Sprint 71", "path": "\\Skytale\\Iteration\\Sprint 71", "attributes": { "startDate": "2026-10-05T00:00:00Z", "finishDate": "2026-10-16T00:00:00Z" } }, … Sprint 68, 70, 69 in that order … ] }` (copy the four children's `attributes` from `scratchpad/ado-rec/iterations.json`; `path` as `"Skytale\\Sprint N"` is built by the parser when the node's `path` is the ADO classification path, see below).

`fixtures/feature-with-stories.json`: an array of four items: `{ "id": 4742, "fields": { "System.WorkItemType": "Feature", "System.State": "Active", "System.Title": "Calls" }, "relations": [ { "rel": "System.LinkTypes.Hierarchy-Forward", "url": "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/4743" }, … 4794, 4795 ] }`, `4743` User Story Closed 3 points iteration `Skytale\Sprint 70`, `4795` User Story Active 5 points iteration `Skytale\Sprint 71`, `4794` User Story New 0 points titled «Utredning: Calls».

```ts
// src/features/ado/sync.ts
// What ADO owns and the plan only reads: sprints (iteration nodes), the stories under a feature, delivery.
import type { Sprint } from "@/features/timeline/merge";
import type { AdoWorkItem, IterationNode } from "./client";
import { ADO_CHILD_REL, ADO_PROJECT } from "./config";
import { relTarget } from "./plan-mappers";

export function parseSprints(root: IterationNode): Sprint[] {
  return (root.children ?? [])
    .filter((c) => /^Sprint \d+/.test(c.name) && c.attributes?.startDate && c.attributes?.finishDate)
    .map((c) => ({ name: c.name, path: ADO_PROJECT + "\\" + c.name, start: c.attributes!.startDate!.slice(0, 10), finish: c.attributes!.finishDate!.slice(0, 10) }))
    .sort((a, b) => a.start.localeCompare(b.start));
}
export const DONE_STATES = ["Resolved", "Closed"];
const sprintNo = (p: string) => parseInt(/Sprint (\d+)/.exec(p)?.[1] ?? "0", 10);
const points = (w: AdoWorkItem) => Number(w.fields["Microsoft.VSTS.Scheduling.StoryPoints"] ?? 0) || 0;
export function readStories(feature: AdoWorkItem, byId: Map<number, AdoWorkItem>, discoveryStoryId?: number): { count: number; pointsTotal: number; pointsDone: number; iteration: string | null } {
  const stories = (feature.relations ?? []).filter((r) => r.rel === ADO_CHILD_REL).map(relTarget).filter((id) => id !== discoveryStoryId)
    .map((id) => byId.get(id)).filter((w): w is AdoWorkItem => !!w && w.fields["System.WorkItemType"] === "User Story" && w.fields["System.State"] !== "Removed");
  const iter = stories.map((w) => String(w.fields["System.IterationPath"] ?? "")).filter((p) => /Sprint \d+/.test(p)).sort((a, b) => sprintNo(b) - sprintNo(a))[0];
  return { count: stories.length, pointsTotal: stories.reduce((s, w) => s + points(w), 0),
    pointsDone: stories.filter((w) => DONE_STATES.includes(String(w.fields["System.State"]))).reduce((s, w) => s + points(w), 0), iteration: iter ? iter.split("\\").pop()! : null };
}
export function deliveredDay(item: AdoWorkItem): string | null {
  const state = String(item.fields["System.State"] ?? "");
  if (!DONE_STATES.includes(state)) return null;
  const d = state === "Closed" ? item.fields["Microsoft.VSTS.Common.ClosedDate"] ?? item.fields["Microsoft.VSTS.Common.ResolvedDate"] : item.fields["Microsoft.VSTS.Common.ResolvedDate"] ?? item.fields["Microsoft.VSTS.Common.ClosedDate"];
  return typeof d === "string" ? d.slice(0, 10) : null;
}
```

epic-tools.js (before the `module.exports` block, exported there and declared in the `.d.ts`):

```js
/* ---------- sprints: from ADO's iterations, cached in plan.sprints ---------- */
function dayKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function currentSprint(sprints, date) {
  const k = dayKey(date);
  return (Array.isArray(sprints) ? sprints : []).find((s) => s.start <= k && k <= s.finish) || null;
}
function sprintDay(sprint, date) {   // working days (Mon–Fri) from the sprint's start through `date`, 1-based; day 10 is the sprint's last day
  const [y, m, d] = sprint.start.split("-").map(Number);
  let n = 0;
  for (const c = new Date(y, m - 1, d); dayKey(c) <= dayKey(date); c.setDate(c.getDate() + 1)) if (c.getDay() !== 0 && c.getDay() !== 6) n++;
  return Math.max(1, n);
}
function sprintLabel(sprints, date) {
  const s = currentSprint(sprints, date);
  return s ? s.name + " · dag " + sprintDay(s, date) : "";
}
```

In `normalizePlan`: after `p.deletedLanes = …`:
```js
const SPEC_RE = /^[A-Za-z0-9._-]+$/;
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const okSprint = (s) => s && typeof s === "object" && typeof s.name === "string" && isDay(s.start) && isDay(s.finish);
if (p.sprints && typeof p.sprints === "object" && typeof p.sprints.at === "string" && Array.isArray(p.sprints.items)) p.sprints.items = p.sprints.items.filter(okSprint);
else delete p.sprints;
if (p.sprintGoals && typeof p.sprintGoals === "object" && !Array.isArray(p.sprintGoals)) {
  Object.keys(p.sprintGoals).forEach((k) => { const g = p.sprintGoals[k]; if (!g || typeof g !== "object" || typeof g.text !== "string" || typeof g.at !== "string") delete p.sprintGoals[k]; });
} else delete p.sprintGoals;
```
and in the task loop: `if (typeof t.specPath !== "string" || !SPEC_RE.test(t.specPath)) delete t.specPath;`

merge.ts types:
```ts
export type Sprint = { name: string; path: string; start: string; finish: string };
export type AdoSnapshot = Partial<Record<"title" | "description" | "state" | "targetDate" | "startDate", string | null>>;
export type AdoConflict = { field: string; ours: string | null; theirs: string | null };
export type LaneAdo = { pushedAt: string; snapshot: AdoSnapshot; conflicts?: AdoConflict[] };
export type TaskAdo = LaneAdo & { storyId?: number; stories?: { count: number; pointsTotal: number; pointsDone: number; iteration: string | null; at: string } };
// PlanTask: specPath?: string; ado?: TaskAdo;   PlanLane: ado?: LaneAdo;
// Plan: sprints?: { at: string; items: Sprint[] }; sprintGoals?: Record<string, { text: string; at: string }>;
```
`.d.ts`: `export declare function currentSprint(sprints: Sprint[] | undefined, date: Date): Sprint | null; sprintDay(sprint: Sprint, date: Date): number; sprintLabel(sprints: Sprint[] | undefined, date: Date): string; dayKey(d: Date): string;` with `import type { Sprint } from "./merge"`.

- [ ] **Step 4: Run to verify GREEN, then commit**

Run: `npx vitest run src/features/ado/sync.test.ts src/features/timeline/epic-tools.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

```bash
git add src/features/ado/sync.ts src/features/ado/sync.test.ts src/features/ado/fixtures src/features/timeline/epic-tools.js src/features/timeline/epic-tools.d.ts src/features/timeline/epic-tools.test.ts src/features/timeline/merge.ts
git -c commit.gpgsign=false commit -m "ado: sprints from the iteration nodes, stories and delivery read back; sprint helpers and the new plan fields in the normaliser"
```

---

### Task 5: The plan's data rules for the mirror: merge group `ado`, `sprints`, the new events, the sprint baseline, the export

**Files:**
- Modify: `src/features/timeline/merge.ts` (+ test): group `ado`, `specPath` in `meta`, `sprints` / `sprintGoals` merge
- Modify: `src/features/timeline/events.ts` (+ test): codes, `cause: ado` for `source: "ado"`, `feature.estimat-hentet`, `plan.sprintmaal`, `adoEvent()`
- Modify: `src/features/timeline/history.ts` (+ test): `extraEvents`, the automatic sprint baseline
- Modify: `src/features/timeline/compare.ts` (+ test): `sinceLabel` for kind `sprint`, sections «ADO» and «Sprintmål»
- Create: `src/features/timeline/plan-store.ts`

**Interfaces:**
- Consumes: Task 4's types and `currentSprint`.
- Produces: `TASK_FIELD_GROUPS` incl. `"ado"`, `GROUP_PROPS.ado = ["ado"]`, `GROUP_PROPS.meta` incl. `"specPath"`; events `EVENT_CODES` + `"feature.estimat-hentet" | "plan.sprintmaal" | "ado.push" | "ado.konflikt" | "ado.lest"`, `adoEvent(code, target, summary, extra?)`; `recordChangeset(db, { …, extraEvents? })`; `readPlan(db)`, `commitPlan(db, { stored, after, editor, note, extraEvents? })`, `PLAN_ID`.

- [ ] **Step 1: Write the failing tests**

merge.test.ts (append):
```ts
describe("the ado group and the sprint keys", () => {
  const t = (fv: Record<string, number>, ado?: unknown) => ({ id: "a", lane: "l", label: "A", kind: "estimate" as const, start: 1, end: 2, fv, ...(ado ? { ado } : {}) });
  const base = { lanes: [{ key: "l", name: "L", v: 1 }], tasks: [] as PlanTask[] };
  it("a server-written ado block (fv.ado bumped) survives a save from a page that never saw it", () => {
    const stored = { ...base, tasks: [t({ tid: 1, ado: 1 }, { pushedAt: "x", snapshot: { title: "A" } })] };
    const incoming = { ...base, tasks: [t({ tid: 2 })] };
    const m = mergePlans(stored, incoming);
    expect(m.tasks[0].ado).toEqual({ pushedAt: "x", snapshot: { title: "A" } });
    expect(m.tasks[0].fv).toEqual({ tid: 2, ado: 1 });
  });
  it("sprints: the newer `at` wins either way; sprintGoals merge per sprint by `at`", () => {
    const old = { at: "2026-10-01T00:00:00.000Z", items: [] }, fresh = { at: "2026-10-09T00:00:00.000Z", items: [{ name: "Sprint 71", path: "p", start: "2026-10-05", finish: "2026-10-16" }] };
    expect(mergePlans({ ...base, sprints: fresh }, { ...base, sprints: old }).sprints).toEqual(fresh);
    expect(mergePlans({ ...base, sprints: old }, { ...base, sprints: fresh }).sprints).toEqual(fresh);
    expect(mergePlans({ ...base }, { ...base, sprints: fresh }).sprints).toEqual(fresh);
    const g = mergePlans({ ...base, sprintGoals: { "Sprint 71": { text: "a", at: "2026-10-09T10:00:00.000Z" }, "Sprint 70": { text: "x", at: "2026-09-21T00:00:00.000Z" } } },
      { ...base, sprintGoals: { "Sprint 71": { text: "b", at: "2026-10-09T09:00:00.000Z" } } }).sprintGoals;
    expect(g).toEqual({ "Sprint 71": { text: "a", at: "2026-10-09T10:00:00.000Z" }, "Sprint 70": { text: "x", at: "2026-09-21T00:00:00.000Z" } });
  });
});
```

events.test.ts (append; reuse the file's fixture helpers for a plan with one lane and one estimate task):
```ts
describe("the mirror's events", () => {
  it("a changeset from ADO carries cause ado on every diff event and never asks for a reason", () => {
    const before = plan([estimate("k", "l", "Kapasitet", { state: "aktiv" })]);
    const after = plan([estimate("k", "l", "Kapasitet", { state: "levert", deliveredAt: "2026-12-03" })]);
    const ev = diffPlans(before, after, { source: "ado" });
    expect(ev.map((e) => [e.code, e.cause, e.summary])).toEqual([["feature.tilstand", "ado", "Levert 3. des"]]);
    expect(ev.some(needsReason)).toBe(false);
  });
  it("an estimate pulled from Skytale.Specs is «Estimat hentet fra utredningen», with the buffer named when it stayed", () => {
    const before = plan([estimate("k", "l", "Kapasitet", { bufferWeeks: 1, raw: { likely: 4, late: 6 } })]);
    const after = plan([estimate("k", "l", "Kapasitet", { bufferWeeks: 1, raw: { likely: 5, late: 8, source: "specs", pulledAt: "2026-10-09T08:00:00.000Z" } })]);
    const ev = diffPlans(before, after).filter((e) => e.code === "feature.estimat-hentet");
    expect(ev.map((e) => e.summary)).toEqual(["Estimat hentet fra utredningen: 5–8 (uendret buffer 1 uke)"]);
    expect(diffPlans(before, after).some((e) => e.code === "feature.raw")).toBe(false);
  });
  it("a sprint goal set or changed is plan.sprintmaal", () => {
    const before = plan([]), after = { ...plan([]), sprintGoals: { "Sprint 71": { text: "Tråder i beta", at: "2026-10-09T08:00:00.000Z" } } };
    expect(diffPlans(before, after).map((e) => [e.code, e.targetLabel, e.summary])).toEqual([["plan.sprintmaal", "Sprint 71", "Sprintmål Sprint 71: «Tråder i beta»"]]);
  });
  it("adoEvent builds a system event with cause ado", () => {
    expect(adoEvent("ado.push", { targetType: "feature", targetId: "k", targetLabel: "Kapasitet", laneKey: "l" }, "Pushet til ADO #4791 (Feature opprettet)", { after: { adoId: 4791 } }))
      .toEqual({ targetType: "feature", targetId: "k", targetLabel: "Kapasitet", laneKey: "l", code: "ado.push", cause: "ado", summary: "Pushet til ADO #4791 (Feature opprettet)", after: { adoId: 4791 } });
  });
});
```

history.test.ts (append, following the file's fake-db pattern; the fake's `timelineSnapshot.findFirst` answers by `where.kind`, and `create` records what it got):
```ts
it("the first save inside a sprint writes the sprint baseline (plan as it was) once, next to the daily snapshot", async () => {
  const sprints = { at: "2026-10-09T06:00:00.000Z", items: [{ name: "Sprint 71", path: "p", start: "2026-10-05", finish: "2026-10-16" }] };
  // choose the sprint so that today (the real clock) is inside it: start = today − 3 days, finish = today + 10 days
  …
  expect(created.map((c) => c.kind)).toEqual(["dag", "sprint"]);
  expect(created[1]).toMatchObject({ kind: "sprint", day: <start>, label: "Sprintstart Sprint 71", planVersion: 3 });
  // a second save: findFirst answers true for kind sprint → no second sprint snapshot
});
it("extraEvents are stored in the same changeset after the diff's events", async () => { … eventCount === diff.length + 1, the last event has code ado.push … });
```
(Write the sprint window relative to `new Date()` with `dayKey` from epic-tools so the test does not depend on the calendar.)

compare.test.ts (append):
```ts
it("sinceLabel names a sprint snapshot by its label and the export has ADO and Sprintmål sections", () => {
  expect(sinceLabel({ kind: "sprint", label: "Sprintstart Sprint 71", at: "2026-10-05T06:00:00.000Z", day: "2026-10-05" })).toBe("sprintstart Sprint 71");
  const md = exportMarkdown("Siden sprintstart Sprint 71", "x", [path({ code: "ado.push", targetLabel: "Kapasitet", summary: "Pushet til ADO #4791 (Feature opprettet)", cause: "ado" }), path({ code: "plan.sprintmaal", targetType: "plan", targetLabel: "Sprint 71", summary: "Sprintmål Sprint 71: «Tråder i beta»" })], (k) => k);
  expect(md).toContain("## ADO\n- x › Kapasitet: Pushet til ADO #4791 (Feature opprettet) — ADO (GO, 6. nov)");
  expect(md).toContain("## Sprintmål\n- Sprint 71: Sprintmål Sprint 71: «Tråder i beta»");
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/features/timeline`
Expected: FAIL on the new cases (ado block dropped by the merge, `adoEvent` missing, cause bruker, no sprint snapshot, no «## ADO»).

- [ ] **Step 3: Implement**

merge.ts: `TaskFieldGroup` + `"ado"`; `TASK_FIELD_GROUPS = [..., "ado"]`; `GROUP_PROPS.meta` + `"specPath"`, `GROUP_PROPS.ado = ["ado"]`; in `mergePlans` before the return:
```ts
const newer = <T extends { at: string }>(a?: T, b?: T) => (!a ? b : !b ? a : b.at >= a.at ? b : a);
const sprints = newer(stored.sprints, incoming.sprints);
const goals: Record<string, { text: string; at: string }> = {};
for (const src of [stored.sprintGoals, incoming.sprintGoals]) for (const [k, g] of Object.entries(src ?? {})) goals[k] = newer(goals[k], g)!;
const out: Plan = { ...stored, ...incoming, lanes: liveLanes, tasks, deleted, deletedLanes };
delete out.sprints; delete out.sprintGoals;
if (sprints) out.sprints = sprints;
if (Object.keys(goals).length) out.sprintGoals = goals;
return out;
```

events.ts: `EVENT_CODES` + `"feature.estimat-hentet", "plan.sprintmaal", "ado.push", "ado.konflikt", "ado.lest"`; in `diffPlans` `const dc: Cause = opts.source === "ado" ? "ado" : "bruker";` used as `cause: dc` in the four `base`/deleted objects; the raw block becomes
```ts
const rawChanged = JSON.stringify(rawOf(b)) !== JSON.stringify(rawOf(t));
if (t.raw && t.raw.source === "specs" && (rawChanged || b.raw?.pulledAt !== t.raw.pulledAt)) {
  const sameBuf = (b.bufferWeeks ?? 0) === (t.bufferWeeks ?? 0);
  ev.push({ ...base, code: "feature.estimat-hentet", before: rawOf(b), after: rawOf(t), summary: "Estimat hentet fra utredningen: " + span(t.raw) + (sameBuf && t.bufferWeeks ? " (uendret buffer " + wk(t.bufferWeeks) + ")" : "") });
} else if (rawChanged && t.raw) ev.push({ ...base, code: "feature.raw", … as today … });
```
after the task loop:
```ts
for (const [name, g] of Object.entries(after.sprintGoals ?? {})) {
  const prev = before.sprintGoals?.[name]?.text ?? "";
  if (g.text !== prev) ev.push({ targetType: "plan", targetId: "sprint:" + name, targetLabel: name, laneKey: null, code: "plan.sprintmaal", before: prev || null, after: g.text || null, cause: dc, summary: g.text ? "Sprintmål " + name + ": " + q(g.text) : "Sprintmål " + name + " fjernet" });
}
```
and
```ts
export function adoEvent(code: "ado.push" | "ado.konflikt" | "ado.lest", target: Pick<PlanEvent, "targetType" | "targetId" | "targetLabel" | "laneKey">, summary: string, extra: { before?: unknown; after?: unknown; causeRef?: string } = {}): PlanEvent {
  return { ...target, code, cause: "ado", summary, ...extra };
}
```
`PlanTask.raw` type gains `by?: string; date?: string`.

history.ts: `recordChangeset(db, args & { extraEvents?: PlanEvent[] })`: `const events = [...diffPlans(...), ...(args.extraEvents ?? [])]`; after the daily snapshot:
```ts
const sprint = currentSprint(args.before.sprints?.items, new Date());
if (sprint) {
  const has = await db.timelineSnapshot.findFirst({ where: { kind: "sprint", day: sprint.start }, select: { id: true } });
  if (!has) { try { await db.timelineSnapshot.create({ data: { kind: "sprint", day: sprint.start, label: "Sprintstart " + sprint.name, planVersion: args.beforeVersion, data: args.before as unknown as Prisma.InputJsonValue } }); } catch { /* raced */ } }
}
```

compare.ts: `sinceLabel`: `if ((b.kind === "baseline" || b.kind === "sprint") && b.label)`; `SECTIONS` + `["ADO", ["ado.push", "ado.konflikt", "ado.lest", "feature.ado", "epic.ado"]]` and `["Sprintmål", ["plan.sprintmaal"]]`, and `"feature.estimat-hentet"` added to the «Spenn» list; `why()` returns `"ADO"` when `e.cause === "ado"`.

plan-store.ts:
```ts
// src/features/timeline/plan-store.ts
// The stored plan for server-side writers (the ADO routes): read, then commit with the version guard
// and log the changeset. The PUT route keeps its own merge path.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Plan } from "./merge";
import { recordChangeset, type SaveNote } from "./history";
import type { PlanEvent } from "./events";
export const PLAN_ID = "epics";
export type StoredPlan = { data: Plan; version: number };
export async function readPlan(db: PrismaClient): Promise<StoredPlan | null> {
  const row = await db.timelinePlan.findUnique({ where: { id: PLAN_ID } });
  return row ? { data: row.data as unknown as Plan, version: row.version } : null;
}
/** null = someone else saved first (the caller answers 409 and the page retries). The log is best effort. */
export async function commitPlan(db: PrismaClient, args: { stored: StoredPlan; after: Plan; editor: string | null; note: SaveNote; extraEvents?: PlanEvent[] }): Promise<{ version: number; changesetId: string | null } | null> {
  const updated = await db.timelinePlan.updateMany({ where: { id: PLAN_ID, version: args.stored.version }, data: { data: args.after as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedBy: args.editor } });
  if (updated.count !== 1) return null;
  let changesetId: string | null = null;
  try { changesetId = await recordChangeset(db, { before: args.stored.data, after: args.after, beforeVersion: args.stored.version, afterVersion: args.stored.version + 1, editor: args.editor, note: args.note, extraEvents: args.extraEvents }); } catch { /* best effort */ }
  return { version: args.stored.version + 1, changesetId };
}
```
The page's `FV_FIELDS` gets `'ado'` in Task 8.

- [ ] **Step 4: Run to verify GREEN, then commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass (the stage-1 fixtures that enumerate `fv` keys may need `ado` — if so, that is a fixture update, ledger it); tsc clean.

```bash
git add src/features/timeline
git -c commit.gpgsign=false commit -m "timeline: ado merge group, sprints in the plan, mirror events (cause ado, estimat-hentet, sprintmål), sprint baseline, plan-store"
```

---

### Task 6: «Hent estimat fra utredningen»: the Skytale.Specs reader

**Files:**
- Create: `src/features/specs/estimate.ts`
- Test: `src/features/specs/estimate.test.ts`
- Create: `src/features/ado/http.ts` (`adoErrorResponse`, `ADO_LOGIN_MESSAGE`)
- Modify: `src/app/api/specs-estimate/route.ts`

**Interfaces:**
- Consumes: `createAdoClient`, `AdoRequestError` (Task 2), `adoAuthFor`, `AdoLoginRequired`, `defaultTokenDeps` (Task 1), `SPECS_REPO_ID`, `readPlan` (Task 5).
- Produces: `parseEstimateYaml(text): SpecEstimate | null`, `estimatePath(folder)`, `SPEC_FOLDER_RE`; `GET /api/specs-estimate?id=<feature>&folder=<optional override>` → `200 { raw: { likely, late, points?, estimatedBy?, date? }, path }` · `404 { error: "no-feature" | "no-spec" | "no-file", message }` · `422 { error: "bad-yaml", message }` · `401 { error: "ado-login", message }`; `adoErrorResponse(e)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/specs/estimate.test.ts
import { describe, expect, it } from "vitest";
import { estimatePath, parseEstimateYaml, SPEC_FOLDER_RE } from "./estimate";

describe("parseEstimateYaml (decision 3: likely_weeks, late_weeks, points, estimated_by, date)", () => {
  it("reads the five keys, tolerating quotes, comments and blank lines", () => {
    expect(parseEstimateYaml('# estimat etter utredning\nlikely_weeks: 4\nlate_weeks: "6"  # senest\npoints: 13\nestimated_by: THM\ndate: 2026-10-09\n'))
      .toEqual({ likely: 4, late: 6, points: 13, estimatedBy: "THM", date: "2026-10-09" });
  });
  it("needs both week numbers, orders them, rounds, and ignores a malformed date", () => {
    expect(parseEstimateYaml("late_weeks: 3\nlikely_weeks: 5.4\ndate: next week")).toEqual({ likely: 3, late: 5 });
    expect(parseEstimateYaml("likely_weeks: 4")).toBeNull();
    expect(parseEstimateYaml("likely_weeks: 0\nlate_weeks: 2")).toBeNull();
    expect(parseEstimateYaml("")).toBeNull();
  });
  it("estimatePath and the folder rule", () => {
    expect(estimatePath("Threading")).toBe("/spec/Threading/estimate.yaml");
    expect(SPEC_FOLDER_RE.test("QR-Onboarding-V2")).toBe(true);
    expect(SPEC_FOLDER_RE.test("../x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/features/specs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/features/specs/estimate.ts
// estimate.yaml beside spec.md in Skytale.Specs (decision 3). Five flat keys; no YAML library needed.
export type SpecEstimate = { likely: number; late: number; points?: number; estimatedBy?: string; date?: string };
export const SPEC_FOLDER_RE = /^[A-Za-z0-9._-]+$/;
export const estimatePath = (folder: string) => "/spec/" + folder + "/estimate.yaml";
export function parseEstimateYaml(text: string): SpecEstimate | null {
  const kv: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (m) kv[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const a = Number(kv.likely_weeks), b = Number(kv.late_weeks);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const out: SpecEstimate = { likely: Math.round(Math.min(a, b)), late: Math.round(Math.max(a, b)) };
  if (kv.points !== undefined && Number.isFinite(Number(kv.points))) out.points = Number(kv.points);
  if (kv.estimated_by) out.estimatedBy = kv.estimated_by;
  if (kv.date && /^\d{4}-\d{2}-\d{2}$/.test(kv.date)) out.date = kv.date;
  return out;
}
```

```ts
// src/features/ado/http.ts
import { AdoRequestError } from "./client";
import { AdoLoginRequired } from "./token";
export const ADO_LOGIN_MESSAGE = "Logg inn på nytt for å koble til ADO.";
const NO_STORE = { "Cache-Control": "no-store" };
/** 401 ado-login for a missing/rejected token, 502 for any other ADO failure; rethrows the rest. */
export function adoErrorResponse(e: unknown, extra: Record<string, unknown> = {}): Response {
  if (e instanceof AdoLoginRequired || (e instanceof AdoRequestError && e.status === 401))
    return Response.json({ error: "ado-login", message: ADO_LOGIN_MESSAGE, ...extra }, { status: 401, headers: NO_STORE });
  if (e instanceof AdoRequestError)
    return Response.json({ error: "ado", message: "ADO svarte " + e.status + ". " + e.message.slice(0, 200), ...extra }, { status: 502, headers: NO_STORE });
  throw e;
}
```

Route: signed in → `id` + optional `folder` (validated with `SPEC_FOLDER_RE`) → `readPlan(prisma)` → the task (404 `no-feature`) → folder = override ?? `task.specPath` (404 `no-spec`: «Featuren har ingen spec-mappe i Skytale.Specs. Skriv mappenavnet i feltet over og prøv igjen.») → `adoAuthFor` (catch → `adoErrorResponse`) → `client.gitItem(SPECS_REPO_ID, estimatePath(folder))` (null → 404 `no-file`: «Fant ikke spec/<folder>/estimate.yaml i Skytale.Specs. Utredningen legger den der når estimatet er klart.») → `parseEstimateYaml` (null → 422 `bad-yaml`: «estimate.yaml mangler likely_weeks og late_weeks.») → `{ raw, path }`, `Cache-Control: no-store`.

- [ ] **Step 4: Run to verify GREEN, then commit**

Run: `npx vitest run src/features/specs && npx tsc --noEmit`
Expected: PASS 3/3; tsc clean.

```bash
git add src/features/specs src/features/ado/http.ts src/app/api/specs-estimate/route.ts
git -c commit.gpgsign=false commit -m "specs: read estimate.yaml from Skytale.Specs as the signed-in person for «Hent estimat fra utredningen»"
```

---

### Task 7: Push, refresh and sprints: the pure functions and the three routes

**Files:**
- Create: `src/features/ado/push.ts`
- Test: `src/features/ado/push.test.ts`
- Create: `src/app/api/ado-push/route.ts`, `src/app/api/ado-refresh/route.ts`, `src/app/api/ado-sprints/route.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `pushItem(plan, { kind, id }, client | null, { dry?, force?, people, now }) → { plan, items: PushedItem[], events }` (throws `PushFailed { partial, cause }` after a partial push, `Error("on-shelf" | "no-feature" | "no-epic")` for bad targets); `refreshPlan(plan, client, now) → { plan, conflicts, read: { epics, features, stories, levert }, events }`; `refreshSprints(plan, client, now, maxAgeMs?) → { plan, changed, sprints }`; `type PushedItem { kind: "epic"|"feature"|"story"; id; label; adoId; action: "create"|"update"|"none"; type; patch; conflicts }`.
- Routes (writers; `ado-sprints` any signed-in person): `POST /api/ado-push?dry=1 { kind, id, force? }` → `200 { version, data, items, changesetId }` or dry `200 { dry: true, items, note? }` · `400 on-shelf` · `404` · `401 ado-login` · `409 contention` · `502 { error: "ado", message, items? }` (partial progress committed first); `POST /api/ado-refresh` → `200 { version, data, conflicts, read, changesetId }`; `POST /api/ado-sprints` → `200 { version, data, sprints }` or `{ unchanged: true, sprints }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/ado/push.test.ts
import { describe, expect, it } from "vitest";
import { dateToUnit } from "@/features/timeline/epic-tools.js";
import type { Plan } from "@/features/timeline/merge";
import type { AdoClient, AdoWorkItem, JsonPatch } from "./client";
import { pushItem, PushFailed, refreshPlan, refreshSprints } from "./push";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const NOW = new Date("2026-10-09T08:00:00.000Z");
const OPTS = { people: { THM: "thm@skytale.no" }, now: NOW };
function plan(): Plan {
  return { lanes: [{ key: "telenor", name: "Telenor", goalDate: D(2026, 12, 15), state: "aktiv", priority: 1, v: 1 }], tasks: [
    { id: "kap", lane: "telenor", label: "Kapasitet", kind: "estimate", start: D(2026, 11, 2), endLikely: D(2026, 11, 2) + 1, end: D(2026, 11, 2) + 1.5, state: "aktiv", deps: ["iam"], order: 2, fv: { tid: 1 } },
    { id: "iam", lane: "telenor", label: "IAM", kind: "discovery", start: D(2026, 10, 19), end: D(2026, 11, 13), state: "utredes", assignee: "THM", order: 1, fv: { tid: 1 } },
  ] };
}
/** An in-memory ADO: items by id, patches applied, ids from 5000. */
function fakeAdo(seed: AdoWorkItem[] = []) {
  const items = new Map(seed.map((w) => [w.id, w]));
  let next = 5000;
  const apply = (w: AdoWorkItem, patch: JsonPatch[]) => { for (const op of patch) {
    if (op.path.startsWith("/fields/")) w.fields[op.path.slice(8)] = op.value;
    else if (op.path === "/relations/-") (w.relations ??= []).push(op.value as { rel: string; url: string });
    else if (op.op === "remove") w.relations!.splice(parseInt(op.path.split("/").pop()!, 10), 1);
  } };
  const calls: string[] = [];
  const client: AdoClient = {
    get: async (id) => { calls.push("get " + id); return items.get(id) ?? null; },
    batch: async (ids) => { calls.push("batch " + ids.join(",")); return ids.map((id) => items.get(id)).filter((w): w is AdoWorkItem => !!w); },
    create: async (type, patch) => { calls.push("create " + type); const w: AdoWorkItem = { id: next++, fields: { "System.WorkItemType": type, "System.State": "New" }, relations: [] }; apply(w, patch); items.set(w.id, w); return w; },
    patch: async (id, patch) => { calls.push("patch " + id); const w = items.get(id)!; apply(w, patch); return w; },
    iterations: async () => ({ name: "Skytale", children: [{ name: "Sprint 71", attributes: { startDate: "2026-10-05T00:00:00Z", finishDate: "2026-10-16T00:00:00Z" } }] }),
    gitItem: async () => null,
  };
  return { items, client, calls };
}

describe("pushItem", () => {
  it("creates the epic first, then the feature parented to it with its predecessor, and the discovery story when utredes; records ids, snapshots and events", async () => {
    const ado = fakeAdo();
    const r = await pushItem(plan(), { kind: "feature", id: "iam" }, ado.client, OPTS);
    expect(r.items.map((i) => [i.kind, i.action, i.adoId])).toEqual([["epic", "create", 5000], ["feature", "create", 5001], ["story", "create", 5002]]);
    const lane = r.plan.lanes[0], iam = r.plan.tasks.find((t) => t.id === "iam")!;
    expect(lane.adoId).toBe(5000); expect(lane.v).toBe(2); expect(lane.ado!.snapshot.title).toBe("Telenor");
    expect(iam.adoId).toBe(5001); expect(iam.fv).toEqual({ tid: 1, meta: 1, ado: 1 }); expect(iam.ado!.storyId).toBe(5002); expect(iam.ado!.pushedAt).toBe(NOW.toISOString());
    const feature = ado.items.get(5001)!;
    expect(feature.fields["System.State"]).toBe("Discovery");
    expect(feature.relations).toContainEqual({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/5000" });
    const story = ado.items.get(5002)!;
    expect(story.fields["System.Title"]).toBe("Utredning: IAM"); expect(story.fields["System.AssignedTo"]).toBe("thm@skytale.no");
    expect(story.relations).toContainEqual({ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/5001" });
    expect(r.events.map((e) => [e.code, e.cause, e.summary])).toEqual([
      ["ado.push", "ado", "Pushet til ADO #5000 (Epic opprettet)"],
      ["ado.push", "ado", "Pushet til ADO #5001 (Feature opprettet, discovery-story #5002)"],
    ]);
    // the blocked feature now links its predecessor
    const r2 = await pushItem(r.plan, { kind: "feature", id: "kap" }, ado.client, OPTS);
    expect(ado.items.get(5003)!.relations).toContainEqual({ rel: "System.LinkTypes.Dependency-Reverse", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/5001" });
    expect(r2.items.find((i) => i.kind === "epic")).toBeUndefined();
  });
  it("a second push with nothing changed sends nothing; a change in SkyTracker is written; a change in ADO is a conflict, listed and kept out of the patch; force overwrites", async () => {
    const ado = fakeAdo();
    const r1 = await pushItem(plan(), { kind: "feature", id: "kap" }, ado.client, OPTS);
    ado.calls.length = 0;
    const r2 = await pushItem(r1.plan, { kind: "feature", id: "kap" }, ado.client, OPTS);
    expect(r2.items.map((i) => [i.kind, i.action])).toEqual([["feature", "none"]]);
    expect(ado.calls.filter((c) => c.startsWith("patch") || c.startsWith("create"))).toEqual([]);
    expect(r2.events[0].summary).toBe("Pushet til ADO #5001 (ingen endringer)");
    const p3 = r2.plan; p3.tasks.find((t) => t.id === "kap")!.label = "Kapasitet 2.0";
    ado.items.get(5001)!.fields["System.State"] = "Resolved";   // someone moved it in ADO
    const r3 = await pushItem(p3, { kind: "feature", id: "kap" }, ado.client, OPTS);
    const f = r3.items.find((i) => i.kind === "feature")!;
    expect(f.action).toBe("update");
    expect(f.patch).toEqual([{ op: "add", path: "/fields/System.Title", value: "Kapasitet 2.0" }]);
    expect(f.conflicts).toEqual([{ field: "state", ours: "Active", theirs: "Resolved" }]);
    expect(r3.plan.tasks.find((t) => t.id === "kap")!.ado!.conflicts).toEqual([{ field: "state", ours: "Active", theirs: "Resolved" }]);
    expect(r3.events.map((e) => e.code)).toEqual(["ado.push", "ado.konflikt"]);
    expect(r3.events[1].summary).toBe("Konflikt med ADO: Tilstand er «Resolved» i ADO, «Active» her – ikke overskrevet");
    const r4 = await pushItem(r3.plan, { kind: "feature", id: "kap" }, ado.client, { ...OPTS, force: true });
    expect(ado.items.get(5001)!.fields["System.State"]).toBe("Active");
    expect(r4.plan.tasks.find((t) => t.id === "kap")!.ado!.conflicts).toBeUndefined();
  });
  it("dry run: the patches, no create or patch call; without a client it still builds the patches", async () => {
    const ado = fakeAdo();
    const r = await pushItem(plan(), { kind: "epic", id: "telenor" }, ado.client, { ...OPTS, dry: true });
    expect(r.items[0].action).toBe("create"); expect(r.items[0].patch.some((p) => p.path === "/fields/System.Title")).toBe(true);
    expect(ado.calls.some((c) => c.startsWith("create"))).toBe(false);
    expect(r.plan.lanes[0].adoId).toBeUndefined(); expect(r.events).toEqual([]);
    const r2 = await pushItem(plan(), { kind: "feature", id: "kap" }, null, { ...OPTS, dry: true });
    expect(r2.items.map((i) => i.kind)).toEqual(["epic", "feature"]);
  });
  it("a shelf feature cannot be pushed; a failure after the epic was created is reported with the partial plan", async () => {
    const p = plan(); p.tasks[0].lane = "_backlog";
    await expect(pushItem(p, { kind: "feature", id: "kap" }, fakeAdo().client, OPTS)).rejects.toThrow("on-shelf");
    const ado = fakeAdo(); let n = 0;
    const failing: AdoClient = { ...ado.client, create: async (type, patch) => { if (++n === 2) throw new Error("boom"); return ado.client.create(type, patch); } };
    const err = await pushItem(plan(), { kind: "feature", id: "kap" }, failing, OPTS).catch((e) => e);
    expect(err).toBeInstanceOf(PushFailed);
    expect((err as PushFailed).partial.plan.lanes[0].adoId).toBe(5000);
    expect((err as PushFailed).partial.items.map((i) => i.kind)).toEqual(["epic"]);
  });
});

describe("refreshPlan", () => {
  it("reads stories, points and sprint under each feature, turns Closed into levert, lists new conflicts once and logs ado.lest", async () => {
    const ado = fakeAdo();
    const pushed = await pushItem(plan(), { kind: "feature", id: "kap" }, ado.client, OPTS);
    const storyA: AdoWorkItem = { id: 7001, fields: { "System.WorkItemType": "User Story", "System.State": "Closed", "Microsoft.VSTS.Scheduling.StoryPoints": 3, "System.IterationPath": "Skytale\\Sprint 70" } };
    const storyB: AdoWorkItem = { id: 7002, fields: { "System.WorkItemType": "User Story", "System.State": "Active", "Microsoft.VSTS.Scheduling.StoryPoints": 5, "System.IterationPath": "Skytale\\Sprint 71" } };
    ado.items.set(7001, storyA); ado.items.set(7002, storyB);
    const feature = ado.items.get(5001)!;
    feature.relations!.push({ rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/7001" }, { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/SkytaleAS/_apis/wit/workItems/7002" });
    feature.fields["System.Title"] = "Kapasitet (ADO)";
    const r = await refreshPlan(pushed.plan, ado.client, NOW);
    const kap = r.plan.tasks.find((t) => t.id === "kap")!;
    expect(kap.ado!.stories).toEqual({ count: 2, pointsTotal: 8, pointsDone: 3, iteration: "Sprint 71", at: NOW.toISOString() });
    expect(r.conflicts).toEqual([{ kind: "feature", id: "kap", label: "Kapasitet", field: "title", ours: "Kapasitet", theirs: "Kapasitet (ADO)" }]);
    expect(r.read).toEqual({ epics: 1, features: 1, stories: 2, levert: 0 });
    expect(r.events.map((e) => e.code)).toEqual(["ado.konflikt", "ado.lest"]);
    expect(r.events[1].summary).toBe("Lest fra ADO: 1 epic, 1 feature, 2 stories, 1 konflikt");
    expect(kap.fv!.ado).toBe(2);
    // the same conflict is not logged twice; Closed → levert with the day
    feature.fields["System.State"] = "Closed"; feature.fields["Microsoft.VSTS.Common.ClosedDate"] = "2026-12-03T10:00:00Z";
    const r2 = await refreshPlan(r.plan, ado.client, NOW);
    const kap2 = r2.plan.tasks.find((t) => t.id === "kap")!;
    expect(kap2.state).toBe("levert"); expect(kap2.deliveredAt).toBe("2026-12-03"); expect(kap2.fv!.state).toBe(1);
    expect(r2.events.map((e) => e.code)).toEqual(["ado.lest"]);
    expect(r2.read.levert).toBe(1);
  });
});

describe("refreshSprints", () => {
  it("fetches when the cache is missing or older than the max age, otherwise leaves the plan alone", async () => {
    const ado = fakeAdo();
    const r = await refreshSprints(plan(), ado.client, NOW);
    expect(r.changed).toBe(true); expect(r.plan.sprints).toEqual({ at: NOW.toISOString(), items: [{ name: "Sprint 71", path: "Skytale\\Sprint 71", start: "2026-10-05", finish: "2026-10-16" }] });
    const r2 = await refreshSprints(r.plan, ado.client, new Date(NOW.getTime() + 3600 * 1000));
    expect(r2.changed).toBe(false); expect(r2.sprints.length).toBe(1);
    expect((await refreshSprints(r.plan, ado.client, new Date(NOW.getTime() + 13 * 3600 * 1000))).changed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run src/features/ado/push.test.ts`
Expected: FAIL — `./push` missing.

- [ ] **Step 3: Write `push.ts`**

```ts
// src/features/ado/push.ts
// The mirror, as pure functions over a cloned plan: push one epic or feature (creating the parent epic
// and the discovery story when needed), refresh everything that has an ADO id, refresh the sprint cache.
// The routes read the stored plan, call these, commit with the version guard and log the events.
import { BACKLOG } from "@/features/timeline/epic-tools.js";
import type { AdoConflict, LaneAdo, Plan, PlanLane, PlanTask, Sprint, TaskAdo } from "@/features/timeline/merge";
import { adoEvent, type PlanEvent } from "@/features/timeline/events";
import type { AdoClient, AdoWorkItem, JsonPatch } from "./client";
import { ADO_CHILD_REL, ADO_WORK_ITEM_TYPE } from "./config";
import { epicFields, featureFields, fieldPatch, FIELD_LABEL, planFieldWrites, relationPatch, relTarget, snapshotAfter, storyFields, type Fields, type OwnedField } from "./plan-mappers";
import { deliveredDay, parseSprints, readStories } from "./sync";

export type PushTarget = { kind: "epic" | "feature"; id: string };
export type PushedItem = { kind: "epic" | "feature" | "story"; id: string; label: string; adoId: number | null; action: "create" | "update" | "none"; type: string; patch: JsonPatch[]; conflicts: AdoConflict[] };
export type PushResult = { plan: Plan; items: PushedItem[]; events: PlanEvent[] };
export type PushOpts = { dry?: boolean; force?: boolean; people: Record<string, string>; now: Date };
export class PushFailed extends Error {
  constructor(public partial: PushResult, public cause: unknown) { super("push-failed"); this.name = "PushFailed"; }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const bump = (t: PlanTask, g: "meta" | "ado" | "state") => { t.fv = t.fv ?? {}; t.fv[g] = (t.fv[g] ?? 0) + 1; };
const bumpLane = (l: PlanLane) => { l.v = (l.v ?? 0) + 1; };
const n = (c: number, one: string, many: string) => c + " " + (c === 1 ? one : many);
const conflictLine = (c: AdoConflict) => FIELD_LABEL[c.field as OwnedField] + " er «" + (c.theirs ?? "") + "» i ADO, «" + (c.ours ?? "") + "» her";
type Target = Pick<PlanEvent, "targetType" | "targetId" | "targetLabel" | "laneKey">;

async function pushOne(client: AdoClient | null, type: string, adoId: number | null, fields: Fields, prev: LaneAdo | null, rels: { parent?: number | null; predecessors?: number[] }, opts: PushOpts) {
  const current = adoId && client ? await client.get(adoId) : null;
  const { writes, conflicts } = planFieldWrites(fields, current, prev?.snapshot ?? null, opts.force);
  const patch = [...fieldPatch(writes, { assignedTo: fields.assignedTo }), ...relationPatch(current, rels)];
  const action: PushedItem["action"] = !adoId ? "create" : patch.length ? "update" : "none";
  let id = adoId;
  if (!opts.dry && client && action !== "none") id = (action === "create" ? await client.create(type, patch) : await client.patch(id!, patch)).id;
  const ado: LaneAdo = { pushedAt: opts.now.toISOString(), snapshot: snapshotAfter(fields, conflicts, prev?.snapshot ?? null) };
  if (conflicts.length) ado.conflicts = conflicts;
  return { id, action, patch, conflicts, ado };
}
function pushEvents(t: Target, r: { id: number | null; action: PushedItem["action"]; patch: JsonPatch[]; conflicts: AdoConflict[] }, typeName: string, story?: { id: number | null; action: PushedItem["action"] }): PlanEvent[] {
  const what = r.action === "create" ? typeName + " opprettet" : r.action === "update" ? n(r.patch.length, "endring", "endringer") : "ingen endringer";
  const storyText = story?.action === "create" ? ", discovery-story #" + story.id : "";
  const ev = [adoEvent("ado.push", t, "Pushet til ADO #" + r.id + " (" + what + storyText + ")", { after: { adoId: r.id, action: r.action } })];
  for (const c of r.conflicts) ev.push(adoEvent("ado.konflikt", t, "Konflikt med ADO: " + conflictLine(c) + " – ikke overskrevet", { before: c.theirs, after: c.ours, causeRef: c.field }));
  return ev;
}

export async function pushItem(plan: Plan, target: PushTarget, client: AdoClient | null, opts: PushOpts): Promise<PushResult> {
  const p = clone(plan);
  const result: PushResult = { plan: p, items: [], events: [] };
  const pushEpic = async (lane: PlanLane) => {
    const r = await pushOne(client, "Epic", lane.adoId ?? null, epicFields(p, lane), lane.ado ?? null, {}, opts);
    result.items.push({ kind: "epic", id: lane.key, label: lane.name, adoId: r.id, action: r.action, type: "Epic", patch: r.patch, conflicts: r.conflicts });
    if (opts.dry) return;
    if (r.id && lane.adoId !== r.id) lane.adoId = r.id;
    lane.ado = r.ado; bumpLane(lane);
    result.events.push(...pushEvents({ targetType: "epic", targetId: lane.key, targetLabel: lane.name, laneKey: lane.key }, r, "Epic"));
  };
  if (target.kind === "epic") {
    const lane = p.lanes.find((l) => l.key === target.id);
    if (!lane) throw new Error("no-epic");
    await pushEpic(lane);
    return result;
  }
  const task = p.tasks.find((t) => t.id === target.id);
  if (!task) throw new Error("no-feature");
  if (task.lane === BACKLOG) throw new Error("on-shelf");
  const lane = p.lanes.find((l) => l.key === task.lane);
  if (!lane) throw new Error("no-epic");
  try {
    if (!lane.adoId) await pushEpic(lane);
    const parent = opts.dry && !lane.adoId ? null : lane.adoId ?? null;
    const predecessors = (task.deps ?? []).map((d) => p.tasks.find((t) => t.id === d)?.adoId).filter((x): x is number => !!x);
    const r = await pushOne(client, "Feature", task.adoId ?? null, featureFields(p, task), task.ado ?? null, { parent, predecessors }, opts);
    result.items.push({ kind: "feature", id: task.id, label: task.label, adoId: r.id, action: r.action, type: "Feature", patch: r.patch, conflicts: r.conflicts });
    let story: { id: number | null; action: PushedItem["action"] } | undefined;
    if (task.state === "utredes") {
      const s = await pushOne(client, ADO_WORK_ITEM_TYPE, task.ado?.storyId ?? null, storyFields(task, opts.people), null, { parent: r.id }, opts);
      result.items.push({ kind: "story", id: task.id, label: "Utredning: " + task.label, adoId: s.id, action: s.action, type: ADO_WORK_ITEM_TYPE, patch: s.patch, conflicts: [] });
      story = { id: s.id, action: s.action };
    }
    if (opts.dry) return result;
    if (r.id && task.adoId !== r.id) { task.adoId = r.id; bump(task, "meta"); }
    const next: TaskAdo = { ...r.ado };
    const storyId = story?.id ?? task.ado?.storyId;
    if (storyId) next.storyId = storyId;
    if (task.ado?.stories) next.stories = task.ado.stories;
    task.ado = next; bump(task, "ado");
    result.events.push(...pushEvents({ targetType: "feature", targetId: task.id, targetLabel: task.label, laneKey: task.lane }, r, "Feature", story));
    return result;
  } catch (e) {
    throw new PushFailed(result, e);
  }
}

export type RefreshConflict = AdoConflict & { kind: "epic" | "feature"; id: string; label: string };
export type RefreshResult = { plan: Plan; conflicts: RefreshConflict[]; read: { epics: number; features: number; stories: number; levert: number }; events: PlanEvent[] };
export async function refreshPlan(plan: Plan, client: AdoClient, now: Date): Promise<RefreshResult> {
  const p = clone(plan);
  const ids = new Set<number>();
  p.lanes.forEach((l) => { if (l.adoId) ids.add(l.adoId); });
  p.tasks.forEach((t) => { if (t.adoId) ids.add(t.adoId); if (t.ado?.storyId) ids.add(t.ado.storyId); });
  const byId = new Map((await client.batch([...ids])).map((w) => [w.id, w]));
  const childIds = new Set<number>();
  for (const t of p.tasks) for (const r of (t.adoId && byId.get(t.adoId)?.relations) || []) if (r.rel === ADO_CHILD_REL && !byId.has(relTarget(r))) childIds.add(relTarget(r));
  for (const w of childIds.size ? await client.batch([...childIds]) : []) byId.set(w.id, w);
  const events: PlanEvent[] = [], conflicts: RefreshConflict[] = [], read = { epics: 0, features: 0, stories: 0, levert: 0 };
  const check = (t: Target & { kind: "epic" | "feature" }, fields: Fields, prev: LaneAdo | undefined, current: AdoWorkItem): AdoConflict[] => {
    const c = planFieldWrites(fields, current, prev?.snapshot ?? null).conflicts;
    const old = new Set((prev?.conflicts ?? []).map((x) => x.field));
    for (const x of c) {
      conflicts.push({ ...x, kind: t.kind, id: t.targetId, label: t.targetLabel });
      if (!old.has(x.field)) events.push(adoEvent("ado.konflikt", t, "Konflikt med ADO: " + conflictLine(x) + " – ikke overskrevet", { before: x.theirs, after: x.ours, causeRef: x.field }));
    }
    return c;
  };
  const withConflicts = <A extends LaneAdo>(prev: A | undefined, c: AdoConflict[]): A => { const next = { ...(prev ?? ({ pushedAt: "", snapshot: {} } as A)) }; if (c.length) next.conflicts = c; else delete next.conflicts; return next; };
  for (const l of p.lanes) {
    const w = l.adoId ? byId.get(l.adoId) : undefined;
    if (!w) continue;
    read.epics++;
    const next = withConflicts(l.ado, check({ kind: "epic", targetType: "epic", targetId: l.key, targetLabel: l.name, laneKey: l.key }, epicFields(p, l), l.ado, w));
    if (JSON.stringify(next) !== JSON.stringify(l.ado)) { l.ado = next; bumpLane(l); }
  }
  for (const t of p.tasks) {
    const w = t.adoId ? byId.get(t.adoId) : undefined;
    if (!w) continue;
    read.features++;
    const next = withConflicts(t.ado, check({ kind: "feature", targetType: "feature", targetId: t.id, targetLabel: t.label, laneKey: t.lane }, featureFields(p, t), t.ado, w));
    const stories = readStories(w, byId, t.ado?.storyId);
    read.stories += stories.count;
    const strip = (a?: TaskAdo) => JSON.stringify({ ...(a ?? {}), stories: a?.stories ? { ...a.stories, at: "" } : undefined });
    next.stories = { ...stories, at: now.toISOString() };
    if (strip(next) !== strip(t.ado)) { t.ado = next; bump(t, "ado"); }
    const day = deliveredDay(w);
    if (day && t.state !== "levert") { t.state = "levert"; t.deliveredAt = day; bump(t, "state"); read.levert++; }
  }
  const parts = [n(read.epics, "epic", "epics"), n(read.features, "feature", "features"), n(read.stories, "story", "stories")];
  if (read.levert) parts.push(n(read.levert, "levert", "levert"));
  if (conflicts.length) parts.push(n(conflicts.length, "konflikt", "konflikter"));
  events.push(adoEvent("ado.lest", { targetType: "plan", targetId: "plan", targetLabel: "Planen", laneKey: null }, "Lest fra ADO: " + parts.join(", "), { after: read }));
  return { plan: p, conflicts, read, events };
}

export async function refreshSprints(plan: Plan, client: AdoClient, now: Date, maxAgeMs = 12 * 3600 * 1000): Promise<{ plan: Plan; changed: boolean; sprints: Sprint[] }> {
  const at = plan.sprints?.at ? new Date(plan.sprints.at).getTime() : 0;
  if (plan.sprints && now.getTime() - at < maxAgeMs) return { plan, changed: false, sprints: plan.sprints.items };
  const items = parseSprints(await client.iterations());
  const p = clone(plan);
  p.sprints = { at: now.toISOString(), items };
  return { plan: p, changed: true, sprints: items };
}
```

Note the «levert» summary in `refreshPlan`'s `ado.lest`: `n(read.levert, "levert", "levert")` reads «1 levert».

Routes (all with `Cache-Control: no-store`; editor = `session.user?.name ?? email ?? null`; `note = { source: "ado" }`):

`src/app/api/ado-push/route.ts`:
```ts
export async function POST(req: Request) {
  const session = await auth(); if (!session) return 401 unauthorized; if (session.role !== "writer") return 403 read-only;
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  body { kind, id, force } validated (kind epic|feature, id string) else 400;
  const stored = await readPlan(prisma); if (!stored) return 404 { error: "no-plan" };
  let client: AdoClient | null = null; let note: string | undefined;
  try { client = createAdoClient(await adoAuthFor(session, defaultTokenDeps(prisma))); }
  catch (e) { if (!(e instanceof AdoLoginRequired) || !dry) return adoErrorResponse(e); note = "Tørrkjøring uten ADO-token: patchene antar at ingenting er endret i ADO."; }
  const opts = { dry, force: !!force, people: peopleMap(process.env), now: new Date() };
  try {
    const r = await pushItem(stored.data, { kind, id }, client, opts);
    if (dry) return Response.json({ dry: true, items: r.items, ...(note ? { note } : {}) }, NO_STORE);
    const c = await commitPlan(prisma, { stored, after: r.plan, editor, note: { source: "ado" }, extraEvents: r.events });
    if (!c) return Response.json({ error: "contention", message: "Noen andre lagret samtidig. Prøv igjen." }, { status: 409 });
    return Response.json({ version: c.version, data: r.plan, items: r.items, changesetId: c.changesetId }, NO_STORE);
  } catch (e) {
    if (e instanceof PushFailed) { if (!dry && e.partial.items.length) await commitPlan(prisma, { stored, after: e.partial.plan, editor, note: { source: "ado" }, extraEvents: e.partial.events }).catch(() => null); return adoErrorResponse(e.cause, { items: e.partial.items }); }
    if (e instanceof Error && e.message === "on-shelf") return 400 { error: "on-shelf", message: "Legg featuren i en epic først; hylla speiles ikke til ADO." };
    if (e instanceof Error && (e.message === "no-feature" || e.message === "no-epic")) return 404 { error: e.message, message: "Fant ikke elementet i planen." };
    return adoErrorResponse(e);
  }
}
```
`adoErrorResponse` rethrows unknown errors; the route lets Next answer 500 for those.

`src/app/api/ado-refresh/route.ts`: writers; `readPlan` (404 no-plan) → client (401 via `adoErrorResponse`) → `refreshPlan(stored.data, client, new Date())` (AdoRequestError → `adoErrorResponse`) → `commitPlan` (409) → `{ version, data, conflicts, read, changesetId }`.

`src/app/api/ado-sprints/route.ts`: any signed-in person; `readPlan` (404 no-plan) → client (401) → `refreshSprints` → if `!changed` → `{ unchanged: true, sprints }` else `commitPlan` (on contention answer `{ unchanged: true, sprints }` too: the next boot retries) → `{ version, data, sprints }`.

- [ ] **Step 4: Run to verify GREEN, then commit**

Run: `npx vitest run src/features/ado && npx tsc --noEmit`
Expected: PASS (push 7/7); tsc clean.

```bash
git add src/features/ado/push.ts src/features/ado/push.test.ts src/app/api/ado-push src/app/api/ado-refresh src/app/api/ado-sprints
git -c commit.gpgsign=false commit -m "ado: push (epic, feature, discovery story), refresh (stories, points, sprint, levert, conflicts) and the sprint cache; three routes as the signed-in person"
```

---

### Task 8: The page: push buttons, the conflict bar, the sprint ruler, the sprint goal, the real estimate pull; smokes S14–S16

**Files:**
- Modify: `src/app/timeline/timeline.html`
- Modify (scratchpad): `hosted-history-smoke.mjs` (mock: fake ADO + the four routes through the real `pushItem` / `refreshPlan` / `refreshSprints`; S14–S16), `hosted-smoke.mjs` (mock answers `POST /api/ado-sprints` with `{ unchanged: true, sprints: [] }`)

**Interfaces:**
- Consumes: the routes of Tasks 6–7; `currentSprint`, `sprintDay`, `sprintLabel`, `dayKey` from epic-tools.js; `FV_FIELDS` gains `'ado'`.
- Produces: ids `#adoRefreshBtn`, `#adoBar` (`#adoText`, `#adoLogin`, `#adoBarClose`), `#adoList` (`.ado-row` with `.force[data-kind][data-id]`), `#sprintGoal`, `.axis .sprints .sprint(.now|.alt)`, `#edSpec`, `#edPushRow` (`#edPush` «Lagre og push til ADO», `#edPushDry` «Lagre og tørrkjør», `#edAdoNote`), `#edPullNote`, `#epPushRow` (`#epPush`, `#epPushDry`, `#epAdoNote`), chips `.chip.ado.stale` / `.chip.ado.conflict`, lane chip «ADO-konflikt».

- [ ] **Step 1: Extend the smoke mock and write S14–S16 (RED)**

In `hosted-history-smoke.mjs`: import `pushItem, refreshPlan, refreshSprints` from `…/src/features/ado/push.ts` and `currentSprint, dayKey` from epic-tools; add the in-memory fake ADO (same `fakeAdo` as the push test, with `iterations` built around today: `monday = today − ((day + 6) % 7)`, Sprint 71 = monday … monday + 11 days, as `YYYY-MM-DD` via `dayKey`); `record(before, after, note, version, extraEvents)` appends `extraEvents` and writes a `kind: "sprint"` snapshot (`day = sprint.start`, `label = "Sprintstart " + name`) when `currentSprint(before.sprints?.items, new Date())` exists and none is stored; routes:
- `POST /api/ado-push` (`?dry=1`): `pushItem(stored.data, body, fake.client, { dry, force: !!body.force, people: { THM: "thm@skytale.no" }, now: new Date() })`; dry → `{ dry: true, items }`; else store `result.plan` (version + 1), `record(before, after, { source: "ado" }, version, result.events)`, respond `{ version, data, items, changesetId }`; `on-shelf` → 400.
- `POST /api/ado-refresh`: `refreshPlan` → store → record → `{ version, data, conflicts, read, changesetId }`.
- `POST /api/ado-sprints`: no plan → `{ unchanged: true, sprints: [] }`; else `refreshSprints` → if changed store (no events) → `{ version, data, sprints }`.
- `GET /api/specs-estimate`: `folder === "Kontaktkort"` → `{ raw: { likely: 5, late: 8, estimatedBy: "THM", date: "2026-10-09" }, path: "/spec/Kontaktkort/estimate.yaml" }`; otherwise 404 `{ error: "no-file", message: "Fant ikke estimate.yaml" }`.
- `GET /__ado` → `{ items: [...fake.items.values()] }`.

Scenarios (replace the `// __LATER_SCENARIOS__` marker):

```js
// S14: «Lagre og push til ADO» on Kapasitet (Telenor has no ADO id): the epic is created first, the feature parented, chip #5001, no reason dialog, ado.push logged; the dry run reports no change
await page.click('.task-label[data-id="kapasitet"] .t'); await page.waitForSelector("#editorBack.open");
assert(!(await page.$eval("#edPushRow", (e) => e.hidden)), "push row visible for a writer");
await page.click("#edPush"); await savedNote();
await page.waitForFunction(() => /pushet til ADO/.test(document.getElementById("dirtyNote").textContent));
await page.waitForSelector('.task-label[data-id="kapasitet"] .chip.ado');
const chip = await page.$eval('.task-label[data-id="kapasitet"] .chip.ado', (e) => ({ text: e.textContent, stale: e.classList.contains("stale"), conflict: e.classList.contains("conflict") }));
assert(/^#\d+$/.test(chip.text) && !chip.stale && !chip.conflict, "fresh ADO chip: " + JSON.stringify(chip));
let adoItems = (await (await fetch(BASE + "/__ado")).json()).items;
const epicItem = adoItems.find((w) => w.fields["System.WorkItemType"] === "Epic"), featItem = adoItems.find((w) => w.fields["System.Title"] === "Kapasitet");
assert(epicItem && featItem && featItem.relations.some((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse" && r.url.endsWith("/" + epicItem.id)), "feature parented to the epic created in the same push");
ev = await evs();
assert(ev.events.filter((e) => e.code === "ado.push").length === 2 && ev.events.some((e) => e.code === "feature.ado" && e.cause === "ado"), "ado.push ×2 and feature.ado with cause ado");
assert(!(await page.$("#reasonBack.open")), "no reason dialog for a push");
await page.click('.task-label[data-id="kapasitet"] .t'); await page.waitForSelector("#editorBack.open");
await page.click("#edPushDry"); await page.waitForSelector("#dlgBack.open");
assert(/uendret \(0 operasjoner\)/.test(await page.$eval("#dlgMsg", (e) => e.textContent)), "dry run after a push: unchanged");
await page.click("#dlgYes");
console.log("S14 ok:", chip.text);

// S15: someone edits the title in ADO and closes a story; «Oppdater fra ADO» lists the conflict and reads the stories; «Push på nytt» overwrites; a Closed feature becomes levert
featItem.fields["System.Title"] = "Kapasitet v2";
await page.click('.task-label[data-id="fildeling"] .t'); await page.waitForSelector("#editorBack.open"); await page.click("#edPush"); await savedNote();
await page.waitForFunction(() => /pushet til ADO/.test(document.getElementById("dirtyNote").textContent));
adoItems = (await (await fetch(BASE + "/__ado")).json()).items;
const fildeling = adoItems.find((w) => w.fields["System.Title"] === "Fildeling i chat");
fildeling.fields["System.State"] = "Closed"; fildeling.fields["Microsoft.VSTS.Common.ClosedDate"] = "2026-12-03T10:00:00Z";
await page.click("#adoRefreshBtn");
await page.waitForFunction(() => /lest fra ADO/.test(document.getElementById("dirtyNote").textContent));
await page.waitForSelector("#adoBar:not([hidden])");
const barText = await page.$eval("#adoList", (e) => e.textContent);
assert(/Kapasitet/.test(barText) && /Tittel er «Kapasitet v2» i ADO, «Kapasitet» her/.test(barText), "conflict listed: " + barText);
assert(await page.$eval('.task-label[data-id="kapasitet"] .chip.ado', (e) => e.classList.contains("conflict")), "conflict chip");
ev = await evs();
const lev = ev.stored.data.tasks.find((t) => t.id === "fildeling");
assert(lev.state === "levert" && lev.deliveredAt === "2026-12-03", "Closed in ADO → levert: " + JSON.stringify({ state: lev.state, deliveredAt: lev.deliveredAt }));
assert(ev.events.some((e) => e.code === "feature.tilstand" && e.cause === "ado" && e.summary === "Levert 3. des"), "levert event from ADO");
assert(ev.events.some((e) => e.code === "ado.lest"), "ado.lest logged");
await page.click('#adoList .force[data-id="kapasitet"]'); await page.waitForSelector("#dlgBack.open"); await page.click("#dlgYes");
await page.waitForFunction(() => document.getElementById("adoBar").hidden);
adoItems = (await (await fetch(BASE + "/__ado")).json()).items;
assert(adoItems.find((w) => w.id === featItem.id).fields["System.Title"] === "Kapasitet", "force push restored the title");
console.log("S15 ok");

// S16: the sprint ruler and the today label; the sprint goal; the estimate pulled from Skytale.Specs; the sprint baseline in the compare list
await page.reload(); await page.waitForSelector(".axis .sprint.now");
assert(/Sprint 71/.test(await page.$eval(".axis .sprint.now", (e) => e.textContent)), "current sprint on the axis");
assert(/Sprint 71 · dag [1-5]$/.test(await page.$eval(".today .tl", (e) => e.textContent)), "today label: " + await page.$eval(".today .tl", (e) => e.textContent));
await page.waitForSelector("#sprintGoal:not([hidden])");
await page.click("#sprintGoal"); await page.waitForSelector("#dlgBack.open"); await page.fill("#dlgInput", "Tråder i beta"); await page.click("#dlgYes"); await savedNote();
assert(/mål: Tråder i beta/.test(await page.$eval("#sprintGoal", (e) => e.textContent)), "sprint goal shown");
ev = await evs();
assert(ev.events.some((e) => e.code === "plan.sprintmaal" && e.summary === "Sprintmål Sprint 71: «Tråder i beta»"), "sprintmål event");
assert(ev.changesets.length && (await (await fetch(BASE + "/api/timeline-snapshots")).json()).snapshots.some((s) => s.kind === "sprint" && s.label === "Sprintstart Sprint 71"), "sprint baseline written on the first save of the sprint");
await page.click('.task-label[data-id="' + placedTask.id + '"] .t'); await page.waitForSelector("#editorBack.open");
await page.fill("#edSpec", "Kontaktkort"); await page.click("#edPull");
await page.waitForFunction(() => document.getElementById("edLikely").value === "5" && document.getElementById("edLate").value === "8");
assert(/Utredningen sa 5–8 uker \(THM, 9\. okt\)/.test(await page.$eval("#edPullNote", (e) => e.textContent)), "pull note: " + await page.$eval("#edPullNote", (e) => e.textContent));
await page.click("#edSave"); await page.waitForSelector("#reasonBack.open"); await page.click('#reasonCodes button[data-code="utredning"]'); await page.click("#reasonSave"); await reasonClosed(); await savedNote();
ev = await evs();
const pulled = ev.stored.data.tasks.find((t) => t.id === placedTask.id);
assert(pulled.raw && pulled.raw.source === "specs" && pulled.raw.likely === 5 && pulled.raw.late === 8 && pulled.specPath === "Kontaktkort", "raw stored from Specs: " + JSON.stringify(pulled.raw));
assert(ev.events.some((e) => e.code === "feature.estimat-hentet" && e.summary === "Estimat hentet fra utredningen: 5–8"), "estimat-hentet event");
console.log("S16 ok");
```

Run: `npx tsx /private/tmp/claude-501/-Users-dnumreig-Skytale/eb935521-cbca-42ea-8aa7-cca1f2df86a8/scratchpad/hosted-history-smoke.mjs`
Expected: S1–S13 ok, S14 fails on `#edPushRow` missing.

- [ ] **Step 2: Build the page**

Markup (where the ids above say): the top-bar button; the bar + list after `#roBanner`; `#sprintGoal` before `#tlSummary` in the legend; `#edSpec`, `#edPushRow`, `#edPullNote` (a `.md` line under the pull button) in the feature editor; `#epPushRow` in the epic editor; the help card «ADO og sprinter»:

> Tidslinjen eier epics, features, estimater og avhengigheter; ADO speiler dem. **Lagre og push til ADO** i redigeringen oppretter eller oppdaterer epicen/featuren (tittel, beskrivelse, tilstand, parent, datoer, avhengigheter) og en discovery-story med eier og sluttdato mens featuren utredes. **Oppdater fra ADO** leser tilbake stories, poeng, sprint og det som er lukket («Levert»). Endres et felt i ADO etter siste push, listes det som **konflikt** øverst og overskrives aldri uten at du ber om det. Sprintene på aksen kommer fra ADO; «Sprint 71 · dag 4» står på dagens strek, og sprintmålet ved tegnforklaringen. Mangler tilgangen, ber siden deg logge inn på nytt.

CSS: `.ado-bar` (the `.cmp-bar` recipe with `--warn-bg` / `--warn-fg` and a `--warn-dot` border), `.ado-list .ado-row{display:flex;gap:10px;align-items:center;padding:6px 12px;font-size:12px;border-bottom:1px solid var(--line-soft)}`, `.axis .sprints{position:absolute;left:0;right:0;bottom:0;height:16px}`, `.axis .sprint{position:absolute;bottom:0;height:16px;font-size:9px;line-height:16px;padding-left:4px;border-left:1px solid var(--line);color:var(--text-4);white-space:nowrap;overflow:hidden}`, `.axis .sprint.alt{background:var(--raised)}`, `.axis .sprint.now{color:var(--text);font-weight:600}`, `.task-label .chip.ado.stale{outline:1px dashed var(--ado-fg);outline-offset:-1px}`, `.task-label .chip.ado.conflict{background:var(--bad-bg);color:var(--bad-fg)}`, `.sprint-goal{font-size:11px;color:var(--text-3);cursor:pointer}`, `#dlgMsg.pre{white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:11px;text-align:left}`.

JS:
- `FV_FIELDS` + `'ado'`; `let adoLoginNeeded = false; const afterSaveQueue = [];` and `function afterSave(fn){ afterSaveQueue.push(fn); }`; in `pushPlan` right after `refreshHistoryBadge()`: `afterSaveQueue.splice(0).forEach(fn => fn());` (also drain the queue in the 403 branch so a reader's click never hangs).
- `adoCall(path, body)` (POST, JSON; 401 `ado-login` → `adoLoginNeeded = true; renderAdoBar(); throw new Error('ado-login')`; non-ok → `throw new Error(j.message || 'HTTP ' + r.status)`; ok → `adoLoginNeeded = false`).
- `pushToAdo(kind, id, opts)`, `dryText(j)` (per item: `type + (adoId ? ' #' + adoId : '') + ' · ' + {create:'opprettes', update:'oppdateres', none:'uendret'} + ' (' + patch.length + ' operasjoner)'` + conflicts + one line per op with the value's text (tags stripped, 80 chars)), shown with `askDialog('Tørrkjøring', text, { confirmText: 'OK', noCancel: true })` after adding class `pre` on `#dlgMsg` (removed on close).
- `refreshFromAdo()`: `adoCall('api/ado-refresh')` → `applyRemote(j.data, j.version)` → `setSaveNote('lest fra ADO: ' + j.read.features + ' features, ' + j.read.stories + ' stories' + (j.read.levert ? ', ' + j.read.levert + ' levert' : '') + (j.conflicts.length ? ', ' + j.conflicts.length + ' konflikter' : ''))`; `refreshHistoryBadge()`.
- `loadSprints()` (called at the end of `initServerPlan` after the plan is applied, hosted only): `adoCall('api/ado-sprints')` → `if(j.data && !pendingSave) applyRemote(j.data, j.version); else if(j.sprints && !state.sprints){ state.sprints = { at: new Date().toISOString(), items: j.sprints }; render(); }`; errors: `ado-login` only shows the bar for writers (`if(!canWrite) adoLoginNeeded = false`), anything else is silent.
- `renderAdoBar()` (called from `render()`): rows = every lane / task with `ado.conflicts.length`; text «ADO-konflikter: N – endret i ADO etter siste push. Ingenting er overskrevet.»; a row = `where · FieldLabel er «theirs» i ADO, «ours» her · [Åpne i ADO] [Push på nytt (overskriv)]`; `adoLoginNeeded` → text «Logg inn på nytt for å koble til ADO.» and `#adoLogin` shown; hidden when neither; `#adoBarClose` hides until the next render with a change (`adoBarDismissed` keyed on the rows' JSON).
- `.force` click → `confirmDialog('Push på nytt', 'Skriver Tidslinjens verdier over det som står i ADO for «…». Konflikten logges.', { confirmText: 'Overskriv', danger: true })` → `pushToAdo(kind, id, { force: true })`.
- Axis: after the month cells, the sprint layer from `state.sprints.items` (see the chart in Task 8's design: `left = x(max(VIEW_FROM, dateToUnit(dayToDate(start))))`, `width` to `dateToUnit(dayToDate(finish)) + 1/30`, label the full name when wider than 56 px, `now` on `currentSprint`, `alt` on odd indexes). Today label: `+ (sprintLabel(items, tn) ? ' · ' + sprintLabel(items, tn) : '')`.
- `renderSprintGoal()` (from `updateTlSummary`): hidden without a current sprint; text `cur.name + ' · dag ' + sprintDay(cur, now) + ' · mål: ' + (goal || (canWrite ? 'sett sprintmål…' : '–'))`; click (writers) → `askDialog(cur.name + ': sprintmål', 'Én setning: hva sprinten skal ha levert.', { input: true, value: current, confirmText: 'Lagre' })` → when not cancelled: `state.sprintGoals[cur.name] = { text, at: new Date().toISOString() }; save(); updateTlSummary()`. (Check how `askDialog` resolves on cancel in the existing `dlgNo` handler and branch on that value.)
- Chips: `.chip.ado` gets `conflict` when `t.ado.conflicts.length`, else `stale` when `t.ado && t.editedAt && t.ado.pushedAt < t.editedAt` (title «Endret etter siste push – push på nytt fra redigeringen»); lane header: `lane.ado.conflicts.length` → `<span class="chip st-rod" title="…">ADO-konflikt</span>`.
- History drawer and compare list: `e.cause === 'ado'` → `<span class="chip cause">ADO</span>`.
- Feature editor: `openEditor` fills `#edSpec`, `#edAdoNote` («Ikke pushet ennå» / «Sist pushet 9. okt 10:12 · discovery-story #5002 · 2 stories, 3/8 poeng · Sprint 71»), `#edPushRow.hidden = !HOSTED || !canWrite || t.lane === BACKLOG`, `#edPullNote` cleared, `edPulled = null`; `edSave` stores `specPath` (meta) and, when `edPulled` matches the typed weeks (`lw === edPulled.likely + buf && hw === edPulled.late + buf`), sets `t.raw = { likely, late, source: 'specs', pulledAt: new Date().toISOString(), by, date }` (`touch(t, 'est')`) with the planned range = raw + buffer; `#edPush` / `#edPushDry` → `afterSave(() => pushToAdo('feature', id, { dry }))` then `$('edSave').click()`.
- `#edPull`: needs `#edSpec` (else a dialog «Skriv mappenavnet i Skytale.Specs først»); `GET api/specs-estimate?id=…&folder=…`; 401 → login bar + dialog; ok → `edPulled`, switch the kind to estimate if needed, fill `#edLikely/#edLate` with raw + buffer, `#edPullNote` = «Utredningen sa 5–8 uker (THM, 9. okt). Før: 4–6.» (the date via `fmtDate(new Date(date))`; «Før: –» when the task had no range).
- Epic editor: `#epAdoNote`, `#epPushRow.hidden = !HOSTED || !canWrite`, `#epPush` / `#epPushDry` → `afterSave(() => pushToAdo('epic', key, { dry }))` then `$('epSave').click()`.
- `initServerPlan`: `$('adoRefreshBtn').hidden = !canWrite`, then `loadSprints()`; `#adoRefreshBtn` click → `refreshFromAdo()`.
- Reader 403 path (`pushPlan`): also hide `#adoRefreshBtn`.

- [ ] **Step 3: Run the smokes until green**

Run: the hosted history smoke (S1–S16), then `npx tsx <scratchpad>/ui-smoke.mjs`, `hosted-smoke.mjs` (after adding the `ado-sprints` stub), `theme-shots.mjs`.
Expected: all OK; no page errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/timeline/timeline.html
git -c commit.gpgsign=false commit -m "timeline page: push to ADO from the editors, the conflict bar, read back from ADO, the sprint ruler and sprint goal, the estimate pulled from Skytale.Specs"
```
Copy the smokes to `~/Skytale/ClaudeReports/planning/roadmap-2.0/build/` (committed there separately, .md-only rule applies to that repo: the .mjs copies stay untracked as in stages 1–3).

---

### Task 9: Stage gate: suite, build, live read-only check, review, PR text, ledger

- [ ] **Step 1: Whole suite** — Run: `npx vitest run 2>&1 | tail -5 && npx tsc --noEmit && npx next build 2>&1 | tail -8`. Expected: all tests pass (about 135), tsc clean, build OK with the three new routes listed.
- [ ] **Step 2: Live read-only check against the real ADO** (no writes; `ADO_DEV_TOKEN` from `az account get-access-token --resource 499b84ac-… --query accessToken -o tsv`): a scratchpad `tsx` script that builds `createAdoClient("Bearer " + token)`, calls `iterations()` → `parseSprints` (expect Sprint 71 = 2026-10-05 … 2026-10-16), `get(4742)` → title «Calls», `gitItem(SPECS_REPO_ID, "/spec/Threading/spec.md")` → non-null, `gitItem(…, "/spec/Threading/estimate.yaml")` → null. Expected: four lines OK. The first live push is agreed with GO (spec §5 R3) and is not run here.
- [ ] **Step 3: Inline review** of `3e5cdc8..HEAD` in the review-branch style (diff dumped to the scratchpad `review/`), one fix pass for Critical/Important with RED→GREEN tests, minors to the ledger.
- [ ] **Step 4: PR text** — append «Stage 4 · ADO mirror, sprint ruler, Specs reader» to `~/Skytale/ClaudeReports/planning/roadmap-2.0/pr-body-planning-system.md` (what changed, the tenant step, the env changes incl. the PAT removal, verification, what waits for GO: admin grant, first live push, `SKYTRACKER_ADO_PEOPLE`).
- [ ] **Step 5: Ledger + memory** — `Stage 4: complete (…)` line; memory file status → stage 4 complete, next stage 5.
