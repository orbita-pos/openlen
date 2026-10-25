import { describe, expect, it } from "vitest";
import { createRepeatReminder } from "./repeat-reminder";

const ok = { ok: true };
const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args, response: ok });

describe("createRepeatReminder (DeepSeek's repeat-tool-reminder + the alternating pair)", () => {
  it("gentle at 3 identical calls, detailed at 5 and 8 with the tool, the count and the arguments", () => {
    const r = createRepeatReminder();
    const got = Array.from({ length: 8 }, () => r.observe([call("Read", { file_path: "/a" })]));
    expect(got.map((x) => x.length)).toEqual([0, 0, 1, 0, 1, 0, 0, 1]);
    expect(got[2]![0]).toMatch(/^You are repeating the exact same tool call/);
    expect(got[4]![0]).toContain("- tool: Read\n- consecutive_calls: 5\n- arguments: {\"file_path\":\"/a\"}");
    expect(got[7]![0]).toContain("- consecutive_calls: 8");
  });

  it("key order does not matter, any other call breaks the run", () => {
    const r = createRepeatReminder();
    r.observe([call("Read", { a: 1, b: 2 }), call("Read", { b: 2, a: 1 })]);
    expect(r.observe([call("Read", { a: 1, b: 2 })])).toHaveLength(1);
    const s = createRepeatReminder();
    expect(s.observe([call("Read", { a: 1 }), call("Read", { a: 1 }), call("Write", {}), call("Read", { a: 1 })])).toEqual([]);
  });

  it("an alternating pair fires once per cycle count (3, then 5), whichever call closes the cycle", () => {
    const r = createRepeatReminder();
    const A = call("render_artifact", { revision: 10 });
    const B = call("inspect_artifact", { artifact_id: "v" });
    const got = [A, B, A, B, A, B, A, B, A, B].map((c) => r.observe([c]));
    expect(got.map((x) => x.length)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(got[5]![0]).toMatch(/^You are alternating the same two tool calls/);
    expect(got[9]![0]).toContain("- tools: render_artifact, then inspect_artifact\n- consecutive_cycles: 5");
  });

  it("a pending answer is transparent and reset() starts over", () => {
    const r = createRepeatReminder();
    const polling = { name: "inspect_artifact", args: { id: "v" }, response: { ok: true, pending: true } };
    expect(r.observe([call("Read"), polling, call("Read"), polling])).toEqual([]);
    expect(r.observe([call("Read")])).toHaveLength(1);
    r.reset();
    expect(r.observe([call("Read"), call("Read")])).toEqual([]);
  });
});
