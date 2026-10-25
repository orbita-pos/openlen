import { afterEach, describe, expect, it, vi } from "vitest";
import { STEP_RETENTION_MS, createStepStore, type StepRow, type StepStoreDb } from "./step-store";

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 24 * 60 * 60_000;

function row(o: Partial<StepRow> = {}): StepRow {
  return {
    id: "r1", projectId: "P", turnId: "T", step: 0, kind: "loop", provider: "deepinfra",
    model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", effort: "high", startedAt: new Date(T0), durationMs: 1200, firstByteMs: 300, longestGapMs: 900,
    inputTokens: 1000, cachedTokens: 900, outputTokens: 10, reasoningTokens: 5,
    systemHash: "s", toolsHash: "t", prefixHash: "p", messageCount: 3, turnFirstMessageCount: 3,
    messageHashes: ["a", "b", "c"], tools: [], repeats: { identicalRun: 0, alternatingPair: 0 }, cacheBreak: null, endReason: null,
    ...o,
  };
}

function fakeDb(over: Partial<StepStoreDb> = {}) {
  const inserted: StepRow[] = [];
  const cutoffs: Date[] = [];
  const db: StepStoreDb = {
    insert: async (rows) => { inserted.push(...rows); },
    lastWithHashes: async () => null,
    deleteOlderThan: async (cutoff) => { cutoffs.push(cutoff); return 0; },
    ...over,
  };
  return { db, inserted, cutoffs };
}

afterEach(() => vi.useRealTimers());

describe("createStepStore", () => {
  it("write never throws when the db rejects, and logs once", async () => {
    const logs: string[] = [];
    const { db } = fakeDb({ insert: async () => { throw new Error("db down"); } });
    const store = createStepStore(db, { now: () => T0, log: (l) => logs.push(l) });
    expect(() => store.write([row()])).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("db down");
  });

  it("prunes rows older than 90 days at most once per 24 h", async () => {
    let now = T0;
    const { db, cutoffs } = fakeDb();
    const store = createStepStore(db, { now: () => now });
    store.write([row()]);
    now = T0 + 60 * 60_000;
    store.write([row()]);
    now = T0 + 25 * 60 * 60_000;
    store.write([row()]);
    await new Promise((r) => setTimeout(r, 0));
    expect(STEP_RETENTION_MS).toBe(90 * DAY);
    expect(cutoffs.map((d) => d.getTime())).toEqual([T0 - 90 * DAY, T0 + 25 * 60 * 60_000 - 90 * DAY]);
  });

  it("loadBaseline gives up after 1500 ms and returns null", async () => {
    vi.useFakeTimers();
    const { db } = fakeDb({ lastWithHashes: () => new Promise<StepRow | null>(() => {}) });
    const store = createStepStore(db, { now: () => T0 });
    const pending = store.loadBaseline("P", "loop");
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toBeNull();
  });

  it("loadBaseline maps a row to a CallSnapshot", async () => {
    const { db } = fakeDb({ lastWithHashes: async () => row({ turnId: "T9", step: 4 }) });
    const store = createStepStore(db, { now: () => T0 });
    await expect(store.loadBaseline("P", "loop")).resolves.toEqual({
      turnId: "T9", step: 4, kind: "loop", provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", effort: "high",
      endedAt: T0 + 1200, cachedTokens: 900, turnFirstMessageCount: 3,
      fingerprint: { systemHash: "s", toolsHash: "t", messageHashes: ["a", "b", "c"], prefixHash: "p", messageCount: 3 },
    });
  });

  it("loadBaseline returns null when the db fails", async () => {
    const { db } = fakeDb({ lastWithHashes: async () => { throw new Error("x"); } });
    await expect(createStepStore(db).loadBaseline("P", "loop")).resolves.toBeNull();
  });
});
