// Semantic diff of two plan snapshots: one event per change a person would name
// (a goal date moved, a span widened, an epic reordered), with a Norwegian
// summary rendered once. The PUT handler logs these on every save; later the
// compare mode (R1b) reuses the same function for "since the baseline".
import type { Delivery, Plan, PlanLane, PlanTask, Release, Wish } from "./merge";
import { WEEK, BACKLOG, MIX_LABEL, unitToDate, fmtDate, rangeWeeks, dayToUnit, releaseScope, deliveryCustomersText } from "./epic-tools.js";

export const EVENT_CODES = [
  "epic.ny", "epic.slettet", "epic.navn", "epic.maltall", "epic.eier", "epic.maldato", "epic.ekstern", "epic.prioritet", "epic.ado",
  "feature.ny", "feature.slettet", "feature.navn", "feature.flyttet", "feature.spenn", "feature.utredning-slutt",
  "feature.estimert", "feature.utredning", "feature.epic", "feature.prioritet", "feature.avhengighet", "feature.ado",
  "feature.tilstand", "feature.eier", "feature.buffer", "feature.raw", "epic.tilstand",
  "plan.seed", "plan.begrunnelse", "plan.baseline",
  "feature.estimat-hentet", "plan.sprintmaal", "ado.push", "ado.konflikt", "ado.lest",
  "feature.fremdrift", "feature.ko", "plan.kapasitet",
  "onske.registrert", "onske.besluttet", "onske.slettet",
  "feature.beskrivelse", "feature.type", "feature.flater", "feature.fastdato", "feature.klasse",
  "release.ny", "release.slettet", "release.versjon", "release.maldato", "release.qa", "release.skippet", "release.notat", "release.scope", "release.lest",
  "leveranse.ny", "leveranse.slettet", "leveranse.navn", "leveranse.lovet", "leveranse.kunder", "leveranse.epics", "leveranse.releaser", "leveranse.eier", "leveranse.notat",
] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type Cause = "bruker" | "avhengighet" | "ado" | "system";
export type PlanEvent = {
  targetType: "epic" | "feature" | "plan" | "onske" | "release" | "leveranse";
  targetId: string;
  targetLabel: string;
  laneKey: string | null;
  code: EventCode;
  before?: unknown;
  after?: unknown;
  cause: Cause;
  causeRef?: string;
  summary: string;
};
export type DiffOptions = { causes?: Record<string, string>; source?: string };

export const REASON_CODES = ["utredning", "avhengighet", "kapasitet", "prioritering", "ekstern", "omfang", "rydding", "annet", "ingen"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export const REASON_LABEL: Record<ReasonCode, string> = {
  utredning: "Utredningen viste mer/mindre arbeid",
  avhengighet: "En avhengighet flyttet seg",
  kapasitet: "Kapasitet: annet gikk foran",
  prioritering: "Prioritert om i produktforum",
  ekstern: "Ekstern dato endret",
  omfang: "Omfanget endret",
  rydding: "Retting / rydding",
  annet: "Annet",
  ingen: "Uten begrunnelse",
};

const near = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? a === b : Math.abs(a - b) < 1e-6;
const date = (u: number) => fmtDate(unitToDate(u));
const q = (s: string) => "«" + s + "»";
const typeLabel = (v: string | undefined) => ({ feature: "Feature", teknisk: "Teknisk", vedlikehold: "Vedlikehold" } as Record<string, string>)[v ?? "feature"] ?? v ?? "Feature";
const n = (count: number, one: string, many: string) => count + " " + (count === 1 ? one : many);
const span = (r: { likely: number; late: number }) => (r.likely === r.late ? String(r.late) : r.likely + "–" + r.late);
const rangeWords = (t: PlanTask) => span(rangeWeeks(t)!) + " uker";
const pickLane = (l: PlanLane) => ({ name: l.name, goalDate: l.goalDate ?? null, goalProvisional: !!l.goalProvisional, metric: l.metric ?? null, priority: l.priority ?? null });
const pickTask = (t: PlanTask) => ({ label: t.label, lane: t.lane, kind: t.kind, start: t.start, end: t.end, endLikely: t.endLikely ?? null, deps: t.deps ?? [] });

/** Keys of `after` that are not part of the longest common subsequence with `before`:
 *  the items that actually moved. Keys present on one side only are ignored. */
export function movedKeys(before: string[], after: string[]): string[] {
  const both = new Set(before.filter((k) => after.includes(k)));
  const a = before.filter((k) => both.has(k));
  const b = after.filter((k) => both.has(k));
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const kept = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) { kept.add(a[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return b.filter((k) => !kept.has(k));
}

const taskIdsInLane = (p: Plan, lane: string) =>
  p.tasks.map((t, i) => ({ t, i })).filter((x) => x.t.lane === lane).sort((x, y) => (x.t.order ?? Infinity) - (y.t.order ?? Infinity) || x.i - y.i).map((x) => x.t.id);

function goalSummary(b: PlanLane, a: PlanLane): string {
  const bd = typeof b.goalDate === "number" ? b.goalDate : null, ad = typeof a.goalDate === "number" ? a.goalDate : null;
  const bp = !!b.goalProvisional, ap = !!a.goalProvisional;
  if (bd === null && ad !== null) return (ap ? "Foreløpig mål satt: " : "Måldato satt: ") + date(ad);
  if (bd !== null && ad === null) return "Måldato fjernet (var " + date(bd) + ")";
  if (bd === null || ad === null) return "Måldato endret";
  if (near(bd, ad)) return ap ? "Måldato " + date(ad) + " → foreløpig" : "Foreløpig mål " + date(ad) + " → endelig måldato";
  if (bp === ap) return (ap ? "Foreløpig mål: " : "Måldato: ") + date(bd) + " → " + date(ad);
  return (bp ? "Foreløpig mål " : "Måldato ") + date(bd) + " → " + (ap ? "foreløpig mål " : "måldato ") + date(ad);
}
const textChange = (what: string, b: string | undefined, a: string | undefined) =>
  !b && a ? what + " satt: " + a : b && !a ? what + " fjernet (var " + b + ")" : what + ": " + q(b ?? "") + " → " + q(a ?? "");
const wk = (c: number) => c + " uke" + (c === 1 ? "" : "r");
const rawOf = (t: PlanTask) => (t.raw ? { likely: t.raw.likely, late: t.raw.late } : null);
function epicStateSummary(b: PlanLane, a: PlanLane): string {
  const s = a.state ?? "aktiv";
  if (s === "avsluttet") return "Avsluttet: " + (a.outcome ?? "uten utfall") + (a.closedReason ? " – " + a.closedReason : "");
  if (s === "aktiv") return (b.state ?? "aktiv") === "avsluttet" ? "Gjenåpnet" : "Valgt i produktforum";
  return "Tilbake til forslag";
}
function stateSummary(b: PlanTask, t: PlanTask): string {
  switch (t.state) {
    case "utredes": return ((b.state === "klar" || b.state === "aktiv") ? "Tilbake til utredning" : "Utredning startet") + " (til " + date(t.end) + ")";   // R13: back from an estimate
    case "klar": return (b.state === "aktiv" || b.state === "levert") ? "Tilbake på hylla: klar for veikart" : "Klar for veikart";
    case "aktiv": return "Aktiv: lagt i epicen" + (t.committedRange ? " med lovet spenn " + span(t.committedRange) + " uker" : "");
    case "levert": return "Levert" + (t.deliveredAt ? " " + fmtDate(new Date(t.deliveredAt)) : "") + (t.adoId ? "" : " · uten ADO");   // R13: by hand or from the old board, never from ADO
    default: return "Registrert";
  }
}

export function diffPlans(before: Plan, after: Plan, opts: DiffOptions = {}): PlanEvent[] {
  if (opts.source === "seed") {
    return [{ targetType: "plan", targetId: "plan", targetLabel: "Planen", laneKey: null, code: "plan.seed", cause: "system",
      summary: `Eksempel-epics lastet inn (${after.lanes.length} epics, ${after.tasks.length} features)` }];
  }
  const ev: PlanEvent[] = [];
  const dc: Cause = opts.source === "ado" || opts.source === "import" ? "ado" : opts.source === "fil" ? "system" : "bruker";   // a sync's or an ADO import's writes are ADO's; a plan file's are the system's; else the editor's
  const from = (adoId: number | undefined) => (opts.source === "import" && adoId ? "Hentet fra ADO #" + adoId + " · " : "");   // «Hent fra ADO» says where an item came from
  const bl = new Map(before.lanes.map((l) => [l.key, l]));
  const al = new Map(after.lanes.map((l) => [l.key, l]));
  const laneName = (key: string) => (key === BACKLOG ? "Klar for veikart" : al.get(key)?.name ?? bl.get(key)?.name ?? key);
  const bt = new Map(before.tasks.map((t) => [t.id, t]));
  const at = new Map(after.tasks.map((t) => [t.id, t]));
  const label = (id: string) => at.get(id)?.label ?? bt.get(id)?.label ?? id;
  const named = (id: string) => ((at.get(id) ?? bt.get(id))?.kind === "discovery" ? "utredning " : "") + q(label(id));   // R8: «i kø bak utredning «X»»

  // ----- epics -----
  for (const l of after.lanes) {
    const b = bl.get(l.key);
    const base = { targetType: "epic" as const, targetId: l.key, targetLabel: l.name, laneKey: l.key, cause: dc };
    if (!b) { ev.push({ ...base, code: "epic.ny", after: pickLane(l), summary: from(l.adoId) + "Ny epic" + (typeof l.goalDate === "number" ? " · " + goalSummary({ key: l.key, name: l.name }, l).replace(" satt", "") : "") }); continue; }
    if (b.name !== l.name) ev.push({ ...base, code: "epic.navn", before: b.name, after: l.name, summary: "Navn: " + q(b.name) + " → " + q(l.name) });
    if ((b.metric ?? "") !== (l.metric ?? "")) ev.push({ ...base, code: "epic.maltall", before: b.metric ?? null, after: l.metric ?? null, summary: textChange("Måltall", b.metric, l.metric) });
    if ((b.owner ?? "") !== (l.owner ?? "")) ev.push({ ...base, code: "epic.eier", before: b.owner ?? null, after: l.owner ?? null, summary: textChange("Eier", b.owner, l.owner) });
    if (!near(b.goalDate, l.goalDate) || !!b.goalProvisional !== !!l.goalProvisional)
      ev.push({ ...base, code: "epic.maldato", before: { date: b.goalDate ?? null, provisional: !!b.goalProvisional }, after: { date: l.goalDate ?? null, provisional: !!l.goalProvisional }, summary: goalSummary(b, l) });
    if (!!b.externalDate !== !!l.externalDate) ev.push({ ...base, code: "epic.ekstern", before: !!b.externalDate, after: !!l.externalDate, summary: l.externalDate ? "Merket som ekstern dato" : "Ekstern dato fjernet" });
    if ((b.adoId ?? null) !== (l.adoId ?? null)) ev.push({ ...base, code: "epic.ado", before: b.adoId ?? null, after: l.adoId ?? null, summary: l.adoId ? "ADO-id: #" + l.adoId : "ADO-id fjernet" });
    if ((b.state ?? "aktiv") !== (l.state ?? "aktiv") || (b.outcome ?? null) !== (l.outcome ?? null) || (b.closedReason ?? null) !== (l.closedReason ?? null))
      ev.push({ ...base, code: "epic.tilstand", before: { state: b.state ?? "aktiv", outcome: b.outcome ?? null }, after: { state: l.state ?? "aktiv", outcome: l.outcome ?? null }, summary: epicStateSummary(b, l) });
    if ((b.priority ?? null) !== (l.priority ?? null))   // the number produktforum set; epics may share one, so the place is not the change
      ev.push({ ...base, code: "epic.prioritet", before: b.priority ?? null, after: l.priority ?? null, summary: `Prioritet: ${b.priority ?? "–"} → ${l.priority ?? "–"}` });
  }
  for (const b of before.lanes) if (!al.has(b.key)) {
    const count = before.tasks.filter((t) => t.lane === b.key).length;
    ev.push({ targetType: "epic", targetId: b.key, targetLabel: b.name, laneKey: b.key, code: "epic.slettet", before: pickLane(b), cause: dc,
      summary: "Epic slettet" + (count ? ` (med ${n(count, "feature", "features")})` : "") });
  }

  // ----- features -----
  const movedTasks = new Set<string>();
  for (const key of al.keys()) {
    const bo = taskIdsInLane(before, key).filter((id) => at.get(id)?.lane === key);
    const ao = taskIdsInLane(after, key).filter((id) => bt.get(id)?.lane === key);
    movedKeys(bo, ao).forEach((id) => movedTasks.add(id));
  }
  for (const t of after.tasks) {
    const b = bt.get(t.id);
    const base = { targetType: "feature" as const, targetId: t.id, targetLabel: t.label, laneKey: t.lane, cause: dc };
    if (!b) {
      ev.push({ ...base, code: "feature.ny", after: pickTask(t), summary: from(t.adoId) + (t.kind === "discovery" ? `Ny utredning (til ${date(t.end)})` : `Ny feature (${rangeWords(t)})`) });
      continue;
    }
    if (b.label !== t.label) ev.push({ ...base, code: "feature.navn", before: b.label, after: t.label, summary: "Navn: " + q(b.label) + " → " + q(t.label) });
    // R9: the four attributes from the old board
    if ((b.description ?? "") !== (t.description ?? "")) ev.push({ ...base, code: "feature.beskrivelse", before: b.description ?? null, after: t.description ?? null, summary: "Beskrivelse endret" });
    if ((b.type ?? "feature") !== (t.type ?? "feature")) ev.push({ ...base, code: "feature.type", before: b.type ?? "feature", after: t.type ?? "feature", summary: "Type: " + typeLabel(b.type) + " → " + typeLabel(t.type) });
    if ((b.areas ?? []).join(";") !== (t.areas ?? []).join(";")) ev.push({ ...base, code: "feature.flater", before: b.areas ?? [], after: t.areas ?? [], summary: "Flater: " + ((t.areas ?? []).join(", ") || "ingen") });
    if (!!b.fixedEnd !== !!t.fixedEnd) ev.push({ ...base, code: "feature.fastdato", before: !!b.fixedEnd, after: !!t.fixedEnd, summary: "Fast dato: " + (t.fixedEnd ? "på" : "av") });
    if ((b.sizeClass ?? null) !== (t.sizeClass ?? null)) ev.push({ ...base, code: "feature.klasse", before: b.sizeClass ?? null, after: t.sizeClass ?? null, summary: "Utredningsklasse: " + (b.sizeClass ?? "ingen") + " → " + (t.sizeClass ?? "ingen") });
    if (b.lane !== t.lane) ev.push({ ...base, code: "feature.epic", before: b.lane, after: t.lane, summary: `Flyttet fra ${q(laneName(b.lane))} til ${q(laneName(t.lane))}` });
    else if (movedTasks.has(t.id)) {
      const from = taskIdsInLane(before, t.lane).indexOf(t.id) + 1, to = taskIdsInLane(after, t.lane).indexOf(t.id) + 1;
      ev.push({ ...base, code: "feature.prioritet", before: from, after: to, summary: `Prioritet i epicen: ${from} → ${to}` });
    }
    if (b.kind !== t.kind) {
      ev.push(t.kind === "estimate"
        ? { ...base, code: "feature.estimert", before: { kind: b.kind, end: b.end }, after: { kind: t.kind, ...rangeWeeks(t)! }, summary: `Utredet: estimat ${rangeWords(t)}` }
        : { ...base, code: "feature.utredning", before: { kind: b.kind, ...rangeWeeks(b)! }, after: { kind: t.kind, end: t.end }, summary: `Tilbake til utredning (til ${date(t.end)})` });
    }
    if (!near(b.start, t.start)) {
      const dw = Math.round((t.start - b.start) / WEEK);
      const cause = opts.causes?.[t.id];
      const blocker = cause && cause.startsWith("dep:") ? cause.slice(4) : null;
      const queued = cause && cause.startsWith("queue:") ? cause.slice(6) : null;   // R5: the same developer's earlier work
      const where = `start ${date(b.start)} → ${date(t.start)}`;
      if (blocker) ev.push({ ...base, code: "feature.flyttet", before: { start: b.start }, after: { start: t.start }, cause: "avhengighet", causeRef: blocker,
        summary: dw ? `Flyttet ${n(Math.abs(dw), "uke", "uker")} av avhengighet ${q(label(blocker))}` : `Flyttet av avhengighet ${q(label(blocker))}: ${where}` });
      else if (queued) ev.push({ ...base, code: "feature.flyttet", before: { start: b.start }, after: { start: t.start }, cause: "avhengighet", causeRef: queued,
        summary: (dw ? `Flyttet ${n(Math.abs(dw), "uke", "uker")}: i kø bak ${named(queued)}` : `Flyttet: i kø bak ${named(queued)}: ${where}`) + (t.assignee ? ` (${t.assignee})` : "") });
      else ev.push({ ...base, code: "feature.flyttet", before: { start: b.start }, after: { start: t.start },
        summary: dw ? `Flyttet ${n(Math.abs(dw), "uke", "uker")} ${dw > 0 ? "senere" : "tidligere"}: ${where}` : `Flyttet: ${where}` });
    }
    if (b.kind === "estimate" && t.kind === "estimate") {
      const rb = rangeWeeks(b)!, ra = rangeWeeks(t)!;
      if (rb.likely !== ra.likely || rb.late !== ra.late) {
        const dl = ra.late - rb.late;
        const why = dl > 0 ? `utvidet ${n(dl, "uke", "uker")}` : dl < 0 ? `krympet ${n(-dl, "uke", "uker")}` : `sannsynlig ${rb.likely} → ${ra.likely} uker`;
        ev.push({ ...base, code: "feature.spenn", before: rb, after: ra, summary: `Spenn: ${span(rb)} → ${span(ra)} uker (${why})` });
      }
    }
    if (b.kind === "discovery" && t.kind === "discovery" && !near(b.end, t.end)) {
      const dw = Math.round((t.end - b.end) / WEEK);
      ev.push({ ...base, code: "feature.utredning-slutt", before: { end: b.end }, after: { end: t.end },
        summary: `Utredning slutt: ${date(b.end)} → ${date(t.end)}` + (dw > 0 ? ` (${n(dw, "uke", "uker")} senere)` : dw < 0 ? ` (${n(-dw, "uke", "uker")} tidligere)` : "") });
    }
    const bs = b.state ?? "aktiv", as = t.state ?? "aktiv";
    if (bs !== as) ev.push({ ...base, code: "feature.tilstand", before: bs, after: as, summary: stateSummary(b, t) });
    if ((b.assignee ?? "") !== (t.assignee ?? "")) ev.push({ ...base, code: "feature.eier", before: b.assignee ?? null, after: t.assignee ?? null, summary: t.assignee ? "Eier: " + t.assignee : "Eier fjernet" });
    if ((b.bufferWeeks ?? 0) !== (t.bufferWeeks ?? 0)) ev.push({ ...base, code: "feature.buffer", before: b.bufferWeeks ?? 0, after: t.bufferWeeks ?? 0, summary: "Buffer: " + (b.bufferWeeks ? wk(b.bufferWeeks) : "0") + " → " + (t.bufferWeeks ? wk(t.bufferWeeks) : "0") });
    const rawChanged = JSON.stringify(rawOf(b)) !== JSON.stringify(rawOf(t));
    if (t.raw && t.raw.source === "specs" && (rawChanged || b.raw?.pulledAt !== t.raw.pulledAt)) {
      const sameBuf = (b.bufferWeeks ?? 0) === (t.bufferWeeks ?? 0);
      ev.push({ ...base, code: "feature.estimat-hentet", before: rawOf(b), after: rawOf(t), summary: "Estimat hentet fra utredningen: " + span(t.raw) + (sameBuf && t.bufferWeeks ? " (uendret buffer " + wk(t.bufferWeeks) + ")" : "") });
    } else if (rawChanged && t.raw) ev.push({ ...base, code: "feature.raw", before: rawOf(b), after: rawOf(t), summary: "Utredningen sa " + span(t.raw) + " uker" });
    const pb = b.progress, pa = t.progress;
    const pkey = (p?: PlanTask["progress"]) => (p ? JSON.stringify([p.pointsDone ?? null, p.pointsTotal ?? null, p.pct ?? null]) : null);
    const pval = (p: NonNullable<PlanTask["progress"]>) => ({ pointsDone: p.pointsDone ?? null, pointsTotal: p.pointsTotal ?? null, pct: p.pct ?? null });
    if (pkey(pb) !== pkey(pa) && pa) ev.push({ ...base, code: "feature.fremdrift", before: pb ? pval(pb) : null, after: pval(pa), cause: pa.source === "ado" ? "ado" : dc,
      summary: (pa.pointsTotal ?? 0) > 0 ? `Fremdrift: ${pa.pointsDone ?? 0} av ${pa.pointsTotal} poeng` : `Fremdrift: ${pa.pct ?? 0} %` });
    if (!!b.pinned !== !!t.pinned) ev.push({ ...base, code: "feature.ko", before: !!b.pinned, after: !!t.pinned, summary: t.pinned ? "Overstyrer køen" : "Følger køen igjen" });
    const bd = b.deps ?? [], ad = t.deps ?? [];
    for (const id of ad) if (!bd.includes(id)) ev.push({ ...base, code: "feature.avhengighet", after: id, summary: `Blokkeres nå av ${q(label(id))}` });
    for (const id of bd) if (!ad.includes(id)) ev.push({ ...base, code: "feature.avhengighet", before: id, summary: `Avhengighet til ${q(label(id))} fjernet` });
    if ((b.adoId ?? null) !== (t.adoId ?? null)) ev.push({ ...base, code: "feature.ado", before: b.adoId ?? null, after: t.adoId ?? null, summary: t.adoId ? "ADO-id: #" + t.adoId : "ADO-id fjernet" });
  }
  for (const b of before.tasks) if (!at.has(b.id) && al.has(b.lane)) // features of a deleted epic are covered by epic.slettet
    ev.push({ targetType: "feature", targetId: b.id, targetLabel: b.label, laneKey: b.lane, code: "feature.slettet", before: pickTask(b), cause: dc, summary: b.kind === "discovery" ? "Utredning slettet" : "Feature slettet" });

  // ----- the sprint mix (plan level) -----
  const mb = before.capacity?.mode ?? "transition", ma = after.capacity?.mode ?? "transition";
  if (mb !== ma) ev.push({ targetType: "plan", targetId: "capacity", targetLabel: "Sprintmiks", laneKey: null, code: "plan.kapasitet", before: mb, after: ma, cause: dc,
    summary: "Sprintmiks: " + MIX_LABEL[mb as keyof typeof MIX_LABEL] + " → " + MIX_LABEL[ma as keyof typeof MIX_LABEL] });

  // ----- the sprint goal (plan level) -----
  for (const [name, g] of Object.entries(after.sprintGoals ?? {})) {
    const prev = before.sprintGoals?.[name]?.text ?? "";
    if (g.text !== prev) ev.push({ targetType: "plan", targetId: "sprint:" + name, targetLabel: name, laneKey: null, code: "plan.sprintmaal", before: prev || null, after: g.text || null, cause: dc,
      summary: g.text ? "Sprintmål " + name + ": " + q(g.text) : "Sprintmål " + name + " fjernet" });
  }
  // the intake (R7b): registered, decided, removed; never asks for a reason, the decision carries its own
  const bw = new Map((before.wishes ?? []).map((w) => [w.id, w])), aw = new Map((after.wishes ?? []).map((w) => [w.id, w]));
  const wbase = (w: Wish) => ({ targetType: "onske" as const, targetId: w.id, targetLabel: w.title, laneKey: null, cause: dc });
  const decision = (w: Wish) => {
    const forum = w.forum ? " · " + w.forum : "";
    if (w.status === "utred") return "Utred nå: «" + w.title + "»" + (w.owner || w.sizeClass ? " · " + [w.owner, w.sizeClass].filter(Boolean).join(", ") : "") + forum;
    if (w.status === "senere") return "Senere: «" + w.title + "»" + forum;
    if (w.status === "nei") return "Nei: «" + w.title + "»" + (w.reason ? " – " + w.reason : "") + forum;
    return "Tilbake til ubehandlet: «" + w.title + "»";
  };
  for (const w of after.wishes ?? []) {
    const b = bw.get(w.id);
    if (!b) { ev.push({ ...wbase(w), code: "onske.registrert", after: { status: w.status ?? "ubehandlet", source: w.source ?? null }, summary: "Nytt ønske «" + w.title + "» (" + (w.source ?? "annet") + ")" }); continue; }
    if ((b.status ?? "ubehandlet") !== (w.status ?? "ubehandlet"))
      ev.push({ ...wbase(w), code: "onske.besluttet", before: { status: b.status ?? "ubehandlet" }, after: { status: w.status ?? "ubehandlet", owner: w.owner ?? null, sizeClass: w.sizeClass ?? null, forum: w.forum ?? null, reason: w.reason ?? null }, summary: decision(w) });
  }
  for (const b of before.wishes ?? []) if (!aw.has(b.id)) ev.push({ ...wbase(b), code: "onske.slettet", before: { status: b.status ?? "ubehandlet" }, summary: "Ønske slettet: «" + b.title + "»" });

  // ----- releases (R10): the version, the target day (a reason, like an epic's goal), «Klar for QA» (R18: a reason when later), shipped, note, the ADO label -----
  const br = new Map((before.releases ?? []).map((r) => [r.key, r])), ar = new Map((after.releases ?? []).map((r) => [r.key, r]));
  const rbase = (r: Release) => ({ targetType: "release" as const, targetId: r.key, targetLabel: "Release " + r.version, laneKey: null, cause: dc });
  const dayWords = (d: string) => date(dayToUnit(d));
  for (const r of after.releases ?? []) {
    const b = br.get(r.key);
    if (!b) {   // R18 (D7): with «Klar for QA» from the start both dates are named; without one it reads as before
      ev.push({ ...rbase(r), code: "release.ny", after: { version: r.version, targetDate: r.targetDate, ...(r.qaDate ? { qaDate: r.qaDate } : {}) },
        summary: "Ny release " + r.version + " · " + (r.qaDate ? "klar for QA " + dayWords(r.qaDate) + " · release " : "mål ") + dayWords(r.targetDate) });
      continue;
    }
    if (b.version !== r.version) ev.push({ ...rbase(r), code: "release.versjon", before: b.version, after: r.version, summary: "Versjon: " + q(b.version) + " → " + q(r.version) });
    if (b.targetDate !== r.targetDate) ev.push({ ...rbase(r), code: "release.maldato", before: { date: b.targetDate }, after: { date: r.targetDate }, summary: "Release: " + dayWords(b.targetDate) + " → " + dayWords(r.targetDate) });
    if ((b.qaDate ?? null) !== (r.qaDate ?? null)) ev.push({ ...rbase(r), code: "release.qa", before: b.qaDate ? { date: b.qaDate } : null, after: r.qaDate ? { date: r.qaDate } : null,
      summary: !b.qaDate ? "Klar for QA satt: " + dayWords(r.qaDate!) : !r.qaDate ? "Klar for QA fjernet" : "Klar for QA: " + dayWords(b.qaDate) + " → " + dayWords(r.qaDate) });   // R18: the development lead's date
    if ((b.shippedDate ?? null) !== (r.shippedDate ?? null)) {
      const open = r.openAtShip?.length ?? 0;   // R18: what was not closed when it went out
      ev.push({ ...rbase(r), code: "release.skippet", before: b.shippedDate ?? null, after: r.shippedDate ?? null,
        summary: r.shippedDate ? "Sluppet " + dayWords(r.shippedDate) + (open ? " · " + n(open, "åpen", "åpne") + " ved release" : "") : "Sluppet-dato fjernet" });
    }
    if ((b.note ?? "") !== (r.note ?? "")) ev.push({ ...rbase(r), code: "release.notat", before: b.note ?? null, after: r.note ?? null, summary: textChange("Notat", b.note, r.note) });
    if (releaseScope(b) !== releaseScope(r)) ev.push({ ...rbase(r), code: "release.scope", before: releaseScope(b), after: releaseScope(r), summary: "ADO-label: " + q(releaseScope(b)) + " → " + q(releaseScope(r)) });
  }
  for (const b of before.releases ?? []) if (!ar.has(b.key)) ev.push({ ...rbase(b), code: "release.slettet", before: { version: b.version, targetDate: b.targetDate }, summary: "Release slettet: " + b.version });

  // ----- deliveries (R16): COO's promise; the promised day asks for a reason; the parts are logged one by one -----
  const bdl = new Map((before.deliveries ?? []).map((d) => [d.key, d])), adl = new Map((after.deliveries ?? []).map((d) => [d.key, d]));
  const dbase = (d: Delivery) => ({ targetType: "leveranse" as const, targetId: d.key, targetLabel: "Leveranse " + d.name, laneKey: null, cause: dc });
  const relName = (key: string) => ((after.releases ?? []).find((x) => x.key === key) ?? (before.releases ?? []).find((x) => x.key === key))?.version ?? key;
  for (const d of after.deliveries ?? []) {
    const b = bdl.get(d.key);
    if (!b) { ev.push({ ...dbase(d), code: "leveranse.ny", after: { name: d.name, promisedDate: d.promisedDate, customers: deliveryCustomersText(d) }, summary: "Ny leveranse " + q(d.name) + " · lovet " + dayWords(d.promisedDate) + " · " + deliveryCustomersText(d) }); continue; }
    if (b.name !== d.name) ev.push({ ...dbase(d), code: "leveranse.navn", before: b.name, after: d.name, summary: "Navn: " + q(b.name) + " → " + q(d.name) });
    if (b.promisedDate !== d.promisedDate) ev.push({ ...dbase(d), code: "leveranse.lovet", before: { date: b.promisedDate }, after: { date: d.promisedDate }, summary: "Lovet dato: " + dayWords(b.promisedDate) + " → " + dayWords(d.promisedDate) });
    if (deliveryCustomersText(b) !== deliveryCustomersText(d)) ev.push({ ...dbase(d), code: "leveranse.kunder", before: deliveryCustomersText(b), after: deliveryCustomersText(d), summary: "Kunder: " + deliveryCustomersText(b) + " → " + deliveryCustomersText(d) });
    const be = b.epics ?? [], ae = d.epics ?? [], br = b.releases ?? [], ar2 = d.releases ?? [];
    for (const k of ae) if (!be.includes(k)) ev.push({ ...dbase(d), code: "leveranse.epics", after: k, summary: "Henger på epic " + q(laneName(k)) });
    for (const k of be) if (!ae.includes(k)) ev.push({ ...dbase(d), code: "leveranse.epics", before: k, summary: "Epic " + q(laneName(k)) + " tatt av" });
    for (const k of ar2) if (!br.includes(k)) ev.push({ ...dbase(d), code: "leveranse.releaser", after: k, summary: "Henger på release " + relName(k) });
    for (const k of br) if (!ar2.includes(k)) ev.push({ ...dbase(d), code: "leveranse.releaser", before: k, summary: "Release " + relName(k) + " tatt av" });
    if ((b.owner ?? "") !== (d.owner ?? "")) ev.push({ ...dbase(d), code: "leveranse.eier", before: b.owner ?? null, after: d.owner ?? null, summary: textChange("Eier", b.owner, d.owner) });
    if ((b.note ?? "") !== (d.note ?? "")) ev.push({ ...dbase(d), code: "leveranse.notat", before: b.note ?? null, after: d.note ?? null, summary: textChange("Notat", b.note, d.note) });
  }
  for (const b of before.deliveries ?? []) if (!adl.has(b.key)) ev.push({ ...dbase(b), code: "leveranse.slettet", before: { name: b.name, promisedDate: b.promisedDate }, summary: "Leveranse slettet: " + q(b.name) });
  return ev;
}

/** A system event from the ADO mirror (push, conflict, read-back), logged in the same changeset as the diff's events. */
export function adoEvent(code: "ado.push" | "ado.konflikt" | "ado.lest", target: Pick<PlanEvent, "targetType" | "targetId" | "targetLabel" | "laneKey">, summary: string, extra: { before?: unknown; after?: unknown; causeRef?: string } = {}): PlanEvent {
  return { ...target, code, cause: "ado", summary, ...extra };
}

/** The server-side rule for "this change deserves a reason"; the page mirrors it in ASK_REASON_FOR. */
export function needsReason(e: PlanEvent): boolean {
  if (e.cause !== "bruker") return false;
  switch (e.code) {
    case "epic.maldato": return (e.before as { date: number | null }).date !== null;
    case "epic.prioritet":
    case "epic.tilstand":
    case "release.maldato":
    case "leveranse.lovet":
    case "feature.epic": return true;
    case "release.qa": { const b = e.before as { date: string } | null, a = e.after as { date: string } | null; return !!b && !!a && a.date > b.date; }   // R18 (D8): later asks why; set the first time, removed or earlier does not
    case "feature.spenn": { const b = e.before as { likely: number; late: number }, a = e.after as { likely: number; late: number }; return a.late > b.late || a.likely > b.likely; }
    case "feature.flyttet": return (e.after as { start: number }).start - (e.before as { start: number }).start >= WEEK - 1e-9;
    case "feature.utredning-slutt": return (e.after as { end: number }).end > (e.before as { end: number }).end + 1e-9;
    case "feature.slettet": return (e.before as { kind: string }).kind === "estimate";
    default: return false;
  }
}
