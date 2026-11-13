import { describe, expect, it } from "vitest";

import {
  PROBE_CAP_USD_DEFAULT,
  PROBE_CONTROL_MIN,
  PROBE_DELAYS_MIN,
  PROBE_PREFIX_WORDS,
  PROBE_TOKENS_PER_WORD_MAX,
  callCostUsd,
  fits,
  hitShare,
  newProbeState,
  nextAction,
  probeReport,
  probeText,
  runProbe,
  spentUsd,
  worstCaseRemainingUsd,
  type ProbeCall,
  type ProbeState,
} from "./cache-probe";

const T0 = Date.UTC(2026, 10, 14, 9, 0, 0);
const call = (atMs: number, cachedTokens: number, inputTokens = 30_000): ProbeCall => ({
  at: new Date(atMs).toISOString(),
  inputTokens,
  cachedTokens,
  outputTokens: 2,
  ms: 900,
});
/** A state where every prefix was sent once at T0 and the listed delays came back with that share cached. */
function answered(shares: Record<number, number>): ProbeState {
  const state = newProbeState("run-1", "some-model");
  for (const entry of state.entries) {
    entry.first = call(T0, 0);
    const share = shares[entry.delayMin];
    if (share !== undefined) entry.second = call(T0 + entry.delayMin * 60_000, Math.round(30_000 * share));
  }
  return state;
}

describe("the prefixes", () => {
  it("each is the same text every time it is built, and no two share their first words", () => {
    expect(probeText("run-1", 0)).toBe(probeText("run-1", 0));
    const heads = new Set(Array.from({ length: 9 }, (_, i) => probeText("run-1", i).slice(0, 40)));
    expect(heads.size).toBe(9);
    // Another run never reuses a prefix: what an earlier probe left cached would read as a hit.
    expect(probeText("run-2", 0).slice(0, 40)).not.toBe(probeText("run-1", 0).slice(0, 40));
  });

  it("has the size the spec asks for: about 30.000 tokens", () => {
    const words = probeText("run-1", 3).split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(PROBE_PREFIX_WORDS);
    expect(words).toBeLessThan(PROBE_PREFIX_WORDS + 20);
    expect(PROBE_PREFIX_WORDS * PROBE_TOKENS_PER_WORD_MAX).toBeLessThanOrEqual(31_000);
  });
});

describe("the plan", () => {
  it("is the spec's eight delays plus a control that proves the cache is written at all", () => {
    const state = newProbeState("run-1", "some-model");
    expect(state.entries.map((e) => e.delayMin)).toEqual([PROBE_CONTROL_MIN, ...PROBE_DELAYS_MIN]);
    expect(PROBE_DELAYS_MIN).toEqual([15, 30, 45, 60, 75, 90, 120, 180]);
    expect(new Set(state.entries.map((e) => e.cacheKey)).size).toBe(9);
  });

  it("the worst case of the whole probe fits under its cap before the first call", () => {
    const state = newProbeState("run-1", "some-model");
    expect(worstCaseRemainingUsd(state)).toBeLessThanOrEqual(PROBE_CAP_USD_DEFAULT);
    expect(fits(state, PROBE_CAP_USD_DEFAULT)).toBe(true);
    expect(fits(state, 0.005)).toBe(false);
  });

  it("sends every prefix once first, then each again when its own delay has passed", () => {
    const state = newProbeState("run-1", "some-model");
    expect(nextAction(state, T0)).toMatchObject({ kind: "first", entry: { id: "p0" } });
    for (const entry of state.entries) entry.first = call(T0, 0);
    expect(nextAction(state, T0 + 30_000)).toEqual({ kind: "wait", untilMs: T0 + 60_000 });
    expect(nextAction(state, T0 + 60_000)).toMatchObject({ kind: "second", entry: { delayMin: 1 } });
    state.entries[0]!.second = call(T0 + 60_000, 30_000);
    expect(nextAction(state, T0 + 61_000)).toEqual({ kind: "wait", untilMs: T0 + 15 * 60_000 });
    for (const entry of state.entries) entry.second = call(T0 + entry.delayMin * 60_000, 0);
    expect(nextAction(state, T0 + 999 * 60_000)).toEqual({ kind: "done" });
  });

  it("a prefix whose first call failed is not sent again: there is nothing cached to look for", () => {
    const state = newProbeState("run-1", "some-model");
    for (const entry of state.entries) entry.first = call(T0, 0);
    state.entries[1]!.first = { ...call(T0, 0), inputTokens: 0, error: "503" };
    for (const entry of state.entries) if (entry.id !== "p1") entry.second = call(T0 + entry.delayMin * 60_000, 0);
    expect(nextAction(state, T0 + 999 * 60_000)).toEqual({ kind: "done" });
  });
});

describe("the money", () => {
  it("a call costs its uncached input, its cached input and its output at DeepInfra's list price", () => {
    expect(callCostUsd(call(T0, 0))).toBeCloseTo(30_000 * 0.2e-6 + 2 * 0.6e-6, 9);
    expect(callCostUsd(call(T0, 30_000))).toBeCloseTo(30_000 * 0.006e-6 + 2 * 0.6e-6, 9);
  });

  it("what is left is counted as if nothing came back cached, with the size the provider reported", () => {
    const state = answered({});
    expect(spentUsd(state)).toBeCloseTo(9 * callCostUsd(call(T0, 0)), 9);
    // Nine second calls left, each as an uncached 30.000.
    expect(worstCaseRemainingUsd(state)).toBeCloseTo(9 * (30_000 * 0.2e-6 + 64 * 0.6e-6), 9);
    expect(fits(state, 0.15)).toBe(true);
    // A provider that counted the prefix three times bigger than expected: the rest no longer fits.
    for (const entry of state.entries) entry.first = call(T0, 0, 90_000);
    expect(fits(state, 0.15)).toBe(false);
  });
});

describe("the report", () => {
  it("reads how much of each prefix came back cached", () => {
    expect(hitShare(call(T0, 29_900))).toBeCloseTo(0.9967, 3);
    expect(hitShare(call(T0, 0))).toBe(0);
    expect(hitShare({ ...call(T0, 0), inputTokens: 0 })).toBe(0);
  });

  it("says until when the cache was found and from when it was gone", () => {
    const report = probeReport(answered({ 1: 1, 15: 1, 30: 1, 45: 1, 60: 0.99, 75: 0, 90: 0, 120: 0, 180: 0 }));
    expect(report.controlOk).toBe(true);
    expect(report.lastWarmMin).toBe(60);
    expect(report.firstColdMin).toBe(75);
    expect(report.complete).toBe(true);
  });

  it("a control that came back uncached means the probe says nothing about how long the cache lives", () => {
    const report = probeReport(answered({ 1: 0, 15: 0, 30: 0, 45: 0, 60: 0, 75: 0, 90: 0, 120: 0, 180: 0 }));
    expect(report.controlOk).toBe(false);
    expect(report.lastWarmMin).toBeNull();
    expect(report.lines.join("\n")).toMatch(/control/i);
  });

  it("a miss in the middle of hits is said, not smoothed over", () => {
    const report = probeReport(answered({ 1: 1, 15: 1, 30: 0, 45: 1, 60: 1, 75: 0, 90: 0, 120: 0, 180: 0 }));
    // The longest run of hits from the start ends at 15: what comes after is not a clean boundary.
    expect(report.lastWarmMin).toBe(15);
    expect(report.firstColdMin).toBe(30);
    expect(report.clean).toBe(false);
  });

  it("the delay it reports is the one that really passed, not the one planned", () => {
    const state = answered({ 1: 1 });
    state.entries[1]!.second = call(T0 + 22 * 60_000, 30_000);
    const row = probeReport(state).rows.find((r) => r.delayMin === 15)!;
    expect(row.actualMin).toBe(22);
    expect(probeReport(state).complete).toBe(false);
  });
});

describe("the run", () => {
  /** A provider whose cache lives `ttlMin` minutes, a clock that only moves when the runner sleeps. */
  function world(ttlMin: number, tokens = 30_000) {
    let clock = T0;
    const sent: string[] = [];
    const firstAt = new Map<string, number>();
    const saved: number[] = [];
    const deps = {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      save: (state: ProbeState) => {
        saved.push(state.entries.filter((e) => e.first).length + state.entries.filter((e) => e.second).length);
      },
      log: () => {},
      send: async (entry: { id: string; cacheKey: string }, text: string): Promise<ProbeCall> => {
        sent.push(`${entry.id}:${text.slice(0, 5)}`);
        const at = clock;
        clock += 4_000;
        const before = firstAt.get(entry.cacheKey);
        if (before === undefined) firstAt.set(entry.cacheKey, at);
        const warm = before !== undefined && at - before <= ttlMin * 60_000;
        return { at: new Date(at).toISOString(), inputTokens: tokens, cachedTokens: warm ? tokens - 30 : 0, outputTokens: 2, ms: 4_000 };
      },
    };
    return { deps, sent, saved, clock: () => clock };
  }

  it("makes eighteen calls in three hours, saves after each one, and finds where the cache ends", async () => {
    const w = world(65);
    const state = newProbeState("run-1", "some-model");
    expect(await runProbe(state, 0.15, w.deps)).toBe("done");
    expect(w.sent).toHaveLength(18);
    expect(w.sent.slice(0, 9).map((s) => s.split(":")[0])).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    expect(w.sent.every((s) => s.endsWith(":Probe"))).toBe(true);
    expect(w.saved).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(w.clock() - T0).toBeLessThan(181 * 60_000);
    const report = probeReport(state);
    expect(report).toMatchObject({ controlOk: true, complete: true, clean: true, lastWarmMin: 60, firstColdMin: 75 });
    expect(report.spentUsd).toBeLessThan(0.15);
  });

  it("stops before the call that might cross the cap, and says how far it got", async () => {
    // The provider counts each prefix at 60.000 tokens: after the nine first calls the rest no longer fits.
    const w = world(65, 60_000);
    const state = newProbeState("run-1", "some-model");
    expect(await runProbe(state, 0.15, w.deps)).toBe("cap");
    expect(w.sent.length).toBeLessThan(18);
    expect(spentUsd(state)).toBeLessThanOrEqual(0.15);
    expect(spentUsd(state) + worstCaseRemainingUsd(state)).toBeGreaterThan(0.15);
  });

  it("a run that was killed goes on from what it had saved, without sending a prefix a third time", async () => {
    const w = world(65);
    const state = newProbeState("run-1", "some-model");
    for (const entry of state.entries) entry.first = call(T0, 0);
    state.entries[0]!.second = call(T0 + 60_000, 29_970);
    expect(await runProbe(state, 0.15, w.deps)).toBe("done");
    expect(w.sent).toHaveLength(8);
    expect(w.sent.some((s) => s.startsWith("p0:"))).toBe(false);
  });
});
