import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BuiltCase } from "./runner";
import { benchIdleMinTokens, keepBuild, latestRuns, loadBuilds, runStore } from "./store";
import type { RunResult } from "./types";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "return-bench-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const built = (caseId: string, tokens: number): BuiltCase => ({ caseId, projectId: `p-${caseId}`, assistantId: null, conversation: null, tokens, turns: 4, spentUsd: 0.1, builtAt: "2026-11-14T00:00:00.000Z" });
const run = (caseId: string, n: number, infra?: string): RunResult => ({ caseId, arm: "trim", run: n, questions: [], ...(infra ? { infra } : {}), costUsd: 0.01, firstCallTokens: 50_000, spentUsd: 0.01, seconds: 30 });

describe("what the bench keeps", () => {
  it("nothing is built before anything is kept", () => {
    expect(loadBuilds(dir).size).toBe(0);
    expect(runStore(dir, "trim").load()).toEqual([]);
  });

  it("a built case is found again, and building it again replaces it", () => {
    keepBuild(dir, built("a", 40_000));
    keepBuild(dir, built("b", 100_000));
    keepBuild(dir, built("a", 43_000));
    const all = loadBuilds(dir);
    expect([...all.keys()]).toEqual(["a", "b"]);
    expect(all.get("a")!.tokens).toBe(43_000);
  });

  it("each arm's runs are kept apart, one by one", () => {
    runStore(dir, "trim").append(run("a", 1));
    runStore(dir, "trim").append(run("a", 2));
    runStore(dir, "today").append({ ...run("a", 1), arm: "today" });
    expect(runStore(dir, "trim").load().map((r) => r.run)).toEqual([1, 2]);
    expect(runStore(dir, "today").load()).toHaveLength(1);
    expect(runStore(dir, "trim_summary").load()).toEqual([]);
  });

  it("a run that was left out and run again counts once, as its second go", () => {
    const runs = [run("a", 1, "the provider failed"), run("a", 2), run("a", 1)];
    const latest = latestRuns(runs);
    expect(latest).toHaveLength(2);
    expect(latest.find((r) => r.run === 1)!.infra).toBeUndefined();
  });
});

describe("from what size the bench's summary is written", () => {
  it("is the smallest threshold the measurement decides about, for every case that reaches it", () => {
    expect(benchIdleMinTokens(100_000)).toBe(40_000);
    expect(benchIdleMinTokens(220_000)).toBe(40_000);
    expect(benchIdleMinTokens(45_000)).toBe(40_000);
  });

  it("a case that came out a little short is still summarized, never skipped as too small", () => {
    expect(benchIdleMinTokens(38_000)).toBe(34_200);
    expect(benchIdleMinTokens(38_000)).toBeLessThan(38_000);
    expect(benchIdleMinTokens(0)).toBe(1);
  });
});
