/**
 * PRODUCTION FRICTION REPORT (Plan Ruta 98 %, P5).
 *
 * Pure aggregator over Layer 0 `StepRow[]` (`agent_request_steps`) that surfaces the
 * exact bottlenecks worth fixing next or turning into `Len-Bench` regression cases:
 * cache hit rate & break causes, reread circling rate, repeat loops, top tool errors,
 * step distribution, and the highest-friction turn IDs.
 */
import type { StepRow } from "./step-store";

export interface ProviderCacheStats {
  readonly provider: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly cacheHitPct: number;
  readonly cacheBreaks: number;
}

export interface FrictionTurnSummary {
  readonly turnId: string;
  readonly projectId: string;
  readonly steps: number;
  readonly rereads: number;
  readonly errors: number;
  readonly cacheBreaks: number;
  readonly totalInputTokens: number;
  readonly frictionScore: number;
}

export interface FrictionReport {
  readonly totalSteps: number;
  readonly totalTurns: number;
  readonly medianStepsPerTurn: number;
  readonly p90StepsPerTurn: number;
  readonly providers: readonly ProviderCacheStats[];
  readonly cacheBreakCauses: readonly { readonly cause: string; readonly count: number }[];
  readonly turnsWithReread: number;
  readonly turnsWithIdenticalRun3: number;
  readonly turnsWithAlternatingPair: number;
  readonly turnsWithToolErrors: number;
  readonly topToolErrors: readonly { readonly tool: string; readonly errorCode: string; readonly count: number }[];
  readonly highestFrictionTurns: readonly FrictionTurnSummary[];
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx]!;
}

export function buildFrictionReport(rows: readonly StepRow[], topTurnsLimit = 5): FrictionReport {
  const byProvider = new Map<string, { calls: number; input: number; cached: number; breaks: number }>();
  const breakCauses = new Map<string, number>();
  const toolErrors = new Map<string, { tool: string; errorCode: string; count: number }>();
  const byTurn = new Map<
    string,
    {
      projectId: string;
      steps: number;
      rereads: number;
      errors: number;
      cacheBreaks: number;
      hasIdentical3: boolean;
      hasPair: boolean;
      inputTokens: number;
    }
  >();

  for (const r of rows) {
    const prov = byProvider.get(r.provider) ?? { calls: 0, input: 0, cached: 0, breaks: 0 };
    prov.calls += 1;
    prov.input += r.inputTokens ?? 0;
    prov.cached += r.cachedTokens ?? 0;
    if (r.cacheBreak) {
      prov.breaks += 1;
      for (const cause of r.cacheBreak.causes) breakCauses.set(cause, (breakCauses.get(cause) ?? 0) + 1);
    }
    byProvider.set(r.provider, prov);

    const turnKey = r.subagentId ? `${r.turnId}#${r.subagentId}` : r.turnId;
    const t = byTurn.get(turnKey) ?? {
      projectId: r.projectId,
      steps: 0,
      rereads: 0,
      errors: 0,
      cacheBreaks: 0,
      hasIdentical3: false,
      hasPair: false,
      inputTokens: 0,
    };
    t.steps += 1;
    t.inputTokens += r.inputTokens ?? 0;
    if (r.cacheBreak) t.cacheBreaks += 1;
    if (r.repeats.identicalRun >= 3) t.hasIdentical3 = true;
    if (r.repeats.alternatingPair >= 2) t.hasPair = true;
    for (const tool of r.tools) {
      if (tool.reread) t.rereads += 1;
      if (!tool.ok) {
        t.errors += 1;
        const code = tool.errorCode ?? "error";
        const k = `${tool.name}::${code}`;
        const prev = toolErrors.get(k) ?? { tool: tool.name, errorCode: code, count: 0 };
        prev.count += 1;
        toolErrors.set(k, prev);
      }
    }
    byTurn.set(turnKey, t);
  }

  const providers: ProviderCacheStats[] = [...byProvider.entries()]
    .map(([provider, s]) => ({
      provider,
      calls: s.calls,
      inputTokens: s.input,
      cachedTokens: s.cached,
      cacheHitPct: s.input > 0 ? Number(((s.cached / s.input) * 100).toFixed(1)) : 0,
      cacheBreaks: s.breaks,
    }))
    .sort((a, b) => b.calls - a.calls);

  const turns = [...byTurn.entries()];
  const stepCounts = turns.map(([, t]) => t.steps).sort((a, b) => a - b);

  const highestFrictionTurns: FrictionTurnSummary[] = turns
    .map(([turnId, t]) => ({
      turnId,
      projectId: t.projectId,
      steps: t.steps,
      rereads: t.rereads,
      errors: t.errors,
      cacheBreaks: t.cacheBreaks,
      totalInputTokens: t.inputTokens,
      frictionScore: t.errors * 3 + t.rereads * 2 + t.cacheBreaks * 4 + (t.hasIdentical3 ? 5 : 0) + (t.hasPair ? 4 : 0) + Math.max(0, t.steps - 8),
    }))
    .filter((t) => t.frictionScore > 0)
    .sort((a, b) => b.frictionScore - a.frictionScore || b.steps - a.steps)
    .slice(0, topTurnsLimit);

  return {
    totalSteps: rows.length,
    totalTurns: turns.length,
    medianStepsPerTurn: percentile(stepCounts, 0.5),
    p90StepsPerTurn: percentile(stepCounts, 0.9),
    providers,
    cacheBreakCauses: [...breakCauses.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count),
    turnsWithReread: turns.filter(([, t]) => t.rereads > 0).length,
    turnsWithIdenticalRun3: turns.filter(([, t]) => t.hasIdentical3).length,
    turnsWithAlternatingPair: turns.filter(([, t]) => t.hasPair).length,
    turnsWithToolErrors: turns.filter(([, t]) => t.errors > 0).length,
    topToolErrors: [...toolErrors.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    highestFrictionTurns,
  };
}

export function formatFrictionMarkdown(r: FrictionReport): string {
  const pct = (n: number) => (r.totalTurns > 0 ? `${((n / r.totalTurns) * 100).toFixed(1)}%` : "0.0%");
  const lines: string[] = [
    `# Len Production Friction Report`,
    `- Steps: ${r.totalSteps} across ${r.totalTurns} turns (median ${r.medianStepsPerTurn} steps/turn, p90 ${r.p90StepsPerTurn})`,
    `- Turns with rereads: ${r.turnsWithReread} (${pct(r.turnsWithReread)}) | identical>=3: ${r.turnsWithIdenticalRun3} (${pct(r.turnsWithIdenticalRun3)}) | alternating pair: ${r.turnsWithAlternatingPair} (${pct(r.turnsWithAlternatingPair)}) | tool errors: ${r.turnsWithToolErrors} (${pct(r.turnsWithToolErrors)})`,
    "",
    "## Cache by Provider",
    ...r.providers.map((p) => `- ${p.provider}: ${p.calls} calls, ${p.cacheHitPct}% hit (${p.cachedTokens}/${p.inputTokens}), ${p.cacheBreaks} cache breaks`),
  ];
  if (r.cacheBreakCauses.length) {
    lines.push("", "## Cache Break Causes", ...r.cacheBreakCauses.map((c) => `- ${c.cause}: ${c.count}`));
  }
  if (r.topToolErrors.length) {
    lines.push("", "## Top Tool Errors", ...r.topToolErrors.map((e) => `- ${e.tool} [${e.errorCode}]: ${e.count}`));
  }
  if (r.highestFrictionTurns.length) {
    lines.push(
      "",
      "## Highest-Friction Turns (Len-Bench candidates)",
      ...r.highestFrictionTurns.map(
        (t) => `- turn=${t.turnId} proj=${t.projectId} score=${t.frictionScore} (steps=${t.steps}, errors=${t.errors}, rereads=${t.rereads}, breaks=${t.cacheBreaks})`,
      ),
    );
  }
  return lines.join("\n");
}
