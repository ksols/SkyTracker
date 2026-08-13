import type { Plan, PlanTask, TaskFieldGroup } from "./merge";

export type ImportChange = {
  kind: "ny" | "endret" | "slettet" | "bevart";
  id: string;
  label: string;
  groups?: TaskFieldGroup[];
  before?: PlanTask;
  after?: PlanTask;
};

export declare function computeImportDiff(
  current: Plan,
  incoming: Plan,
  opts?: { editor?: string; now?: string },
): { plan: Plan; changes: ImportChange[] };

export declare const IMPORT_GROUP_PROPS: Record<TaskFieldGroup, string[]>;

export declare function depClosure(plan: Plan, id: string): PlanTask[];

export type BufferStatus = {
  taskId: string;
  label: string;
  target: number;
  bufferWeeks: number;
  usedWeeks: number;
  overrunWeeks: number;
};

export declare function bufferStatuses(plan: Plan): BufferStatus[];

export type Economy = { cost: number; revenue: number };

export declare function planEconomy(plan: Plan): Economy;
export declare function milestoneCost(plan: Plan, id: string): number;
export declare function laneEconomy(plan: Plan): Record<string, Economy>;
