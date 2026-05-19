export type CardTag = {
  name: string;
  applicable: boolean;
};

export const DEFAULT_TAGS: CardTag[] = [
  { name: "Backend", applicable: true },
  { name: "Frontend", applicable: true },
];

export const TASK_TYPE_LABELS: Record<string, string> = {
  FEATURE: "Feature",
  WORK_ITEM: "Work Item",
  BUG: "Bug",
  MAINTENANCE: "Maintenance",
  OTHER: "Other",
};

export const TASK_TYPE_COLORS: Record<string, { border: string; badge: string }> = {
  FEATURE: {
    border: "border-l-skyblue-1",
    badge: "bg-sky-100 text-sky-700 dark:bg-ocean-4 dark:text-skyblue-2",
  },
  WORK_ITEM: {
    border: "border-l-violet-400",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  },
  BUG: {
    border: "border-l-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  },
  MAINTENANCE: {
    border: "border-l-teal-400",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  },
  OTHER: {
    border: "",
    badge: "bg-slate-100 text-slate-600 dark:bg-ocean-4 dark:text-slate-300",
  },
};

export const ESTIMATE_TYPE_LABELS: Record<string, string> = {
  HARD_DATE: "Hard Date",
  WEEKS: "Weeks",
  SCOPES: "Scopes",
  NONE: "None",
};

export function parseTags(value: unknown): CardTag[] {
  if (!Array.isArray(value)) return DEFAULT_TAGS;
  return value
    .filter(
      (t): t is CardTag =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as CardTag).name === "string" &&
        typeof (t as CardTag).applicable === "boolean",
    )
    .map((t) => ({ name: t.name, applicable: t.applicable }));
}
