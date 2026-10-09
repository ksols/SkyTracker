// estimate.yaml beside spec.md in Skytale.Specs (decision 3): five flat keys, one `key: value` per line.
// No YAML library needed; quotes, comments and blank lines are tolerated.
export type SpecEstimate = { likely: number; late: number; points?: number; estimatedBy?: string; date?: string };
export const SPEC_FOLDER_RE = /^[A-Za-z0-9._-]+$/;
export const estimatePath = (folder: string) => "/spec/" + folder + "/estimate.yaml";

export function parseEstimateYaml(text: string): SpecEstimate | null {
  const kv: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (m) kv[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const a = Number(kv.likely_weeks), b = Number(kv.late_weeks);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const out: SpecEstimate = { likely: Math.round(Math.min(a, b)), late: Math.round(Math.max(a, b)) };
  if (kv.points !== undefined && kv.points !== "" && Number.isFinite(Number(kv.points))) out.points = Number(kv.points);
  if (kv.estimated_by) out.estimatedBy = kv.estimated_by;
  if (kv.date && /^\d{4}-\d{2}-\d{2}$/.test(kv.date)) out.date = kv.date;
  return out;
}
