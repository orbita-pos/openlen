// @vitest-environment node
// (The reviewer runs on the server: jsdom's AbortSignal has no `any`.)
import { describe, expect, it } from "vitest";

import type { Corrida } from "@/lib/agent/subagente";

import { MAX_FINDINGS_TO_FILTER, reviewWithModel, type Run } from "./model-review";
import type { RawFinding } from "./parse";
import { FILTER_SYSTEM, SCAN_SYSTEM } from "./prompt";

const uso = { inputTokens: 100, outputTokens: 10, cachedTokens: 50, thinkingTokens: 0 };
const ok = (texto: string): Corrida => ({ ok: true, texto, uso });
const raw = (category: string, severity = "HIGH", confidence = 0.9): RawFinding =>
  ({ file: "/supabase/functions/x/index.ts", line: 3, severity, category, description: `d-${category}`, exploit_scenario: "e", recommendation: "r", confidence }) as RawFinding;
const scanOf = (...fs: RawFinding[]) => ok(JSON.stringify({ findings: fs }));
const verdict = (score: number, keep = true) => ok(JSON.stringify({ confidence_score: score, keep_finding: keep }));

type Call = { system: string; messages: readonly string[]; maxTurns: number };

function scripted(scan: Corrida | ((signal: AbortSignal) => Promise<Corrida>), filters: Record<string, Corrida> = {}) {
  const calls: Call[] = [];
  const run: Run = async (o) => {
    calls.push({ system: o.system, messages: o.messages, maxTurns: o.maxTurns });
    if (o.system === SCAN_SYSTEM) return typeof scan === "function" ? scan(o.signal) : scan;
    const finding = JSON.parse(o.messages[1]!.split("```json\n")[1]!.split("\n```")[0]!) as RawFinding;
    return filters[finding.category] ?? verdict(1, false);
  };
  return { run, calls };
}
const go = (run: Run, signal = new AbortController().signal, timeouts?: { scanMs: number; totalMs: number }) =>
  reviewWithModel(run, { context: "CONTEXT", focus: "FOCUS", signal, ...(timeouts ? { timeouts } : {}) });

describe("reviewWithModel", () => {
  it("identifies, filters each finding, and keeps what scores 8 or more", async () => {
    const { run, calls } = scripted(scanOf(raw("a"), raw("b"), raw("c", "MEDIUM")), { a: verdict(9), b: verdict(5), c: verdict(8) });
    const r = await go(run);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.findings.map((f) => f.key)).toEqual(["model:a:/supabase/functions/x/index.ts", "model:c:/supabase/functions/x/index.ts"]);
    expect(r.findings[1]).toMatchObject({ source: "model", severity: "MEDIUM", description: "d-c", exploitScenario: "e", recommendation: "r", line: 3 });
    expect(r.usage).toEqual({ inputTokens: 400, outputTokens: 40, cachedTokens: 200, thinkingTokens: 0 });
    expect(calls[0]).toMatchObject({ system: SCAN_SYSTEM, messages: ["CONTEXT", "FOCUS"], maxTurns: 10 });
    expect(calls[1]).toMatchObject({ system: FILTER_SYSTEM, maxTurns: 4 });
    expect(calls[1]!.messages[0]).toBe("CONTEXT");
  });

  it("a filter that says keep_finding false is dropped even with a high score", async () => {
    const { run } = scripted(scanOf(raw("a")), { a: verdict(9, false) });
    const r = await go(run);
    expect(r.ok && r.findings).toEqual([]);
  });

  it("LOW and anything under 0.7 never reach the filter", async () => {
    const { run, calls } = scripted(scanOf(raw("low", "LOW"), raw("vague", "HIGH", 0.6)), { low: verdict(10), vague: verdict(10) });
    const r = await go(run);
    expect(r.ok && r.findings).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("filters at most 10, HIGH first and then by confidence", async () => {
    const many = [raw("m0", "MEDIUM", 0.99), ...Array.from({ length: 12 }, (_, k) => raw(`h${k}`, "HIGH", 0.7 + k / 100))];
    const { run, calls } = scripted(scanOf(...many));
    await go(run);
    const filtered = calls.slice(1).map((c) => (JSON.parse(c.messages[1]!.split("```json\n")[1]!.split("\n```")[0]!) as RawFinding).category);
    expect(filtered).toHaveLength(MAX_FINDINGS_TO_FILTER);
    expect(filtered[0]).toBe("h11");
    expect(filtered).not.toContain("m0");
  });

  it("an unreadable answer or a failed pass is a failure, never a finding", async () => {
    expect(await go(scripted(ok("No issues.")).run)).toMatchObject({ ok: false, reason: "scan: unreadable answer" });
    expect(await go(scripted({ ok: false, motivo: "fireworks_5xx", uso }).run)).toMatchObject({ ok: false, reason: "scan: fireworks_5xx" });
  });

  it("a filter that fails drops its finding and keeps the others", async () => {
    const { run } = scripted(scanOf(raw("a"), raw("b")), { a: { ok: false, motivo: "x", uso }, b: verdict(9) });
    const r = await go(run);
    expect(r.ok && r.findings.map((f) => f.category)).toEqual(["b"]);
  });

  it("the identifying pass has its own time limit", async () => {
    const hangs = (signal: AbortSignal) => new Promise<Corrida>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, motivo: "aborted", uso })));
    const r = await go(scripted(hangs).run, new AbortController().signal, { scanMs: 20, totalMs: 1_000 });
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("an abort from outside is 'aborted', not a timeout", async () => {
    const ac = new AbortController();
    const hangs = (signal: AbortSignal) => new Promise<Corrida>((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, motivo: "aborted", uso })));
    const p = go(scripted(hangs).run, ac.signal);
    ac.abort();
    expect(await p).toMatchObject({ ok: false, reason: "aborted" });
  });
});
