import { describe, expect, it } from "vitest";
import { buildFrictionReport, formatFrictionMarkdown } from "./friction-report";
import type { StepRow } from "./step-store";

function row(over: Partial<StepRow> = {}): StepRow {
  return {
    id: "s1",
    projectId: "p1",
    turnId: "t1",
    step: 1,
    kind: "loop",
    provider: "deepinfra",
    model: "deepseek-v4p1-flash-1017",
    effort: "high",
    startedAt: new Date("2026-11-18T00:00:00Z"),
    durationMs: 1200,
    firstByteMs: 300,
    longestGapMs: 400,
    inputTokens: 10000,
    cachedTokens: 9500,
    outputTokens: 200,
    reasoningTokens: 100,
    systemHash: "sys",
    toolsHash: "tools",
    prefixHash: "pref",
    messageCount: 5,
    turnFirstMessageCount: 3,
    messageHashes: null,
    tools: [],
    repeats: { identicalRun: 0, alternatingPair: 0 },
    cacheBreak: null,
    endReason: null,
    subagentId: null,
    ...over,
  };
}

describe("production friction report (Plan Ruta 98 %, P5)", () => {
  it("aggregates cache hit rate, breaks, rereads, top errors and highest-friction turns", () => {
    const rows: StepRow[] = [
      row({ id: "1", turnId: "t1", step: 1, inputTokens: 10000, cachedTokens: 9000 }),
      row({
        id: "2",
        turnId: "t1",
        step: 2,
        inputTokens: 12000,
        cachedTokens: 1000,
        cacheBreak: { causes: ["messages_rewritten"], prevCached: 9000, cached: 1000, firstChangedIndex: 2 },
        tools: [
          { name: "Read", argsHash: "a", ok: true, reread: true },
          { name: "Edit", argsHash: "b", ok: false, errorCode: "not_read" },
        ],
        repeats: { identicalRun: 3, alternatingPair: 0 },
      }),
      row({ id: "3", turnId: "t2", step: 1, inputTokens: 8000, cachedTokens: 7800, tools: [{ name: "Write", argsHash: "c", ok: true }] }),
    ];

    const report = buildFrictionReport(rows);
    expect(report.totalSteps).toBe(3);
    expect(report.totalTurns).toBe(2);
    expect(report.providers).toEqual([
      { provider: "deepinfra", calls: 3, inputTokens: 30000, cachedTokens: 17800, cacheHitPct: 59.3, cacheBreaks: 1 },
    ]);
    expect(report.cacheBreakCauses).toEqual([{ cause: "messages_rewritten", count: 1 }]);
    expect(report.turnsWithReread).toBe(1);
    expect(report.turnsWithIdenticalRun3).toBe(1);
    expect(report.turnsWithToolErrors).toBe(1);
    expect(report.topToolErrors).toEqual([{ tool: "Edit", errorCode: "not_read", count: 1 }]);
    expect(report.highestFrictionTurns[0]).toMatchObject({ turnId: "t1", errors: 1, rereads: 1, cacheBreaks: 1 });

    const md = formatFrictionMarkdown(report);
    expect(md).toContain("deepinfra: 3 calls, 59.3% hit");
    expect(md).toContain("Edit [not_read]: 1");
    expect(md).toContain("turn=t1");
  });
});
