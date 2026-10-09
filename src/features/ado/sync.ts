// What ADO owns and the plan only reads: sprints (iteration nodes), the stories under a feature, delivery.
import type { Sprint } from "@/features/timeline/merge";
import type { AdoWorkItem, IterationNode } from "./client";
import { ADO_CHILD_REL, ADO_PROJECT } from "./config";
import { relTarget } from "./plan-mappers";

/** The dated «Sprint N» nodes as calendar days, sorted by start; names without dates (e.g. «After MVP») are skipped. */
export function parseSprints(root: IterationNode): Sprint[] {
  return (root.children ?? [])
    .filter((c) => /^Sprint \d+/.test(c.name) && c.attributes?.startDate && c.attributes?.finishDate)
    .map((c) => ({ name: c.name, path: ADO_PROJECT + "\\" + c.name, start: c.attributes!.startDate!.slice(0, 10), finish: c.attributes!.finishDate!.slice(0, 10) }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const DONE_STATES = ["Resolved", "Closed"];
const sprintNo = (p: string) => parseInt(/Sprint (\d+)/.exec(p)?.[1] ?? "0", 10);
const points = (w: AdoWorkItem) => Number(w.fields["Microsoft.VSTS.Scheduling.StoryPoints"] ?? 0) || 0;

/** The User Stories under a feature (the discovery story excluded): count, points, points done, the latest sprint named. */
export function readStories(feature: AdoWorkItem, byId: Map<number, AdoWorkItem>, discoveryStoryId?: number): { count: number; pointsTotal: number; pointsDone: number; iteration: string | null } {
  const stories = (feature.relations ?? [])
    .filter((r) => r.rel === ADO_CHILD_REL)
    .map(relTarget)
    .filter((id) => id !== discoveryStoryId)
    .map((id) => byId.get(id))
    .filter((w): w is AdoWorkItem => !!w && w.fields["System.WorkItemType"] === "User Story" && w.fields["System.State"] !== "Removed");
  const iter = stories
    .map((w) => String(w.fields["System.IterationPath"] ?? ""))
    .filter((p) => /Sprint \d+/.test(p))
    .sort((a, b) => sprintNo(b) - sprintNo(a))[0];
  return {
    count: stories.length,
    pointsTotal: stories.reduce((s, w) => s + points(w), 0),
    pointsDone: stories.filter((w) => DONE_STATES.includes(String(w.fields["System.State"]))).reduce((s, w) => s + points(w), 0),
    iteration: iter ? iter.split("\\").pop()! : null,
  };
}

/** The day a Resolved/Closed item was delivered (ClosedDate for Closed, ResolvedDate for Resolved), null while open. */
export function deliveredDay(item: AdoWorkItem): string | null {
  const state = String(item.fields["System.State"] ?? "");
  if (!DONE_STATES.includes(state)) return null;
  const closed = item.fields["Microsoft.VSTS.Common.ClosedDate"], resolved = item.fields["Microsoft.VSTS.Common.ResolvedDate"];
  const d = state === "Closed" ? closed ?? resolved : resolved ?? closed;
  return typeof d === "string" ? d.slice(0, 10) : null;
}
