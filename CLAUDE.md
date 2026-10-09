# CLAUDE.md — SkyTracker

Skytale's planning system: the feature board (`/`), the timeline «Tidslinjen» (`/timeline`) and the intake «Inntak» (`/inntak`) over one shared plan, mirrored to Azure DevOps as Epics and Features. Next.js 16 (App Router) + Prisma 7 + Postgres + Auth.js v5 (Microsoft Entra ID); the three pages are plain HTML/JS served by route handlers. Design: `docs/superpowers/specs/2026-10-08-planning-system-design.md` and the R7–R9 amendment beside it.

## Stack & versions

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, React 19, TypeScript |
| Styling | Tailwind v4 (`@import "tailwindcss"` in `globals.css`) |
| ORM | Prisma 7 (new `prisma-client` generator → `src/generated/prisma/`) |
| DB driver | `@prisma/adapter-pg` over `pg` (works for local Postgres, Vercel Postgres, Neon, anything Postgres-shaped) |
| Auth | `next-auth@beta` (Auth.js v5) with `@auth/prisma-adapter`. Single provider: **Microsoft Entra ID** |
| Validation | Zod (in server actions) |
| Hosting target | Vercel |

## Folder structure

```
src/
├── app/
│   ├── route.ts + board.html           # The feature board: the plan's features as a Kanban over the lifecycle (plain JS)
│   ├── timeline/route.ts + timeline.html  # Tidslinjen: epics, features, the shelf, history, compare, ADO, investors (plain JS)
│   ├── inntak/route.ts + inntak.html   # Inntak: PreSales' wishes and produktforum's decisions (plain JS)
│   ├── timeline/epic-tools.js          # Shared plain-JS logic (normalisation, queue, classes, labels); also imported by vitest and the pages
│   ├── api/timeline-*/                 # The plan (GET/PUT with merge), changes, snapshots, compare, digest, investor
│   ├── api/ado-*/                      # ADO on the signed-in person's Entra token: push, refresh, sprints, import
│   ├── api/board-import, api/specs-estimate
│   ├── api/auth/[...nextauth]/, login/, layout.tsx, globals.css, icon.svg
├── features/
│   ├── timeline/                       # merge (field-group versioning), events, history, compare, report, investor, notify, plan-store
│   ├── ado/                            # client (REST), token (Entra), plan-mappers (fields, conflicts, patches), push, import, config, http
│   └── board/import.ts                 # The old cards → features, once
├── lib/                                # prisma.ts, auth.config.ts (Edge-safe), auth.ts (Node, Prisma adapter, token storage)
└── generated/prisma/                   # Prisma 7 generated client (DO NOT EDIT)
prisma/schema.prisma                    # TimelinePlan + history tables; Card/Column/Dependency stay for the one-time import
```

## How to work in this code

- **The plan is one JSON document** (`TimelinePlan.data`, id `epics`): lanes (epics), tasks (features), wishes (the intake),
  sprints, capacity. Every page loads it with `GET /api/timeline-plan`, edits it in the browser and saves it with `PUT`;
  the server merges by field group (`src/features/timeline/merge.ts`), bumps the version and records a changeset with
  events (`events.ts`, `history.ts`). Read `plan-store.ts` and `merge.ts` before touching a page.
- **The pages are plain HTML/JS** (`board.html`, `timeline.html`, `inntak.html`) served by route handlers behind the Entra
  login. Shared rules live in `src/features/timeline/epic-tools.js`; its `module.exports` must equal `epic-tools.d.ts`, and
  the page's `FV_FIELDS` must equal `TASK_FIELD_GROUPS`. No React on these pages.
- **ADO runs as the signed-in person** (`src/features/ado/token.ts`, delegated `user_impersonation`); no PAT anywhere.
  SkyTracker owns epics, features, estimates, dependencies and pushes them; ADO owns stories and sprints.
- **Tests**: `npx vitest run` (pure modules, `src/**/*.test.ts`), `npx tsc --noEmit`, `npx eslint src`; the pages are
  exercised by Playwright smokes kept in `~/Skytale/ClaudeReports/planning/roadmap-2.0/build/` (they run the real modules
  behind a mock API: `npx tsx <smoke>.mjs` from this directory).
- Norwegian in the UI and stored text, English in code and commits.

## Setup

### 1. Database
Pick one:
- **Local Postgres:** install Postgres, create `skytracker` db, point `DATABASE_URL` in `.env` at it.
- **Prisma's local sandbox:** `npx prisma dev` (runs Postgres in your terminal, prints a URL).
- **Vercel Postgres:** create from the Vercel dashboard, copy the connection string into `.env` and into the Vercel project's env vars.

Then:
```bash
npx prisma migrate dev --name init   # first time
npx prisma generate                  # whenever schema.prisma changes
```

### 2. Microsoft Entra ID app registration
In Entra admin > App registrations > New registration:
- Name: `SkyTracker` (or whatever)
- Supported account types: pick what fits your tenant policy
- Redirect URI (Web): `http://localhost:3000/api/auth/callback/microsoft-entra-id` (and production URL when deploying)
- Create a client secret, copy the value
- Note the Application (client) ID and Directory (tenant) ID

Fill `.env`:
```
AUTH_SECRET="..."                                       # npx auth secret
AUTH_MICROSOFT_ENTRA_ID_ID="<client-id>"
AUTH_MICROSOFT_ENTRA_ID_SECRET="<client-secret>"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<tenant-id>/v2.0"
```

### 3. Run
```bash
npm run dev
# → http://localhost:3000 (redirects to /login if signed out)
```

## Commands

```bash
npm run dev                          # Local dev server (Turbopack)
npm run build && npm start           # Prod build
npm run lint                         # ESLint
npx tsc --noEmit                     # Typecheck only
npx prisma migrate dev --name X      # Create + apply migration
npx prisma studio                    # Open Prisma's DB browser
npx prisma generate                  # Regenerate client (after schema edits)
npx auth secret                      # Generate AUTH_SECRET
```

## Gotchas worth remembering

- **Prisma 7 dropped `url = env("DATABASE_URL")` from `schema.prisma`.** The URL lives in `prisma.config.ts` for migrations, and the runtime client gets it via the `@prisma/adapter-pg` adapter constructor in `src/lib/prisma.ts`. Don't try to "fix" the schema by adding `url` back — it won't validate.
- **The Prisma generated client is committed.** It's TypeScript source, not compiled output. Treat it as build artifact: don't edit, do commit, regenerate via `npx prisma generate` after schema changes.
- **Auth.js v5 provider name is `microsoft-entra-id`**, not `azure-ad` (renamed). The redirect URI ends in `/api/auth/callback/microsoft-entra-id`.
- **Tags field is JSON.** `Card.tags` is a JSON array of `{ name, applicable }`. Parse via `parseTags` (defensive — DB JSON is untyped). Don't put domain logic on tag arrays elsewhere; centralise it in `features/board/types.ts`.
- **Middleware protects everything except `/login`, `/api/auth/*`, and static assets.** If you add a route that should be public (e.g. `/healthz`), update the matcher in `src/middleware.ts`.
- **Auth.js v5 split config (Edge ↔ Node) — JWT sessions.** Middleware runs in Edge runtime and cannot import Prisma, so we split the Auth.js config in two: `lib/auth.config.ts` holds the Edge-safe parts (providers, pages, **session strategy**), and `lib/auth.ts` extends it with `PrismaAdapter`. **Middleware imports `auth.config`; everything else imports `auth`.** Session strategy is **JWT, not database** — required for Edge compatibility, because database sessions need a DB roundtrip to validate and Edge can't reach Prisma. The encrypted JWE cookie carries the session payload; `auth()` decrypts it without touching the DB. The Prisma adapter still writes `User` and `Account` rows on first sign-in (so the user identity is persistent), but the `Session` table stays empty — it's only used if you switch back to database strategy. If you add a new auth provider, change `pages`, or change session strategy, edit `auth.config.ts`; if you change adapter or callbacks, edit `auth.ts`.
- **No `git commit` from automated tooling unless explicitly asked.** This project is local-only until pushed.

## Deployment to Vercel

### Build command
Migrations don't run automatically — they're wired into `vercel-build` in `package.json`:

```jsonc
"postinstall":    "prisma generate",
"vercel-build":   "prisma generate && prisma migrate deploy && next build"
```

In Vercel **Project Settings → Build & Output Settings → Build Command**, set:
```
npm run vercel-build
```

- `postinstall` regenerates the Prisma client on every `npm install` (Vercel caches `node_modules`, so this is the only reliable hook).
- `prisma migrate deploy` applies all pending migrations non-interactively. It's the production sibling of `migrate dev` — never prompts, never writes new migration files.

### Env vars (Production + Preview)

| Name | Value |
|---|---|
| `DATABASE_URL` | Postgres TCP connection string (see below) |
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Entra app reg client ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Entra app reg client secret |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` |

Auth.js v5 auto-trusts the host on Vercel, so `AUTH_TRUST_HOST` is **not** needed.
Also: add the production callback URL `https://<your-domain>/api/auth/callback/microsoft-entra-id` to the Entra app registration.

### Which `DATABASE_URL`-shaped env var to use

Our code reads `process.env.DATABASE_URL`. The Vercel-injected name depends on which DB product you connect:

| DB product | Vercel injects | Action |
|---|---|---|
| **Prisma Postgres** (Vercel Marketplace) | `DATABASE_URL` (direct TCP) + `PRISMA_DATABASE_URL` (Accelerate) | Use `DATABASE_URL` as-is. Ignore `PRISMA_DATABASE_URL` — our `@prisma/adapter-pg` doesn't speak the Accelerate `prisma+postgres://` protocol. |
| **Legacy Vercel Postgres** (Neon-backed) | `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` | Add a manual `DATABASE_URL` env var, value = `POSTGRES_PRISMA_URL`. |
| **External** (Neon direct / Supabase / self-hosted) | nothing | Add `DATABASE_URL` manually: `postgres://user:pass@host:port/db?sslmode=require` |

### Pooled vs direct connections (when migrations need it)

PgBouncer transaction pooling rejects some commands `prisma migrate deploy` runs. If you hit migration errors at build time using a pooled URL (mostly legacy Vercel Postgres / Supabase / Neon-via-pgbouncer), add a separate `DIRECT_URL` env var (non-pooled) and update `prisma.config.ts`:

```ts
datasource: {
  url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
}
```

Prisma Postgres (Marketplace integration) handles pooling transparently — you only need `DIRECT_URL` when using a partner DB whose pooler can't run DDL.
