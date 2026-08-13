// Smart import for tidslinjeplanen: diff en importert JSON mot gjeldende plan
// og bump feltversjoner (fv) automatisk per endret feltgruppe — slik at den som
// redigerer JSON-en (menneske eller Claude-økt) aldri trenger å kjenne fv-regimet.
//
// Filen er delt kode: kjøres i nettleseren (lastes som vanlig <script> av
// tidslinjeverktøyet, også fra file://) OG importeres av vitest. Derfor vanlig
// JS uten import/export — kun en CommonJS-hale for testene. Feltgruppene må
// være identiske med merge.ts (håndheves av en test).

const IMPORT_GROUP_PROPS = {
  tid: ["start", "end"],
  label: ["label"],
  status: ["status", "statusCause", "statusAt"],
  deps: ["deps"],
  subtasks: ["subtasks"],
  meta: ["lane", "t2", "milestone", "source", "ext", "dod", "links"],
  buffer: ["buffer"],
  okonomi: ["cost", "revenue"],
};
const IMPORT_FIELD_GROUPS = Object.keys(IMPORT_GROUP_PROPS);

function importNormTask(t) {
  const n = Object.assign({}, t);
  n.deps = Array.isArray(n.deps) ? n.deps.slice() : [];
  n.subtasks = Array.isArray(n.subtasks) ? n.subtasks.map((s) => Object.assign({}, s)) : [];
  return n;
}

function importPropEq(group, a, b) {
  if (group === "deps") {
    a = (a || []).slice().sort();
    b = (b || []).slice().sort();
  }
  const norm = (v) => (v === undefined ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function importMaxFv(t) {
  const fv = t.fv || {};
  return Math.max(0, ...IMPORT_FIELD_GROUPS.map((g) => fv[g] || 0));
}

function importDeriveBounds(t) {
  if (Array.isArray(t.subtasks) && t.subtasks.length) {
    t.start = Math.min(...t.subtasks.map((s) => s.start));
    t.end = Math.max(...t.subtasks.map((s) => s.end));
  }
}

function importStamp(t, opts) {
  if (opts && opts.editor) {
    t.editedBy = opts.editor;
    if (opts.now) t.editedAt = opts.now;
  }
}

const importSnapshot = (t) => JSON.parse(JSON.stringify(t));

/**
 * Diff `incoming` (importert JSON) mot `current` (planen i verktøyet nå).
 * Returnerer { plan, changes }:
 *  - plan: incoming sitt innhold, men med fv bygget fra current + bump per
 *    faktisk endret feltgruppe, tombstones for fjernede rader, og bevarte
 *    SkyTracker-speilrader. Filens egne fv-verdier ignoreres.
 *  - changes: [{kind: "ny"|"endret"|"slettet"|"bevart", id, label, groups?, before?, after?}]
 * opts: { editor?: string, now?: ISO-string } — stemples kun på nye/endrede rader.
 */
function computeImportDiff(current, incoming, opts) {
  const currentByld = new Map((current.tasks || []).map((t) => [t.id, t]));
  const incomingIds = new Set((incoming.tasks || []).map((t) => t.id));

  // tombstones: union, høyeste versjon vinner
  const deleted = {};
  [current.deleted, incoming.deleted].forEach((d) => {
    Object.entries(d || {}).forEach(([id, v]) => {
      deleted[id] = Math.max(deleted[id] || 0, v || 0);
    });
  });

  const changes = [];
  const tasks = [];

  (incoming.tasks || []).forEach((raw) => {
    const inc = importNormTask(raw);
    const cur = currentByld.get(inc.id);

    if (!cur) {
      // ny rad — evt. gjeninnført: bump forbi tombstonen så den overlever fletting
      const base = Math.max(1, (deleted[inc.id] || 0) + 1);
      inc.fv = {};
      IMPORT_FIELD_GROUPS.forEach((g) => { inc.fv[g] = base; });
      importDeriveBounds(inc);
      importStamp(inc, opts);
      tasks.push(inc);
      changes.push({ kind: "ny", id: inc.id, label: inc.label });
      return;
    }

    const curN = importNormTask(cur);
    const out = importNormTask(cur);
    out.fv = Object.assign({}, cur.fv || {});
    const groups = [];
    IMPORT_FIELD_GROUPS.forEach((g) => {
      const changed = IMPORT_GROUP_PROPS[g].some((p) => !importPropEq(g, curN[p], inc[p]));
      if (!changed) return;
      IMPORT_GROUP_PROPS[g].forEach((p) => {
        if (inc[p] === undefined) delete out[p];
        else out[p] = inc[p];
      });
      out.fv[g] = (out.fv[g] || 0) + 1;
      groups.push(g);
    });

    if (groups.length) {
      importDeriveBounds(out);
      importStamp(out, opts);
      changes.push({
        kind: "endret",
        id: out.id,
        label: out.label,
        groups,
        before: importSnapshot(curN),
        after: importSnapshot(out),
      });
    }
    tasks.push(out);
  });

  // rader som finnes nå, men mangler i importen
  (current.tasks || []).forEach((cur) => {
    if (incomingIds.has(cur.id)) return;
    if (cur.source === "skytracker") {
      // speilrader eies av SkyTracker-synken — en Claude-økt som utelot dem
      // skal ikke kunne slette dem ved et uhell
      tasks.push(importSnapshot(cur));
      changes.push({ kind: "bevart", id: cur.id, label: cur.label });
    } else {
      deleted[cur.id] = importMaxFv(cur) + 1;
      changes.push({ kind: "slettet", id: cur.id, label: cur.label });
    }
  });

  // lanes: behold gjeldende (omdøpt = versjonsbump), nye legges til, ingen slettes
  const lanes = [];
  const incLanes = new Map((incoming.lanes || []).map((l) => [l.key, l]));
  (current.lanes || []).forEach((cl) => {
    const il = incLanes.get(cl.key);
    if (il && il.name !== cl.name) lanes.push({ key: cl.key, name: il.name, v: (cl.v || 0) + 1 });
    else lanes.push(Object.assign({}, cl));
    incLanes.delete(cl.key);
  });
  incLanes.forEach((il) => lanes.push(Object.assign({}, il)));

  const plan = Object.assign({}, current, incoming, { lanes, tasks, deleted });
  return { plan, changes };
}

/**
 * Transitiv avhengighets-closure for en oppgave: alle oppgaver som (direkte
 * eller indirekte) må bli ferdige før `id`. Brukes av «Hva nå», buffer- og
 * kostnadsberegningene — samme kode i nettleser, server og tester.
 */
function depClosure(plan, id) {
  const byId = new Map((plan.tasks || []).map((t) => [t.id, t]));
  const seen = new Set();
  const out = [];
  const walk = (tid) => {
    const t = byId.get(tid);
    if (!t) return;
    (t.deps || []).forEach((d) => {
      if (seen.has(d)) return;
      seen.add(d);
      const p = byId.get(d);
      if (p) { out.push(p); walk(d); }
    });
  };
  walk(id);
  return out;
}

/**
 * Bufferstatus per milepæl (føring 1.5). Enheter: tid er måneder,
 * 1 uke = 0.25 enheter (verktøyets snappe-konvensjon). `buffer` på en
 * milepæl er antall UKER reservert før måldatoen (= milepælens start).
 * Forbruk = hvor langt avhengighetskjedens slutt har spist inn i reserven.
 */
const WEEK_UNITS = 0.25;
function bufferStatuses(plan) {
  return (plan.tasks || [])
    .filter((t) => t.milestone && typeof t.buffer === "number" && t.buffer > 0)
    .map((m) => {
      const chain = depClosure(plan, m.id).filter((t) => !t.milestone);
      const chainEnd = chain.length ? Math.max(...chain.map((t) => t.end)) : -Infinity;
      const target = m.start;
      const safeEnd = target - m.buffer * WEEK_UNITS;
      const usedWeeks = Math.min(m.buffer, Math.max(0, (chainEnd - safeEnd) / WEEK_UNITS));
      const overrunWeeks = Math.max(0, (chainEnd - target) / WEEK_UNITS);
      const round = (v) => Math.round(v * 100) / 100;
      return {
        taskId: m.id,
        label: m.label,
        target,
        bufferWeeks: m.buffer,
        usedWeeks: round(usedWeeks),
        overrunWeeks: round(overrunWeeks),
      };
    });
}

/* Økonomi: valgfri `cost` og `revenue` (NOK, ESTIMATER) på oppgaver.
   Opprulling skjer her — banene og planen lagrer aldri egne tall. */
const numOr0 = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

function planEconomy(plan) {
  return (plan.tasks || []).reduce(
    (acc, t) => ({ cost: acc.cost + numOr0(t.cost), revenue: acc.revenue + numOr0(t.revenue) }),
    { cost: 0, revenue: 0 },
  );
}

/** Kost for å nå en milepæl: egen kost + hele avhengighetskjeden. */
function milestoneCost(plan, id) {
  const byId = new Map((plan.tasks || []).map((t) => [t.id, t]));
  const own = numOr0(byId.get(id) && byId.get(id).cost);
  return own + depClosure(plan, id).reduce((sum, t) => sum + numOr0(t.cost), 0);
}

/** Sum per bane — baner uten et eneste tall utelates. */
function laneEconomy(plan) {
  const out = {};
  (plan.tasks || []).forEach((t) => {
    if (t.cost === undefined && t.revenue === undefined) return;
    const e = out[t.lane] || (out[t.lane] = { cost: 0, revenue: 0 });
    e.cost += numOr0(t.cost);
    e.revenue += numOr0(t.revenue);
  });
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { computeImportDiff, IMPORT_GROUP_PROPS, depClosure, bufferStatuses, planEconomy, milestoneCost, laneEconomy };
}
