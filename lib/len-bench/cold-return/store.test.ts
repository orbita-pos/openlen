import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BuiltCase } from "./runner";
import { benchIdleMinTokens, builtSizeOf, keepBuild, latestRuns, loadBuilds, runStore, sizeClassK } from "./store";
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

// Seen in the full measurement's build (14/11): the app cases came out far lighter than their names say
// («…-220k» weighed 94k, «…-100k» 42k), and the report was filing them under the name.
describe("the size a case is filed under in the report", () => {
  it("is what its conversation really weighs, to the nearest ten thousand tokens", () => {
    expect(sizeClassK(34_916)).toBe(30);
    expect(sizeClassK(40_265)).toBe(40);
    expect(sizeClassK(56_268)).toBe(60);
    expect(sizeClassK(93_751)).toBe(90);
    expect(sizeClassK(4_000)).toBe(10);
  });

  it("🔴 comes from what was built, never from the label in the case's name; the label only for a case never built", () => {
    keepBuild(dir, built("build-app-looms-220k", 93_751));
    keepBuild(dir, built("build-app-printers-100k", 42_350));
    const sizeOf = builtSizeOf(loadBuilds(dir), (id) => (id.endsWith("220k") ? 220 : 100));
    expect(sizeOf("build-app-looms-220k")).toBe(90);
    expect(sizeOf("build-app-printers-100k")).toBe(40);
    expect(sizeOf("never-built-100k")).toBe(100);
  });
});

// Review, finding 3: the cap is the step's, across every time its command is run.
describe("what each step has spent", () => {
  it("is nothing before anything ran, and adds up across commands", async () => {
    const { addSpend, loadSpend } = await import("./store");
    expect(loadSpend(dir, "build")).toBe(0);
    addSpend(dir, "build", 0.12);
    addSpend(dir, "build", 0.05);
    addSpend(dir, "trim", 0.3);
    expect(loadSpend(dir, "build")).toBeCloseTo(0.17, 9);
    expect(loadSpend(dir, "trim")).toBeCloseTo(0.3, 9);
    expect(loadSpend(dir, "today")).toBe(0);
  });

  it("the summary's job of a built case is the bench's own copy, by case", async () => {
    const { jobFile } = await import("./store");
    expect(jobFile(dir, "chat-pumps-40k")).toBe(path.join(dir, "jobs", "chat-pumps-40k.json"));
  });
});
