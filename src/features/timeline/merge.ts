// Field-level merge for the shared /timeline plan (epic roadmap).
//
// Every task carries `fv`, a version number per FIELD GROUP, bumped by the
// client whenever it edits that group. Merging two plans is then per-field:
// the higher version wins; an equal version with different values means two
// clients raced on the same field, and the incoming save wins (last write
// wins, but only for that one field, nothing else is lost). Deletes are
// tombstones (`deleted[taskId] = version`, `deletedLanes[key] = version`):
// a tombstone wins over an item whose version hasn't been bumped past it.

export type TaskFieldGroup = "tid" | "label" | "deps" | "meta" | "state" | "est" | "ado" | "progress";
export const TASK_FIELD_GROUPS: TaskFieldGroup[] = ["tid", "label", "deps", "meta", "state", "est", "ado", "progress"];

// Which task properties belong to which field group. `ado` is written by the server (push/refresh), never by the page.
export const GROUP_PROPS: Record<TaskFieldGroup, string[]> = {
  tid: ["start", "end", "endLikely", "sizeClass"],
  label: ["label"],
  deps: ["deps"],
  meta: ["lane", "kind", "adoId", "order", "assignee", "specPath", "pinned", "description"],
  state: ["state", "committedRange", "activatedAt", "deliveredAt", "startedAt"],
  est: ["raw", "bufferWeeks"],
  ado: ["ado"],
  progress: ["progress"],
};

export type Sprint = { name: string; path: string; start: string; finish: string };
/** The intake (R7b): a wish PreSales registered; produktforum decides it. Versioned like a lane (`v`). */
export type WishSource = "egen-plan" | "investor" | "kunde" | "ledermote" | "annet";
export type WishStatus = "ubehandlet" | "utred" | "senere" | "nei";
export type Wish = {
  id: string;
  v?: number;
  title: string;
  note?: string;
  source?: WishSource;
  askedBy?: string;
  /** YYYY-MM-DD */
  askedOn?: string;
  registeredBy?: string;
  registeredAt?: string;
  status?: WishStatus;
  decidedAt?: string;
  decidedBy?: string;
  /** «Produktforum 5. nov»: typed once per session, kept on every decision taken in it. */
  forum?: string;
  reason?: string;
  /** Utred nå: the owner and the size class the forum chose; the created task holds the dates. */
  owner?: string;
  sizeClass?: "S" | "M" | "L" | "XL";
  /** The task on the shelf a yes created. */
  featureId?: string;
};
/** What the last push wrote to ADO, field by field, so a refresh can tell «changed in ADO» from «changed here». */
export type AdoSnapshot = Partial<Record<"title" | "description" | "state" | "targetDate" | "startDate", string | null>>;
export type AdoConflict = { field: string; ours: string | null; theirs: string | null };
export type LaneAdo = { pushedAt: string; snapshot: AdoSnapshot; conflicts?: AdoConflict[] };
export type TaskAdo = LaneAdo & { storyId?: number; stories?: { count: number; pointsTotal: number; pointsDone: number; iteration: string | null; at: string } };

export type PlanTask = {
  id: string;
  lane: string;
  label: string;
  kind: "discovery" | "estimate";
  start: number;
  end: number;
  endLikely?: number;
  adoId?: number;
  deps?: string[];
  order?: number;
  state?: "ny" | "utredes" | "klar" | "aktiv" | "levert";
  assignee?: string;
  raw?: { likely: number; late: number; source?: string; pulledAt?: string; by?: string; date?: string };
  bufferWeeks?: number;
  committedRange?: { likely: number; late: number; start: number };
  activatedAt?: string;
  deliveredAt?: string;
  /** ISO: when «Start utredning» (or the intake, or an import) started the discovery; discoveries of one owner run in this order (R8). */
  startedAt?: string;
  specPath?: string;
  /** The size class the forum promised when the discovery started (R8): S 1, M 2, L 4, XL 6 weeks. */
  sizeClass?: "S" | "M" | "L" | "XL";
  /** Free text: imported from ADO or typed; pushed as the ADO description instead of the generated lines. */
  description?: string;
  /** The planner dragged it below the queue's floor: it keeps its place and still counts for the ones after it. */
  pinned?: boolean;
  ado?: TaskAdo;
  /** Typed on day 10 (`manuell`) or read from ADO's stories (`ado`): points, or a percent when no points exist. */
  progress?: { pointsDone?: number; pointsTotal?: number; pct?: number; sprint?: string | null; at: string; source: "manuell" | "ado" };
  fv?: Partial<Record<TaskFieldGroup, number>>;
  [key: string]: unknown;
};

export type PlanLane = {
  key: string;
  name: string;
  v?: number;
  owner?: string;
  goalDate?: number;
  goalProvisional?: boolean;
  adoId?: number;
  priority?: number;
  metric?: string;
  externalDate?: boolean;
  description?: string;
  state?: "forslag" | "aktiv" | "avsluttet";
  closedReason?: string;
  closedAt?: string;
  outcome?: "nådd" | "ikke nådd" | "endret";
  ado?: LaneAdo;
};

export type Plan = {
  schema?: string;
  lanes: PlanLane[];
  tasks: PlanTask[];
  deleted?: Record<string, number>;
  deletedLanes?: Record<string, number>;
  wishes?: Wish[];
  deletedWishes?: Record<string, number>;
  sprints?: { at: string; items: Sprint[] };
  sprintGoals?: Record<string, { text: string; at: string }>;
  /** The sprint mix: the share of a sprint that goes to planned features (R5); the factor from raw weeks to elapsed time. */
  capacity?: { mode: "transition" | "normal"; at: string };
  [key: string]: unknown;
};

export const fvOf = (t: PlanTask, f: TaskFieldGroup): number => t.fv?.[f] ?? 0;
export const maxFv = (t: PlanTask): number => Math.max(0, ...TASK_FIELD_GROUPS.map((f) => fvOf(t, f)));

function mergeTask(stored: PlanTask, incoming: PlanTask): PlanTask {
  const out: PlanTask = { ...stored, fv: { ...(stored.fv ?? {}) } };
  for (const f of TASK_FIELD_GROUPS) {
    const sv = fvOf(stored, f);
    const iv = fvOf(incoming, f);
    // incoming wins ties: it is the later save, and per-field this is the
    // only place "last write wins" still applies
    const winner = iv >= sv ? incoming : stored;
    for (const p of GROUP_PROPS[f]) {
      if (winner[p] === undefined) delete out[p];
      else out[p] = winner[p];
    }
    out.fv![f] = Math.max(sv, iv);
  }
  // the "last edited by" stamp follows the newest edit (ISO strings compare
  // lexicographically = chronologically)
  const sAt = typeof stored.editedAt === "string" ? stored.editedAt : "";
  const iAt = typeof incoming.editedAt === "string" ? incoming.editedAt : "";
  const newer = iAt >= sAt ? incoming : stored;
  if (newer.editedAt !== undefined) {
    out.editedAt = newer.editedAt;
    out.editedBy = newer.editedBy;
  }
  return out;
}

function mergeTombstones(a?: Record<string, number>, b?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [id, v] of Object.entries(b ?? {})) out[id] = Math.max(out[id] ?? 0, v);
  return out;
}

export function mergePlans(stored: Plan, incoming: Plan): Plan {
  const deleted = mergeTombstones(stored.deleted, incoming.deleted);
  const deletedLanes = mergeTombstones(stored.deletedLanes, incoming.deletedLanes);
  const deletedWishes = mergeTombstones(stored.deletedWishes, incoming.deletedWishes);

  // lanes: union by key, versioned (incoming wins ties); a tombstone removes a
  // lane unless its version was bumped PAST the tombstone
  const lanes: PlanLane[] = [];
  const laneByKey = new Map(incoming.lanes.map((l) => [l.key, l]));
  for (const s of stored.lanes) {
    const i = laneByKey.get(s.key);
    lanes.push(i && (i.v ?? 0) >= (s.v ?? 0) ? { ...i } : { ...s });
    laneByKey.delete(s.key);
  }
  for (const i of laneByKey.values()) lanes.push({ ...i });
  const liveLanes = lanes.filter((l) => {
    const tomb = deletedLanes[l.key];
    return tomb === undefined || (l.v ?? 0) > tomb;
  });

  // wishes: like lanes, by id and version
  const wishes: Wish[] = [];
  const wishById = new Map((incoming.wishes ?? []).map((w) => [w.id, w]));
  for (const s of stored.wishes ?? []) {
    const i = wishById.get(s.id);
    wishes.push(i && (i.v ?? 0) >= (s.v ?? 0) ? { ...i } : { ...s });
    wishById.delete(s.id);
  }
  for (const i of wishById.values()) wishes.push({ ...i });
  const liveWishes = wishes.filter((w) => { const tomb = deletedWishes[w.id]; return tomb === undefined || (w.v ?? 0) > tomb; });

  // tasks: union by id, stored order first, incoming-only appended
  const storedMap = new Map(stored.tasks.map((t) => [t.id, t]));
  const incomingMap = new Map(incoming.tasks.map((t) => [t.id, t]));
  const orderedIds = [
    ...stored.tasks.map((t) => t.id),
    ...incoming.tasks.filter((t) => !storedMap.has(t.id)).map((t) => t.id),
  ];

  const tasks: PlanTask[] = [];
  for (const id of orderedIds) {
    const s = storedMap.get(id);
    const i = incomingMap.get(id);
    const candidate = s && i ? mergeTask(s, i) : ({ ...(s ?? i)! } as PlanTask);
    // a tombstone wins unless the task's fields were bumped PAST it
    const tomb = deleted[id] ?? 0;
    if (tomb > 0 && maxFv(candidate) <= tomb) continue;
    tasks.push(candidate);
  }

  // plan-level caches: the sprint list and each sprint's goal carry an `at`; the newer one wins (incoming on ties)
  const newer = <T extends { at: string }>(a?: T, b?: T) => (!a ? b : !b ? a : b.at >= a.at ? b : a);
  const sprints = newer(stored.sprints, incoming.sprints);
  const capacity = newer(stored.capacity, incoming.capacity);
  const sprintGoals: Record<string, { text: string; at: string }> = {};
  for (const src of [stored.sprintGoals, incoming.sprintGoals]) for (const [k, g] of Object.entries(src ?? {})) sprintGoals[k] = newer(sprintGoals[k], g)!;
  const out: Plan = { ...stored, ...incoming, lanes: liveLanes, tasks, deleted, deletedLanes, wishes: liveWishes, deletedWishes };
  delete out.sprints;
  delete out.sprintGoals;
  delete out.capacity;
  if (sprints) out.sprints = sprints;
  if (capacity) out.capacity = capacity;
  if (Object.keys(sprintGoals).length) out.sprintGoals = sprintGoals;
  return out;
}
