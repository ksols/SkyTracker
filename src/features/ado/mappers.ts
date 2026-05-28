import type { CardTag } from "@/features/board/types";

export type AdoFieldPatch = { op: "add"; path: string; value: string };

export function cardTagsToAdoTags(tags: CardTag[]): string[] {
  const applicable = tags.filter((t) => t.applicable).map((t) => t.name);
  return [...applicable, "SkyTracker"];
}

export function buildAttributionDescription(
  description: string | null,
  userName: string,
): string {
  const stamp = `<i>Created from SkyTracker by ${userName}</i>`;
  return description ? `${description}<br><br>${stamp}` : stamp;
}

/** Find the iteration node name for a sprint number, tolerating suffixes
 *  like "Sprint 57 (Bugweek)" while never matching "Sprint 60" for 6. */
export function matchIterationName(names: string[], sprintNumber: number): string | null {
  const re = new RegExp(`^Sprint ${sprintNumber}(\\s|\\(|$)`);
  return names.find((n) => re.test(n)) ?? null;
}

export function buildWorkItemPatch(input: {
  title: string;
  description: string;
  tags: string[];
  iterationPath: string | null;
}): AdoFieldPatch[] {
  const patch: AdoFieldPatch[] = [
    { op: "add", path: "/fields/System.Title", value: input.title },
  ];
  if (input.description) {
    patch.push({ op: "add", path: "/fields/System.Description", value: input.description });
  }
  if (input.tags.length > 0) {
    patch.push({ op: "add", path: "/fields/System.Tags", value: input.tags.join("; ") });
  }
  if (input.iterationPath) {
    patch.push({ op: "add", path: "/fields/System.IterationPath", value: input.iterationPath });
  }
  return patch;
}
