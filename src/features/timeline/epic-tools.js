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
// the intake (R7b): where a wish came from and what produktforum decided
const WISH_SOURCES = ["egen-plan", "investor", "kunde", "ledermote", "annet"];
const WISH_SOURCE_LABEL = { "egen-plan": "Egen plan", investor: "Investor", kunde: "Kunde", ledermote: "Ledermøte", annet: "Annet" };
const WISH_STATUSES = ["ubehandlet", "utred", "senere", "nei"];
const WISH_STATUS_LABEL = { ubehandlet: "Ubehandlet", utred: "Utred nå", senere: "Senere", nei: "Nei" };
const SIZE_CLASSES = ["S", "M", "L", "XL"];
// the four attributes from the old board (R9)
const FEATURE_TYPES = ["feature", "teknisk", "vedlikehold"];
const FEATURE_TYPE_LABEL = { feature: "Feature", teknisk: "Teknisk", vedlikehold: "Vedlikehold" };
const AREAS = ["Backend", "Frontend", "iOS", "Android", "Desktop", "Admin"];
/** Areas as typed or imported → the canonical names, deduplicated, in the canonical order; [] when none. */
function normalizeAreas(v) {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[;,]/) : [];
  const want = new Set(list.filter((x) => typeof x === "string").map((x) => x.trim().toLowerCase()));
  return AREAS.filter((a) => want.has(a.toLowerCase()));
}
const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);

function normalizePlan(plan) {
  const p = plan && typeof plan === "object" ? plan : {};
  p.schema = SCHEMA;
  p.lanes = Array.isArray(p.lanes) ? p.lanes : [];
  p.tasks = Array.isArray(p.tasks) ? p.tasks : [];
  p.deleted = p.deleted && typeof p.deleted === "object" ? p.deleted : {};
  p.deletedLanes = p.deletedLanes && typeof p.deletedLanes === "object" ? p.deletedLanes : {};
  p.deletedWishes = p.deletedWishes && typeof p.deletedWishes === "object" ? p.deletedWishes : {};
  const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  p.wishes = (Array.isArray(p.wishes) ? p.wishes : []).filter((w) => w && typeof w === "object" && typeof w.id === "string" && w.id && text(w.title, 200)).map((w) => {
    const out = { id: w.id, v: num(w.v, 0), title: text(w.title, 200), status: WISH_STATUSES.includes(w.status) ? w.status : "ubehandlet", source: WISH_SOURCES.includes(w.source) ? w.source : "annet" };
    for (const k of ["note", "askedBy", "askedOn", "registeredBy", "registeredAt", "decidedAt", "decidedBy", "forum", "reason", "featureId"]) { const v = text(w[k], k === "note" || k === "reason" ? 2000 : 200); if (v) out[k] = v; }
    const owner = text(w.owner, 12); if (owner) out.owner = owner.toUpperCase();
    if (SIZE_CLASSES.includes(w.sizeClass)) out.sizeClass = w.sizeClass;
    return out;
  });
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
  const sprintCheck = sprintCheckOf(p.sprintCheck, isDay);   // R19: the Sprint tab's read of ADO, written by the server; dropped whole when any part is off
  if (sprintCheck) p.sprintCheck = sprintCheck; else delete p.sprintCheck;
  // releases (R10): a version with a target day, a shipped day once out, and the ADO read-back of its label's bugs and stories
  p.deletedReleases = p.deletedReleases && typeof p.deletedReleases === "object" ? p.deletedReleases : {};
  const validDay = (d) => { if (!isDay(d)) return false; const q = d.split("-").map(Number), dt = new Date(q[0], q[1] - 1, q[2]); return dt.getFullYear() === q[0] && dt.getMonth() === q[1] - 1 && dt.getDate() === q[2]; };   // a real calendar day, not just the shape
  p.releases = (Array.isArray(p.releases) ? p.releases : []).filter((r) => r && typeof r === "object" && typeof r.key === "string" && r.key && text(r.version, 40) && validDay(r.targetDate)).map((r) => {
    const out = { key: r.key, v: num(r.v, 0), version: text(r.version, 40), targetDate: r.targetDate };
    if (validDay(r.qaDate)) out.qaDate = r.qaDate;   // R18: «Klar for QA», the development lead's date (the editor keeps it on or before «Release»)
    if (validDay(r.shippedDate)) out.shippedDate = r.shippedDate;
    if (out.shippedDate && Array.isArray(r.openAtShip)) { const ids = [...new Set(r.openAtShip.filter((n) => Number.isInteger(n) && n > 0))]; if (ids.length) out.openAtShip = ids; }   // R18: what was not closed at «Sluppet»
    const note = text(r.note, 2000); if (note) out.note = note;
    const label = text(r.label, 60); if (label && label !== out.version) out.label = label;
    if (r.ado && typeof r.ado === "object" && typeof r.ado.at === "string" && Array.isArray(r.ado.items)) {
      out.ado = { at: r.ado.at, label: typeof r.ado.label === "string" && r.ado.label ? r.ado.label : out.label || out.version, items: r.ado.items.filter((i) => i && typeof i === "object" && typeof i.id === "number").map((i) => ({
        id: i.id, type: i.type === "Bug" ? "Bug" : "User Story", title: typeof i.title === "string" ? i.title.slice(0, 200) : "", state: typeof i.state === "string" && i.state ? i.state : "New", points: Math.max(0, num(i.points, 0)), assignee: typeof i.assignee === "string" && i.assignee ? i.assignee : null, ...(typeof i.iteration === "string" && i.iteration ? { iteration: i.iteration } : {}), ...(validDay(i.delivered) ? { delivered: i.delivered } : {}),
        ...(CATEGORY_ORDER.includes(i.category) ? { category: i.category } : {}), ...(validDay(i.closed) ? { closed: i.closed } : {}),   // R18: ADO's category of the state, the day it was closed
      })) };
      const hist = new Map();   // R11: one reading per day, the day's last wins, the latest kept
      const chance = (f) => (f && typeof f === "object" && Number.isFinite(f.p) && f.p >= 0 && f.p <= 1 && Number.isFinite(f.mean) && f.mean >= 0 ? { forecast: { p: f.p, mean: f.mean } } : {});   // R12: the day's chance
      const closedOf = (h) => ({ ...(Number.isFinite(h.closedPoints) && h.closedPoints >= 0 ? { closedPoints: h.closedPoints } : {}), ...(Number.isFinite(h.closed) && h.closed >= 0 ? { closed: h.closed } : {}) });   // R18: what was closed that day
      (Array.isArray(r.ado.history) ? r.ado.history : []).forEach((h) => { if (h && typeof h === "object" && validDay(h.day)) hist.set(h.day, { day: h.day, pointsDone: Math.max(0, num(h.pointsDone, 0)), pointsTotal: Math.max(0, num(h.pointsTotal, 0)), done: Math.max(0, num(h.done, 0)), total: Math.max(0, num(h.total, 0)), ...closedOf(h), ...chance(h.forecast) }); });
      if (hist.size) out.ado.history = [...hist.values()].sort((x, y) => (x.day < y.day ? -1 : 1)).slice(-RELEASE_HISTORY_MAX);
      const sprints = (Array.isArray(r.ado.sprints) ? r.ado.sprints : []).filter((s) => s && typeof s === "object" && typeof s.name === "string" && s.name).map((s) => ({ name: s.name, unlabelled: Math.max(0, num(s.unlabelled, 0)) }));
      if (sprints.length) out.ado.sprints = sprints;
      const fc = forecastOf(r.ado.forecast, validDay);
      if (fc) out.ado.forecast = fc;
      if (r.ado.statesMissing === true) out.ado.statesMissing = true;   // R18: ADO's states were not found, the items were counted by the names
    }
    return out;
  }).sort((a, b) => releaseEnd(a) - releaseEnd(b) || a.version.localeCompare(b.version));
  // deliveries (R16): COO's promise to customers, hanging on epics and releases; a key of a since-deleted part stays and is ignored when read
  p.deletedDeliveries = p.deletedDeliveries && typeof p.deletedDeliveries === "object" ? p.deletedDeliveries : {};
  const strList = (v, max, n) => { const out = []; (Array.isArray(v) ? v : []).forEach((s) => { const t = text(s, max); if (t && !out.includes(t) && out.length < n) out.push(t); }); return out; };
  p.deliveries = (Array.isArray(p.deliveries) ? p.deliveries : []).filter((d) => d && typeof d === "object" && typeof d.key === "string" && d.key && text(d.name, 120) && validDay(d.promisedDate)).map((d) => {
    const out = { key: d.key, v: num(d.v, 0), name: text(d.name, 120), customers: d.allCustomers ? [] : strList(d.customers, 60, 50), promisedDate: d.promisedDate, epics: strList(d.epics, 80, 200), releases: strList(d.releases, 80, 200) };
    if (d.allCustomers) out.allCustomers = true;
    const owner = text(d.owner, 60); if (owner) out.owner = owner;
    const note = text(d.note, 2000); if (note) out.note = note;
    return out;
  }).sort((a, b) => (a.promisedDate < b.promisedDate ? -1 : a.promisedDate > b.promisedDate ? 1 : a.name.localeCompare(b.name, "nb")));
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
  // priority = produktforum's number (1 = top); several epics may share one, and those sort by name. Data, not array order,
  // so it survives the merge. A missing or broken number goes after the highest.
  const priOf = (l) => (Number.isInteger(l.priority) && l.priority >= 1 ? l.priority : null);
  let nextPri = Math.max(0, ...p.lanes.map((l) => priOf(l) || 0));
  p.lanes.forEach((l) => { if (priOf(l) === null) l.priority = ++nextPri; });
  p.lanes.sort((a, b) => a.priority - b.priority || String(a.name || "").localeCompare(String(b.name || ""), "nb"));
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
    if (!SIZE_CLASSES.includes(t.sizeClass)) delete t.sizeClass;   // the class the forum promised at «Start utredning» (R8)
    if (typeof t.startedAt !== "string" || !t.startedAt) delete t.startedAt;   // when the discovery was started: its place in the owner's queue (R8)
    if (!FEATURE_TYPES.includes(t.type)) delete t.type;   // R9: feature · teknisk · vedlikehold
    const areas = normalizeAreas(t.areas); if (areas.length) t.areas = areas; else delete t.areas;
    if (t.fixedEnd) t.fixedEnd = true; else delete t.fixedEnd;   // a hard date: the queue never moves it
    if (typeof t.cardId !== "string" || !t.cardId) delete t.cardId;   // the old board's card this came from (R9 import, once)
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
/** The shelf: features on the backlog lane that still wait for a place in an epic (delivered ones are on the board's «Levert»). */
function shelfTasks(plan) { return plan.tasks.filter((t) => t.lane === BACKLOG && t.state !== "levert"); }

/* ---------- R13: the transitions the lifecycle lacked ---------- */
/** Delivery of a feature with an ADO id is ADO's; one without can be marked delivered by hand. */
function canMarkDelivered(t) { return !!t && !t.adoId && t.state !== "levert"; }
/** Marks it delivered on `day` (YYYY-MM-DD). A discovery becomes an estimate whose end is its span. Returns the field groups touched. */
function markDelivered(t, day) {
  const groups = ["state"];
  if (t.kind === "discovery") { t.kind = "estimate"; t.endLikely = t.end; groups.push("meta", "tid"); }
  t.state = "levert"; t.deliveredAt = day;
  return groups;
}
/** An estimated feature on the shelf or in an epic can go back to discovery. */
function canRestartDiscovery(t) { return !!t && t.kind === "estimate" && (t.state === "klar" || t.state === "aktiv"); }
/** The lane rule both pages share: an estimate from the shelf into an epic becomes aktiv with the promised span, back on the
 *  shelf it is klar again; a discovery, a registered or a delivered feature keeps its state. Returns the groups touched. */
function applyLaneChange(t, laneKey, todayDay) {
  if (t.lane === laneKey) return [];
  const from = t.lane;
  t.lane = laneKey;
  const groups = ["meta"];
  if (t.kind !== "estimate" || t.state === "levert" || t.state === "ny") return groups;
  if (laneKey === BACKLOG && t.state === "aktiv") { t.state = "klar"; delete t.committedRange; delete t.activatedAt; groups.push("state"); }
  else if (from === BACKLOG && laneKey !== BACKLOG) {
    const r = rangeWeeks(t);
    t.state = "aktiv";
    if (r) t.committedRange = { likely: r.likely, late: r.late, start: t.start };
    t.activatedAt = todayDay;
    groups.push("state");
  }
  return groups;
}
/** The board's column: the lifecycle state, «Aktiv» meaning an estimate inside an epic. */
function boardColumn(t) { return t.state === "levert" ? "levert" : t.state === "ny" ? "ny" : t.state === "utredes" ? "utredes" : t.lane === BACKLOG ? "klar" : "aktiv"; }
/** Whether the board may move a feature to a column: one step forward, back to the shelf or to discovery, delivered by hand only without ADO. */
function featureTransition(t, to) {
  const from = boardColumn(t);
  if (from === to || to === "ny" || from === "levert") return false;
  if (to === "levert") return canMarkDelivered(t);
  if (from === "ny") return to === "utredes";
  if (from === "utredes") return to === (t.lane === BACKLOG ? "klar" : "aktiv");
  if (from === "klar") return to === "aktiv" || to === "utredes";
  if (from === "aktiv") return to === "klar" || to === "utredes";
  return false;
}
/** The intake grouped by decision, newest registration first inside each group. */
function wishesByStatus(plan) {
  const out = { ubehandlet: [], utred: [], senere: [], nei: [] };
  const sorted = [...(plan.wishes || [])].sort((a, b) => (b.registeredAt || "").localeCompare(a.registeredAt || ""));
  sorted.forEach((w) => out[w.status || "ubehandlet"].push(w));
  return out;
}
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
// R8: a discovery with an owner occupies them from start to end (spec decision 4): the owner's features start when it ends
// in the order they were started (the forum's earlier decision keeps its place; a new one queues behind), else by start
function discoveryAnchors(plan) {
  return plan.tasks.filter((t) => t.kind === "discovery" && t.state !== "levert" && t.assignee)
    .sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || "") || a.start - b.start || (a.order || 0) - (b.order || 0));
}
const occupies = (d, t) => d.start < t.end - 1e-9 && d.end >= t.start - 1e-9;   // the discovery runs into the feature's window (touching counts: the feature starts when it ends)
function floorOf(plan, t, earlier) {
  const byId = new Map(plan.tasks.map((v) => [v.id, v]));
  let floor = -Infinity, by = null, kind = null;
  (t.deps || []).forEach((d) => { const p = byId.get(d); if (p && p.end > floor + 1e-9) { floor = p.end; by = d; kind = "dep"; } });
  if (t.assignee) earlier.forEach((e) => { if (e.assignee === t.assignee && e.end >= floor - 1e-9) { floor = e.end; by = e.id; kind = "queue"; } });
  if (t.assignee && t.kind === "estimate" && t.lane !== BACKLOG && t.state !== "levert") discoveryAnchors(plan).forEach((d) => { if (d.id !== t.id && d.assignee === t.assignee && occupies(d, t) && d.end > floor + 1e-9) { floor = d.end; by = d.id; kind = "queue"; } });
  return { floor: floor === -Infinity ? null : floor, by, kind };
}
/** What a task waits for: earlier discoveries of the owner for a discovery, the queue order for a feature. */
function earlierFor(plan, t) {
  if (t.kind === "discovery") { const discs = discoveryAnchors(plan), i = discs.findIndex((v) => v.id === t.id); return i < 0 ? [] : discs.slice(0, i); }
  const order = queueOrder(plan), i = order.findIndex((v) => v.id === t.id);
  return i < 0 ? [] : order.slice(0, i);
}
function queueFloor(plan, taskId) {
  const t = plan.tasks.find((v) => v.id === taskId);
  if (!t) return { floor: null, by: null, kind: null };
  return floorOf(plan, t, earlierFor(plan, t));
}
function resolveQueue(plan) {
  const shifted = []; // [{ id, by, kind }]: what each shifted feature waits for
  const note = (t, f) => { const prev = shifted.find((s) => s.id === t.id); if (prev) { prev.by = f.by; prev.kind = f.kind; } else shifted.push({ id: t.id, by: f.by, kind: f.kind }); };
  let changed = true, guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    const order = queueOrder(plan), discs = discoveryAnchors(plan), inQueue = new Set([...order, ...discs].map((t) => t.id));
    // R8: an owner's discoveries run one after the other, by start; a discovery never waits for a feature
    discs.forEach((t, i) => {
      const f = floorOf(plan, t, discs.slice(0, i));
      if (f.floor === null || t.pinned || t.fixedEnd || f.floor <= t.start + 1e-9) return;
      if (shiftTask(t, f.floor - t.start) !== 0) { note(t, f); changed = true; }
    });
    order.forEach((t, i) => {
      const f = floorOf(plan, t, order.slice(0, i));
      if (f.floor === null || t.pinned || t.fixedEnd || f.floor <= t.start + 1e-9) return;   // a fixed end is never moved (R9)
      if (shiftTask(t, f.floor - t.start) !== 0) { note(t, f); changed = true; }
    });
    // ownerless discoveries, the shelf and delivered features keep the plain rule: after a blocker's late end
    plan.tasks.filter((t) => !inQueue.has(t.id)).forEach((t) => {
      const f = floorOf(plan, t, []);
      if (f.floor === null || t.pinned || t.fixedEnd || f.floor <= t.start + 1e-9) return;
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
/** What the dates say: S ≤ 1 week, M ≤ 2, L ≤ 4, XL above (the deck's thresholds). */
function sizeClassDerived(t) {
  if (t.kind !== "discovery") return "";
  const w = (t.end - t.start) / WEEK;
  const slack = 0.2;   // a date typed or computed to the day lands up to a day and a half off the week grid: still the same class
  return w <= 1 + slack ? "S" : w <= 2 + slack ? "M" : w <= 4 + slack ? "L" : "XL";
}
/** The class the forum promised when it exists (R8), else the derived one. */
function sizeClass(t) {
  if (t.kind !== "discovery") return "";
  return SIZE_CLASSES.includes(t.sizeClass) ? t.sizeClass : sizeClassDerived(t);
}
/** «M», or «M, nå L» when the dates have drifted from the promise. */
function sizeClassText(t) {
  const s = sizeClass(t);
  if (!s) return "";
  const d = sizeClassDerived(t);
  return SIZE_CLASSES.includes(t.sizeClass) && d !== t.sizeClass ? t.sizeClass + ", nå " + d : s;
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
    // a copy of an example feature still in the plan (say, on the shelf after its epic was deleted): the example wins every field group
    const prevTasks = new Map((Array.isArray(prev.tasks) ? prev.tasks : []).filter((t) => t && typeof t.id === "string").map((t) => [t.id, t]));
    const groups = ["tid", "label", "deps", "meta", "state", "est", "ado", "progress"];
    p.tasks.forEach((t) => { const c = prevTasks.get(t.id); if (!c) return; t.fv = t.fv || {}; groups.forEach((g) => { t.fv[g] = Math.max(t.fv[g] || 0, ((c.fv && c.fv[g]) || 0) + 1); }); });
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

/* ---------- releases (R10): the band above the sprint ruler ---------- */
const RELEASE_DONE_STATES = ["Resolved", "Closed"];   // done by name, for an item without a category (read before R18, or ADO's states not found)
/** The chart unit of a YYYY-MM-DD day (local midnight), shared by the sprint ruler and the release band. */
function dayToUnit(day) { const q = String(day).split("-").map(Number); return dateToUnit(new Date(q[0], q[1] - 1, q[2])); }
/** The release label in ADO (`Custom.Release`): the version unless overridden. */
function releaseScope(r) { return r.label || r.version; }
function releaseEnd(r) { return dayToUnit(r.shippedDate || r.targetDate); }
/** The ADO query behind a release: every Bug and User Story carrying the label, any state but Removed. */
function releaseWiql(label) {
  return "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [Custom.Release] = '" + String(label).replace(/'/g, "''") + "' AND [System.WorkItemType] IN ('Bug', 'User Story') AND [System.State] <> 'Removed' ORDER BY [System.WorkItemType], [System.Id]";
}
const ADO_PROJECT_URL = "https://dev.azure.com/SkytaleAS/Skytale";
/** The same query opened in ADO's work item hub («Åpne i ADO» in the release drawer). */
function releaseQueryUrl(label) { return ADO_PROJECT_URL + "/_workitems?_a=query&wiql=" + encodeURIComponent(releaseWiql(label)); }
/** The releases as segments on the band, sorted by end day: each starts where the previous one ends, the first two weeks before its own end. */
function releaseSegments(plan, todayUnit) {
  const list = ((plan && plan.releases) || []).slice().sort((a, b) => releaseEnd(a) - releaseEnd(b) || a.version.localeCompare(b.version));
  let prev = null;
  return list.map((r) => {
    const end = releaseEnd(r);
    const start = prev === null ? end - 2 * WEEK : Math.min(prev, end - WEEK / 7);
    prev = end;
    return { release: r, start, end, shipped: !!r.shippedDate, overdue: !r.shippedDate && typeof todayUnit === "number" && end < todayUnit };
  });
}
const releaseItemDone = (i) => (i.category ? i.category === "Resolved" || i.category === "Completed" : RELEASE_DONE_STATES.includes(i.state));   // R18: developed
const releaseItemClosed = (i) => (i.category ? i.category === "Completed" : i.state === "Closed");   // R18: through QA
/** Points developed (R18: by the state's category; Resolved/Closed without one) over all points (items by count when nobody pointed them), with the counts in words;
 *  R18: and what is closed (through QA), the same way. */
function releaseProgress(r) {
  const a = r && r.ado;
  if (!a || !Array.isArray(a.items)) return { fraction: null, text: "ikke lest fra ADO", bugs: 0, stories: 0, done: 0, total: 0, pointsDone: 0, pointsTotal: 0, closed: 0, pointsClosed: 0, closedFraction: null };
  const items = a.items, doneItems = items.filter(releaseItemDone), closedItems = items.filter(releaseItemClosed);
  const points = (list) => list.reduce((s, i) => s + (i.points || 0), 0);
  const pointsTotal = points(items), pointsDone = points(doneItems), pointsClosed = points(closedItems);
  const bugs = items.filter((i) => i.type === "Bug").length, stories = items.length - bugs, done = doneItems.length, total = items.length, closed = closedItems.length;
  const n = (c, one, many) => c + " " + (c === 1 ? one : many);
  const fraction = pointsTotal > 0 ? pointsDone / pointsTotal : total ? done / total : 0;
  const closedFraction = pointsTotal > 0 ? pointsClosed / pointsTotal : total ? closed / total : 0;
  const text = !total ? "ingenting med labelen i ADO" : n(bugs, "bug", "bugs") + ", " + n(stories, "story", "stories") + " · " + (pointsTotal > 0 ? pointsDone + "/" + pointsTotal + " SP utviklet" : done + " av " + total + " utviklet");
  return { fraction, text, bugs, stories, done, total, pointsDone, pointsTotal, closed, pointsClosed, closedFraction };
}
/** R18: where development aims: «Klar for QA» when it is set, else «Release». */
function releaseDevTarget(r) { return r.qaDate || r.targetDate; }

/* ---------- R12: the chance a release is done by its target day (computed by the server from ADO's Capacity) ---------- */
/** A stored forecast as the normaliser keeps it, or null: the computed kind with its numbers, or what is missing. */
function forecastOf(f, validDay) {
  if (!f || typeof f !== "object" || !validDay(f.day)) return null;
  const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x) : []);
  if (f.missing === "history") return { day: f.day, missing: "history" };
  if (f.missing === "capacity") return { day: f.day, missing: "capacity", sprints: strs(f.sprints), unplanned: Math.max(0, num(f.unplanned, 0)) };
  if (f.missing !== undefined || !["need", "days", "p", "mean", "p10", "p90"].every((k) => Number.isFinite(f[k]) && f[k] >= 0) || f.p > 1) return null;
  const people = (Array.isArray(f.people) ? f.people : []).filter((x) => x && typeof x === "object" && typeof x.name === "string" && x.name && ["days", "pace", "expected"].every((k) => Number.isFinite(x[k]))).map((x) => ({ name: x.name, days: x.days, pace: x.pace, expected: x.expected }));
  return { day: f.day, need: f.need, days: f.days, p: f.p, mean: f.mean, p10: f.p10, p90: f.p90, people, basis: strs(f.basis), capacity: strs(f.capacity) };
}
/** R19: the Sprint tab's read of ADO rebuilt with exactly the fields of `SprintCheck`, or null when any of them is off. */
function sprintCheckOf(c, isDay) {
  const isCount = (n) => Number.isFinite(n) && n >= 0;
  const isMap = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const pick = (o, keys) => (isMap(o) && keys.every((k) => isCount(o[k])) ? Object.fromEntries(keys.map((k) => [k, o[k]])) : null);   // the counts, or null when one is off
  const nameOrNull = (s) => s === null || typeof s === "string";
  if (!isMap(c) || typeof c.at !== "string" || !nameOrNull(c.current) || !nameOrNull(c.next)) return null;
  const bugs = pick(c.bugs, ["open", "A", "B", "C", "D", "none", "inNext", "inNextPoints", "closedCurrent"]), issues = pick(c.issues, ["open"]);
  if (!bugs || !issues) return null;
  const release = c.release === undefined ? null : pick(c.release, ["bugs", "issues"]);
  if (c.release !== undefined && !(release && typeof c.release.label === "string" && c.release.label)) return null;
  const sprints = Array.isArray(c.sprints) ? c.sprints.map((s) => { const n = pick(s, ["openBugs", "openIssues", "created", "closed", "closedPoints"]); return n && typeof s.name === "string" && s.name && isDay(s.end) ? { name: s.name, end: s.end, ...n } : null; }) : [null];
  const b = c.budget;
  if (sprints.includes(null) || !isMap(b) || !(b.points === null || isCount(b.points)) || !(Number.isFinite(b.share) && b.share >= 0 && b.share <= 1) || !(b.missing === undefined || b.missing === "capacity" || b.missing === "history")) return null;
  if (!isMap(c.features)) return null;
  const features = Object.entries(c.features).map(([k, f]) => [k, pick(f, ["stories", "open", "inNext", "inNextPoints", "inCurrent"])]);
  if (features.some(([, f]) => !f)) return null;
  return {
    at: c.at, current: c.current, next: c.next, ...(c.statesMissing === true ? { statesMissing: true } : {}),
    bugs: { open: bugs.open, A: bugs.A, B: bugs.B, C: bugs.C, D: bugs.D, none: bugs.none, inNext: bugs.inNext, inNextPoints: bugs.inNextPoints, closedCurrent: bugs.closedCurrent },
    issues, ...(release ? { release: { label: c.release.label, ...release } } : {}), sprints, budget: { points: b.points, share: b.share, ...(b.missing ? { missing: b.missing } : {}) }, features: Object.fromEntries(features),
  };
}
const andList = (xs) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " og " + xs[xs.length - 1]);
/** The forecast in words for the drawer, the tooltip, the strip and the report; null without one or once shipped.
 *  R18: the chance is for development: it aims at «Klar for QA» when that is set, and there is none in phase QA. */
function releaseForecastText(r, todayDay) {
  const f = r && !r.shippedDate && r.ado && r.ado.forecast;
  if (!f || (r.qaDate && releasePhase(r) === "qa")) return null;
  if (f.missing === "history") return { short: null, text: "Ingen utviklede poeng i de to siste sprintene å regne tempo fra" };   // R18 (D9): the pace pool counts what was developed
  if (f.missing === "capacity") {
    const off = f.unplanned + " arbeidsdag" + (f.unplanned === 1 ? "" : "er") + " er uten sprint";
    const to = r.qaDate ? "klar for QA" : "målet";   // R18: the window ends at «Klar for QA» when it is set (D7)
    if (!f.sprints.length) return { short: null, text: "Lag sprintene fram til " + to + " i ADO og fyll inn Capacity (" + off + ") for å få sannsynligheten" };
    return { short: null, text: "Fyll inn Capacity i ADO for " + andList(f.sprints) + " (Development-timer per dag og fridager)" + (f.unplanned ? " og lag sprintene fram til " + to + " (" + off + ")" : "") + " for å få sannsynligheten" };
  }
  const short = (f.p >= 0.995 ? "over 99 %" : f.p < 0.005 ? "under 1 %" : Math.round(f.p * 100) + " %") + " sjanse";   // a simulation never knows for certain
  return {
    short,
    text: short + (r.qaDate ? " for at alt er utviklet til klar for QA " + fmtDate(dayOf(r.qaDate)) : " for at alt er utviklet til " + fmtDate(dayOf(r.targetDate))) + (f.day < todayDay ? " · regnet " + fmtDate(dayOf(f.day)) : ""),
    detail: "Forventet " + f.mean + " av " + f.need + " SP på " + f.days + " arbeidsdag" + (f.days === 1 ? "" : "er") + " · 8 av 10 utfall " + (f.p10 === f.p90 ? "rundt " + f.p10 : "mellom " + f.p10 + " og " + f.p90) + " SP",
    basis: "Tempo per person fra " + andList(f.basis) + " · tilgjengelighet fra Capacity i " + andList(f.capacity) + " (Development-timer, 7,5 t = full dag) · ikke regnet med: hvem som kan ta hvilken oppgave",
    people: f.people,
  };
}

/* ---------- R11: progress towards a release: working days, tempo, history, sprint vs release ---------- */
const RELEASE_HISTORY_MAX = 120;              // one point per day: four months of readings
const RELEASE_MAX_AGE_MS = 6 * 3600 * 1000;   // the page re-reads the labels on load when the last read is older (writers)
const PACE_SLACK = 0.1;                       // the feature signal's slack, reused for the straight line
const PACE_LATE_DAYS = 3;                     // working days after the target that still count as yellow
const PACE_WORD = { gronn: "grønn", gul: "gul", rod: "rød" };
const dayOf = (day) => { const q = String(day).split("-").map(Number); return new Date(q[0], q[1] - 1, q[2]); };
const isWorkDay = (d) => d.getDay() !== 0 && d.getDay() !== 6;
/** Working days (Mon–Fri) from day a through day b, both inclusive; 0 when b is before a. */
function workDays(a, b) {
  if (!a || !b || b < a) return 0;
  let n = 0;
  for (const c = dayOf(a); dayKey(c) <= b; c.setDate(c.getDate() + 1)) if (isWorkDay(c)) n++;
  return n;
}
/** Working days after day a up to and including day b (a's own day never counts). */
function workDaysBetween(a, b) { return workDays(a, b) - (b >= a && isWorkDay(dayOf(a)) ? 1 : 0); }
/** The day n working days after `day` (n = 0: the day itself). */
function addWorkDays(day, n) {
  const c = dayOf(day);
  for (let left = Math.max(0, Math.ceil(n)); left > 0; ) { c.setDate(c.getDate() + 1); if (isWorkDay(c)) left--; }
  return dayKey(c);
}
/** Calendar days from a to b, negative when b is before a. */
function calendarDays(a, b) { const A = dayOf(a), B = dayOf(b); return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000); }
/** Where the release's clock starts: the sprint start of the oldest iteration among its items, else the segment's start;
 *  never before the first reading that found anything carrying the label (the scope did not exist before it: 2.0.1 was
 *  stamped a week into Sprint 71). */
function releaseStartDay(plan, r) {
  const sprints = (plan && plan.sprints && plan.sprints.items) || [];
  const starts = ((r.ado && r.ado.items) || []).map((i) => { const s = i.iteration && sprints.find((sp) => sp.name === i.iteration); return s ? s.start : null; }).filter(Boolean).sort();
  let start;
  if (starts.length) start = starts[0];
  else { const seg = releaseSegments(plan).find((s) => s.release.key === r.key); start = dayKey(unitToDate(seg ? seg.start : releaseEnd(r) - 2 * WEEK)); }
  const scoped = ((r.ado && r.ado.history) || []).find((h) => h.total > 0);
  return scoped && scoped.day > start ? scoped.day : start;
}
/** The units (points, or items when nothing has points) delivered on or before `day`; a done item without a delivered day counts from the start. */
function releaseDoneBy(r, day, usePoints) {
  return ((r.ado && r.ado.items) || []).filter((i) => releaseItemDone(i) && (!i.delivered || i.delivered <= day)).reduce((s, i) => s + (usePoints ? i.points || 0 : 1), 0);
}
/** R18: the same for what is closed (through QA) on or before `day`. A closed item without a closed day counts from the day it was
 *  developed, so what is not closed never dips below what is not developed; with neither day, from the start. */
function releaseClosedBy(r, day, usePoints) {
  return ((r.ado && r.ado.items) || []).filter((i) => releaseItemClosed(i) && (!(i.closed || i.delivered) || (i.closed || i.delivered) <= day)).reduce((s, i) => s + (usePoints ? i.points || 0 : 1), 0);
}
const PACE_WORDS = ["null", "én", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni", "ti", "elleve", "tolv"];
const daysWords = (n) => (n <= 12 ? PACE_WORDS[n] : String(n)) + " arbeidsdag" + (n === 1 ? "" : "er");
const dayWords = (day) => fmtDate(dayOf(day));
const pct = (f) => Math.round(f * 100) + " %";
/** The tempo signal of a release that is not out yet: the colour its segment wears and the sentence the drawer, the strip and the report say.
 *  R18: measured against development's target (`releaseDevTarget`); the clock's start is unchanged (its fallback, the segment, ends at «Release»). */
function releasePace(plan, r, todayDay) {
  if (!r || r.shippedDate || !r.ado) return null;
  const pr = releaseProgress(r);
  if (!pr.total) return null;
  const target = releaseDevTarget(r);
  const units = pr.pointsTotal > 0 ? { done: pr.pointsDone, total: pr.pointsTotal } : { done: pr.done, total: pr.total };
  const startDay = releaseStartDay(plan, r);
  const elapsedDays = workDays(startDay, todayDay), totalDays = workDays(startDay, target);
  const elapsed = totalDays > 0 ? Math.max(0, Math.min(1, elapsedDays / totalDays)) : todayDay >= target ? 1 : 0;
  const done = pr.fraction;
  const readings = new Set((r.ado.history || []).map((h) => h.day)).size;
  const usePoints = pr.pointsTotal > 0;
  const dayBefore = dayOf(startDay); dayBefore.setDate(dayBefore.getDate() - 1);
  const since = units.done - releaseDoneBy(r, dayKey(dayBefore), usePoints);   // delivered after the clock started
  const tempo = elapsedDays > 0 && since > 0 ? since / elapsedDays : null;
  const forecastDay = tempo !== null && done < 1 ? addWorkDays(todayDay, Math.ceil((units.total - units.done) / tempo)) : null;
  const deltaDays = forecastDay ? (forecastDay > target ? workDaysBetween(target, forecastDay) : -workDaysBetween(forecastDay, target)) : null;
  const past = todayDay > target;
  let code;
  if (done >= 1) code = "gronn";
  else if (deltaDays !== null) code = deltaDays <= 0 ? "gronn" : deltaDays <= PACE_LATE_DAYS ? "gul" : "rod";
  else code = past ? "rod" : done + Math.max(PACE_SLACK, totalDays > 0 ? 1 / totalDays : 0) >= elapsed ? "gronn" : "gul";   // the straight line allows a working day, at least 10 %
  const qa = !!r.qaDate, ref = qa ? "" : " målet";   // R18: with a QA date the sentence aims at it
  const head = pct(done) + " utviklet · " + pct(elapsed) + " av tiden brukt";
  const tail = done >= 1 ? (qa ? "alt utviklet · QA tar over" : "alt utviklet · sett «Sluppet» når den er ute")
    : forecastDay ? "med dagens tempo " + (qa ? "klar for QA " : "ferdig ") + dayWords(forecastDay) +
      (deltaDays === 0 ? (qa ? ", på dagen" : ", på målet") : deltaDays > 0 ? ", " + daysWords(deltaDays) + " etter" + ref : ", " + daysWords(-deltaDays) + " før" + ref)
    : startDay > todayDay ? "tempo regnes fra " + dayWords(startDay)   // the clock has not started: the items sit in a coming sprint
    : units.done === 0 ? "ingenting utviklet ennå" : "ingenting utviklet siden " + dayWords(startDay);
  return { code, text: head + " · " + tail, done, elapsed, startDay, elapsedDays, totalDays, tempo, forecastDay, deltaDays, readings };
}
/** The next release: the first not shipped, by «Release»; null when there is none. */
function nextRelease(plan) {
  return ((plan && plan.releases) || []).filter((x) => !x.shippedDate).sort((a, b) => (a.targetDate < b.targetDate ? -1 : a.targetDate > b.targetDate ? 1 : 0))[0] || null;
}
/** The legend's status strip: the next release not yet out, how far away it is, the share developed and the tempo colour in words; R18: and its phase. */
function nextReleaseText(plan, todayDay) {
  const r = nextRelease(plan);
  if (!r) return null;
  const n = calendarDays(todayDay, r.targetDate);
  const when = n > 0 ? "om " + n + (n === 1 ? " dag" : " dager") : n === 0 ? "i dag" : -n + (n === -1 ? " dag" : " dager") + " på overtid";
  const pr = releaseProgress(r), pace = releasePace(plan, r, todayDay);
  return { text: "Neste release " + r.version + " " + when + " · " + (pr.fraction === null ? "ikke lest fra ADO" : pct(pr.fraction)) + (pace ? " · " + PACE_WORD[pace.code] : ""), code: pace ? pace.code : null, release: r, phase: releasePhase(r) };
}

/* ---------- R18: a release in two phases: development until «Klar for QA», QA until «Release», «Sluppet» by hand ---------- */
/** «utvikling» while some item is not developed (or nothing carries the label yet), «qa» when everything is, «sluppet» once out. */
function releasePhase(r) {
  if (r.shippedDate) return "sluppet";
  const items = (r.ado && r.ado.items) || [];
  return items.length && items.every(releaseItemDone) ? "qa" : "utvikling";
}
/** The expected release day: «Release» plus the working days development runs past «Klar for QA» (the day everything was developed
 *  in phase QA, else the tempo's day, else at least today); without a QA date the tempo's day, else «Release». Never before today while not out. */
function releaseExpected(plan, r, todayDay) {
  if (r.shippedDate) return r.shippedDate;
  const pace = releasePace(plan, r, todayDay);
  if (!r.qaDate) return laterDay((pace && pace.forecastDay) || r.targetDate, todayDay);
  const items = (r.ado && r.ado.items) || [];
  const finished = releasePhase(r) === "qa" ? items.map((i) => i.delivered).filter(Boolean).sort().pop() || todayDay : null;
  const devEnd = finished || (pace && pace.forecastDay) || laterDay(todayDay, r.qaDate);
  const slip = devEnd > r.qaDate ? workDaysBetween(r.qaDate, devEnd) : 0;
  return laterDay(addWorkDays(r.targetDate, slip), todayDay);
}
/** The expected release when it is later than «Release» (a late handover, or «Release» passed while not out), for the drawer and
 *  the strip to say; null without «Klar for QA» (one phase reads as before, D7), once out, or when it is «Release». */
function releaseExpectedLate(plan, r, todayDay) {
  if (!r.qaDate || r.shippedDate) return null;
  const day = releaseExpected(plan, r, todayDay);
  return day !== r.targetDate ? day : null;
}
/** The QA section's sentence: «Klar for QA 20. okt · release 27. okt» · «I QA: 5 av 9 lukket · release 27. okt» · «Sluppet 27. okt · 2 åpne ved release».
 *  Given the plan, it adds the expected release when that is later than «Release» (`releaseExpectedLate`, D6): «… · release 27. okt · forventet release 11. nov». */
function releaseQaText(r, todayDay, plan) {
  const phase = releasePhase(r), items = (r.ado && r.ado.items) || [];
  if (phase === "sluppet") { const n = (r.openAtShip || []).length; return "Sluppet " + dayWords(r.shippedDate) + (n ? " · " + n + (n === 1 ? " åpen" : " åpne") + " ved release" : ""); }
  const late = plan ? releaseExpectedLate(plan, r, todayDay) : null, exp = late ? " · forventet release " + dayWords(late) : "";
  if (phase === "qa") return "I QA: " + items.filter(releaseItemClosed).length + " av " + items.length + " lukket · release " + dayWords(r.targetDate) + exp;
  const s = (r.qaDate ? "Klar for QA " + dayWords(r.qaDate) + " · " : "") + "release " + dayWords(r.targetDate) + exp;
  return s[0].toUpperCase() + s.slice(1);   // «Release 27. okt» without a QA date
}
const STATE_ORDER = ["New", "Active", "Resolved", "Closed"];
const CATEGORY_ORDER = ["Proposed", "InProgress", "Resolved", "Completed"];
/** The items by state in ADO's category order (Ny · Codereview · Develop · QA · Closed); without a category, ADO's old order. A state
 *  name in two categories (a story's «Resolved» is InProgress, a bug's is Resolved) gives one entry per category, with its items' type. */
function releaseStateCounts(r) {
  const items = (r && r.ado && r.ado.items) || [];
  const split = (state) => new Set(items.filter((i) => i.state === state && i.category).map((i) => i.category)).size > 1;
  const counts = new Map();
  items.forEach((i) => {
    const key = i.state + "/" + (i.category || "");   // by state and category
    const c = counts.get(key) || { state: i.state, count: 0, ...(i.category ? { category: i.category } : {}), ...(i.category && split(i.state) ? { type: i.type } : {}) };
    c.count++;
    counts.set(key, c);
  });
  const rank = (s) => { const k = STATE_ORDER.indexOf(s); return k < 0 ? STATE_ORDER.length : k; };
  const cat = (c) => (c.category ? CATEGORY_ORDER.indexOf(c.category) : rank(c.state));   // New ~ Proposed, Active ~ InProgress, …
  const own = (c) => (c.category && rank(c.state) !== cat(c) ? STATE_ORDER.length : rank(c.state));   // ADO's default name leads only its own category: a story's «Resolved» (InProgress) sorts by name
  return [...counts.values()].sort((a, b) => cat(a) - cat(b) || own(a) - own(b) || a.state.localeCompare(b.state));
}
/** «16 items i 2.0.1: 15 i Sprint 71, 1 i Sprint 72 · Sprint 71 har 3 items uten release-label» */
function releaseSprintText(r) {
  const items = (r && r.ado && r.ado.items) || [];
  if (!items.length) return "";
  const by = new Map();
  let none = 0;
  items.forEach((i) => { if (i.iteration) by.set(i.iteration, (by.get(i.iteration) || 0) + 1); else none++; });
  const n = (c, one, many) => c + " " + (c === 1 ? one : many);
  const parts = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], "nb", { numeric: true })).map(([k, c]) => c + " i " + k);   // «Sprint 9» before «Sprint 10»
  if (none) parts.push(none + " uten sprint");
  const extra = (r.ado.sprints || []).filter((s) => s.unlabelled > 0).map((s) => s.name + " har " + n(s.unlabelled, "item", "items") + " uten release-label");
  return n(items.length, "item", "items") + " i " + releaseScope(r) + ": " + parts.join(", ") + (extra.length ? " · " + extra.join(" · ") : "");
}
/** The burndown's numbers: today's scope left on every working day from the axis start to today (or the shipped day), from
 *  each item's delivered day, so a day nobody opened the page leaves no hole; the ideal line's ends, the day the tempo
 *  points at, and the scope the first reading found when it differs from today's. R18: the ideal line ends at development's
 *  target (`targetDay`), «Release» and «Klar for QA» come as `releaseDay` and `qaDay`, and `closedActual` is what is not closed yet. */
function releaseBurndownData(plan, r, todayDay) {
  const a = r && r.ado;
  if (!a || !Array.isArray(a.items) || !a.items.length) return null;
  const pr = releaseProgress(r);
  const usePoints = pr.pointsTotal > 0, unit = usePoints ? "SP" : "items", total = usePoints ? pr.pointsTotal : pr.total;
  const history = a.history || [];
  const pace = releasePace(plan, r, todayDay);
  const startDay = pace ? pace.startDay : releaseStartDay(plan, r);
  const axisStart = history.length && history[0].day < startDay ? history[0].day : startDay;   // readings before the clock's start (items moved to a later sprint) stay on the chart
  const lastDay = r.shippedDate && r.shippedDate < todayDay ? r.shippedDate : todayDay;
  const actual = [], closedActual = [];
  for (const c = dayOf(axisStart); dayKey(c) <= lastDay; c.setDate(c.getDate() + 1)) if (isWorkDay(c)) {
    const day = dayKey(c);
    actual.push({ day, remaining: total - releaseDoneBy(r, day, usePoints) });
    closedActual.push({ day, remaining: total - releaseClosedBy(r, day, usePoints) });   // R18: what is not closed yet
  }
  const endDay = [r.targetDate, r.shippedDate || todayDay, ...history.map((h) => h.day)].sort().pop();
  const first = history.find((h) => h.total > 0), firstTotal = first ? (usePoints ? first.pointsTotal : first.total) : null;
  const chances = history.filter((h) => h.forecast).map((h) => ({ day: h.day, p: h.forecast.p, mean: h.forecast.mean }));   // R12: each reading's chance, next to what happened
  return { startDay, axisStart, targetDay: releaseDevTarget(r), releaseDay: r.targetDate, qaDay: r.qaDate || null, endDay, todayDay, total, unit, actual, closedActual, forecastDay: pace ? pace.forecastDay : null, firstScope: first && firstTotal !== total ? { day: first.day, total: firstTotal } : null, chances };
}
/** The sprint's open bugs and stories that carry no release label at all: what sprint planning still has to stamp. */
function sprintUnlabelledWiql(iterationPath) {
  return "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.IterationPath] = '" + String(iterationPath).replace(/'/g, "''") + "' AND [Custom.Release] = '' AND [System.WorkItemType] IN ('Bug', 'User Story') AND [System.State] NOT IN ('Closed', 'Removed')";
}

/* ---------- sprints: from ADO's iterations, cached in plan.sprints ---------- */
function dayKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
/** The calendar day in Oslo (YYYY-MM-DD): what «today» means for the people using the plan, whatever the server's clock zone. */
function osloDay(d) { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
/** That Oslo day as a local Date at midnight, for the unit and week helpers that read local date parts. */
function osloDate(d) { const q = osloDay(d).split("-").map(Number); return new Date(q[0], q[1] - 1, q[2]); }
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

/* ---------- R14: the shared top bar and the status strip in words ---------- */
const NAV_TABS = [["inntak", "Inntak", "/inntak"], ["timeline", "Tidslinjen", "/timeline"], ["board", "Brettet", "/"], ["kunder", "Kunder", "/kunder"], ["sprint", "Sprint", "/sprint"]];
/** The pages' tabs in the process order (R16 added «Kunder», R19 «Sprint»); opened from a file, only the active one shows (the others would point nowhere). */
function navTabsHtml(active, hosted) {
  return NAV_TABS.map(([key, name, href]) => {
    const on = key === active;
    return '<a class="tab' + (on ? " on" : "") + '" id="tab-' + key + '" data-tab="' + key + '" data-label="' + name + '" href="' + href + '"' + (on ? ' aria-current="page"' : hosted ? "" : " hidden") + ">" + name + "</a>";
  }).join("");
}
/** The status strip's first part: the active epics by colour, in words; zero parts are left out. */
function epicStatusWords(plan) {
  if (!plan.lanes.length) return "Ingen epics ennå";
  const active = plan.lanes.filter((l) => (l.state || "aktiv") === "aktiv");
  const n = { gronn: 0, gul: 0, rod: 0, venter: 0 };
  active.forEach((l) => { const c = epicStatus(plan, l.key).code; if (n[c] !== undefined) n[c]++; });
  const parts = [active.length + (active.length === 1 ? " aktiv epic" : " aktive epics")];
  if (n.gronn) parts.push(n.gronn + (n.gronn === 1 ? " grønn" : " grønne"));
  if (n.gul) parts.push(n.gul + (n.gul === 1 ? " gul" : " gule"));
  if (n.rod) parts.push(n.rod + (n.rod === 1 ? " rød" : " røde"));
  if (n.venter) parts.push(n.venter + " venter på utredning");
  const forslag = plan.lanes.filter((l) => l.state === "forslag").length;
  if (forslag) parts.push(forslag + " forslag");
  return parts.join(" · ");
}

/* R15: the forum view */
function forumBaseline(snapshots) {   // the last product forum: the newest snapshot of kind «baseline»; sprint starts are not forums
  let best = null;
  (snapshots || []).forEach((s) => { if (s && s.kind === "baseline" && (!best || String(s.at) > String(best.at))) best = s; });
  return best;
}
function forumDefault(stored, canWrite) {   // a stored choice wins; without one the forum view is the readers' default
  if (stored === "1") return true;
  if (stored === "0") return false;
  return !canWrite;
}

/* ---------- R16: Leveranser, the COO layer over epics and releases ---------- */
const DELIVERY_OWNER = "COO";
const DELIVERY_LATE_DAYS = 3;   // the release rule: working days after the promise that still count as yellow
const DELIVERY_WORD = { gronn: "grønn", gul: "gul", rod: "rød", ingen: "uten dato" };
function deliveryOwner(d) { return (d && d.owner) || DELIVERY_OWNER; }
/** «alle kunder», the names, or «ingen kunder». */
function deliveryCustomersText(d) { return d.allCustomers ? "alle kunder" : d.customers && d.customers.length ? d.customers.join(", ") : "ingen kunder"; }
/** The epics and releases a delivery hangs on, existing ones only, in the plan's order. */
function deliveryParts(plan, d) {
  const e = new Set(d.epics || []), r = new Set(d.releases || []);
  return { epics: (plan.lanes || []).filter((l) => e.has(l.key)), releases: (plan.releases || []).filter((x) => r.has(x.key)) };
}
const partName = (p) => (p.kind === "epic" ? "«" + p.name + "»" : "release " + p.name);
const laterDay = (a, b) => (a > b ? a : b);
/** The day a part ({ kind, lane } or { kind, release }) is expected to finish, never before today: an epic's open features'
 *  latest end, a release's expected release (`releaseExpected`: R18, a late «Klar for QA» pushes it; without one, the tempo's
 *  forecast, else the target). Null when it no longer pulls: «avsluttet», nothing open, shipped. */
function deliveryPartDay(plan, part, todayDay) {
  if (part.kind === "release") {
    const r = part.release;
    if (r.shippedDate) return null;
    return releaseExpected(plan, r, todayDay);
  }
  if (part.lane.state === "avsluttet") return null;
  const tasks = plan.tasks.filter((t) => t.lane === part.lane.key && t.state !== "levert");
  return tasks.length ? laterDay(dayKey(unitToDate(Math.max(...tasks.map((t) => t.end)))), todayDay) : null;
}
/** The computed date: the latest of the open epics' late ends and the open releases' expected release, never before today;
 *  who gives it; whether a discovery still runs. */
function deliveryComputed(plan, d, todayDay) {
  const parts = deliveryParts(plan, d);
  let day = null, by = null, pending = false, open = 0;
  const take = (cand, who) => { if (cand && (day === null || cand > day)) { day = cand; by = who; } };
  parts.epics.forEach((l) => {
    const cand = deliveryPartDay(plan, { kind: "epic", lane: l }, todayDay);
    if (cand === null) return;
    open++;
    if (plan.tasks.some((t) => t.lane === l.key && t.state !== "levert" && t.kind === "discovery")) pending = true;
    take(cand, { kind: "epic", key: l.key, name: l.name });
  });
  parts.releases.forEach((r) => {
    const cand = deliveryPartDay(plan, { kind: "release", release: r }, todayDay);
    if (cand === null) return;
    open++;
    take(cand, { kind: "release", key: r.key, name: r.version });
  });
  return { day, by, pending, open, parts: parts.epics.length + parts.releases.length };
}
const dec = (n) => String(n).replace(".", ",");
const weeksWords = (w) => (w === 1 ? "1 uke" : dec(w) + " uker");
/** The status against the promise: the colour, the working days and weeks after (+) or before (−) it, the sentence that says what pulls the date. */
function deliveryStatus(plan, d, todayDay) {
  const c = deliveryComputed(plan, d, todayDay);
  if (!c.parts) return { code: "ingen", computed: null, by: null, pending: false, deltaDays: null, weeks: null, deviation: "", text: "henger ikke på noe ennå" };
  if (!c.open) return { code: "gronn", computed: null, by: null, pending: false, deltaDays: 0, weeks: 0, deviation: "", text: "alt levert" };
  const deltaDays = c.day > d.promisedDate ? workDaysBetween(d.promisedDate, c.day) : c.day < d.promisedDate ? -workDaysBetween(c.day, d.promisedDate) : 0;
  const weeks = Math.round((calendarDays(d.promisedDate, c.day) / 7) * 10) / 10;
  const code = deltaDays <= 0 ? "gronn" : deltaDays <= DELIVERY_LATE_DAYS ? "gul" : "rod";
  const side = deltaDays > 0 ? " etter lovet" : " før lovet";
  const deviation = deltaDays === 0 ? "på lovet dato" : (Math.abs(weeks) < 1 ? daysWords(Math.abs(deltaDays)) : weeksWords(Math.abs(weeks))) + side;
  const text = (c.pending ? "minst " : "utregnet ") + dayWords(c.day) + " · " + deviation + (c.pending ? " · venter på utredning" : "") + " · dratt av " + partName(c.by);
  return { code, computed: c.day, by: c.by, pending: c.pending, deltaDays, weeks, deviation, text };
}
/** The open bugs and stories without a release label in the sprints of the delivery's releases (the highest count any release reports per sprint). */
function deliveryUnlabelled(plan, d) {
  const per = new Map();
  deliveryParts(plan, d).releases.forEach((r) => ((r.ado && r.ado.sprints) || []).forEach((s) => per.set(s.name, Math.max(per.get(s.name) || 0, s.unlabelled || 0))));
  let n = 0; per.forEach((v) => { n += v; }); return n;
}
/** Distinct open bugs across the delivery's releases (R18: open = not closed; a developed bug still waits for QA). */
function deliveryBugsLeft(plan, d) {
  const ids = new Set();
  deliveryParts(plan, d).releases.forEach((r) => ((r.ado && r.ado.items) || []).forEach((i) => { if (i.type === "Bug" && !releaseItemClosed(i)) ids.add(i.id); }));
  return ids.size;
}
/** «Release 2.0.1 · release 2.0.2 · FileVault · 3 uten release-label», or «ingenting ennå». */
function deliveryPartsText(plan, d) {
  const parts = deliveryParts(plan, d);
  const list = parts.releases.map((r, i) => (i ? "release " : "Release ") + r.version).concat(parts.epics.map((l) => l.name));
  if (!list.length) return "ingenting ennå";
  const u = deliveryUnlabelled(plan, d);
  if (u) list.push(u + " uten release-label");
  return list.join(" · ");
}
/** One row per customer of each delivery («Alle kunder» as one row, «Ingen kunder» when none). */
function deliveryLines(plan, todayDay) {
  const rows = [];
  (plan.deliveries || []).forEach((d) => {
    const status = deliveryStatus(plan, d, todayDay), hangsOn = deliveryPartsText(plan, d);
    const customers = d.allCustomers ? ["Alle kunder"] : d.customers.length ? d.customers : ["Ingen kunder"];
    customers.forEach((customer) => rows.push({ key: d.key, customer, all: !!d.allCustomers, none: !d.allCustomers && !d.customers.length, delivery: d, hangsOn, promisedDate: d.promisedDate, status }));
  });
  return rows;
}
/** The customers waiting on an epic through any delivery; `all` when one of them is for all customers. */
function epicCustomers(plan, laneKey) {
  const deliveries = (plan.deliveries || []).filter((d) => (d.epics || []).includes(laneKey));
  const all = deliveries.some((d) => d.allCustomers);
  const names = [];
  deliveries.forEach((d) => (d.customers || []).forEach((c) => { if (!names.includes(c)) names.push(c); }));
  return { all, names, count: names.length, deliveries };
}
function epicCustomersText(c) { return c.all ? "alle kunder" : c.count === 1 ? "1 kunde" : c.count > 1 ? c.count + " kunder" : ""; }
/** The priority signal: one line is light, several are many stakeholders, all customers is the heaviest. */
function epicWeight(c) {
  if (c.all) return { code: "tyngst", label: "Tyngst" };
  if (c.count >= 2) return { code: "flere", label: "Flere interessenter" };
  if (c.count === 1) return { code: "lett", label: "Lett å prioritere" };
  return { code: "ingen", label: "Ingen kunder venter" };
}
/** One segment per delivery for the band: from the earliest feature start (else the release's segment, else today) to the computed day (else the promise). */
function deliverySegments(plan, todayDay) {
  const today = dayToUnit(todayDay);
  return (plan.deliveries || []).map((d) => {
    const parts = deliveryParts(plan, d), status = deliveryStatus(plan, d, todayDay);
    const epicKeys = new Set(parts.epics.map((l) => l.key));
    const starts = plan.tasks.filter((t) => epicKeys.has(t.lane)).map((t) => t.start);
    if (!starts.length && parts.releases.length) {
      const segs = releaseSegments(plan, today);
      parts.releases.forEach((r) => { const s = segs.find((x) => x.release.key === r.key); if (s) starts.push(s.start); });
    }
    const start = starts.length ? Math.min(...starts) : today;
    const promised = dayToUnit(d.promisedDate);
    const end = Math.max(start + WEEK / 2, status.computed ? dayToUnit(status.computed) : promised);
    return { delivery: d, start, end, promised, status };
  });
}
/** The five numbers for the investor page, with the colour and what pulls the date. */
function deliveryInvestor(plan, d, todayDay) {
  const parts = deliveryParts(plan, d), s = deliveryStatus(plan, d, todayDay);
  return { key: d.key, name: d.name, customers: deliveryCustomersText(d), owner: deliveryOwner(d), promised: d.promisedDate, computed: s.computed, weeks: s.weeks, colour: DELIVERY_WORD[s.code], code: s.code,
    by: s.by ? partName(s.by) : null, pending: s.pending, epicsDone: parts.epics.filter((l) => l.state === "avsluttet").length, epicsTotal: parts.epics.length, bugsLeft: deliveryBugsLeft(plan, d), text: s.text };
}

/* ---------- R17: «Per leveranse»: COO's business cases with what they hang on ---------- */
/** One epic as a part: the span of its open features (all of them when none is open), darker to the latest likely end. */
function deliveryEpicPart(plan, lane, deliveryKey) {
  const all = plan.tasks.filter((t) => t.lane === lane.key), open = all.filter((t) => t.state !== "levert"), use = open.length ? open : all;
  const shared = (plan.deliveries || []).filter((d) => d.key !== deliveryKey && (d.epics || []).includes(lane.key)).map((d) => d.name);
  const part = { kind: "epic", key: lane.key, lane, code: epicStatus(plan, lane.key).code, window: epicWindowText(plan, lane.key), shared };
  if (!use.length) return Object.assign(part, { start: null, likelyEnd: null, end: null, pending: false });
  return Object.assign(part, {
    start: Math.min(...use.map((t) => t.start)),
    likelyEnd: Math.max(...use.map((t) => (t.kind === "estimate" ? t.endLikely : t.end))),
    end: Math.max(...use.map((t) => t.end)),
    pending: open.some((t) => t.kind === "discovery"),
  });
}
/** Each delivery (the plan's order) with its parts ordered by the day each is expected to finish (`deliveryPartDay`; the
 *  ones that no longer pull first, then by name), so the last row is the one that pulls the date as «dratt av» names it;
 *  and the open epics no delivery hangs on («Ingen leveranse»). Keys of since-deleted epics or releases are ignored. Units
 *  are the time unit. */
function deliveryRows(plan, todayDay) {
  const segs = releaseSegments(plan, dayToUnit(todayDay));
  const nameOf = (p) => (p.kind === "epic" ? p.lane.name : p.release.version);
  const byDay = (a, b) => (a.day === null ? 0 : 1) - (b.day === null ? 0 : 1) || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  const groups = deliverySegments(plan, todayDay).map((sg) => {
    const d = sg.delivery, parts = deliveryParts(plan, d);
    const list = parts.epics.map((l) => deliveryEpicPart(plan, l, d.key)).concat(parts.releases.map((r) => {
      const s = segs.find((x) => x.release.key === r.key);
      return { kind: "release", key: r.key, release: r, start: s ? s.start : null, end: s ? s.end : null, shipped: !!r.shippedDate };
    }));
    const by = sg.status.by, pulls = (x) => (by && x.p.kind === by.kind && x.p.key === by.key ? 1 : 0);   // on equal days the part «dratt av» names comes last
    const ordered = list.map((p) => ({ p, day: deliveryPartDay(plan, p, todayDay) })).sort((a, b) => byDay(a, b) || pulls(a) - pulls(b) || nameOf(a.p).localeCompare(nameOf(b.p), "nb")).map((x) => x.p);
    return { delivery: d, status: sg.status, segment: { start: sg.start, end: sg.end, promised: sg.promised }, parts: ordered };
  });
  const used = new Set();
  (plan.deliveries || []).forEach((d) => (d.epics || []).forEach((k) => used.add(k)));
  const loose = (plan.lanes || []).filter((l) => !used.has(l.key) && l.state !== "avsluttet").map((l) => deliveryEpicPart(plan, l, null));
  return { groups, loose };
}

/* ---------- R19: the Sprint tab ---------- */
/** The sprint after the one `date` falls in, or the first that starts after `date` (between sprints); null when there is none. */
function nextSprint(sprints, date) {
  const list = (Array.isArray(sprints) ? sprints : []).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const cur = currentSprint(list, date);
  const after = cur ? cur.finish : dayKey(date);
  return list.find((s) => s.start > after) || null;
}
/** The part of a sprint for bugs and issues: 1 − the mix's feature share (transition 0.45, normal 0.4), to the hundredth. */
function budgetShare(plan) {
  const mode = plan && plan.capacity && MIX[plan.capacity.mode] ? plan.capacity.mode : "transition";
  return Math.round((1 - MIX[mode]) * 100) / 100;
}
/** «26. okt – 6. nov» */
function sprintRangeText(s) { return fmtDate(dayOf(s.start)) + " – " + fmtDate(dayOf(s.finish)); }
const sprintsOfPlan = (plan) => (plan && plan.sprints && plan.sprints.items) || [];
const epicFeature = (plan, t) => t.kind === "estimate" && t.state === "aktiv" && t.lane !== BACKLOG && plan.lanes.some((l) => l.key === t.lane);   // a feature of an epic, in development
const laneRank = (plan) => { const idx = new Map(plan.lanes.map((l, i) => [l.key, i])); return (t) => (idx.has(t.lane) ? idx.get(t.lane) : plan.lanes.length); };   // the epics' order, the shelf last
/** The features the read asks ADO about: in an epic, aktiv, with an ADO id, the bar starting on or before the next sprint's last day. */
function dueFeatureIds(plan, todayDay) {
  const next = nextSprint(sprintsOfPlan(plan), dayOf(todayDay));
  if (!next) return [];
  const last = dayToUnit(next.finish);
  return plan.tasks.filter((t) => epicFeature(plan, t) && typeof t.adoId === "number" && t.start <= last + 1e-9).map((t) => t.id);
}
/** D6: what the timeline expects of the next sprint: every task not delivered whose bar starts on or before its last day.
 *  Discoveries («utredes» or «ny», shelf or epic) must be under way; features (estimates in an epic, aktiv) must have stories
 *  in the next sprint, or in the current one once the bar has started. «sent»: it should have started before the next sprint.
 *  The counts come from the check (0 without an entry; entries for tasks no longer due are ignored). By start, epic, label. */
function sprintDue(plan, check, todayDay) {
  const sprint = nextSprint(sprintsOfPlan(plan), dayOf(todayDay));
  if (!sprint) return { sprint: null, discoveries: [], features: [] };
  const first = dayToUnit(sprint.start), last = dayToUnit(sprint.finish), today = dayToUnit(todayDay), rank = laneRank(plan);
  const due = (t) => t.state !== "levert" && t.start <= last + 1e-9;
  const late = (t) => t.start < first - 1e-9;
  const row = (t, status) => ({ task: t, epic: t.lane === BACKLOG ? null : plan.lanes.find((l) => l.key === t.lane) || null, start: dayKey(unitToDate(t.start)), status });
  const order = (a, b) => (Math.abs(a.task.start - b.task.start) > 1e-9 ? a.task.start - b.task.start : 0) || rank(a.task) - rank(b.task) || String(a.task.label || "").localeCompare(String(b.task.label || ""), "nb");
  const discoveries = plan.tasks.filter((t) => (t.state === "utredes" || t.state === "ny") && due(t))
    .map((t) => row(t, t.state === "utredes" ? "i gang" : late(t) ? "sent" : "ikke startet")).sort(order);
  const counts = (check && check.features) || {};
  const features = plan.tasks.filter((t) => epicFeature(plan, t) && due(t)).map((t) => {
    const c = Object.prototype.hasOwnProperty.call(counts, t.id) ? counts[t.id] : { open: 0, inNext: 0, inNextPoints: 0, inCurrent: 0 };
    const status = c.inNext > 0 || (c.inCurrent > 0 && t.start <= today + 1e-9) ? "planlagt" : late(t) ? "sent" : typeof t.adoId !== "number" ? "ikke i ADO" : "uten stories";
    return { ...row(t, status), inNext: c.inNext, open: c.open, inNextPoints: c.inNextPoints, inCurrent: c.inCurrent };
  }).sort(order);
  return { sprint, discoveries, features };
}
/** The features in work today: in an epic, aktiv, today inside the bar; by epic, then start. */
function sprintInWork(plan, todayDay) {
  const today = dayToUnit(todayDay), rank = laneRank(plan);
  return plan.tasks.filter((t) => epicFeature(plan, t) && t.start <= today + 1e-9 && today <= t.end + 1e-9).sort((a, b) => rank(a) - rank(b) || a.start - b.start);
}
/** D7: what it costs when the task starts no earlier than the sprint after next: on clones of the plan run through the queue,
 *  the end's shift in whole weeks and its epic's status before and after (null on the shelf). Nothing in `plan` moves.
 *  Null without a sprint after next or without the task. */
function slipCost(plan, taskId, todayDay) {
  const items = sprintsOfPlan(plan), next = nextSprint(items, dayOf(todayDay)), after = next && nextSprint(items, dayOf(next.start));
  if (!after) return null;
  const before = normalizePlan(JSON.parse(JSON.stringify(plan)));
  resolveQueue(before);
  const was = before.tasks.find((t) => t.id === taskId);
  if (!was) return null;
  const moved = JSON.parse(JSON.stringify(before)), t = moved.tasks.find((v) => v.id === taskId), at = dayToUnit(after.start);
  if (t.start < at - 1e-9) shiftTask(t, at - t.start);   // by hand, a pinned one or a fixed end too: the question is what a later start costs
  resolveQueue(moved);
  const lane = was.lane === BACKLOG ? null : before.lanes.find((l) => l.key === was.lane) || null;
  return {
    weeks: Math.round((t.end - was.end) / WEEK), sprint: after.name,
    epic: lane ? { key: lane.key, name: lane.name, before: epicStatus(before, lane.key).code, after: epicStatus(moved, lane.key).code, goalDate: typeof lane.goalDate === "number" ? lane.goalDate : null } : null,
  };
}
const SLIP_WORD = { gronn: "grønn", gul: "gul", rod: "rød", venter: "venter på utredning", "ingen-mal": "uten måldato", tom: "tom" };
/** «starter tidligst Sprint 73 → slutt +2 uker → «Epic» blir gul (mål 15. des)», or «· «Epic» er fortsatt …» when the colour stays. */
function slipCostText(c) {
  const head = "starter tidligst " + c.sprint + " → ";
  if (c.weeks === 0) return head + "slutten flytter seg ikke";
  const shift = head + "slutt +" + weeksWords(c.weeks);
  const e = c.epic;
  if (!e) return shift;
  const goal = typeof e.goalDate === "number" ? " (mål " + fmtDate(unitToDate(e.goalDate)) + ")" : "";
  return shift + (e.before !== e.after ? " → «" + e.name + "» blir " : " · «" + e.name + "» er fortsatt ") + SLIP_WORD[e.after] + goal;
}
/** D4: the open bugs now (the next release's already left out, D2) and at the end of the next sprint (open − the budget's
 *  points at the closed bugs' average points + the average created, over the last two finished sprints; by count when
 *  those bugs had no points). `endOfNext` is null without a budget or without history. */
function healthForecast(check) {
  const open = check.bugs.open;
  let endOfNext = null;
  const last = check.sprints.slice(-2), n = last.length;
  if (check.budget.points !== null && n) {
    const sum = (k) => last.reduce((s, x) => s + x[k], 0);
    const closedPoints = sum("closedPoints"), avg = closedPoints / sum("closed");
    const closed = closedPoints > 0 ? Math.round((check.budget.points * check.budget.share) / avg) : Math.round(sum("closed") / n);
    const created = Math.round(sum("created") / n);
    endOfNext = { value: Math.max(0, open - closed + created), closed, created };
  }
  return { now: open, endOfNext };
}
/** «45 % ≈ 24 SP av ~53 · 18 SP planlagt på bugs», or why there is no budget. */
function budgetText(check) {
  const b = check.budget;
  if (b.points === null) {
    if (b.missing === "capacity") return "Ingen budsjett: fyll inn Capacity i ADO for " + (check.next || "neste sprint") + " (Development-timer per dag og fridager)";
    if (b.missing === "history") return "Ingen budsjett: ingen utviklede poeng i de to siste sprintene å regne tempo fra";
    return "Ingen budsjett: ingen neste sprint i ADO";
  }
  const planned = check.bugs.inNextPoints;
  return Math.round(b.share * 100) + " % ≈ " + Math.round(b.points * b.share) + " SP av ~" + Math.round(b.points) + " · " +
    (planned > 0 ? dec(Math.round(planned * 10) / 10) + " SP planlagt på bugs" : "ingen SP planlagt på bugs ennå");
}
const openBugsWords = (n) => n + (n === 1 ? " åpen bug" : " åpne bugs");
const issuesWords = (n) => n + (n === 1 ? " issue" : " issues");
/** «43 åpne bugs · 17 issues»; "" without a check. */
function healthStripText(check) { return check ? openBugsWords(check.bugs.open) + " · " + issuesWords(check.issues.open) : ""; }
/** D2: «Ikke telt: 9 bugs merket 2.0.1, på vei ut med releasen»; "" without a check, a release or anything left out. */
function releaseLeftOutText(check) {
  const r = check && check.release;
  if (!r || !(r.bugs + r.issues)) return "";
  const what = [r.bugs ? r.bugs + (r.bugs === 1 ? " bug" : " bugs") : "", r.issues ? issuesWords(r.issues) : ""].filter(Boolean).join(" og ");
  return "Ikke telt: " + what + " merket " + r.label + ", på vei ut med releasen";
}
/** HH:MM in Oslo, built from the parts so the locale's separator does not matter. */
function osloTime(d) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const part = (type) => String((parts.find((p) => p.type === type) || { value: "0" }).value).padStart(2, "0");
  return part("hour") + ":" + part("minute");
}
/** D9: «Kopier som tekst», the Markdown for produktforum: the health with its forecasts, the budget, the due lists with the
 *  cost of every «sent» row, and when ADO was read. */
function sprintCheckMarkdown(plan, check, todayDay) {
  const due = sprintDue(plan, check, todayDay), s = due.sprint, next = s ? s.name : check.next || "neste sprint";
  const fc = healthForecast(check), left = releaseLeftOutText(check), b = check.bugs;
  const grades = "A " + b.A + " · B " + b.B + " · C " + b.C + " · D " + b.D + (b.none > 0 ? " · uten grad " + b.none : "");
  const lines = ["## " + (s ? s.name + " · " + sprintRangeText(s) : next.charAt(0).toUpperCase() + next.slice(1)), "",
    "**App-helse:** " + openBugsWords(b.open) + " (" + grades + ") · " + issuesWords(check.issues.open)];
  if (left) lines.push("- " + left);
  if (fc.endOfNext) lines.push("- Ved slutten av " + next + ": ≈ " + fc.endOfNext.value + " (lukker ~" + fc.endOfNext.closed + ", ~" + fc.endOfNext.created + " nye)");
  lines.push("", "**Budsjett for bugs og issues:** " + budgetText(check), "");
  const row = (d) => {
    const t = d.task, cost = d.status === "sent" ? slipCost(plan, t.id, todayDay) : null;
    return "- " + (d.epic ? d.epic.name : "Hylla") + " › " + t.label + " · " + (t.assignee || "uten eier") + " · " + fmtDate(unitToDate(t.start)) + " – " + fmtDate(unitToDate(t.end)) + " · " + d.status + (cost ? " · " + slipCostText(cost) : "");
  };
  const list = (rows) => (rows.length ? rows.map(row) : ["- Ingen"]);
  lines.push("### Utredninger som skal i gang", ...list(due.discoveries), "", "### Features som skal ha stories i " + next, ...list(due.features), "");
  const at = new Date(check.at);
  lines.push("_Lest fra ADO " + (isNaN(at.getTime()) ? check.at : fmtDate(dayOf(osloDay(at))) + " " + osloTime(at)) + "_");
  if (check.statesMissing) lines.push("", "_ADOs tilstander ble ikke funnet: alt unntatt Closed og Removed er telt som åpent._");
  return lines.join("\n") + "\n";
}

/* ---------- R17: the focus across a re-render (browser only) ---------- */
/** A selector that finds `el` again after a re-render: `#id`; else its row (the closest [data-id] or [data-key], never a
 *  ghost; the n-th of them when rows share the key, as Kunder's one per customer) and the control in it. */
function focusSelector(el) {
  if (!el || !el.closest) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  const row = el.closest("[data-id], [data-key]");
  if (!row) return null;
  const tag = (e) => e.tagName.toLowerCase() + (e.classList[0] ? "." + CSS.escape(e.classList[0]) : "");
  const attr = row.hasAttribute("data-id") ? "data-id" : "data-key";
  let sel = tag(row) + ":not(.ghost)[" + attr + '="' + CSS.escape(row.getAttribute(attr)) + '"]';
  const same = row.parentElement ? [...row.parentElement.children].filter((r) => r.matches(sel)) : [];
  if (same.length > 1) sel = ":nth-child(" + (same.indexOf(row) + 1) + " of " + sel + ")";
  if (el === row) return sel;
  const act = ["data-act", "data-edit", "data-hist"].find((k) => el.hasAttribute(k));
  return sel + " " + (act ? "[" + act + '="' + CSS.escape(el.getAttribute(act)) + '"]' : tag(el));
}
/** The key of the control that has the focus, taken before a render replaces it; null when nothing has it. */
function focusKey(doc) { try { return focusSelector(doc.activeElement); } catch { return null; } }
/** The focus back on the control the key names, without scrolling, when it exists. Never throws: a render that called it
 *  (inside applyRemote) must finish, or the saves that wait for it stop. */
function restoreFocus(doc, key) { try { const c = key && doc.querySelector(key); if (c) c.focus({ preventScroll: true }); } catch { /* a selector this browser can't parse: the focus stays where the render left it */ } }

/* ---------- R17: modals and drawers as dialogs (browser only; every page calls it once at boot) ---------- */
/** Role, aria-modal and a label on every `.modal-back .modal` and `aside.drawer`; focus moves in when one opens, Tab stays
 *  inside a modal, focus returns to what opened it when it closes. A modal opens with the class «open», a drawer by losing «hidden». */
function wireDialogs(doc) {
  const SEL = ".modal-back, aside.drawer";
  const isModal = (b) => b.classList.contains("modal-back");
  const isOpen = (b) => (isModal(b) ? b.classList.contains("open") : !b.hidden);
  const box = (b) => (isModal(b) ? b.querySelector(".modal") || b : b);
  const focusables = (b) => [...box(b).querySelectorAll("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
  const z = (b) => parseInt(getComputedStyle(b).zIndex, 10) || 0;
  const topModal = () => [...doc.querySelectorAll(".modal-back.open")].sort((a, b) => z(b) - z(a))[0] || null;
  doc.querySelectorAll(SEL).forEach((b, i) => {
    const d = box(b), h = d.querySelector("h2");
    d.setAttribute("role", "dialog");
    if (isModal(b)) d.setAttribute("aria-modal", "true");
    if (h) { if (!h.id) h.id = (b.id || "dialog" + i) + "Title"; d.setAttribute("aria-labelledby", h.id); }
  });
  const openers = new Map();   // the opener and its focus key, taken while it is still in the page
  new MutationObserver((list) => list.forEach((m) => {
    const b = m.target;
    if (!b.matches || !b.matches(SEL)) return;
    if (isOpen(b) && !openers.has(b)) {
      openers.set(b, { el: doc.activeElement, key: focusKey(doc) });
      setTimeout(() => { if (isOpen(b) && !box(b).contains(doc.activeElement)) { const f = focusables(b)[0]; if (f) f.focus(); } }, 30);
    } else if (!isOpen(b) && openers.has(b)) {
      const rec = openers.get(b); openers.delete(b);
      const o = rec.el && rec.el.isConnected ? rec.el : rec.key && doc.querySelector(rec.key);   // a re-render replaced it: the same control in its row, never a ghost
      const top = topModal(), above = top && openers.get(top);
      if (above && above.el && b.contains(above.el)) openers.set(top, rec);   // the modal on top was opened from inside this one (the reason over the editor's Lagre): it gives the focus back here when it closes
      else if (o && typeof o.focus === "function" && (!top || top.contains(o))) o.focus();   // a modal still open (Avbryt on «Slett feature …» over the editor) takes it back only when the opener is inside it
    }
  })).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const b = topModal();
    if (!b) return;
    const f = focusables(b);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = doc.activeElement;
    if (!box(b).contains(at)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    BASE_Y, BASE_M, N_MONTHS, WEEK, SCHEMA, OWNER_DEFAULT, STATUS_LABEL,
    BACKLOG, FEATURE_STATES, EPIC_STATES, STATE_LABEL, EPIC_STATE_LABEL, OUTCOMES,
    WISH_SOURCES, WISH_SOURCE_LABEL, WISH_STATUSES, WISH_STATUS_LABEL, SIZE_CLASSES, wishesByStatus,
    FEATURE_TYPES, FEATURE_TYPE_LABEL, AREAS, normalizeAreas,
    dateToUnit, unitToDate, fmtDate, normalizePlan, epicStatus, shiftTask, resolveDeps,
    rangeWeeks, rangeLabel, goalText, exampleSeed,
    isoWeek, weekSpan, windowLabel, epicWindowText, discoveryOverdue,
    shelfTasks, epicCounts, sizeClass, sizeClassDerived, sizeClassText, bufferLabel, rawLabel, previewPlacement,
    canMarkDelivered, markDelivered, canRestartDiscovery, applyLaneChange, boardColumn, featureTransition,
    dayKey, osloDay, osloDate, currentSprint, sprintDay, sprintLabel, navTabsHtml, epicStatusWords, forumBaseline, forumDefault,
    DELIVERY_OWNER, DELIVERY_WORD, deliveryOwner, deliveryCustomersText, deliveryParts, deliveryComputed, deliveryStatus, deliveryUnlabelled, deliveryBugsLeft, deliveryPartsText, deliveryLines, epicCustomers, epicCustomersText, epicWeight, deliverySegments, deliveryInvestor, deliveryRows, wireDialogs,
    dayToUnit, releaseScope, releaseSegments, releaseProgress, releaseItemDone, releaseItemClosed, RELEASE_DONE_STATES, releaseWiql, releaseQueryUrl,
    workDays, workDaysBetween, addWorkDays, calendarDays, releaseStartDay, releasePace, nextRelease, nextReleaseText, releaseStateCounts, releaseSprintText, releaseBurndownData, releaseForecastText, sprintUnlabelledWiql, PACE_WORD, RELEASE_HISTORY_MAX, RELEASE_MAX_AGE_MS,
    releaseDevTarget, releasePhase, releaseExpected, releaseExpectedLate, releaseQaText,
    progressFraction, progressSignal, epicProgressSignal, progressText,
    MIX, MIX_LABEL, capacityFactor, elapsedWeeks, queueFloor, resolveQueue,
    focusKey, restoreFocus,
    nextSprint, budgetShare, sprintRangeText, dueFeatureIds, sprintDue, sprintInWork, slipCost, slipCostText, healthForecast, budgetText, healthStripText, releaseLeftOutText, sprintCheckMarkdown,
  };
}
