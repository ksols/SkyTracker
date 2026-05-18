# CLAUDE.md — SkyTracker

Lightweight personal/team Kanban board. Next.js 16 (App Router) + React 19 + Prisma 7 + Postgres + Auth.js v5 (Microsoft Entra ID) + Tailwind v4.

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
├── app/                              # Next.js App Router
│   ├── api/auth/[...nextauth]/       # Auth.js handlers
│   ├── login/                        # Public sign-in page
│   ├── page.tsx                      # Protected board view (= "/")
│   ├── layout.tsx
│   ├── globals.css
│   └── icon.svg                      # Favicon (App Router convention)
├── components/                       # Presentational React components
│   ├── board/                        # Board UI: Board, Column, Card, Add*Form
│   └── SignOutButton.tsx
├── features/                         # Domain logic, grouped by feature
│   └── board/
│       ├── queries.ts                # Read-side: getOrCreateBoard, getBoardWithContents
│       ├── actions.ts                # Server actions (mutations). Validation lives here via Zod.
│       └── types.ts                  # Domain types (CardTag, parseTags, DEFAULT_TAGS)
├── lib/                              # Cross-cutting wiring (one entity per file)
│   ├── prisma.ts                     # PrismaClient singleton + pg adapter
│   ├── auth.config.ts                # EDGE-safe Auth.js config (providers + pages only). Imported by middleware.
│   └── auth.ts                       # Full NextAuth() config (adds Prisma adapter + DB sessions). Node runtime only.
├── generated/prisma/                 # Prisma 7 generated client (DO NOT EDIT, committed)
│   ├── client.ts                     # → `import { PrismaClient } from "@/generated/prisma/client"`
│   └── models.ts                     # → `import type { CardModel } from "@/generated/prisma/models"`
└── middleware.ts                     # Protects every route except /login + /api/auth + assets
prisma/
└── schema.prisma                     # Schema. No `url` here — see prisma.config.ts.
prisma.config.ts                      # Datasource URL + migrations path (Prisma 7 lives here, not in schema)
.env / .env.example                   # Local secrets; never commit .env
```

## How to work in this code

### Adding a new domain feature
1. Add the model to `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <change>` (or `npx prisma db push` for throwaway iteration).
3. Create `src/features/<feature>/{queries.ts,actions.ts,types.ts}`.
4. Create `src/components/<feature>/` with presentational React components.
5. Use the feature from `src/app/.../page.tsx`. Pages stay thin — fetch via `features/*/queries`, mutate via `features/*/actions`.

### Conventions
- **Server Components by default.** Only mark `"use client"` if you actually need state, effects, or browser-only APIs. The board is fully server-rendered.
- **Mutations are Server Actions**, not API route handlers. They live in `src/features/<feature>/actions.ts`, marked with `"use server"` at the top of the file.
- **Validation in Server Actions uses Zod.** `formData.get(...)` → `schema.parse(...)`. Never trust client input. Auth check first via `await auth()` (see `requireAuth()` helper pattern in `features/board/actions.ts`).
- **Reads via `features/*/queries.ts`**, writes via `features/*/actions.ts`. Pages should not call Prisma directly except trivially — that's what the feature layer is for. (For a 1-call read, inline is fine. When it grows past that, extract.)
- **Types from Prisma** import as `CardModel`, `ColumnModel`, etc. from `@/generated/prisma/models`. The bare names (`Card`, `Column`) are React components, not types.
- **Auth helper:** `import { auth, signIn, signOut } from "@/lib/auth"` (server-component/action only — Node runtime). The route handler lives at `src/app/api/auth/[...nextauth]/route.ts` and just re-exports `handlers`. **Never import `@/lib/auth` from `middleware.ts`** — middleware runs in Edge runtime and `@/lib/auth` transitively pulls in Prisma (which uses `node:*` modules). Middleware imports `@/lib/auth.config` instead.
- **`revalidatePath("/")`** after every mutation so the board reflects changes on next render.
- **No client-side data fetching libraries** (no SWR/React Query). Server Components + Server Actions + `revalidatePath` is enough for v1.
- **Path alias** `@/*` → `./src/*`. Always prefer the alias over relative imports across folders.

### What v1 does NOT have (intentionally — YAGNI)
- Drag-and-drop reordering. Cards/columns have `position: Int` but reordering UI isn't built yet. Add it via `dnd-kit` when needed; the schema is ready.
- Real-time / multi-user live updates. Refresh to see other users' edits.
- Multiple boards. There's exactly one `Board` row, created on first load (`getOrCreateBoard`).
- Optimistic UI. Server Actions revalidate; the page re-fetches. Add `useOptimistic` if latency hurts.
- A separate "User can own a card" relationship. Cards aren't owned. Add a `Card.assigneeId` later if needed.

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
- **Auth.js v5 split config (Edge ↔ Node).** Middleware runs in Edge runtime and cannot import Prisma, so we split the Auth.js config in two: `lib/auth.config.ts` holds the Edge-safe parts (providers, pages — no adapter, no DB), and `lib/auth.ts` extends it with `PrismaAdapter` + `session: { strategy: "database" }`. **Middleware imports `auth.config`; everything else imports `auth`.** With database sessions, middleware can only check that a session cookie exists (it can't validate against the DB in Edge), and full validation happens in server components/actions when they call `auth()`. If you add a new auth provider or change `pages`, edit `auth.config.ts`; if you change adapter/session/callbacks, edit `auth.ts`.
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
