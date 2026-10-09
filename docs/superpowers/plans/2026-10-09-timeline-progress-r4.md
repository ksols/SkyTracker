# Tidslinjen stage 5 (R4): progress, the second signal, the sprint report and the Slack notice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Progress fills the bars (typed on day 10, read from ADO once stories exist); the v3.1 progress rule stands next to the range colour as a second signal; «Levert» is drawn; the sprint report and the same-week Slack notice are generated from the plan and its history, plus a weekly digest.

**Architecture:** `progress` is a new merge group on features; `progressSignal` / `epicProgressSignal` in `epic-tools.js` compute the second signal from progress against elapsed time in the likely window, on the page and on the server. The ADO refresh (stage 4) writes `progress` from the stories it already reads. `notify.ts` turns a save's before/after into epic colour turns and Slack text (webhook, best effort, never blocks a save); `report.ts` builds the sprint report (the compare export plus progress, discoveries and deliveries) and the weekly digest from the same data. One new route for the digest; the compare route gains `report=1`.

**Tech Stack:** as stages 1–4 (Next.js 16, Prisma 7, vitest, the plain-JS page, Playwright smokes). Slack by incoming webhook (`SLACK_WEBHOOK_URL`), no new dependency.

**Spec:** `docs/superpowers/specs/2026-10-08-planning-system-design.md` §3 field `progress`, §4.1 `feature.fremdrift`, §5 R4, decision 7 (Slack). The v3.1 rule (memory `scrum-devops-model.md`, RAG regime): green = time ≤ progress; yellow = trending out of the window; red = window broken.

## Global Constraints

- The second signal never changes the epic colour (spec R4: «not mixed into the epic colour until GO has seen it for two sprints»): it is a separate chip per feature and per epic.
- When a feature has ADO stories with points, ADO's numbers replace a typed progress on the next refresh (`source: "ado"`); a typed value is `source: "manuell"`.
- «Levert» comes from ADO (stage 4); it is never typed. Delivered features keep their bar, dimmed, with the day.
- The notice is sent only when a save turns an epic to `gul` or `rod` from a better colour; improvements are not sent. A missing `SLACK_WEBHOOK_URL` means nothing is sent and nothing fails.
- Norwegian in everything a person reads; English in code and commits; no em dashes. Additive data only (`progress` group, `FV_FIELDS` on the page). No schema change.
- Never the shared database; routes untested against Postgres as before; the pure functions carry the tests.
- Commits per task with `git -c commit.gpgsign=false commit`, no Claude attribution. One branch, no PR before stage 7.

## Review Focus

1. A feature with progress typed as `0 av 0 poeng` or `%` outside 0–100: expected no signal and no event, nothing drawn (Task 1 tests on `normalizePlan` and `progressSignal`).
2. Today is before the feature's start or after its late end: expected no signal before start, red after the late end while not delivered (Task 1 tests).
3. A save that moves an epic from `rod` to `gul`: expected no notice (improvement), while `gronn → gul` and `gul → rod` notify once each (Task 3 tests on `epicTurns`).
4. `SLACK_WEBHOOK_URL` unset or the webhook answers 500: expected the save succeeds and the response is unchanged (Task 3: `notifyTurns` swallows; the route never awaits the result).
5. The sprint report when nothing was delivered and no discovery moved: expected the sections are omitted, not printed empty (Task 4 test).

---

### Task 1: The `progress` field and the second-signal rule

**Files:**
- Modify: `src/features/timeline/merge.ts` (+ test): group `progress`, `PlanTask.progress`
- Modify: `src/features/timeline/epic-tools.js` (+ `.d.ts`, `.test.ts`): `normalizePlan` validation, `progressFraction`, `progressSignal`, `epicProgressSignal`, `progressText`
- Modify: `src/features/timeline/events.ts` (+ test): `feature.fremdrift`

**Interfaces:**
- Produces: `PlanTask.progress?: { pointsDone?: number; pointsTotal?: number; pct?: number; sprint?: string | null; at: string; source: "manuell" | "ado" }`; `GROUP_PROPS.progress = ["progress"]`; `progressFraction(p) → number | null` (points when `pointsTotal > 0`, else `pct / 100`, else null); `progressSignal(task, todayUnit) → { code: "gronn" | "gul" | "rod"; done: number; elapsed: number } | null` (null without progress, before the start, or when delivered); `epicProgressSignal(plan, laneKey, todayUnit) → "gronn" | "gul" | "rod" | null` (worst over the epic's active estimates); `progressText(task, signal) → "fremdrift 62 % · tid 75 %"`; event `feature.fremdrift` «Fremdrift: 13 av 21 poeng» / «Fremdrift: 60 %».

- [ ] **Step 1: Write the failing tests**

epic-tools.test.ts (import `progressFraction, progressSignal, epicProgressSignal, progressText`):
```ts
describe("progress: the second signal", () => {
  const E = (over: Partial<PlanTask>): PlanTask => est({ start: 4, endLikely: 6, end: 7, state: "aktiv", ...over });   // likely window = 2 months
  it("progressFraction: points first, then percent, else null", () => {
    expect(progressFraction({ pointsDone: 13, pointsTotal: 21, at: "", source: "manuell" })).toBeCloseTo(13 / 21);
    expect(progressFraction({ pct: 60, at: "", source: "manuell" })).toBe(0.6);
    expect(progressFraction({ pointsDone: 0, pointsTotal: 0, at: "", source: "manuell" })).toBeNull();
    expect(progressFraction(undefined)).toBeNull();
  });
  it("green when progress keeps up with time (10 % slack), yellow when behind, red after the late end while not delivered", () => {
    expect(progressSignal(E({ progress: { pct: 50, at: "", source: "manuell" } }), 5)).toMatchObject({ code: "gronn", done: 0.5, elapsed: 0.5 });
    expect(progressSignal(E({ progress: { pct: 45, at: "", source: "manuell" } }), 5)!.code).toBe("gronn");
    expect(progressSignal(E({ progress: { pct: 30, at: "", source: "manuell" } }), 5)!.code).toBe("gul");
    expect(progressSignal(E({ progress: { pct: 30, at: "", source: "manuell" } }), 7.5)!.code).toBe("rod");
    expect(progressSignal(E({ progress: { pct: 100, at: "", source: "manuell" } }), 7.5)!.code).toBe("gronn");
  });
  it("no signal without progress, before the start, for discoveries, for delivered features", () => {
    expect(progressSignal(E({}), 5)).toBeNull();
    expect(progressSignal(E({ progress: { pct: 50, at: "", source: "manuell" } }), 3)).toBeNull();
    expect(progressSignal(disc({ progress: { pct: 50, at: "", source: "manuell" } }), 2.5)).toBeNull();
    expect(progressSignal(E({ state: "levert", deliveredAt: "2026-12-03", progress: { pct: 50, at: "", source: "manuell" } }), 7.5)).toBeNull();
  });
  it("the epic's signal is the worst of its features; null when none has progress", () => {
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [E({ id: "a", progress: { pct: 50, at: "", source: "manuell" } }), E({ id: "b", progress: { pct: 10, at: "", source: "manuell" } }), E({ id: "c" })] });
    expect(epicProgressSignal(p, "x", 5)).toBe("gul");
    expect(epicProgressSignal(normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [E({ id: "c" })] }), "x", 5)).toBeNull();
  });
  it("progressText and the normaliser", () => {
    const t = E({ progress: { pointsDone: 13, pointsTotal: 21, at: "", source: "manuell" } });
    expect(progressText(t, progressSignal(t, 5)!)).toBe("fremdrift 62 % · tid 50 %");
    const p = normalizePlan({ lanes: [{ key: "x", name: "X" }], tasks: [
      E({ id: "ok", progress: { pct: 60, at: "2026-10-09", source: "ado" } }),
      E({ id: "bad", progress: { pct: 140, at: "2026-10-09", source: "manuell" } }),
      E({ id: "src", progress: { pointsDone: 2, pointsTotal: 5, at: "x", source: "nope" as never } }),
    ] });
    expect(p.tasks.find((t) => t.id === "ok")!.progress!.source).toBe("ado");
    expect(p.tasks.find((t) => t.id === "bad")!.progress).toBeUndefined();
    expect(p.tasks.find((t) => t.id === "src")!.progress!.source).toBe("manuell");
  });
});
```
merge.test.ts: `progress` is its own group (an incoming higher `fv.progress` replaces; a page without the field cannot drop a server-written one), like the `ado` case.
events.test.ts: «Fremdrift: 13 av 21 poeng» when points change, «Fremdrift: 60 %» for a percent, no event when equal; cause `ado` with `source: "ado"`.

- [ ] **Step 2: Run to verify RED** — `npx vitest run src/features/timeline` → the new cases fail.

- [ ] **Step 3: Implement**

epic-tools.js (before the sprints block; exported + declared):
```js
/* ---------- progress: the v3.1 rule as a second signal (never the epic colour) ---------- */
function progressFraction(p) {
  if (!p || typeof p !== "object") return null;
  if (num(p.pointsTotal, 0) > 0) return Math.max(0, Math.min(1, num(p.pointsDone, 0) / p.pointsTotal));
  if (num(p.pct, null) !== null) return Math.max(0, Math.min(1, p.pct / 100));
  return null;
}
function progressSignal(t, today) {
  if (t.kind !== "estimate" || t.state === "levert") return null;
  const done = progressFraction(t.progress);
  if (done === null || today < t.start - 1e-9) return null;
  const span = Math.max(WEEK, t.endLikely - t.start);
  const elapsed = Math.max(0, Math.min(1, (today - t.start) / span));
  const code = today > t.end + 1e-9 && done < 1 ? "rod" : done + 0.1 >= elapsed ? "gronn" : "gul";
  return { code, done, elapsed };
}
const SIG_RANK = { gronn: 0, gul: 1, rod: 2 };
function epicProgressSignal(plan, laneKey, today) {
  let worst = null;
  plan.tasks.filter((t) => t.lane === laneKey).forEach((t) => { const s = progressSignal(t, today); if (s && (worst === null || SIG_RANK[s.code] > SIG_RANK[worst])) worst = s.code; });
  return worst;
}
function progressText(t, s) { return "fremdrift " + Math.round(s.done * 100) + " % · tid " + Math.round(s.elapsed * 100) + " %"; }
```
normalizePlan (task loop): keep `progress` only as `{ pointsDone?, pointsTotal?, pct?, sprint?, at, source }` with numbers ≥ 0, `pct` ≤ 100, `source` in `manuell | ado` (else `manuell`), `at` a string (else now); drop when `progressFraction` is null.
merge.ts: `TaskFieldGroup` + `"progress"`, `GROUP_PROPS.progress = ["progress"]`, the type above.
events.ts: `EVENT_CODES` + `"feature.fremdrift"`; after the raw block:
```ts
const pb = b.progress, pa = t.progress;
const key = (p?: PlanTask["progress"]) => (p ? JSON.stringify([p.pointsDone ?? null, p.pointsTotal ?? null, p.pct ?? null]) : null);
if (key(pb) !== key(pa) && pa) ev.push({ ...base, code: "feature.fremdrift", before: pb ? { pointsDone: pb.pointsDone ?? null, pointsTotal: pb.pointsTotal ?? null, pct: pb.pct ?? null } : null, after: { pointsDone: pa.pointsDone ?? null, pointsTotal: pa.pointsTotal ?? null, pct: pa.pct ?? null }, cause: pa.source === "ado" ? "ado" : dc,
  summary: (pa.pointsTotal ?? 0) > 0 ? `Fremdrift: ${pa.pointsDone ?? 0} av ${pa.pointsTotal} poeng` : `Fremdrift: ${pa.pct ?? 0} %` });
```
compare.ts: `"feature.fremdrift"` joins a new section `["Fremdrift", ["feature.fremdrift"]]` (before «Nye og fjernet»).

- [ ] **Step 4: GREEN + commit** — `npx vitest run src/features/timeline && npx tsc --noEmit`; commit «timeline: progress on features (group, normaliser, event) and the second-signal rule».

---

### Task 2: Progress from ADO's stories

**Files:** Modify `src/features/ado/push.ts` (+ `push.test.ts`).

**Interfaces:** Consumes `readStories` (stage 4). Produces: `refreshPlan` writes `t.progress = { pointsDone, pointsTotal, sprint: iteration, at, source: "ado" }` and bumps `fv.progress` when the feature has stories with `pointsTotal > 0` and the numbers differ from what is stored; a typed progress is replaced; no stories or no points → untouched.

- [ ] **Step 1: Failing test** (push.test.ts, in the refreshPlan describe): after the refresh with storyA/storyB, `kap.progress` equals `{ pointsDone: 3, pointsTotal: 8, sprint: "Sprint 71", at: NOW.toISOString(), source: "ado" }` and `kap.fv.progress === 1`; a second refresh with the same numbers does not bump; a feature whose stories carry no points keeps a typed `progress`.
- [ ] **Step 2: RED** — `npx vitest run src/features/ado/push.test.ts`.
- [ ] **Step 3: Implement** in the task loop of `refreshPlan`, after `stories` is read:
```ts
if (stories.pointsTotal > 0) {
  const prog = { pointsDone: stories.pointsDone, pointsTotal: stories.pointsTotal, sprint: stories.iteration, at: now.toISOString(), source: "ado" as const };
  const same = t.progress && t.progress.source === "ado" && t.progress.pointsDone === prog.pointsDone && t.progress.pointsTotal === prog.pointsTotal && t.progress.sprint === prog.sprint;
  if (!same) { t.progress = prog; bump(t, "progress"); }
}
```
(`bump` accepts `"progress"`.) The read-back summary gains nothing new; the diff logs `feature.fremdrift` with cause `ado`.
- [ ] **Step 4: GREEN + commit** — «ado: progress from the stories' points on refresh».

---

### Task 3: The same-week notice

**Files:**
- Create: `src/features/timeline/notify.ts` (+ `notify.test.ts`)
- Modify: `src/features/timeline/plan-store.ts` (`commitPlan` calls `notifyTurns`), `src/app/api/timeline-plan/route.ts` (`logHistory` calls it), `.env.example` (`SLACK_WEBHOOK_URL`, `SKYTRACKER_URL`)

**Interfaces:**
- Produces: `epicTurns(before, after) → { key, name, from, to, window, goal }[]` (to ∈ gul | rod, worse than before, lane state not `avsluttet`); `noticeText(turns, ctx: { editor, reason?, reasonCode?, url? }) → string` (Slack mrkdwn); `postSlack(url, text, fetchImpl?) → Promise<boolean>`; `notifyTurns(before, after, ctx, env?, fetchImpl?) → Promise<void>` (never throws; no-op without `SLACK_WEBHOOK_URL`).

- [ ] **Step 1: Failing tests**
```ts
describe("epicTurns", () => {
  it("lists epics that turned yellow or red for the worse, skips improvements, closed epics and unchanged colours", …);
  // fixtures: lane x goal at unit 8; before: one estimate end 7.5 (gronn); after: end 9 → gul (likely 8.5 > goal? use likely 7.9/end 9 → gul); another lane gul → rod; a third rod → gul (skipped); a fourth gronn → gul but state avsluttet (skipped)
});
describe("noticeText", () => {
  it("names the epic, the colours, the window, the goal and the reason, and links the timeline", () => {
    expect(noticeText([{ key: "telenor", name: "Telenor kan bygge på oss", from: "gronn", to: "gul", window: "uke 49–51", goal: "Måldato 15. des" }], { editor: "GO", reason: "Flere lagringsnoder", reasonCode: "utredning", url: "https://sky-tracker-nu.vercel.app/timeline" }))
      .toBe("🟡 *Telenor kan bygge på oss* ble gul (var grønn): leveres uke 49–51, Måldato 15. des.\nHvorfor: Utredningen viste mer/mindre arbeid – Flere lagringsnoder (GO)\nValg for ledelsen: flytte datoen eller kutte omfang. <https://sky-tracker-nu.vercel.app/timeline|Tidslinjen>");
    // without a reason: «Hvorfor: begrunnelse mangler»; rod → 🔴 «ble rød»
  });
});
describe("postSlack / notifyTurns", () => {
  it("posts { text } as JSON and reports ok; a 500 is false; no url → nothing sent, no throw", …);
});
```
- [ ] **Step 2: RED**.
- [ ] **Step 3: Implement** (`epicStatus`, `epicWindowText`, `goalText` from epic-tools; colours gronn/gul/rod with Norwegian names grønn/gul/rød; rank gronn 0 · venter/ingen-mal/tom 0 · gul 1 · rod 2; a turn when rank(after) > rank(before) and after ∈ gul|rod). `notifyTurns` builds the text from `ctx` (reason via `REASON_LABEL`) and posts with a 5 s `AbortSignal.timeout`, catching everything. Call sites: PUT route `logHistory` (after `recordChangeset`, with `note.reason/reasonCode` and the editor; not awaited: `void notifyTurns(...)`), `commitPlan` (ado commits: no reason).
- [ ] **Step 4: GREEN + commit** — «timeline: the same-week notice to Slack when a save turns an epic yellow or red».

---

### Task 4: The sprint report and the weekly digest

**Files:**
- Create: `src/features/timeline/report.ts` (+ `report.test.ts`)
- Modify: `src/app/api/timeline-compare/route.ts` (`report=1`)
- Create: `src/app/api/timeline-digest/route.ts`

**Interfaces:**
- Consumes: `exportMarkdown`, `summaryLine`, `summarizeNet` (compare.ts), `progressSignal`, `progressText`, `epicStatus`, `epicWindowText`, `goalText`, `windowLabel`, `fmtDate`, `unitToDate`, `isoWeek` (epic-tools), `postSlack` (Task 3), `PathEvent`.
- Produces: `sprintReportMarkdown({ title, strip, path, plan, laneName, todayUnit }) → string`: `# <title>`, the strip, then «## Levert» (features with `feature.tilstand` → levert in the path, or `state: levert` with `deliveredAt` inside the period), «## Fremdrift per feature» (active estimates with a signal: `Epic › Feature: 13 av 21 poeng · fremdrift 62 % · tid 50 % · gul · leveres uke 49–51`), «## Utredninger som kom videre» (path events `feature.tilstand` to `utredes`/`klar`/`aktiv`, `feature.estimert`, `feature.estimat-hentet`: `Feature: <summary> (editor, day)`), then the compare export's sections (`exportMarkdown` minus its first line); empty sections omitted. `digestText({ plan, strip, path, todayUnit, week, url }) → string` (Slack mrkdwn): `*Tidslinjen, uke 46* — 2 grønne · 1 gul · 1 rød · 2 venter`, one line per yellow/red epic with its window, goal and the latest reason from the path, the strip line, «Levert denne uken: …», the link.
- Routes: `GET /api/timeline-compare?from=&report=1` → `exportText` is the sprint report (title «Sprintrapport <label>» for a sprint snapshot, «Rapport siden <label>» otherwise); `GET /api/timeline-digest?days=7` (signed in) → `{ text, since }`; `POST /api/timeline-digest` (writer, or header `x-cron-secret` equal to `CRON_SECRET`) → posts the text to `SLACK_WEBHOOK_URL` → `{ sent: true }` · `503 { error: "no-webhook" }`.

- [ ] **Step 1: Failing tests** (report.test.ts): a plan with two epics (one gul with a yellow-signal feature `13 av 21 poeng`, one gronn), a delivered feature (`state: levert`, `deliveredAt` inside the period), a path with `feature.tilstand` «Klar for veikart» for a discovery and a `feature.spenn` event with reason; expect the four headings in order, the exact feature line, the discovery line, the «## Spenn» section from the compare export, and that a plan without deliveries or discoveries prints neither heading. `digestText`: the header with counts, the yellow epic's line «🟡 Telenor: leveres uke 49–51, Måldato 15. des — Ekstern dato endret: Telenor flyttet piloten (GO, 6. nov)», the strip, «Levert denne uken: Kapasitet (3. des)», the link line.
- [ ] **Step 2: RED**.
- [ ] **Step 3: Implement** `report.ts` (pure; dates via `dayText` from compare.ts; the period = events' `at` range), then the routes: the compare route builds `exportText` with `sprintReportMarkdown` when `report=1` (title from the snapshot's kind); the digest route computes `since = today − days` (Oslo day), `snapshotForDay(all, since)` (404 `no-snapshot` when none), `net = diffPlans(baseline, now)`, the path since the snapshot's `at`, `strip = summaryLine(dayText(since), summarizeNet(net, path))`, `text = digestText(...)`; POST authorises a writer session or `x-cron-secret`.
- [ ] **Step 4: GREEN + commit** — «timeline: sprint report (compare export + progress + discoveries + deliveries) and the weekly digest route».

---

### Task 5: The page: progress entry and fill, the second signal, «Levert», the report button; smokes S17–S18

**Files:** Modify `src/app/timeline/timeline.html`; scratchpad `hosted-history-smoke.mjs` (mock: `report=1` on the compare route, scenarios S17–S18).

**Interfaces:** Consumes Task 1's helpers (globals on the page), `GET …timeline-compare?from=&report=1`. Produces ids `#edDone`, `#edTotal`, `#edPct`, `#edProgNote`, `.bar .prog`, chips `.chip.sig.st-*` (feature and epic), `.chip.st-gronn.levert`, `#cmpReport` («Sprintrapport», visible when the compare baseline is a sprint snapshot); `FV_FIELDS` + `'progress'`.

- [ ] **Step 1: Smoke RED** — mock: the compare route answers `exportText` from `sprintReportMarkdown` when `report=1` (import from `report.ts`); scenarios:
```js
// S17: progress typed on a feature fills the likely segment and shows the second signal; the event reads «Fremdrift: 1 av 2 poeng»; a delivered feature shows «Levert 3. des» and is dimmed
await page.click('.task-label[data-id="kapasitet"] .t'); await page.waitForSelector("#editorBack.open");
await page.fill("#edDone", "1"); await page.fill("#edTotal", "2"); await page.click("#edSave"); await savedNote();
await page.waitForSelector('.bar[data-id="kapasitet"] .prog');
const fill = await page.$eval('.bar[data-id="kapasitet"]', (b) => ({ prog: b.querySelector(".prog").getBoundingClientRect().width, likely: b.querySelector(".seg.likely").getBoundingClientRect().width }));
assert(Math.abs(fill.prog - fill.likely / 2) < 2, "the fill is half of the likely segment: " + JSON.stringify(fill));
assert(await page.$('.task-label[data-id="kapasitet"] .chip.sig'), "second-signal chip on the feature");
ev = await evs();
assert(ev.events.some((e) => e.code === "feature.fremdrift" && e.summary === "Fremdrift: 1 av 2 poeng"), "fremdrift event");
assert(await page.$eval('.task-label[data-id="fildeling"] .chip.levert', (e) => e.textContent) === "Levert 3. des", "levert chip from stage 4's read-back");
assert(await page.$eval('.bar[data-id="fildeling"]', (e) => e.classList.contains("levert")), "delivered bar dimmed");
console.log("S17 ok");

// S18: the sprint baseline from S16 gives a sprint report with the progress section
const sprintSnap = (await (await fetch(BASE + "/api/timeline-snapshots")).json()).snapshots.find((s) => s.kind === "sprint");
await page.selectOption("#cmpSelect", sprintSnap.id); await page.waitForSelector("#cmpBar:not([hidden])");
await page.waitForSelector("#cmpReport:not([hidden])");
const report = (await (await fetch(BASE + "/api/timeline-compare?from=" + sprintSnap.id + "&report=1")).json()).exportText;
assert(/^# Sprintrapport Sprint 71/.test(report) && /## Fremdrift per feature\n- Telenor kan bygge på oss › Kapasitet i store grupper: 1 av 2 poeng · fremdrift 50 %/.test(report), "sprint report: " + report.slice(0, 300));
await page.click("#cmpClose");
console.log("S18 ok");
```
- [ ] **Step 2: Build the page** — editor row «Fremdrift» (`#edDone` poeng gjort · `#edTotal` poeng totalt · `#edPct` prosent, `#edProgNote` «fra ADO 9. okt 10:12 · Sprint 71» or «skrives inn på dag 10; ADO tar over når stories har poeng»); `edSave` writes `progress` (`source: 'manuell'`, `at`) when the numbers changed, `touch(t, 'progress')`; bar markup `<div class="seg likely"><div class="prog"></div></div>`, CSS `.bar .seg.likely .prog{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,.3);border-right:2px solid rgba(255,255,255,.95)}`, `.bar.levert{opacity:.55}`; `position()` sets the fill width `lw * progressFraction(t.progress)` (hidden when null); chips: levert «Levert 3. des» (`chip st-gronn levert`), the second signal `chip sig st-<code>` with `progressText`; the lane header gets `chip sig st-<code>` «fremdrift» when `epicProgressSignal` is set; `renderCompareBar` shows `#cmpReport` when `cmp.kind === 'sprint'` (store `kind` from `j.baseline.kind`); `#cmpReport` click fetches `report=1` and downloads `sprintrapport-<label>.md`; help card «Fremdrift og sprintrapport»; `FV_FIELDS` + 'progress'.
- [ ] **Step 3: Smokes green** (history S1–S18, ui, hosted, theme), **commit** — «timeline page: progress entry and fill, the second signal, «Levert», the sprint report button».

---

### Task 6: Stage gate — suite, tsc, build, smokes, inline review + one fix pass, PR text «Stage 5», ledger, memory. The notice to a test channel waits for `SLACK_WEBHOOK_URL` from GO (hand-over).
