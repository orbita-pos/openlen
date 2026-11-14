// What a run is judged by, at $0: the grade of an answer, whether the arm's mechanism really happened, what
// the run costs, and the gates of the spec's §8.5 — written before any turn is run.
import { describe, expect, it } from "vitest";

import { ARM_SPECS, mechanismProblem } from "./arms";
import { LIST_PRICE, runCost, usdOf, type CallUsage } from "./cost";
import { gates, QUALITY_MARGIN, COST_SAVING, type GateInput } from "./gates";
import { grade } from "./grade";
import type { Arm, QuestionResult, ReturnQuestion, RunResult } from "./types";

describe("the grade of an answer", () => {
  const question: ReturnQuestion = {
    kind: "continue",
    prompt: "…",
    checks: [
      { on: "answer", has: /hecho/i, why: "does not say it is done" },
      { on: "answer", lacks: /no puedo/i, why: "says it cannot" },
      { on: "file", path: "/index.html", has: /Pide la tuya/, why: "the button was not changed" },
      { on: "file", path: "/index.html", lacks: /Ver catálogo/, why: "the old button is still there" },
      { on: "files", has: /750/, why: "no file says 750" },
      { on: "files", lacks: /lorem ipsum/i, why: "filler text was left" },
    ],
  };

  it("passes when every check holds", () => {
    const result = grade(question, { answer: "Hecho, cambié la franja.", files: { "/index.html": "<a>Pide la tuya</a> desde 750", "/src/x.ts": "ok" } });
    expect(result).toEqual({ kind: "continue", pass: true, failed: [] });
  });

  it("fails with the reason of each check that did not hold", () => {
    const result = grade(question, { answer: "No puedo hacerlo.", files: { "/index.html": "<a>Ver catálogo</a> desde 600", "/notes.md": "Lorem ipsum" } });
    expect(result.pass).toBe(false);
    expect(result.failed).toEqual(["does not say it is done", "says it cannot", "the button was not changed", "the old button is still there", "no file says 750", "filler text was left"]);
  });

  // Review, finding 10: «**37** metros» is the right answer.
  it("an answer is read without its emphasis marks", () => {
    const fact: ReturnQuestion = { kind: "early", prompt: "…", checks: [{ on: "answer", has: /\b37\s*metros/i, why: "no depth" }, { on: "answer", has: /Kuntur K-417/, why: "no name" }] };
    expect(grade(fact, { answer: "Tu pozo tiene **37** metros; la `Kuntur K-417` sirve.", files: {} }).pass).toBe(true);
    expect(grade(fact, { answer: "Son __37__ metros y la *Kuntur K-417*.", files: {} }).pass).toBe(true);
    // A file is read as it is: an asterisk there is code.
    const file: ReturnQuestion = { kind: "continue", prompt: "…", checks: [{ on: "file", path: "/a.ts", has: /a \* b/, why: "no product" }] };
    expect(grade(file, { answer: "ok", files: { "/a.ts": "const c = a * b;" } }).pass).toBe(true);
  });

  it("a file that is not there has nothing in it", () => {
    const result = grade(question, { answer: "Hecho.", files: { "/other.html": "Pide la tuya 750" } });
    expect(result.failed).toEqual(["the button was not changed"]);
  });

  it("a pattern with the global flag gives the same verdict every time it is used", () => {
    const sticky: ReturnQuestion = { kind: "early", prompt: "…", checks: [{ on: "answer", has: /morado/g, why: "no colour" }] };
    for (let i = 0; i < 3; i++) expect(grade(sticky, { answer: "morado", files: {} }).pass).toBe(true);
  });
});

describe("the arms", () => {
  it("are the spec's three, and each says what its server must be started with", () => {
    expect(Object.keys(ARM_SPECS)).toEqual(["today", "trim", "trim_summary"]);
    expect(ARM_SPECS.today.server).toBe("today");
    expect(ARM_SPECS.trim.server).toBe("new");
    expect(ARM_SPECS.trim_summary.server).toBe("new");
    expect(ARM_SPECS.today.summary || ARM_SPECS.trim.summary).toBe(false);
    expect(ARM_SPECS.trim_summary.summary).toBe(true);
  });

  const seen = (over: Partial<Parameters<typeof mechanismProblem>[1]> = {}) => ({ firstQuestionTrimmed: false, summaryPromoted: false, sandboxRows: 0, ...over });

  it("today's arm sends everything again: no trim, no summary", () => {
    expect(mechanismProblem("today", seen())).toBeNull();
    expect(mechanismProblem("today", seen({ firstQuestionTrimmed: true }))).toMatch(/OPENLEN_COLD_RETURN=0/);
    expect(mechanismProblem("today", seen({ summaryPromoted: true }))).toMatch(/OPENLEN_IDLE_SUMMARY=0/);
  });

  it("the trim arm trims and starts from no summary", () => {
    expect(mechanismProblem("trim", seen({ firstQuestionTrimmed: true }))).toBeNull();
    expect(mechanismProblem("trim", seen())).toMatch(/was not trimmed/);
    expect(mechanismProblem("trim", seen({ firstQuestionTrimmed: true, summaryPromoted: true }))).toMatch(/summary/);
  });

  it("the summary arm starts from the summary, which replaces the trim", () => {
    expect(mechanismProblem("trim_summary", seen({ summaryPromoted: true }))).toBeNull();
    expect(mechanismProblem("trim_summary", seen({ firstQuestionTrimmed: true }))).toMatch(/was not promoted/);
  });

  it("🔴 a box of the real terminal is never part of a run: it costs money nobody approved", () => {
    for (const arm of ["today", "trim", "trim_summary"] as Arm[]) {
      expect(mechanismProblem(arm, seen({ firstQuestionTrimmed: arm === "trim", summaryPromoted: arm === "trim_summary", sandboxRows: 1 }))).toMatch(/OPENLEN_SANDBOX=0/);
    }
  });
});

describe("what a run costs", () => {
  const call = (question: number, step: number, inputTokens: number, cachedTokens: number, outputTokens = 500): CallUsage => ({ question, step, inputTokens, cachedTokens, outputTokens });

  it("is counted at DeepInfra's list price, per million tokens", () => {
    expect(LIST_PRICE).toEqual({ input: 0.2, cached: 0.006, output: 0.6 });
    expect(usdOf({ inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 })).toBeCloseTo(0.2, 9);
    expect(usdOf({ inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.606, 9);
  });

  it("🔴 the cold return's first call is priced as if nothing was cached, whatever the provider found warm in the bench", () => {
    // The same case was run a minute ago: the provider still had it and read 119.000 of 120.000 from its cache.
    const calls = [call(0, 1, 120_000, 119_000), call(0, 2, 121_000, 120_000), call(1, 1, 122_000, 121_500), call(2, 1, 123_000, 122_500)];
    const cost = runCost(calls);
    expect(cost.firstCallTokens).toBe(120_000);
    const asReported = calls.reduce((s, c) => s + usdOf(c), 0);
    expect(cost.spentUsd).toBeCloseTo(asReported, 9);
    expect(cost.costUsd).toBeCloseTo(asReported - usdOf(calls[0]!) + usdOf({ ...calls[0]!, cachedTokens: 0 }), 9);
    expect(cost.costUsd).toBeGreaterThan(cost.spentUsd);
  });

  it("the first call is the first step of the first question, in whatever order the rows come", () => {
    const calls = [call(1, 1, 50_000, 49_000), call(0, 2, 41_000, 40_000), call(0, 1, 40_000, 0)];
    expect(runCost(calls).firstCallTokens).toBe(40_000);
  });

  it("the summary is what it costs in production — read from the cache — while the budget counts what it really cost here", () => {
    const calls = [call(0, 1, 30_000, 0)];
    const summary = { inputTokens: 200_000, cachedTokens: 0, outputTokens: 3_000 };
    const cost = runCost(calls, summary);
    expect(cost.spentUsd).toBeCloseTo(usdOf(calls[0]!) + usdOf(summary), 9);
    expect(cost.costUsd).toBeCloseTo(usdOf(calls[0]!) + usdOf({ ...summary, cachedTokens: summary.inputTokens }), 9);
  });

  // Review, finding 8: a first attempt that failed has no usage; the call after it was priced as warm.
  it("the first call is the first the provider answered: a failed attempt before it does not take its place", () => {
    const calls = [call(0, 1, 0, 0, 0), call(0, 2, 120_000, 119_000), call(1, 1, 121_000, 120_000)];
    const cost = runCost(calls);
    expect(cost.firstCallTokens).toBe(120_000);
    expect(cost.costUsd).toBeCloseTo(usdOf({ ...calls[1]!, cachedTokens: 0 }) + usdOf(calls[2]!), 9);
  });

  it("a run with no calls recorded has no cost to speak of", () => {
    expect(runCost([])).toEqual({ costUsd: 0, spentUsd: 0, firstCallTokens: 0 });
  });
});

describe("the gates (spec §8.5)", () => {
  const q = (pass: boolean, infra?: string): QuestionResult => ({ kind: "early", pass, failed: pass ? [] : ["x"], ...(infra ? { infra } : {}) });
  /** One case's three runs under an arm: `passes[run][question]`. */
  function runs(arm: Arm, caseId: string, passes: boolean[][], costUsd: number, firstCallTokens: number): RunResult[] {
    return passes.map((p, i) => ({ caseId, arm, run: i + 1, questions: p.map((x) => q(x)), costUsd, firstCallTokens, spentUsd: costUsd, seconds: 60 }));
  }
  const ALL = [
    [true, true, true],
    [true, true, true],
    [true, true, true],
  ];
  const sizes = { a: 40, b: 100, c: 220 } as const;
  const input = (today: RunResult[], arm: RunResult[]): GateInput => ({ today, arm, sizeOf: (id) => sizes[id as keyof typeof sizes] });

  it("an arm that answers as well and costs 40 % less passes all three", () => {
    const today = [...runs("today", "a", ALL, 0.03, 120_000), ...runs("today", "b", ALL, 0.03, 120_000)];
    const arm = [...runs("trim", "a", ALL, 0.018, 60_000), ...runs("trim", "b", ALL, 0.018, 60_000)];
    const result = gates(input(today, arm));
    expect(result.quality.pass && result.perQuestion.pass && result.cost.pass).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.cost.saving).toBeCloseTo(0.4, 6);
  });

  it("quality: fails when it answers right more than 14 points less often than today", () => {
    expect(QUALITY_MARGIN).toBe(0.14);
    const today = runs("today", "a", ALL, 0.03, 120_000);
    // 7 of 9 right: 22 points down.
    const arm = runs("trim", "a", [[true, true, false], [true, true, false], [true, true, true]], 0.01, 40_000);
    const result = gates(input(today, arm));
    expect(result.quality).toMatchObject({ pass: false, today: 1 });
    expect(result.quality.arm).toBeCloseTo(7 / 9, 6);
    expect(result.pass).toBe(false);
  });

  it("question by question: one that today gets right all three times and the arm misses twice fails it, even when the whole does not move", () => {
    const fine = Array.from({ length: 6 }, (_, i) => runs("today", `ok${i}`, ALL, 0.03, 120_000)).flat();
    const today = [...fine, ...runs("today", "a", ALL, 0.03, 120_000)];
    const broken = [[true, true, false], [true, true, false], [true, true, true]];
    const arm = [...fine.map((r) => ({ ...r, arm: "trim" as const, costUsd: 0.01, firstCallTokens: 40_000 })), ...runs("trim", "a", broken, 0.01, 40_000)];
    const result = gates({ today, arm, sizeOf: () => 40 });
    expect(result.quality.pass).toBe(true);
    expect(result.perQuestion.pass).toBe(false);
    expect(result.perQuestion.broken).toEqual([{ caseId: "a", question: 2, kind: "early", todayRight: 3, armRight: 1 }]);
  });

  it("a question today itself misses once is not held against the arm", () => {
    const today = runs("today", "a", [[true, true, false], [true, true, true], [true, true, true]], 0.03, 120_000);
    const arm = runs("trim", "a", [[true, true, false], [true, true, false], [true, true, true]], 0.01, 40_000);
    expect(gates(input(today, arm)).perQuestion.pass).toBe(true);
  });

  it("cost: needs 40 % less, and the drop has to show in the first call's tokens", () => {
    expect(COST_SAVING).toBe(0.4);
    const today = runs("today", "a", ALL, 0.03, 120_000);
    expect(gates(input(today, runs("trim", "a", ALL, 0.02, 60_000))).cost.pass).toBe(false);
    // Cheaper, but the first call is as big as today's: the saving came from somewhere else.
    expect(gates(input(today, runs("trim", "a", ALL, 0.015, 120_000))).cost.pass).toBe(false);
    expect(gates(input(today, runs("trim", "a", ALL, 0.015, 60_000))).cost.pass).toBe(true);
  });

  // Review, finding 6: the mean of each case's saving lets the many small cases decide; the money is in the long ones.
  it("cost is the saving of the money as a whole: a big saving on a cheap case does not make up for none on a dear one", () => {
    const today = [...runs("today", "a", ALL, 0.01, 40_000), ...runs("today", "c", ALL, 0.06, 240_000)];
    const arm = [...runs("trim", "a", ALL, 0.002, 10_000), ...runs("trim", "c", ALL, 0.055, 220_000)];
    const cost = gates(input(today, arm)).cost;
    // $0.07 becomes $0.057: 18.6 % less, though case a alone saves 80 %.
    expect(cost.saving).toBeCloseTo(1 - 0.057 / 0.07, 6);
    expect(cost.pass).toBe(false);
    // Both other readings are given, not hidden: the mean of the cases' savings, and each size apart.
    expect(cost.meanCaseSaving).toBeCloseTo((0.8 + (1 - 0.055 / 0.06)) / 2, 6);
    expect(cost.bySize).toEqual([
      { size: 40, cases: 1, saving: expect.closeTo(0.8, 6) },
      { size: 220, cases: 1, saving: expect.closeTo(1 - 0.055 / 0.06, 6) },
    ]);
  });

  it("a case weighs by what it costs, not by how many of its runs could be counted", () => {
    const today = [...runs("today", "a", ALL, 0.01, 40_000), ...runs("today", "c", ALL, 0.06, 240_000)];
    const arm = [...runs("trim", "a", ALL, 0.002, 10_000), ...runs("trim", "c", ALL, 0.055, 220_000)];
    arm[4] = { ...arm[4]!, infra: "the provider failed" };
    arm[5] = { ...arm[5]!, infra: "the provider failed" };
    expect(gates(input(today, arm)).cost.saving).toBeCloseTo(1 - 0.057 / 0.07, 6);
  });

  it("what could not be judged counts for neither side, and is said", () => {
    const today = runs("today", "a", ALL, 0.03, 120_000);
    const arm = runs("trim", "a", ALL, 0.015, 60_000);
    arm[0] = { ...arm[0]!, infra: "the provider failed" };
    arm[1] = { ...arm[1]!, questions: [q(true), q(false, "upstream"), q(true)] };
    const result = gates(input(today, arm));
    expect(result.quality.arm).toBe(1);
    expect(result.counted.arm).toEqual({ runs: 2, questions: 5 });
    expect(result.left.arm).toEqual({ runs: 1, questions: 1 });
    // Fewer than three judged answers for a question: the question-by-question gate cannot speak for it.
    expect(result.perQuestion.unjudged.length).toBeGreaterThan(0);
  });

  it("the smallest size at which the summary breaks no question", () => {
    const today = [...runs("today", "a", ALL, 0.03, 120_000), ...runs("today", "b", ALL, 0.03, 120_000), ...runs("today", "c", ALL, 0.03, 120_000)];
    const broken = [[true, true, false], [true, true, false], [true, true, true]];
    const arm = [...runs("trim_summary", "a", broken, 0.01, 30_000), ...runs("trim_summary", "b", ALL, 0.01, 30_000), ...runs("trim_summary", "c", ALL, 0.01, 30_000)];
    expect(gates(input(today, arm)).smallestCleanSize).toBe(100);
    const allBroken = arm.map((r) => ({ ...r, questions: [q(true), q(true), q(false)] }));
    expect(gates(input(today, allBroken)).smallestCleanSize).toBeNull();
  });
});
