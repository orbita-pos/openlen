// The runner with a made-up world: what it does and in which order, what it does when something that is not
// the answer fails, and that it never goes past its cap.
import { describe, expect, it } from "vitest";

import { RETURN_CASES } from "./cases";
import { usdOf } from "./cost";
import { Budget, BudgetStop, buildCase, estimateRunUsd, runArm, runOnce, type BuiltCase, type RunStore, type World } from "./runner";
import type { Arm, RunResult } from "./types";

const CHAT = RETURN_CASES.find((c) => c.id === "chat-pumps-40k")!;
const PAGE = RETURN_CASES.find((c) => c.id === "build-page-lamps-40k")!;
const built = (c = CHAT, tokens = 40_000): BuiltCase => ({ caseId: c.id, projectId: "p1", assistantId: c.assistant ? "a1" : null, conversation: c.assistant ? "assistant:a1" : null, tokens, turns: c.build.length, spentUsd: 0.1, builtAt: "2026-11-14T00:00:00.000Z" });

interface Script {
  /** What the route answers to each prompt; a function of the prompt. */
  answer?: (prompt: string, n: number) => { answer: string; error?: { code: string; message: string } };
  files?: Record<string, string>;
  mechanism?: { firstQuestionTrimmed: boolean; summaryPromoted: boolean; sandboxRows: number };
  summary?: { outcome: string; usage: { inputTokens: number; cachedTokens: number; outputTokens: number } | null };
  capture?: boolean;
  callsPerTurn?: { inputTokens: number; cachedTokens: number; outputTokens: number }[];
}

function world(script: Script = {}): World & { readonly log: string[]; readonly allowed: number[] } {
  const log: string[] = [];
  const allowed: number[] = [];
  let asked = 0;
  return {
    log,
    allowed,
    async createProject(c) {
      log.push(`create ${c.id}`);
      return { projectId: "p1", assistantId: c.assistant ? "a1" : null, conversation: c.assistant ? "assistant:a1" : null };
    },
    async allow(usd) {
      allowed.push(usd);
    },
    async ask(_target, prompt) {
      log.push(`ask ${prompt.slice(0, 12)}`);
      const r = script.answer?.(prompt, asked) ?? { answer: "ok" };
      asked += 1;
      return { answer: r.answer, error: r.error ?? null };
    },
    async files() {
      return script.files ?? {};
    },
    async hasCapture() {
      return script.capture ?? true;
    },
    async conversationTokens() {
      return 41_500;
    },
    async save(caseId) {
      log.push(`save ${caseId}`);
    },
    async restore(caseId) {
      log.push(`restore ${caseId}`);
    },
    async age() {
      log.push("age");
    },
    async rowIds() {
      return ["t1", "t2"];
    },
    async mark() {
      return asked;
    },
    async callsSince() {
      return (script.callsPerTurn ?? [{ inputTokens: 60_000, cachedTokens: 0, outputTokens: 400 }]).map((c, i) => ({ ...c, step: i + 1 }));
    },
    async mechanism() {
      log.push("mechanism");
      return script.mechanism ?? { firstQuestionTrimmed: false, summaryPromoted: false, sandboxRows: 0 };
    },
    async summarize() {
      log.push("summarize");
      return script.summary ?? { outcome: "saved", usage: { inputTokens: 64_000, cachedTokens: 0, outputTokens: 2_500 } };
    },
    async discard(target) {
      log.push(`discard ${target.projectId}`);
    },
  };
}

/** Answers that pass every check of the chat case. */
const rightAnswers = (prompt: string): { answer: string } => {
  const q = CHAT.questions.find((x) => x.prompt === prompt);
  if (!q) return { answer: "ok" };
  const corpus = (CHAT as unknown as { corpus: { of(c: number): { name: string; values: Record<string, number> }[]; spec: { hidden: { key: string }; attrs: { key: string }[]; categories: string[] } } }).corpus;
  if (q.kind === "early") return { answer: "Tu pozo tiene 37 metros y tu tope eran 18,400 pesos." };
  if (q.kind === "continue") {
    const last = corpus.spec.categories.length - 1;
    const top = [...corpus.of(last)].sort((a, b) => b.values[corpus.spec.attrs[0]!.key]! - a.values[corpus.spec.attrs[0]!.key]!)[0]!;
    return { answer: `La más cara era la ${top.name}, a ${top.values[corpus.spec.attrs[0]!.key]} pesos.` };
  }
  const old = corpus.of(0)[3]!;
  return { answer: `La ${old.name} tiene ${old.values[corpus.spec.hidden.key]} meses de garantía.` };
};

describe("building a case", () => {
  it("creates the project, sends every message in order, and keeps the case only at the end", async () => {
    const w = world();
    const result = await buildCase(CHAT, w, new Budget(5));
    expect(w.log[0]).toBe("create chat-pumps-40k");
    expect(w.log.filter((l) => l.startsWith("ask"))).toHaveLength(15);
    expect(w.log.at(-1)).toBe("save chat-pumps-40k");
    expect(result).toMatchObject({ caseId: "chat-pumps-40k", projectId: "p1", assistantId: "a1", conversation: "assistant:a1", tokens: 41_500, turns: 15 });
    expect(result.spentUsd).toBeCloseTo(15 * usdOf({ inputTokens: 60_000, cachedTokens: 0, outputTokens: 400 }), 9);
  });

  it("a turn the route could not answer stops the building: half a conversation is not a case", async () => {
    const w = world({ answer: (_p, n) => (n === 3 ? { answer: "", error: { code: "upstream", message: "503" } } : { answer: "ok" }) });
    await expect(buildCase(CHAT, w, new Budget(5))).rejects.toThrow(/message 4 of 15.*upstream/s);
    expect(w.log.some((l) => l.startsWith("save"))).toBe(false);
    expect(w.log.at(-1)).toBe("discard p1");
  });

  it("without the summary's job on file the server is not the building one, and it says so before keeping anything", async () => {
    const w = world({ capture: false });
    await expect(buildCase(PAGE, w, new Budget(5))).rejects.toThrow(/OPENLEN_IDLE_SUMMARY_CAPTURE_DIR/);
    expect(w.log.some((l) => l.startsWith("save"))).toBe(false);
  });
});

describe("one run", () => {
  it("today's arm: the case is put back, moved into the past, asked its three questions, and put back again", async () => {
    const w = world({ answer: rightAnswers });
    const result = await runOnce(CHAT, built(), "today", 1, w, new Budget(5));
    expect(w.log).toEqual(["restore chat-pumps-40k", "age", "ask Hola de nuev", "mechanism", "ask De la última", "ask Y una de la ", "restore chat-pumps-40k"]);
    expect(result.questions.map((q) => q.pass)).toEqual([true, true, true]);
    expect(result).toMatchObject({ caseId: "chat-pumps-40k", arm: "today", run: 1, firstCallTokens: 60_000 });
    expect(result.infra).toBeUndefined();
  });

  it("the summary arm writes the summary AFTER the case is put back and BEFORE it is moved into the past", async () => {
    const w = world({ answer: rightAnswers, mechanism: { firstQuestionTrimmed: false, summaryPromoted: true, sandboxRows: 0 } });
    const result = await runOnce(CHAT, built(), "trim_summary", 2, w, new Budget(5));
    expect(w.log.slice(0, 3)).toEqual(["restore chat-pumps-40k", "summarize", "age"]);
    expect(result.infra).toBeUndefined();
    // Its cost counts the summary as production would pay it; its spend, as it was really paid here.
    expect(result.spentUsd).toBeGreaterThan(result.costUsd - 3 * usdOf({ inputTokens: 60_000, cachedTokens: 0, outputTokens: 400 }));
  });

  it("an answer that misses a check fails that question and only that one", async () => {
    const w = world({ answer: (p) => (p.startsWith("Y una de la") ? { answer: "No lo recuerdo." } : rightAnswers(p)) });
    const result = await runOnce(CHAT, built(), "today", 1, w, new Budget(5));
    expect(result.questions.map((q) => q.pass)).toEqual([true, true, false]);
    expect(result.questions[2]!.failed[0]).toMatch(/garantía/);
  });

  it("🔴 a run where the arm's mechanism did not happen is out of the count, and stops before spending on the rest", async () => {
    const w = world({ answer: rightAnswers, mechanism: { firstQuestionTrimmed: false, summaryPromoted: false, sandboxRows: 0 } });
    const result = await runOnce(CHAT, built(), "trim", 1, w, new Budget(5));
    expect(result.infra).toMatch(/was not trimmed/);
    expect(w.log.filter((l) => l.startsWith("ask"))).toHaveLength(1);
    expect(w.log.at(-1)).toBe("restore chat-pumps-40k");
  });

  it("a turn the route could not answer is not a wrong answer: the question counts for neither side", async () => {
    const w = world({ answer: (p, n) => (n === 1 ? { answer: "", error: { code: "upstream", message: "the provider went away" } } : rightAnswers(p)) });
    const result = await runOnce(CHAT, built(), "today", 1, w, new Budget(5));
    expect(result.infra).toBeUndefined();
    expect(result.questions[1]).toMatchObject({ pass: false, infra: "upstream: the provider went away" });
    expect(result.questions[2]!.pass).toBe(true);
  });

  it("if the cold return itself could not be answered, the whole run is out", async () => {
    const w = world({ answer: (p, n) => (n === 0 ? { answer: "", error: { code: "upstream", message: "503" } } : rightAnswers(p)) });
    const result = await runOnce(CHAT, built(), "today", 1, w, new Budget(5));
    expect(result.infra).toMatch(/cold return.*upstream/);
    expect(w.log.filter((l) => l.startsWith("ask"))).toHaveLength(1);
  });

  it("a summary that was not written puts the run out, and the case is still put back", async () => {
    const w = world({ summary: { outcome: "no_summary", usage: { inputTokens: 64_000, cachedTokens: 0, outputTokens: 30 } } });
    const result = await runOnce(CHAT, built(), "trim_summary", 1, w, new Budget(5));
    expect(result.infra).toMatch(/summary was not written.*no_summary/);
    expect(result.spentUsd).toBeGreaterThan(0);
    expect(w.log).toEqual(["restore chat-pumps-40k", "summarize", "restore chat-pumps-40k"]);
  });

  it("the page case is graded on the files the turn left", async () => {
    const w = world({ answer: () => ({ answer: "Hecho. No usé morado; la tienda está en Valdivia. El proveedor es Casa Ovalle." }), files: { "/index.html": "<h1>Farol Sereno</h1><a>Pide la tuya</a> Envíos gratis desde 750 pesos" } });
    const result = await runOnce(PAGE, built(PAGE), "today", 1, w, new Budget(5));
    expect(result.questions[0]!.pass).toBe(true);
    expect(result.questions[1]!.pass).toBe(true);
  });
});

describe("the money", () => {
  it("before every turn the server is told how much is left: its balance is the cap's second lock", async () => {
    const w = world({ answer: rightAnswers });
    const budget = new Budget(1);
    await runOnce(CHAT, built(), "today", 1, w, budget);
    expect(w.allowed).toHaveLength(3);
    expect(w.allowed[0]).toBe(1);
    expect(w.allowed[1]!).toBeLessThan(1);
    expect(budget.spentUsd).toBeCloseTo(3 * usdOf({ inputTokens: 60_000, cachedTokens: 0, outputTokens: 400 }), 9);
  });

  it("a route that says the balance ran out stops everything: that is the cap, not an error of the case", async () => {
    const w = world({ answer: () => ({ answer: "", error: { code: "no_credits", message: "no credits" } }) });
    await expect(runOnce(CHAT, built(), "today", 1, w, new Budget(1))).rejects.toBeInstanceOf(BudgetStop);
    expect(w.log.at(-1)).toBe("restore chat-pumps-40k");
  });

  it("a run costs more to estimate the longer its conversation, and the summary arm more than the others", () => {
    expect(estimateRunUsd(100_000, "today")).toBeGreaterThan(estimateRunUsd(40_000, "today"));
    expect(estimateRunUsd(100_000, "trim_summary")).toBeGreaterThan(estimateRunUsd(100_000, "today"));
    // Never under what the cold return's first call alone costs with nothing cached.
    expect(estimateRunUsd(100_000, "trim")).toBeGreaterThan(usdOf({ inputTokens: 100_000, cachedTokens: 0, outputTokens: 0 }));
  });
});

describe("an arm", () => {
  const memory = (): RunStore & { readonly kept: RunResult[] } => {
    const kept: RunResult[] = [];
    return { kept, load: () => kept, append: (r) => void kept.push(r) };
  };
  const cases = [CHAT, PAGE];
  const builds = new Map([
    [CHAT.id, built(CHAT)],
    [PAGE.id, built(PAGE)],
  ]);

  it("runs every case the asked number of times and keeps each run as soon as it ends", async () => {
    const w = world();
    const store = memory();
    const ended = await runArm({ cases, builds, arm: "today", runs: 3, budget: new Budget(50), world: w, store, log: () => {} });
    expect(ended).toBe("done");
    expect(store.kept.map((r) => `${r.caseId}#${r.run}`)).toEqual(["chat-pumps-40k#1", "chat-pumps-40k#2", "chat-pumps-40k#3", "build-page-lamps-40k#1", "build-page-lamps-40k#2", "build-page-lamps-40k#3"]);
  });

  it("goes on where it stopped: a run that is already kept is not run again", async () => {
    const w = world();
    const store = memory();
    await runArm({ cases, builds, arm: "today", runs: 2, budget: new Budget(50), world: w, store, log: () => {} });
    const asksBefore = w.log.filter((l) => l.startsWith("ask")).length;
    await runArm({ cases, builds, arm: "today", runs: 3, budget: new Budget(50), world: w, store, log: () => {} });
    expect(store.kept).toHaveLength(6);
    expect(w.log.filter((l) => l.startsWith("ask")).length - asksBefore).toBe(2 * 3);
  });

  it("a run that was left out of the count is run again only when asked to", async () => {
    const w = world({ mechanism: { firstQuestionTrimmed: false, summaryPromoted: false, sandboxRows: 0 } });
    const store = memory();
    await runArm({ cases: [CHAT], builds, arm: "trim", runs: 1, budget: new Budget(50), world: w, store, log: () => {} });
    expect(store.kept).toHaveLength(1);
    expect(store.kept[0]!.infra).toBeDefined();
    await runArm({ cases: [CHAT], builds, arm: "trim", runs: 1, budget: new Budget(50), world: w, store, log: () => {} });
    expect(store.kept).toHaveLength(1);
    await runArm({ cases: [CHAT], builds, arm: "trim", runs: 1, budget: new Budget(50), world: w, store, retryInfra: true, log: () => {} });
    expect(store.kept).toHaveLength(2);
  });

  it("🔴 stops BEFORE the run that might cross the cap, and says it stopped at the cap", async () => {
    const w = world();
    const store = memory();
    const oneRun = estimateRunUsd(40_000, "today");
    const ended = await runArm({ cases, builds, arm: "today", runs: 3, budget: new Budget(oneRun * 2), world: w, store, log: () => {} });
    expect(ended).toBe("cap");
    expect(store.kept.length).toBeLessThan(6);
    expect(store.kept.reduce((s, r) => s + r.spentUsd, 0)).toBeLessThanOrEqual(oneRun * 2);
  });

  it("a case that was never built is an error before anything is spent", async () => {
    const w = world();
    await expect(runArm({ cases, builds: new Map([[CHAT.id, built(CHAT)]]), arm: "today", runs: 1, budget: new Budget(50), world: w, store: memory(), log: () => {} })).rejects.toThrow(/build-page-lamps-40k.*not built/);
    expect(w.log).toEqual([]);
  });

  it("the three arms are asked the same questions", async () => {
    const seen: Record<string, string[]> = {};
    for (const arm of ["today", "trim", "trim_summary"] as Arm[]) {
      const w = world({ mechanism: { firstQuestionTrimmed: arm === "trim", summaryPromoted: arm === "trim_summary", sandboxRows: 0 } });
      await runOnce(CHAT, built(), arm, 1, w, new Budget(5));
      seen[arm] = w.log.filter((l) => l.startsWith("ask"));
    }
    expect(seen.trim).toEqual(seen.today);
    expect(seen.trim_summary).toEqual(seen.today);
  });
});
