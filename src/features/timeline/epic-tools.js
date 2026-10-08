// Shared logic for the epic roadmap (/timeline): time unit, plan normalisation,
// computed epic status, dependency push and the example seed. Plain script:
// the browser loads it with <script src>, vitest imports it via epic-tools.d.ts.
// One source, no drift between the page and the tests.

/* ---------- time: unit = months since 1 Aug 2026 ---------- */
const BASE_Y = 2026;
const BASE_M = 7; // august, 0-indexed
const N_MONTHS = 17; // axis ends Dec 2027
const WEEK = 0.25; // one week in month units, also the drag snap
const MND = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

function dateToUnit(d) {
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (d.getFullYear() - BASE_Y) * 12 + (d.getMonth() - BASE_M) + (d.getDate() - 1) / dim;
}
function unitToDate(u) {
  u = Math.max(0, Math.min(N_MONTHS, u));
  const i = Math.min(N_MONTHS - 1, Math.floor(u));
  const m = (BASE_M + i) % 12;
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
  p.lanes.forEach((l) => {
    if (typeof l.owner !== "string" || !l.owner) l.owner = OWNER_DEFAULT;
    if (num(l.goalDate, null) === null) delete l.goalDate;
    if (!l.goalProvisional) delete l.goalProvisional;
    if (num(l.adoId, null) === null) delete l.adoId;
    if (typeof l.metric !== "string" || !l.metric.trim()) delete l.metric;
    if (!l.externalDate) delete l.externalDate;
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

function resolveDeps(plan) {
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const shifted = []; // [{ id, by }]: by = the blocker whose late end forced the shift
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const t of plan.tasks) {
      let req = -Infinity, by = null;
      t.deps.forEach((d) => {
        const p = byId.get(d);
        if (p && p.end > req) { req = p.end; by = d; }
      });
      if (req > t.start + 1e-9 && shiftTask(t, req - t.start) !== 0) {
        const prev = shifted.find((s) => s.id === t.id);
        if (prev) prev.by = by; else shifted.push({ id: t.id, by });
        changed = true;
      }
    }
  }
  return shifted;
}

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
function previewPlacement(plan, taskId, laneKey) {
  if (!plan.tasks.some((t) => t.id === taskId) || !plan.lanes.some((l) => l.key === laneKey)) return null;
  const before = epicStatus(plan, laneKey).code;
  const copy = normalizePlan(JSON.parse(JSON.stringify(plan)));
  const t = copy.tasks.find((v) => v.id === taskId);
  t.lane = laneKey;
  delete t.order;
  normalizePlan(copy);
  return { before, after: epicStatus(copy, laneKey).code, window: epicWindowText(copy, laneKey) };
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

if (typeof module !== "undefined") {
  module.exports = {
    BASE_Y, BASE_M, N_MONTHS, WEEK, SCHEMA, OWNER_DEFAULT, STATUS_LABEL,
    BACKLOG, FEATURE_STATES, EPIC_STATES, STATE_LABEL, EPIC_STATE_LABEL, OUTCOMES,
    dateToUnit, unitToDate, fmtDate, normalizePlan, epicStatus, shiftTask, resolveDeps,
    rangeWeeks, rangeLabel, goalText, exampleSeed,
    isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue,
    shelfTasks, epicCounts, sizeClass, bufferLabel, rawLabel, previewPlacement,
  };
}
