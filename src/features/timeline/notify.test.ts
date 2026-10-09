import { describe, expect, it, vi } from "vitest";
import { dateToUnit, normalizePlan } from "./epic-tools.js";
import type { Plan, PlanLane, PlanTask } from "./merge";
import { epicTurns, noticeText, notifyTurns, postSlack } from "./notify";

const D = (y: number, m: number, d: number) => dateToUnit(new Date(y, m - 1, d));
const GOAL = D(2026, 12, 15);
const lane = (key: string, over: Partial<PlanLane> = {}): PlanLane => ({ key, name: "Epic " + key, goalDate: GOAL, ...over });
const est = (id: string, lane: string, start: number, likelyWeeks: number, lateWeeks: number): PlanTask =>
  ({ id, lane, label: "F " + id, kind: "estimate", start, endLikely: start + likelyWeeks * 0.25, end: start + lateWeeks * 0.25, deps: [], fv: {} });
const plan = (lanes: PlanLane[], tasks: PlanTask[]): Plan => normalizePlan({ lanes, tasks, deleted: {} });
const S = D(2026, 10, 26); // 26 Oct: 6 planning weeks (0.25 month each) end before 15 Dec, 8 do not

describe("epicTurns", () => {
  it("lists epics that turned yellow or red for the worse; skips improvements, unchanged colours and closed epics", () => {
    const before = plan(
      [lane("a"), lane("b"), lane("c"), lane("d", { state: "avsluttet", outcome: "nådd" }), lane("e")],
      [est("a1", "a", S, 4, 6), est("b1", "b", S, 4, 8), est("c1", "c", S, 8, 10), est("d1", "d", S, 4, 6), est("e1", "e", S, 4, 6)],
    );
    const after = plan(
      [lane("a"), lane("b"), lane("c"), lane("d", { state: "avsluttet", outcome: "nådd" }), lane("e")],
      [est("a1", "a", S, 4, 8), est("b1", "b", S, 8, 10), est("c1", "c", S, 4, 8), est("d1", "d", S, 4, 8), est("e1", "e", S, 4, 6)],
    );
    expect(epicTurns(before, after).map((t) => [t.key, t.from, t.to])).toEqual([["a", "gronn", "gul"], ["b", "gul", "rod"]]);
    const t = epicTurns(before, after)[0];
    expect(t.name).toBe("Epic a");
    expect(t.goal).toBe("Måldato 15. des");
    expect(t.window).toMatch(/^Leveres uke \d+–\d+$/);
  });
});

describe("noticeText", () => {
  it("names the epic, the colours, the window, the goal and the reason, and links the timeline", () => {
    const text = noticeText([{ key: "telenor", name: "Telenor kan bygge på oss", from: "gronn", to: "gul", window: "Leveres uke 49–51", goal: "Måldato 15. des" }],
      { editor: "GO", reason: "Flere lagringsnoder", reasonCode: "utredning", url: "https://sky-tracker-nu.vercel.app/timeline" });
    expect(text).toBe("🟡 *Telenor kan bygge på oss* ble gul (var grønn): leveres uke 49–51, måldato 15. des.\nHvorfor: Utredningen viste mer/mindre arbeid – Flere lagringsnoder (GO)\nValg for ledelsen: flytte datoen eller kutte omfang. <https://sky-tracker-nu.vercel.app/timeline|Tidslinjen>");
  });
  it("red, no reason, no url: «begrunnelse mangler» and the plain name", () => {
    const text = noticeText([{ key: "x", name: "X", from: "gul", to: "rod", window: "", goal: "Måldato settes etter utredning" }], { editor: null });
    expect(text).toBe("🔴 *X* ble rød (var gul): måldato settes etter utredning.\nHvorfor: begrunnelse mangler\nValg for ledelsen: flytte datoen eller kutte omfang. Tidslinjen");
  });
});

describe("postSlack and notifyTurns", () => {
  it("posts { text } as JSON; a 500 answers false; no url sends nothing and never throws", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    expect(await postSlack("https://hooks.slack.com/x", "hei", ok as unknown as typeof fetch)).toBe(true);
    expect(ok.mock.calls[0][0]).toBe("https://hooks.slack.com/x");
    expect(JSON.parse(ok.mock.calls[0][1].body)).toEqual({ text: "hei" });
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await postSlack("https://hooks.slack.com/x", "hei", bad as unknown as typeof fetch)).toBe(false);
    const before = plan([lane("a")], [est("a1", "a", S, 4, 6)]), after = plan([lane("a")], [est("a1", "a", S, 4, 8)]);
    const sent = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await notifyTurns(before, after, { editor: "GO" }, {}, sent as unknown as typeof fetch);
    expect(sent).not.toHaveBeenCalled();
    await notifyTurns(before, after, { editor: "GO" }, { SLACK_WEBHOOK_URL: "https://hooks.slack.com/y", SKYTRACKER_URL: "https://x" }, sent as unknown as typeof fetch);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sent.mock.calls[0][1].body).text).toContain("🟡 *Epic a* ble gul (var grønn)");
    const boom = vi.fn().mockRejectedValue(new Error("network"));
    await expect(notifyTurns(before, after, { editor: "GO" }, { SLACK_WEBHOOK_URL: "https://hooks.slack.com/y" }, boom as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});
