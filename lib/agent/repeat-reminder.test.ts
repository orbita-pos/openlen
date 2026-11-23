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
    const A = call("render_deliverable", { revision: 10 });
    const B = call("inspect_deliverable", { deliverable_id: "v" });
    const got = [A, B, A, B, A, B, A, B, A, B].map((c) => r.observe([c]));
    expect(got.map((x) => x.length)).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(got[5]![0]).toMatch(/^You are alternating the same two tool calls/);
    expect(got[9]![0]).toContain("- tools: render_deliverable, then inspect_deliverable\n- consecutive_cycles: 5");
  });

  it("a pending answer is transparent and reset() starts over", () => {
    const r = createRepeatReminder();
    const polling = { name: "inspect_deliverable", args: { id: "v" }, response: { ok: true, pending: true } };
    expect(r.observe([call("Read"), polling, call("Read"), polling])).toEqual([]);
    expect(r.observe([call("Read")])).toHaveLength(1);
    r.reset();
    expect(r.observe([call("Read"), call("Read")])).toEqual([]);
  });

  it("A2 · 3 and 5 consecutive use_page calls with no_change or failure emit a check-in reminder even with distinct args", () => {
    const r = createRepeatReminder();
    const step = (click: string, extra: Record<string, unknown> = { no_change: true }) => ({
      name: "use_page",
      args: { steps: [{ click }] },
      response: { ok: true, ...extra },
    });
    expect(r.observe([step("Enviar")])).toEqual([]);
    expect(r.observe([step("Guardar")])).toEqual([]);
    const third = r.observe([step("Confirmar")]);
    expect(third).toHaveLength(1);
    expect(third[0]).toContain("use_page calls produced no observable change");
    expect(r.observe([step("Aceptar")])).toEqual([]);
    expect(r.observe([{ name: "use_page", args: { steps: [{ click: "X" }] }, response: { ok: false, error: "boom" } }])).toHaveLength(1);
    // An Edit resets the streak.
    expect(r.observe([call("Edit", { file_path: "/index.html" })])).toEqual([]);
    expect(r.observe([step("A"), step("B")])).toEqual([]);
    // A use_page with a real change also resets the streak.
    expect(r.observe([step("C", {})])).toEqual([]);
    expect(r.observe([step("D"), step("E")])).toEqual([]);
  });

  it("A2 · repeated Reads of already-read files with no edits emit a circling reminder and Edit/bash resets it", () => {
    const r = createRepeatReminder();
    // Initial reads of two files do not trigger circling.
    expect(r.observe([call("Read", { file_path: "/a.ts" }), call("Read", { file_path: "/b.ts" })])).toEqual([]);
    // Re-reading alternating already-read files without editing triggers at 3.
    expect(r.observe([call("Read", { file_path: "/a.ts" })])).toEqual([]);
    expect(r.observe([call("Read", { file_path: "/b.ts" })])).toEqual([]);
    const third = r.observe([call("Read", { file_path: "/a.ts" })]);
    expect(third).toHaveLength(1);
    expect(third[0]).toContain("re-reading files you already read with no edits in between");
    // Editing /a.ts invalidates its cached read scope and resets the streak.
    expect(r.observe([call("Edit", { file_path: "/a.ts" })])).toEqual([]);
    expect(r.observe([call("Read", { file_path: "/a.ts" })])).toEqual([]);
  });
});

// A3 · the reminders' false positives: what changes the project without a file path, and who cannot edit at all.
describe("createRepeatReminder · what counts as a change, and who it speaks to", () => {
  const FILES = ["/a.ts", "/b.ts", "/c.ts", "/d.ts"];
  const read = (r: ReturnType<typeof createRepeatReminder>, file: string) => r.observe([call("Read", { file_path: file })]);
  /** Four files read once each, then two of them re-read: a streak of 2, one more re-read from the reminder. */
  const circling = (r: ReturnType<typeof createRepeatReminder>) => {
    r.observe(FILES.map((f) => call("Read", { file_path: f })));
    read(r, "/a.ts");
    read(r, "/b.ts");
  };
  const rereads = (r: ReturnType<typeof createRepeatReminder>) => read(r, "/c.ts");
  const noChange = (click: string) => ({ name: "use_page", args: { steps: [{ click }] }, response: { ok: true, no_change: true } });

  // Every one of them can change what Read would now answer, whatever its own arguments say.
  const ALSO_MUTATING = ["undo_last_change", "create_deliverable", "render_deliverable", "cancel_deliverable_job", "publish_artifact", "subagent", "subagent_fork"];

  it("🔴 the tools that change the project without naming a file break the circling streaks and forget what was read", () => {
    for (const tool of ALSO_MUTATING) {
      const r = createRepeatReminder();
      circling(r);
      expect(r.observe([call(tool, { description: "x" })]), tool).toEqual([]);
      // Without it the next re-read would be the third; after it, /c.ts is a first read again.
      expect(rereads(r), tool).toEqual([]);

      const p = createRepeatReminder();
      p.observe([noChange("A"), noChange("B")]);
      p.observe([call(tool, { description: "x" })]);
      expect(p.observe([noChange("C")]), tool).toEqual([]);
    }
  });

  it("a failed one changed nothing, so it breaks nothing", () => {
    const r = createRepeatReminder();
    circling(r);
    r.observe([{ name: "render_deliverable", args: { revision: 1 }, response: { ok: false, error: "boom" } }]);
    expect(rereads(r)).toHaveLength(1);
  });

  it("🔴 those names are real tools of Len's", async () => {
    const { ARTIFACT_TOOLS } = await import("@/lib/artifacts/tools");
    const { PUBLISH_ARTIFACT } = await import("@/lib/len-artifacts/tools");
    const { SUBAGENT_TOOL, SUBAGENT_FORK_TOOL } = await import("./subagents/enabled");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const real = new Set<string>([...ARTIFACT_TOOLS, PUBLISH_ARTIFACT, SUBAGENT_TOOL, SUBAGENT_FORK_TOOL]);
    const catalog = readFileSync(join(__dirname, "catalog.ts"), "utf8");
    expect(catalog).toContain('name: "undo_last_change"');
    for (const tool of ALSO_MUTATING.filter((t) => t !== "undo_last_change")) expect(real.has(tool), tool).toBe(true);
  });

  it("🔴 artifact_data writes (set/update/delete/batch) break circling and use_page streaks; reads (get/list/query) do not", () => {
    for (const action of ["set", "update", "delete", "batch"]) {
      const r = createRepeatReminder();
      circling(r);
      expect(r.observe([call("artifact_data", { artifact: "budget", action })]), action).toEqual([]);
      expect(rereads(r), action).toEqual([]);

      const p = createRepeatReminder();
      p.observe([noChange("A"), noChange("B")]);
      p.observe([call("artifact_data", { artifact: "budget", action })]);
      expect(p.observe([noChange("C")]), action).toEqual([]);
    }
    for (const action of ["get", "list", "query"]) {
      const r = createRepeatReminder();
      circling(r);
      expect(r.observe([call("artifact_data", { artifact: "budget", action })]), action).toEqual([]);
      expect(rereads(r), action).toHaveLength(1);

      const p = createRepeatReminder();
      p.observe([noChange("A"), noChange("B")]);
      p.observe([call("artifact_data", { artifact: "budget", action })]);
      expect(p.observe([noChange("C")]), action).toHaveLength(1);
    }
  });

  it("🔴 a reader that cannot edit is never told to move on to editing; the other reminders still reach it", () => {
    const reader = createRepeatReminder(undefined, { readOnly: true });
    circling(reader);
    for (const f of [...FILES, ...FILES]) expect(read(reader, f)).toEqual([]);
    // Identical calls are the other detector's, and still say so.
    const same = Array.from({ length: 3 }, () => reader.observe([call("Grep", { pattern: "x" })]));
    expect(same.flat()).toHaveLength(1);
    // And a writer in the same situation is told (the control arm).
    const writer = createRepeatReminder(undefined, { readOnly: false });
    circling(writer);
    expect(rereads(writer)).toHaveLength(1);
  });
});
