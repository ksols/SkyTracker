# Design: SkyTracker ↔ Azure DevOps work-item creation

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Related:** GitHub issue ksols/SkyTracker#3

## Goal

Let SkyTracker create the equivalent work item in Azure DevOps when a card is
added, and display a link to the ADO work item on cards that are attached.
Scope for v1 is **SkyTracker → ADO** (create + link) plus showing the ADO
number. Two-way sync is explicitly out of scope.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| ADO auth model | **App PAT** (`ADO_PAT`, server-only). Service identity, not per-user. |
| Trigger | **In-app server action, opt-in** via a checkbox in the add-card form. |
| TaskType → ADO type | **All cards → User Story** for v1. Reclassify in ADO if needed. |

## Architecture

### Auth
- The server holds `ADO_PAT` in env (server-only; never sent to the client).
- ADO REST calls use HTTP Basic auth: `Authorization: Basic base64(":" + PAT)`.
- Attribution: because the PAT is a service identity, the real SkyTracker user
  is stamped into the created work item's description
  ("Created from SkyTracker by `<user>`").

### Module layout
New feature module `src/features/ado/` keeps ADO concerns isolated:
- `client.ts` — thin REST wrapper: `createWorkItem`, `addWorkItemLink`,
  `resolveIterationPath`. Uses `fetch`. No Prisma, no React.
- `actions.ts` — `"use server"` action(s) that orchestrate: read card, call
  client, write `adoWorkItemId` back via Prisma, `revalidatePath("/")`.

Constants (in the module):
- Org: `https://dev.azure.com/SkytaleAS`
- Project: `Skytale`
- Work item URL: `https://dev.azure.com/SkytaleAS/Skytale/_workitems/edit/<id>`
- API version: pin a current `api-version` (confirm at build time).

### Schema
- Add `adoWorkItemId Int?` to the `Card` model (nullable — most cards are not
  linked). The URL is derived in the UI, not stored.
- Migration: `npx prisma migrate dev --name add_ado_work_item_id`, then
  `npx prisma generate`.

## Behaviour

### Add-card flow (opt-in)
1. The add-card form gains an **"Also create in ADO"** checkbox and an optional
   **Sprint number** field. Tags (Backend/Frontend) and dependencies already
   exist on the card model.
2. On submit with the box checked, the server action:
   - Creates the card locally **first**. The local board is never blocked by
     ADO availability.
   - Calls the ADO client to create the work item.
   - On success, writes the returned id to `card.adoWorkItemId` and
     revalidates.
   - On failure, the card still exists with `adoWorkItemId = null`; an error is
     surfaced to the user; the card can be retried later (see Retry).

### What gets created in ADO
- **Type:** User Story (v1, all cards).
- **Title:** `card.title`.
- **Description:** `card.description` + attribution stamp.
- **Tags:** applicable card tags (e.g. `Backend`, `Frontend`) mapped to ADO
  Tags (semicolon-separated), plus a `SkyTracker` tag.
- **Iteration:** if a sprint number is supplied, set `System.IterationPath`.
  ⚠️ The exact path format (e.g. `Skytale\Sprint <n>`) is **verified at build
  time** via ADO's classification-nodes API, not guessed.
- **Dependencies:** for each "blocked by" relation where the blocker card
  **already has an `adoWorkItemId`**, add a **Predecessor** link
  (`System.LinkTypes.Dependency-Reverse`). Blockers not yet in ADO are skipped
  (they can be linked when they are later created/attached). ⚠️ Exact link-type
  reference name verified at build time.

### Retry / attach-later
- `EditCardModal` gains a **"Create in ADO"** button shown only for cards with
  no `adoWorkItemId`. It calls the same server action. This covers both retry
  after a failed create and attaching pre-existing cards.

### Card badge (display)
- `Card.tsx` renders a `#<id>` badge for cards with an `adoWorkItemId`, linking
  to the ADO work item with `target="_blank"`.
- The link's click handler calls `stopPropagation()` so clicking the badge
  opens ADO rather than the card's edit modal — consistent with the
  click/drag fix in PR #2.

## Error handling
- ADO failures never roll back the local card; they surface an error and leave
  `adoWorkItemId` null for retry.
- Dependency links that can't be created (blocker not yet in ADO) are skipped
  silently — they are not errors.
- The PAT is read server-side only; absence/invalid PAT produces a clear error.

## Testing
- The repo currently has no test harness. The ADO client (`client.ts`) is the
  unit worth covering — pure request-building + response-parsing, mockable by
  stubbing `fetch`. Introducing a minimal test runner (e.g. vitest) for this is
  a reasonable part of the work; confirm in the implementation plan.
- The server action and UI are verified manually against the dev ADO project.

## Out of scope (v1 — YAGNI)
- Two-way sync (ADO → SkyTracker state/title/assignee).
- Auto-close or delete of the ADO item when a card is removed.
- Per-user delegated auth (we use the App PAT only).
- Mapping nuanced TaskTypes to distinct ADO types (all → User Story).

## Build-time verifications (do not guess)
1. **Iteration path format** — query the classification-nodes API to learn the
   real `System.IterationPath` shape before mapping a sprint number.
2. **Dependency link reference name** — confirm `System.LinkTypes.Dependency-Reverse`
   (Predecessor) is correct for the Skytale ADO process.
3. **`api-version`** — pin a current, supported value.
