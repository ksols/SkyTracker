export type CardTag = {
  name: string;
  applicable: boolean;
};

export const DEFAULT_TAGS: CardTag[] = [
  { name: "Backend", applicable: true },
  { name: "Frontend", applicable: true },
];

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
