// lib/security-review/model-review.ts — PHASES 1 TO 3, the three steps of the
// /security-review method:
//   1. a read-only subagent identifies;
//   2. one subagent per finding filters its false positives, in parallel;
//   3. only what scores 8 or more stays, HIGH or MEDIUM.
// `run` is a read-only subagent (lib/agent/subagente.ts), wired by real.ts;
// the tests script it.

import type { Corrida, Uso } from "@/lib/agent/subagente";

import { parseFilter, parseScan, type RawFinding } from "./parse";
import { FILTER_SYSTEM, SCAN_SYSTEM, filterFindingMessage } from "./prompt";
import type { Finding } from "./types";

export type Run = (o: {
  readonly system: string;
  readonly messages: readonly string[];
  readonly maxTurns: number;
  readonly signal: AbortSignal;
}) => Promise<Corrida>;

export type ModelReviewResult =
  | { readonly ok: true; readonly findings: Finding[]; readonly usage: Uso }
  | { readonly ok: false; readonly reason: string; readonly usage: Uso };

export const SCAN_MAX_TURNS = 10;
export const FILTER_MAX_TURNS = 4;
export const MAX_FINDINGS_TO_FILTER = 10;
/** The identifying pass's scale (0..1): below 0.7 is "too speculative" to send on. */
export const SCAN_MIN_CONFIDENCE = 0.7;
/** The filter's scale (1..10): 8 or more stays. */
export const KEEP_SCORE = 8;
/** Under the agent route's 180 s silence clock: Len's publish waits for this. */
export const DEFAULT_TIMEOUTS = { scanMs: 90_000, totalMs: 150_000 } as const;

const RANK: Readonly<Record<RawFinding["severity"], number>> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function toFinding(f: RawFinding): Finding {
  return {
    // Category and file: a finding the owner accepted doesn't come back reworded.
    key: `model:${f.category}:${f.file}`,
    source: "model",
    severity: f.severity === "HIGH" ? "HIGH" : "MEDIUM",
    category: f.category,
    file: f.file,
    line: f.line,
    description: f.description,
    exploitScenario: f.exploit_scenario,
    recommendation: f.recommendation,
  };
}

export async function reviewWithModel(
  run: Run,
  o: {
    readonly context: string;
    readonly focus: string;
    readonly signal: AbortSignal;
    readonly timeouts?: { readonly scanMs: number; readonly totalMs: number };
  },
): Promise<ModelReviewResult> {
  const timeouts = o.timeouts ?? DEFAULT_TIMEOUTS;
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
  const add = (u: Uso) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cachedTokens += u.cachedTokens;
    usage.thinkingTokens += u.thinkingTokens;
  };
  const total = AbortSignal.any([o.signal, AbortSignal.timeout(timeouts.totalMs)]);
  const scanSignal = AbortSignal.any([total, AbortSignal.timeout(timeouts.scanMs)]);
  const stopped = (s: AbortSignal): string | null => (o.signal.aborted ? "aborted" : s.aborted ? "timeout" : null);

  const scan = await run({ system: SCAN_SYSTEM, messages: [o.context, o.focus], maxTurns: SCAN_MAX_TURNS, signal: scanSignal });
  add(scan.uso);
  const scanStop = stopped(scanSignal);
  if (scanStop) return { ok: false, reason: scanStop, usage };
  if (!scan.ok) return { ok: false, reason: `scan: ${scan.motivo}`, usage };
  const raw = parseScan(scan.texto);
  if (!raw) return { ok: false, reason: "scan: unreadable answer", usage };

  const candidates = raw
    .filter((f) => f.severity !== "LOW" && f.confidence >= SCAN_MIN_CONFIDENCE)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.confidence - a.confidence)
    .slice(0, MAX_FINDINGS_TO_FILTER);
  const verdicts = await Promise.all(
    candidates.map(async (f) => {
      // The shared context goes first in every subagent: it is read from cache.
      const r = await run({ system: FILTER_SYSTEM, messages: [o.context, filterFindingMessage(f)], maxTurns: FILTER_MAX_TURNS, signal: total });
      add(r.uso);
      return r.ok ? parseFilter(r.texto) : null;
    }),
  );
  const totalStop = stopped(total);
  if (totalStop) return { ok: false, reason: totalStop, usage };
  const findings = candidates
    .filter((_, k) => {
      const v = verdicts[k];
      return v != null && v.keep && v.score >= KEEP_SCORE;
    })
    .map(toFinding);
  return { ok: true, findings, usage };
}
