// Field-level merge for the shared /timeline plan (epic roadmap).
//
// Every task carries `fv`, a version number per FIELD GROUP, bumped by the
// client whenever it edits that group. Merging two plans is then per-field:
// the higher version wins; an equal version with different values means two
// clients raced on the same field, and the incoming save wins (last write
// wins, but only for that one field, nothing else is lost). Deletes are
// tombstones (`deleted[taskId] = version`, `deletedLanes[key] = version`):
// a tombstone wins over an item whose version hasn't been bumped past it.

export type TaskFieldGroup = "tid" | "label" | "deps" | "meta";
export const TASK_FIELD_GROUPS: TaskFieldGroup[] = ["tid", "label", "deps", "meta"];

// Which task properties belong to which field group.
export const GROUP_PROPS: Record<TaskFieldGroup, string[]> = {
  tid: ["start", "end", "endLikely"],
  label: ["label"],
  deps: ["deps"],
  meta: ["lane", "kind", "adoId"],
};

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
};

export type Plan = {
  schema?: string;
  lanes: PlanLane[];
  tasks: PlanTask[];
  deleted?: Record<string, number>;
  deletedLanes?: Record<string, number>;
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

  return { ...stored, ...incoming, lanes: liveLanes, tasks, deleted, deletedLanes };
}
