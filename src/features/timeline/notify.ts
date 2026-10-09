// The same-week notice (spec R4, decision 7): when a save turns an epic yellow or red, management hears it the
// same week with the new window and the reason from the changeset. Slack incoming webhook; best effort: never
// awaited by a route, never a failed save.
import { epicStatus, epicWindowText, goalText, type EpicStatusCode } from "./epic-tools.js";
import { REASON_LABEL, type ReasonCode } from "./events";
import type { Plan } from "./merge";

export type EpicTurn = { key: string; name: string; from: EpicStatusCode; to: "gul" | "rod"; window: string; goal: string };
export type NoticeCtx = { editor: string | null; reason?: string; reasonCode?: string; url?: string };

const RANK: Record<EpicStatusCode, number> = { gronn: 0, venter: 0, "ingen-mal": 0, tom: 0, gul: 1, rod: 2 };
const COLOUR: Record<EpicStatusCode, string> = { gronn: "grønn", gul: "gul", rod: "rød", venter: "venter på utredning", "ingen-mal": "uten måldato", tom: "tom" };
const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Epics that got worse into yellow or red between two plans; closed epics and improvements are not news. */
export function epicTurns(before: Plan, after: Plan): EpicTurn[] {
  const out: EpicTurn[] = [];
  for (const lane of after.lanes) {
    if (lane.state === "avsluttet") continue;
    const from = before.lanes.some((l) => l.key === lane.key) ? epicStatus(before, lane.key).code : "gronn";
    const to = epicStatus(after, lane.key).code;
    if ((to === "gul" || to === "rod") && RANK[to] > RANK[from]) out.push({ key: lane.key, name: lane.name, from, to, window: epicWindowText(after, lane.key), goal: goalText(lane) });
  }
  return out;
}

export function noticeText(turns: EpicTurn[], ctx: NoticeCtx): string {
  const code = ctx.reasonCode && ctx.reasonCode !== "ingen" ? REASON_LABEL[ctx.reasonCode as ReasonCode] : undefined;
  const why = code ? code + (ctx.reason ? " – " + ctx.reason : "") : ctx.reason ? ctx.reason : "begrunnelse mangler";
  const whyLine = "Hvorfor: " + why + (ctx.editor ? " (" + ctx.editor + ")" : "");
  const link = ctx.url ? "<" + ctx.url + "|Tidslinjen>" : "Tidslinjen";
  return turns.map((t) => {
    const where = [t.window ? lower(t.window) : "", lower(t.goal)].filter(Boolean).join(", ");
    return (t.to === "rod" ? "🔴" : "🟡") + " *" + t.name + "* ble " + COLOUR[t.to] + " (var " + COLOUR[t.from] + "): " + where + ".\n" + whyLine + "\nValg for ledelsen: flytte datoen eller kutte omfang. " + link;
  }).join("\n\n");
}

export async function postSlack(url: string, text: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fire-and-forget from the save paths: nothing without SLACK_WEBHOOK_URL, nothing without a turn, never throws. */
export async function notifyTurns(before: Plan, after: Plan, ctx: NoticeCtx, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<void> {
  try {
    const hook = env.SLACK_WEBHOOK_URL?.trim();
    if (!hook) return;
    const turns = epicTurns(before, after);
    if (!turns.length) return;
    const base = env.SKYTRACKER_URL?.trim().replace(/\/$/, "");
    await postSlack(hook, noticeText(turns, { ...ctx, url: base ? base + "/timeline" : ctx.url }), fetchImpl);
  } catch { /* the notice is never the save's problem */ }
}
