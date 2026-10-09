# Tidslinjen R8: size classes and one queue per person Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The forum picks a discovery's size (S/M/L/XL) and the date follows; a discovery occupies its owner, so the owner's features and later discoveries queue behind it; a per-person view shows each owner's sequence.

**Architecture:** `epic-tools.js` gains the stored-class semantics and the discovery rules in the queue (`floorOf`, `resolveQueue`, `queueFloor`); `events.ts` names a discovery in the queue cause; the page gets class buttons in «Start utredning», the drift text on shelf and bars, the «utredning» wording on the queue chip, and a read-only per-person mode that renders virtual lanes.

**Spec:** `docs/superpowers/specs/2026-10-09-planning-system-r7-r9-design.md` §5 (decisions 3 and 4).

## Global Constraints

- The pin (`pinned`) overrides every queue rule, as in R5. Blockers (`deps`) still come first.
- A discovery is never moved by a feature; only by its blockers and by an earlier overlapping discovery of the same owner.
- Norwegian in UI, English in code; `epic-tools.js` exports = `.d.ts`.

## Review Focus

1. A discovery far in the future (next year) must not push today's features of the same owner: only overlapping discoveries count.
2. A feature pushed past one discovery may now overlap the owner's next discovery: the loop must settle (guard 200) with the feature after both.
3. A discovery without an owner never occupies anyone.
4. The per-person view is read-only: no drag, no add, no link/delete; toggling back restores the epic view with the scroll position.
5. `sizeClass` stored on an estimate (not a discovery) is ignored by the display.

---

### Task 1: stored classes and the discovery rules in the queue (epic-tools + events)

- [ ] Tests (RED): `sizeClass` stored first, `sizeClassDerived` from duration, `sizeClassText` «M, nå L»; queue cases: feature pushed after an overlapping discovery of the same owner (cause queue, by the discovery); two overlapping discoveries of one owner sequence by start; a discovery is not pushed by a feature; a future discovery leaves today's feature alone; pinned stays; other owner untouched; the old «discoveries are left alone» case is rewritten to the new rule. Events: «i kø bak utredning «D» (THM)».
- [ ] Implement, GREEN, suite green. Commit: `timeline: stored size classes; a discovery occupies its owner in the queue`.

### Task 2: the page: class buttons, drift text, queue wording

- [ ] Smoke (RED): «Start utredning» with L → end = start + 4 plan weeks to the day, `sizeClass: "L"`, shelf text «Utredes · THM · til … · L»; drag the end later by two weeks → text «L, nå XL»; a feature of THM overlapping the discovery gets the chip «i kø bak utredning «X» (THM)».
- [ ] Implement, GREEN. Commit: `timeline: «Start utredning» picks S/M/L/XL; the bar says when a discovery holds a feature`.

### Task 3: the per-person view

- [ ] Smoke (RED): click «Per person» → lanes «THM», «KSO», «Uten eier» in that order; THM's row lists the discovery then the feature by start; no grips, no «+»; click again → epic view back.
- [ ] Implement (virtual lanes in `render()`, `personMode` flag, guards on drag/edit/add). GREEN. Commit: `timeline: a per-person view of discoveries and features`.

### Task 4: hand-over

- [ ] Ledger closed, PR text section, memory.
