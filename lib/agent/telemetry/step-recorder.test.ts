import { describe, expect, it } from "vitest";
import type { BrainCall } from "@/lib/agent/brain";
import type { WireBody } from "@/lib/ai/fireworks-stream-client";
import type { CallSnapshot } from "./cache-break";
import { fingerprintWire } from "./request-fingerprint";
import { createStepRecorder } from "./step-recorder";
import type { StepRow, StepStore } from "./step-store";

const T0 = Date.UTC(2026, 9, 23, 22, 4, 52);
const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

function wire(msgs: string[], tools = true): WireBody {
  return {
    model: MODEL,
    messages: [{ role: "system", content: "S" }, ...msgs.map((c) => ({ role: "user", content: c }))],
    ...(tools ? { tools: [{ type: "function", function: { name: "Read" } }] } : {}),
  };
}
function call(msgs: string[], cached: number, o: Partial<BrainCall> = {}): BrainCall {
  return {
    kind: "loop", provider: "deepinfra", model: MODEL, effort: "high", startedAt: T0, durationMs: 1000,
    usage: { inputTokens: cached + 2000, cachedTokens: cached, outputTokens: 10, thinkingTokens: 0 },
    stop: "end_turn", wire: wire(msgs), ...o,
  };
}
/** Keeps the latest copy of each row, like the upsert by id. */
function fakeStore(baseline: CallSnapshot | null | "never" = null) {
  const rows: StepRow[] = [];
  let loads = 0;
  const store: StepStore = {
    write: async (r) => {
      for (const x of r) {
        const i = rows.findIndex((y) => y.id === x.id);
        if (i === -1) rows.push(x);
        else rows[i] = x;
      }
    },
    loadBaseline: async () => {
      loads++;
      if (baseline === "never") return new Promise<CallSnapshot | null>(() => {});
      return baseline;
    },
  };
  return { store, rows, loads: () => loads };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createStepRecorder", () => {
  it("graciasa: the first call after the testimonials turn writes a messages_rewritten row and the log line", async () => {
    const prevWire = wire(["a", "b", "c", "d", "e"]);
    const baseline: CallSnapshot = {
      turnId: "T", step: 24, kind: "loop", provider: "deepinfra", model: MODEL, effort: "high",
      endedAt: T0 - 30_000, cachedTokens: 221_952, turnFirstMessageCount: 3, fingerprint: fingerprintWire(prevWire),
    };
    const { store, rows } = fakeStore(baseline);
    const logs: string[] = [];
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: true, store, log: (l) => logs.push(l) });
    await flush();
    rec.onCall(call(["a", "b", "c", "X", "e", "f"], 192_256));
    rec.finish({ endReason: "completed" });
    await flush();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cacheBreak).toMatchObject({ causes: ["messages_rewritten"], firstChangedIndex: 3 });
    expect(rows[0]!.endReason).toBe("completed");
    expect(logs[0]).toBe("[cache-break] proj=P turn=U step=0 kind=loop causes=messages_rewritten@first=3 cached 221952→192256 provider=deepinfra");
  });

  it("hasHistory false: no baseline is loaded and the first call never breaks", async () => {
    const f = fakeStore(null);
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: () => {} });
    rec.onCall(call(["a"], 0));
    rec.finish({ endReason: "completed" });
    await flush();
    expect(f.loads()).toBe(0);
    expect(f.rows[0]!.cacheBreak).toBeNull();
  });

  it("a store that never answers does not hold anything back: finish writes synchronously", () => {
    const f = fakeStore("never");
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: true, store: f.store, log: () => {} });
    rec.onCall(call(["a"], 0));
    rec.finish({ endReason: "completed" });
    expect(f.rows).toHaveLength(1);
  });

  it("80 calls: only the last loop call and broken calls carry messageHashes", async () => {
    const f = fakeStore(null);
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: () => {} });
    const msgs: string[] = [];
    for (let i = 0; i < 80; i++) {
      msgs.push(`m${i}`);
      rec.onCall(call([...msgs], i === 40 ? 0 : 1000 * (i + 1) + 50_000));
    }
    rec.finish({ endReason: "completed" });
    await flush();
    expect(f.rows).toHaveLength(80);
    const withHashes = f.rows.filter((r) => r.messageHashes !== null).map((r) => r.step);
    expect(withHashes).toEqual([40, 79]);
    expect(f.rows[40]!.cacheBreak).not.toBeNull();
  });

  it("two recorders on the same project interleaved: no throw, each writes its own turnId", async () => {
    const f = fakeStore(null);
    const a = createStepRecorder({ projectId: "P", turnId: "A", hasHistory: true, store: f.store, log: () => {} });
    const b = createStepRecorder({ projectId: "P", turnId: "B", hasHistory: true, store: f.store, log: () => {} });
    a.onCall(call(["a"], 1000));
    b.onCall(call(["x"], 1000));
    a.onCall(call(["a", "b"], 1500));
    b.finish({ endReason: "completed" });
    a.finish({ endReason: "completed" });
    await flush();
    expect(f.rows.filter((r) => r.turnId === "A")).toHaveLength(2);
    expect(f.rows.filter((r) => r.turnId === "B")).toHaveLength(1);
  });

  it("tool outcomes attach to the call that requested them; repeats are computed across batches", async () => {
    const f = fakeStore(null);
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: () => {} });
    const R = { name: "render_artifact", argsHash: "r", ok: true };
    const I = { name: "inspect_artifact", argsHash: "i", ok: true };
    for (let i = 0; i < 4; i++) {
      rec.onCall(call(["a"], 1000));
      rec.onStepTools([R]);
      rec.onCall(call(["a"], 1000));
      rec.onStepTools([I]);
    }
    rec.finish({ endReason: "completed" });
    await flush();
    expect(f.rows[0]!.tools).toEqual([R]);
    expect(f.rows.at(-1)!.repeats).toEqual({ identicalRun: 1, alternatingPair: 4 });
  });

  it("a compaction between two calls adds the compaction cause", async () => {
    const f = fakeStore(null);
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: () => {} });
    rec.onCall(call(["a", "b", "c"], 200_000));
    rec.onCompaction();
    rec.onCall(call(["a", "SUMMARY"], 5_000));
    rec.finish({ endReason: "completed" });
    await flush();
    expect(f.rows[1]!.cacheBreak?.causes).toContain("compaction");
  });

  it("a failed attempt gets its row but neither becomes the comparison nor keeps the hashes", async () => {
    const f = fakeStore(null);
    const logs: string[] = [];
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: (l) => logs.push(l) });
    rec.onCall(call(["a"], 200_000));
    rec.onCall(call(["a", "b"], 0, { provider: "fireworks", usage: null, stop: "error" }));
    rec.onCall(call(["a", "b"], 199_000));
    rec.onCall(call(["a", "b", "c"], 0, { usage: null, stop: "error" }));
    rec.finish({ endReason: "provider_error" });
    await flush();
    expect(f.rows).toHaveLength(4);
    expect(f.rows.map((r) => r.cacheBreak)).toEqual([null, null, null, null]);
    expect(f.rows.map((r) => r.messageHashes !== null)).toEqual([false, false, true, false]);
    expect(f.rows[3]!.endReason).toBe("provider_error");
    expect(logs).toEqual([]);
  });

  it("closeOut is compared only with closeOut, and both kinds keep hashes on their last call", async () => {
    const f = fakeStore(null);
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: () => {} });
    rec.onCall(call(["a"], 200_000));
    rec.onCall(call(["a"], 0, { kind: "closeOut", wire: wire(["a"], false) }));
    rec.finish({ endReason: "budget_limit" });
    await flush();
    expect(f.rows.map((r) => [r.kind, r.cacheBreak, r.messageHashes !== null])).toEqual([["loop", null, true], ["closeOut", null, true]]);
  });
});

// Layer 0, the signals Claude Code keeps and Len did not: the time to the first event and the longest stall of
// each call (raw), and a Read that repeats one already done in the turn with no write to that file since
// (`tengu_file_read_reread`). The path never leaves: only its hash.
describe("createStepRecorder: first byte, stalls and rereads", () => {
  it("each row carries the call's time to first event and longest gap", async () => {
    const { store, rows } = fakeStore();
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store, log: () => {} });
    rec.onCall(call(["a"], 0, { firstEventMs: 820, longestGapMs: 4_100 }));
    rec.finish({ endReason: "completed" });
    await rec.flush();
    expect(rows[0]).toMatchObject({ firstByteMs: 820, longestGapMs: 4_100 });
  });

  it("a Read repeated with no write to that file since is a reread; after an Edit of it, it is not", async () => {
    const { store, rows } = fakeStore();
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store, log: () => {} });
    const read = { name: "Read", argsHash: "r1", pathHash: "p1", ok: true };
    for (const batch of [[read], [read], [{ name: "Edit", argsHash: "e1", pathHash: "p1", ok: true }], [read]]) {
      rec.onCall(call(["a"], 0));
      rec.onStepTools(batch);
    }
    rec.finish({ endReason: "completed" });
    await rec.flush();
    expect(rows.map((r) => r.tools[0]!.reread ?? false)).toEqual([false, true, false, false]);
  });
});

// Rows as they happen, like Claude Code's per-call telemetry and DeepSeek's durable log: a deploy that kills the
// turn before its end leaves the calls it already made, and the next turn still finds its baseline.
describe("createStepRecorder: rows as the turn goes", () => {
  it("a turn killed after two calls leaves both rows with their tools, the second one with the hashes", async () => {
    const f = fakeStore(null);
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store: f.store, log: () => {} });
    const read = { name: "Read", argsHash: "r1", ok: true };
    rec.onCall(call(["a"], 1000));
    rec.onStepTools([read]);
    rec.onCall(call(["a", "b"], 1500));
    rec.onStepTools([read, read]);
    await rec.flush();
    expect(f.rows.map((r) => [r.step, r.tools.length, r.messageHashes !== null, r.endReason])).toEqual([
      [0, 1, false, null],
      [1, 2, true, null],
    ]);
  });

  it("the store sees each change when it happens: the call's row, then the same row with its tools", async () => {
    const writes: string[][] = [];
    const store: StepStore = {
      write: async (rows) => {
        writes.push(rows.map((r) => `${r.step}:${r.tools.length}:${r.messageHashes ? "h" : "-"}:${r.endReason ?? ""}`));
      },
      loadBaseline: async () => null,
    };
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store, log: () => {} });
    rec.onCall(call(["a"], 1000));
    await rec.flush();
    rec.onStepTools([{ name: "Read", argsHash: "r1", ok: true }]);
    await rec.flush();
    rec.onCall(call(["a", "b"], 1500));
    await rec.flush();
    rec.finish({ endReason: "completed" });
    await rec.flush();
    // The second call takes the hashes from the first, which is rewritten without them; unchanged rows are not resent.
    expect(writes).toEqual([["0:0:h:"], ["0:1:h:"], ["0:1:-:", "1:0:h:"], ["1:0:h:completed"]]);
  });

  it("one write at a time: what changes while a write is out goes in the next, so an older copy never lands last", async () => {
    const writes: StepRow[][] = [];
    const answers: (() => void)[] = [];
    const store: StepStore = {
      write: (rows) => {
        writes.push([...rows]);
        return new Promise<void>((r) => answers.push(r));
      },
      loadBaseline: async () => null,
    };
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store, log: () => {} });
    rec.onCall(call(["a"], 1000));
    rec.onStepTools([{ name: "Read", argsHash: "r1", ok: true }]);
    rec.onCall(call(["a", "b"], 1500));
    rec.finish({ endReason: "completed" });
    expect(writes).toHaveLength(1);
    let flushed = false;
    const flushing = rec.flush().then(() => (flushed = true));
    answers.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toHaveLength(2);
    expect(writes[1]!.map((r) => [r.step, r.tools.length, r.messageHashes !== null, r.endReason])).toEqual([
      [0, 1, false, null],
      [1, 0, true, "completed"],
    ]);
    expect(flushed).toBe(false);
    answers.shift()!();
    await flushing;
    expect(writes).toHaveLength(2);
  });

  it("a store that throws or rejects never reaches the turn, and the next write still goes", async () => {
    let n = 0;
    const store: StepStore = {
      write: (rows) => {
        n++;
        if (n === 1) throw new Error("sync boom");
        if (n === 2) return Promise.reject(new Error("async boom"));
        return Promise.resolve(void rows);
      },
      loadBaseline: async () => null,
    };
    const rec = createStepRecorder({ projectId: "P", turnId: "U", hasHistory: false, store, log: () => {} });
    expect(() => rec.onCall(call(["a"], 1000))).not.toThrow();
    await rec.flush();
    expect(() => rec.onStepTools([{ name: "Read", argsHash: "r1", ok: true }])).not.toThrow();
    await rec.flush();
    rec.finish({ endReason: "completed" });
    await rec.flush();
    expect(n).toBe(3);
  });
});
