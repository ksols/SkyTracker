import { GROUP_PROPS, TASK_FIELD_GROUPS, type Plan, type PlanTask, type TaskFieldGroup } from "./merge";

// What actually changed between two plan snapshots — used to write the change
// log on every shared save. fv/editedBy/editedAt bumps alone are NOT changes;
// only real content differences per field group count.

export type PlanChange = {
  kind: "ny" | "endret" | "slettet";
  taskId: string;
  taskLabel: string;
  groups?: TaskFieldGroup[];
  before?: PlanTask;
  after?: PlanTask;
};

function propEq(group: TaskFieldGroup, a: unknown, b: unknown): boolean {
  if (group === "deps") {
    a = ([...((a as string[] | undefined) ?? [])] as string[]).sort();
    b = ([...((b as string[] | undefined) ?? [])] as string[]).sort();
  }
  const norm = (v: unknown) => (v === undefined ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export function planDelta(before: Plan, after: Plan): PlanChange[] {
  const beforeById = new Map(before.tasks.map((t) => [t.id, t]));
  const afterIds = new Set(after.tasks.map((t) => t.id));
  const changes: PlanChange[] = [];

  for (const a of after.tasks) {
    const b = beforeById.get(a.id);
    if (!b) {
      changes.push({ kind: "ny", taskId: a.id, taskLabel: a.label, after: a });
      continue;
    }
    const groups = TASK_FIELD_GROUPS.filter((g) =>
      GROUP_PROPS[g].some((p) => !propEq(g, b[p], a[p])),
    );
    if (groups.length) {
      changes.push({ kind: "endret", taskId: a.id, taskLabel: a.label, groups, before: b, after: a });
    }
  }
  for (const b of before.tasks) {
    if (!afterIds.has(b.id)) {
      changes.push({ kind: "slettet", taskId: b.id, taskLabel: b.label, before: b });
    }
  }
  return changes;
}
