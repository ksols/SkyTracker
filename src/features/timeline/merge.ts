// Field-level merge for the shared /timeline plan.
//
// Every task carries `fv` — a version number per FIELD GROUP, bumped by the
// client whenever it edits that group. Merging two plans is then per-field:
// the higher version wins; an equal version with different values means two
// clients raced on the same field, and the incoming save wins (last write
// wins — but only for that one field, nothing else is lost). Deletes are
// tombstones (`deleted[taskId] = version`): a tombstone wins over a task
// whose fields haven't been bumped past it.

export type TaskFieldGroup = "tid" | "label" | "status" | "deps" | "subtasks" | "meta" | "buffer" | "okonomi";
export const TASK_FIELD_GROUPS: TaskFieldGroup[] = ["tid", "label", "status", "deps", "subtasks", "meta", "buffer", "okonomi"];

// Which task properties belong to which field group.
export const GROUP_PROPS: Record<TaskFieldGroup, string[]> = {
  tid: ["start", "end"],
  label: ["label"],
  status: ["status", "statusCause", "statusAt"],
  deps: ["deps"],
  subtasks: ["subtasks"],
  meta: ["lane", "t2", "milestone", "source", "ext", "dod", "links"],
  buffer: ["buffer"],
  okonomi: ["cost", "revenue"],
};

export type PlanTask = {
  id: string;
  lane: string;
  label: string;
  start: number;
  end: number;
  deps?: string[];
  subtasks?: { id: string; label: string; start: number; end: number }[];
  fv?: Partial<Record<TaskFieldGroup, number>>;
  [key: string]: unknown;
};

export type Plan = {
  lanes: { key: string; name: string; v?: number }[];
  tasks: PlanTask[];
  deleted?: Record<string, number>;
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
  // "sist endret av"-stempelet følger den nyeste redigeringen (ISO-strenger
  // sammenlignes leksikografisk = kronologisk)
  const sAt = typeof stored.editedAt === "string" ? stored.editedAt : "";
  const iAt = typeof incoming.editedAt === "string" ? incoming.editedAt : "";
  const newer = iAt >= sAt ? incoming : stored;
  if (newer.editedAt !== undefined) {
    out.editedAt = newer.editedAt;
    out.editedBy = newer.editedBy;
  }
  return withDerivedBounds(out);
}

// with subtasks, start/end always follow them
function withDerivedBounds(t: PlanTask): PlanTask {
  if (Array.isArray(t.subtasks) && t.subtasks.length) {
    t.start = Math.min(...t.subtasks.map((s) => s.start));
    t.end = Math.max(...t.subtasks.map((s) => s.end));
  }
  return t;
}

export function mergePlans(stored: Plan, incoming: Plan): Plan {
  // tombstones: union, highest version wins
  const deleted: Record<string, number> = { ...(stored.deleted ?? {}) };
  for (const [id, v] of Object.entries(incoming.deleted ?? {})) {
    deleted[id] = Math.max(deleted[id] ?? 0, v);
  }

  // lanes: union by key, versioned rename (incoming wins ties)
  const lanes: Plan["lanes"] = [];
  const laneByKey = new Map(incoming.lanes.map((l) => [l.key, l]));
  for (const s of stored.lanes) {
    const i = laneByKey.get(s.key);
    lanes.push(i && (i.v ?? 0) >= (s.v ?? 0) ? { ...i } : { ...s });
    laneByKey.delete(s.key);
  }
  for (const i of laneByKey.values()) lanes.push({ ...i });

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
    const candidate = s && i ? mergeTask(s, i) : withDerivedBounds({ ...(s ?? i)! } as PlanTask);
    // a tombstone wins unless the task's fields were bumped PAST it
    const tomb = deleted[id] ?? 0;
    if (tomb > 0 && maxFv(candidate) <= tomb) continue;
    tasks.push(candidate);
  }

  return { ...stored, ...incoming, lanes, tasks, deleted };
}
