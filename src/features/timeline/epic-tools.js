// Shared logic for the epic roadmap (/timeline): time unit, plan normalisation,
// computed epic status, dependency push and the example seed. Plain script:
// the browser loads it with <script src>, vitest imports it via epic-tools.d.ts.
// One source, no drift between the page and the tests.

/* ---------- time: unit = months since 1 Aug 2026 ---------- */
const BASE_Y = 2026;
const BASE_M = 7; // august, 0-indexed
const N_MONTHS = 29; // the model ends Dec 2028; the page draws from a few months before today
const WEEK = 0.25; // one week in month units, also the drag snap
const MND = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

function dateToUnit(d) {
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getFullYear() - BASE_Y) * 12 + (d.getMonth() - BASE_M) + (d.getDate() - 1) / dim;
}
function unitToDate(u) {
  u = Math.min(N_MONTHS, u);   // units before the base month are negative: the axis reaches back in time
  const i = Math.min(N_MONTHS - 1, Math.floor(u));
  const m = (((BASE_M + i) % 12) + 12) % 12;
  const y = BASE_Y + Math.floor((BASE_M + i) / 12);
  const dim = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dim, 1 + Math.round((u - i) * dim)));
}
function fmtDate(d) {
  return d.getDate() + ". " + MND[d.getMonth()];
}

/* ---------- plan shape ---------- */
const SCHEMA = "epics-v1";
const KINDS = ["discovery", "estimate"];
const OWNER_DEFAULT = "PM + CTO";
const BACKLOG = "_backlog";   // the shelf «Klar for veikart»: tasks without an epic
const FEATURE_STATES = ["ny", "utredes", "klar", "aktiv", "levert"];
const EPIC_STATES = ["forslag", "aktiv", "avsluttet"];
const STATE_LABEL = { ny: "Registrert", utredes: "Utredes", klar: "Klar for veikart", aktiv: "Aktiv", levert: "Levert" };
const EPIC_STATE_LABEL = { forslag: "Forslag", aktiv: "Aktiv", avsluttet: "Avsluttet" };
const OUTCOMES = ["nådd", "ikke nådd", "endret"];
const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);

function normalizePlan(plan) {
  const p = plan && typeof plan === "object" ? plan : {};
  p.schema = SCHEMA;
  p.lanes = Array.isArray(p.lanes) ? p.lanes : [];
  p.tasks = Array.isArray(p.tasks) ? p.tasks : [];
  p.deleted = p.deleted && typeof p.deleted === "object" ? p.deleted : {};
  p.deletedLanes = p.deletedLanes && typeof p.deletedLanes === "object" ? p.deletedLanes : {};
  // sprints (from ADO's iterations, cached by the sprints route) and the sprint goals typed on the page
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const okSprint = (s) => !!s && typeof s === "object" && typeof s.name === "string" && isDay(s.start) && isDay(s.finish);
  if (p.sprints && typeof p.sprints === "object" && typeof p.sprints.at === "string" && Array.isArray(p.sprints.items)) p.sprints.items = p.sprints.items.filter(okSprint);
  else delete p.sprints;
  if (p.capacity && typeof p.capacity === "object" && MIX[p.capacity.mode] && typeof p.capacity.at === "string") p.capacity = { mode: p.capacity.mode, at: p.capacity.at };
  else delete p.capacity;
  if (p.sprintGoals && typeof p.sprintGoals === "object" && !Array.isArray(p.sprintGoals)) {
    Object.keys(p.sprintGoals).forEach((k) => { const g = p.sprintGoals[k]; if (!g || typeof g !== "object" || typeof g.text !== "string" || typeof g.at !== "string") delete p.sprintGoals[k]; });
  } else delete p.sprintGoals;
  p.lanes.forEach((l) => {
    if (typeof l.owner !== "string" || !l.owner) l.owner = OWNER_DEFAULT;
    if (num(l.goalDate, null) === null) delete l.goalDate;
    if (!l.goalProvisional) delete l.goalProvisional;
    if (num(l.adoId, null) === null) delete l.adoId;
    if (typeof l.metric !== "string" || !l.metric.trim()) delete l.metric;
    if (!l.externalDate) delete l.externalDate;
    if (typeof l.description !== "string" || !l.description.trim()) delete l.description; else l.description = l.description.trim().slice(0, 4000);
    if (!EPIC_STATES.includes(l.state)) l.state = "aktiv";
    if (typeof l.closedReason !== "string" || !l.closedReason.trim()) delete l.closedReason;
    if (!OUTCOMES.includes(l.outcome)) delete l.outcome;
    if (typeof l.closedAt !== "string" || !l.closedAt) delete l.closedAt;
  });
  // priority = the order on the timeline (1 = top). Data, not array order, so it survives the merge.
  let nextPri = Math.max(0, ...p.lanes.map((l) => num(l.priority, 0)));
  p.lanes.forEach((l) => { if (num(l.priority, null) === null) l.priority = ++nextPri; });
  p.lanes.sort((a, b) => a.priority - b.priority); // stable: equal priorities keep their order
  const laneKeys = new Set(p.lanes.map((l) => l.key));
  p.tasks = p.tasks.filter((t) => t && typeof t.id === "string" && (laneKeys.has(t.lane) || t.lane === BACKLOG));
  p.tasks.forEach((t) => {
    t.deps = Array.isArray(t.deps) ? t.deps : [];
    t.fv = t.fv && typeof t.fv === "object" ? t.fv : {};
    if (!KINDS.includes(t.kind)) t.kind = "estimate";
    t.start = num(t.start, 0);
    t.end = num(t.end, t.start + WEEK);
    if (t.end < t.start + WEEK) t.end = t.start + WEEK;
    if (t.kind === "estimate") {
      t.endLikely = Math.min(t.end, Math.max(t.start + WEEK, num(t.endLikely, t.end)));
    } else {
      delete t.endLikely;
    }
    if (num(t.adoId, null) === null) delete t.adoId;
    if (typeof t.specPath !== "string" || !/^[A-Za-z0-9._-]+$/.test(t.specPath)) delete t.specPath;   // a folder under spec/ in Skytale.Specs
    if (typeof t.description !== "string" || !t.description.trim()) delete t.description; else t.description = t.description.trim().slice(0, 4000);
    if (t.pinned) t.pinned = true; else delete t.pinned;   // the planner's override of the queue
    // progress: points (ADO or typed) or a percent; the source says who wrote it
    if (t.progress && typeof t.progress === "object") {
      const pr = t.progress, out = {};
      if (num(pr.pointsTotal, 0) > 0) { out.pointsTotal = num(pr.pointsTotal, 0); out.pointsDone = Math.max(0, Math.min(out.pointsTotal, num(pr.pointsDone, 0))); }
      else if (num(pr.pct, null) !== null && pr.pct >= 0 && pr.pct <= 100) out.pct = pr.pct;
      if (typeof pr.sprint === "string" && pr.sprint) out.sprint = pr.sprint;
      out.at = typeof pr.at === "string" ? pr.at : new Date().toISOString();
      out.source = pr.source === "ado" ? "ado" : "manuell";
      if (progressFraction(out) === null) delete t.progress; else t.progress = out;
    } else delete t.progress;
    if (typeof t.assignee !== "string" || !t.assignee.trim()) delete t.assignee; else t.assignee = t.assignee.trim();
    if (num(t.bufferWeeks, null) === null || t.bufferWeeks <= 0) delete t.bufferWeeks; else t.bufferWeeks = Math.round(t.bufferWeeks);
    if (!t.raw || typeof t.raw !== "object" || num(t.raw.likely, null) === null || num(t.raw.late, null) === null) delete t.raw;
    // state: ny and levert are explicit; everything else follows from kind and lane
    if (t.state === "ny") { if (t.lane !== BACKLOG) t.lane = BACKLOG; }
    else if (t.state !== "levert") t.state = t.kind === "discovery" ? "utredes" : t.lane === BACKLOG ? "klar" : "aktiv";
    if (t.state !== "aktiv" && t.state !== "levert") { delete t.committedRange; delete t.activatedAt; }
    if (t.state !== "levert") delete t.deliveredAt;
  });
  const ids = new Set(p.tasks.map((t) => t.id));
  p.tasks.forEach((t) => {
    t.deps = t.deps.filter((d) => d !== t.id && ids.has(d));
  });
  // order = position inside the epic; missing ones go after the lane's max
  const nextOrd = {};
  p.tasks.forEach((t) => { if (num(t.order, null) !== null) nextOrd[t.lane] = Math.max(nextOrd[t.lane] || 0, t.order); });
  p.tasks.forEach((t) => { if (num(t.order, null) === null) t.order = nextOrd[t.lane] = (nextOrd[t.lane] || 0) + 1; });
  const laneIdx = new Map(p.lanes.map((l, i) => [l.key, i]));
  laneIdx.set(BACKLOG, p.lanes.length);   // the shelf sorts last
  p.tasks.sort((a, b) => laneIdx.get(a.lane) - laneIdx.get(b.lane) || a.order - b.order);
  return p;
}

/* ---------- computed epic status ---------- */
const STATUS_LABEL = {
  gronn: "Grønn: holder",
  gul: "Gul: i fare",
  rod: "Rød: sprekker",
  venter: "Venter på utredning",
  "ingen-mal": "Uten måldato",
  tom: "Ingen features ennå",
};

function epicStatus(plan, laneKey) {
  const lane = plan.lanes.find((l) => l.key === laneKey);
  const tasks = plan.tasks.filter((t) => t.lane === laneKey);
  if (!lane || !tasks.length) return { code: "tom" };
  if (tasks.some((t) => t.kind === "discovery")) return { code: "venter" };
  const likely = Math.max(...tasks.map((t) => t.endLikely));
  const late = Math.max(...tasks.map((t) => t.end));
  if (typeof lane.goalDate !== "number") return { code: "ingen-mal", likely, late };
  const goal = lane.goalDate;
  const code = late <= goal + 1e-9 ? "gronn" : likely > goal + 1e-9 ? "rod" : "gul";
  return { code, likely, late };
}
function shelfTasks(plan) { return plan.tasks.filter((t) => t.lane === BACKLOG); }
function epicCounts(plan) {
  const c = { forslag: 0, aktiv: 0, avsluttet: 0 };
  plan.lanes.forEach((l) => { c[l.state || "aktiv"]++; });
  return c;
}

/* ---------- dependencies: finish-to-start on the blocker's late end ---------- */
function shiftTask(t, d) {
  d = Math.max(d, -t.start);
  d = Math.min(d, N_MONTHS - t.end);
  if (!d) return 0;
  t.start += d;
  t.end += d;
  if (t.kind === "estimate") t.endLikely += d;
  return d;
}

/* ---------- the queue (R5): blockers first, then the same developer's earlier work, in priority order ---------- */
const MIX = { transition: 0.55, normal: 0.6 };   // the share of a sprint that goes to planned features (transition 55/35/10, normal 60/15/15/10)
const MIX_LABEL = { transition: "overgang (55 % til features)", normal: "normal (60 %)" };
function capacityFactor(plan) {
  const mode = plan && plan.capacity && MIX[plan.capacity.mode] ? plan.capacity.mode : "transition";
  return Math.round(100 / MIX[mode]) / 100;
}
function elapsedWeeks(rawWeeks, factor) { return Math.ceil(rawWeeks * factor - 1e-9); }
function queueOrder(plan) {   // active estimates in epics, in priority order; a pinned one stays put but still counts for the ones after it
  const idx = new Map(plan.lanes.map((l, i) => [l.key, i]));
  return plan.tasks
    .filter((t) => t.kind === "estimate" && t.lane !== BACKLOG && idx.has(t.lane) && t.state !== "levert")
    .sort((a, b) => idx.get(a.lane) - idx.get(b.lane) || (a.order || 0) - (b.order || 0));
}
function floorOf(plan, t, earlier) {
  const byId = new Map(plan.tasks.map((v) => [v.id, v]));
  let floor = -Infinity, by = null, kind = null;
  (t.deps || []).forEach((d) => { const p = byId.get(d); if (p && p.end > floor + 1e-9) { floor = p.end; by = d; kind = "dep"; } });
  if (t.assignee) earlier.forEach((e) => { if (e.assignee === t.assignee && e.end >= floor - 1e-9) { floor = e.end; by = e.id; kind = "queue"; } });
  return { floor: floor === -Infinity ? null : floor, by, kind };
}
function queueFloor(plan, taskId) {
  const t = plan.tasks.find((v) => v.id === taskId);
  if (!t) return { floor: null, by: null, kind: null };
  const order = queueOrder(plan), i = order.findIndex((v) => v.id === taskId);
  return floorOf(plan, t, i < 0 ? [] : order.slice(0, i));
}
function resolveQueue(plan) {
  const shifted = []; // [{ id, by, kind }]: what each shifted feature waits for
  const note = (t, f) => { const prev = shifted.find((s) => s.id === t.id); if (prev) { prev.by = f.by; prev.kind = f.kind; } else shifted.push({ id: t.id, by: f.by, kind: f.kind }); };
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    const order = queueOrder(plan), inQueue = new Set(order.map((t) => t.id));
    order.forEach((t, i) => {
      const f = floorOf(plan, t, order.slice(0, i));
      if (f.floor === null || t.pinned || f.floor <= t.start + 1e-9) return;
      if (shiftTask(t, f.floor - t.start) !== 0) { note(t, f); changed = true; }
    });
    // discoveries, the shelf and delivered features keep the plain rule: after a blocker's late end
    plan.tasks.filter((t) => !inQueue.has(t.id)).forEach((t) => {
      const f = floorOf(plan, t, []);
      if (f.floor === null || t.pinned || f.floor <= t.start + 1e-9) return;
      if (shiftTask(t, f.floor - t.start) !== 0) { note(t, f); changed = true; }
    });
  }
  return shifted;
}
function resolveDeps(plan) { return resolveQueue(plan).filter((s) => s.kind === "dep").map(({ id, by }) => ({ id, by })); }

/* ---------- labels ---------- */
const weeks = (u) => Math.round(u / WEEK);
function rangeWeeks(t) {
  if (t.kind !== "estimate") return null;
  return { likely: weeks(t.endLikely - t.start), late: weeks(t.end - t.start) };
}
function rangeLabel(t) {
  const r = rangeWeeks(t);
  if (!r) return "";
  return (r.likely === r.late ? r.late : r.likely + "–" + r.late) + " uker";
}
function goalText(lane) {
  if (typeof lane.goalDate !== "number") return "Måldato settes etter utredning";
  return (lane.goalProvisional ? "Foreløpig mål " : "Måldato ") + fmtDate(unitToDate(lane.goalDate));
}

/* ---------- lifecycle labels ---------- */
function sizeClass(t) {
  if (t.kind !== "discovery") return "";
  const w = (t.end - t.start) / WEEK;
  return w <= 1 + 1e-9 ? "S" : w <= 2 + 1e-9 ? "M" : w <= 4 + 1e-9 ? "L" : "XL";
}
function bufferLabel(t) {
  const r = rangeWeeks(t);
  if (!r) return "";
  const b = t.bufferWeeks || 0;
  const likely = r.likely - b, late = r.late - b;
  const base = (likely === late ? late : likely + "–" + late) + " uker";
  return b ? base + " + " + b + " uke" + (b === 1 ? "" : "r") + " buffer" : base;
}
function rawLabel(t) {
  const r = rangeWeeks(t);
  if (!r || !t.raw) return "";
  const b = t.bufferWeeks || 0;
  if (r.likely - b === t.raw.likely && r.late - b === t.raw.late) return "";
  return "utredning sa " + (t.raw.likely === t.raw.late ? t.raw.late : t.raw.likely + "–" + t.raw.late);
}
/* ---------- the price before a decision: the epic's colour if this feature lands there ---------- */
function previewPlacement(plan, taskId, laneKey) {   // the price before the decision: the colour, the feature's computed window, and what it pushes (R5)
  if (!plan.tasks.some((t) => t.id === taskId) || !plan.lanes.some((l) => l.key === laneKey)) return null;
  const before = epicStatus(plan, laneKey).code;
  const coloursBefore = new Map(plan.lanes.map((l) => [l.key, epicStatus(plan, l.key).code]));
  const copy = normalizePlan(JSON.parse(JSON.stringify(plan)));
  const t = copy.tasks.find((v) => v.id === taskId);
  t.lane = laneKey;
  delete t.order;
  normalizePlan(copy);
  // raw weeks become elapsed time through the sprint mix while the range still is the raw one (plus buffer)
  if (t.kind === "estimate" && t.raw) {
    const r = rangeWeeks(t), b = t.bufferWeeks || 0;
    if (r && r.likely - b === t.raw.likely && r.late - b === t.raw.late) {
      const f = capacityFactor(copy);
      t.endLikely = t.start + (elapsedWeeks(t.raw.likely, f) + b) * WEEK;
      t.end = t.start + (elapsedWeeks(t.raw.late, f) + b) * WEEK;
    }
  }
  const startsBefore = new Map(copy.tasks.map((v) => [v.id, v.start]));
  resolveQueue(copy);
  const pushed = copy.tasks
    .filter((v) => v.id !== taskId && v.start > startsBefore.get(v.id) + 1e-9)
    .map((v) => ({ id: v.id, label: v.label, laneKey: v.lane, weeks: Math.round((v.start - startsBefore.get(v.id)) / WEEK) }));
  const epics = copy.lanes
    .filter((l) => l.key !== laneKey)
    .map((l) => ({ key: l.key, name: l.name, before: coloursBefore.get(l.key), after: epicStatus(copy, l.key).code }))
    .filter((e) => e.before !== e.after);
  return {
    before, after: epicStatus(copy, laneKey).code, window: epicWindowText(copy, laneKey),
    featureStart: t.start, featureWeeks: rangeWeeks(t), featureWindow: windowLabel(t), pushed, epics,
  };
}

/* ---------- delivery window in ISO weeks, overdue discoveries ---------- */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
}
function weekSpan(u1, u2) {
  const w1 = isoWeek(unitToDate(u1)), w2 = isoWeek(unitToDate(u2));
  return "uke " + (w1 === w2 ? w1 : w1 + "–" + w2);
}
function windowLabel(t) {
  return t.kind === "estimate" ? weekSpan(t.endLikely, t.end) : "";
}
function epicWindowText(plan, laneKey) {
  const st = epicStatus(plan, laneKey);
  return typeof st.likely === "number" ? "Leveres " + weekSpan(st.likely, st.late) : "";
}
function discoveryOverdue(t, today) {
  return t.kind === "discovery" && t.end < today - 1e-9;
}

/* ---------- example seed (deck slides 6, 22, 23, 24) ---------- */
// `prev` is the plan the seed replaces. Its tombstones are carried over and every
// seeded lane/task that was deleted before is versioned PAST its tombstone, so the
// server merge keeps the seed instead of silently dropping it again.
const D = (y, m, d) => dateToUnit(new Date(y, m - 1, d));
function exampleSeed(prev) {
  const est = (id, lane, label, start, likelyW, lateW, extra) =>
    Object.assign(
      { id, lane, label, kind: "estimate", start, endLikely: start + likelyW * WEEK, end: start + lateW * WEEK, deps: [], fv: {} },
      extra || {},
    );
  const disc = (id, lane, label, start, end, extra) =>
    Object.assign({ id, lane, label, kind: "discovery", start, end, deps: [], fv: {} }, extra || {});
  const lane = (key, name, extra) => Object.assign({ key, name, owner: OWNER_DEFAULT }, extra || {});
  const p = normalizePlan({
    schema: SCHEMA,
    example: true,
    lanes: [
      lane("org", "En ny organisasjon er i gang fra dag én", { goalDate: D(2027, 2, 1), goalProvisional: true }),
      lane("samtaler", "Samtaler du kan stole på"),
      lane("telenor", "Telenor kan bygge på oss", { goalDate: D(2026, 12, 15) }),
      lane("revisjon", "Vi består en ekstern sikkerhetsrevisjon"),
      lane("drift", "Vi ser nedetid før kunden gjør det"),
      lane("filer", "Filene dine er trygge i Skytale"),
      lane("kanaler", "Samarbeid i travle kanaler"),
    ],
    tasks: [
      disc("iam", "org", "IAM: brukerlivsløp", D(2026, 10, 12), D(2026, 11, 6)),
      disc("qr", "org", "Innmelding med QR-kode", D(2026, 11, 9), D(2026, 12, 4), { adoId: 4791 }),
      est("roller", "org", "Rollebasert tilgang", D(2026, 11, 9), 4, 6, { adoId: 4664, deps: ["iam"] }),
      disc("samtaler-sfu", "samtaler", "Samtaler: video og skjermdeling (SFU)", D(2026, 10, 12), D(2026, 11, 20), { adoId: 4742 }),
      disc("varsler", "samtaler", "Varsler", D(2026, 11, 23), D(2026, 12, 4)),
      est("f24", "telenor", "API for integrasjoner (F-24)", D(2026, 10, 12), 6, 9),
      est("kapasitet", "telenor", "Kapasitet i store grupper", D(2026, 11, 2), 4, 7, { adoId: 4499 }),
      disc("herding", "revisjon", "Sikkerhetsherding", D(2026, 11, 2), D(2026, 11, 20)),
      disc("overvaking", "revisjon", "Driftsovervåking", D(2026, 11, 23), D(2026, 12, 11)),
      disc("fjernsletting", "revisjon", "Fjernsletting av enhet", D(2026, 12, 7), D(2026, 12, 18), { adoId: 4790 }),
      disc("statusvarsel", "drift", "Driftsovervåking og statusvarsel", D(2026, 11, 2), D(2026, 11, 27)),
      disc("reservedrift", "drift", "Infrastruktur og reservedrift", D(2026, 11, 30), D(2026, 12, 18)),
      disc("filevault", "filer", "FileVault-fanen", D(2026, 10, 19), D(2026, 11, 13), { adoId: 4780 }),
      est("fildeling", "filer", "Fildeling i chat", D(2026, 10, 12), 3, 5, { adoId: 4492 }),
      disc("trader", "kanaler", "Tråder", D(2026, 11, 2), D(2026, 11, 27), { adoId: 4566 }),
      disc("omtaler", "kanaler", "@-omtaler", D(2026, 11, 30), D(2026, 12, 11)),
      disc("kontaktkort", "kanaler", "Kontaktkort", D(2026, 12, 14), D(2026, 12, 23)),
      disc("sok", "kanaler", "Søk", D(2027, 1, 4), D(2027, 1, 29), { adoId: 4716 }),
    ],
    deleted: {},
  });
  if (prev && typeof prev === "object") {
    const deleted = prev.deleted && typeof prev.deleted === "object" ? prev.deleted : {};
    const deletedLanes = prev.deletedLanes && typeof prev.deletedLanes === "object" ? prev.deletedLanes : {};
    p.lanes.forEach((l) => { if (deletedLanes[l.key]) l.v = deletedLanes[l.key] + 1; });
    p.tasks.forEach((t) => { if (deleted[t.id]) t.fv = { tid: deleted[t.id] + 1 }; });
    p.deleted = Object.assign({}, deleted);
    p.deletedLanes = Object.assign({}, deletedLanes);
  }
  return p;
}

/* ---------- progress: the v3.1 rule as a second signal (never the epic colour) ---------- */
function progressFraction(p) {
  if (!p || typeof p !== "object") return null;
  if (num(p.pointsTotal, 0) > 0) return Math.max(0, Math.min(1, num(p.pointsDone, 0) / p.pointsTotal));
  if (num(p.pct, null) !== null) return Math.max(0, Math.min(1, p.pct / 100));
  return null;
}
function progressSignal(t, today) {   // green: progress keeps up with the time spent in the likely window (10 % slack); yellow: behind; red: the late end passed
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

/* ---------- sprints: from ADO's iterations, cached in plan.sprints ---------- */
function dayKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function currentSprint(sprints, date) {
  const k = dayKey(date);
  return (Array.isArray(sprints) ? sprints : []).find((s) => s.start <= k && k <= s.finish) || null;
}
function sprintDay(sprint, date) {   // working days (Mon–Fri) from the sprint's start through `date`, 1-based; day 10 is a two-week sprint's last day
  const [y, m, d] = sprint.start.split("-").map(Number);
  let n = 0;
  for (const c = new Date(y, m - 1, d); dayKey(c) <= dayKey(date); c.setDate(c.getDate() + 1)) if (c.getDay() !== 0 && c.getDay() !== 6) n++;
  return Math.max(1, n);
}
function sprintLabel(sprints, date) {
  const s = currentSprint(sprints, date);
  return s ? s.name + " · dag " + sprintDay(s, date) : "";
}

if (typeof module !== "undefined") {
  module.exports = {
    BASE_Y, BASE_M, N_MONTHS, WEEK, SCHEMA, OWNER_DEFAULT, STATUS_LABEL,
    BACKLOG, FEATURE_STATES, EPIC_STATES, STATE_LABEL, EPIC_STATE_LABEL, OUTCOMES,
    dateToUnit, unitToDate, fmtDate, normalizePlan, epicStatus, shiftTask, resolveDeps,
    rangeWeeks, rangeLabel, goalText, exampleSeed,
    isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue,
    shelfTasks, epicCounts, sizeClass, bufferLabel, rawLabel, previewPlacement,
    dayKey, currentSprint, sprintDay, sprintLabel,
    progressFraction, progressSignal, epicProgressSignal, progressText,
    MIX, MIX_LABEL, capacityFactor, elapsedWeeks, queueFloor, resolveQueue,
  };
}
