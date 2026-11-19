/**
 * Read-only CLI: summarizes Len's production friction from `agent_request_steps`
 * so the highest-friction turns become `Len-Bench` cases (Plan Ruta 98 %, P5).
 *
 *   npm run measure:friction -- --days=7
 *   npm run measure:friction -- --days=14 --json
 */
import { desc, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentRequestSteps } from "@/lib/db/schema";
import type { CallKind } from "@/lib/agent/telemetry/cache-break";
import { buildFrictionReport, formatFrictionMarkdown } from "@/lib/agent/telemetry/friction-report";
import type { StepRow } from "@/lib/agent/telemetry/step-store";

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x === name || x.startsWith(`${name}=`));
  return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : a ? "" : undefined;
}

async function main() {
  const days = Math.max(1, Math.min(90, Number(arg("--days") ?? "7") || 7));
  const limit = Math.max(100, Math.min(50_000, Number(arg("--limit") ?? "10000") || 10_000));
  const since = new Date(Date.now() - days * 86_400_000);

  const raw = await db
    .select()
    .from(agentRequestSteps)
    .where(gte(agentRequestSteps.startedAt, since))
    .orderBy(desc(agentRequestSteps.startedAt))
    .limit(limit);

  const rows: StepRow[] = raw.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    turnId: r.turnId,
    step: r.step,
    kind: r.kind as CallKind,
    provider: r.provider,
    model: r.model,
    effort: r.effort,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    firstByteMs: r.firstByteMs,
    longestGapMs: r.longestGapMs,
    inputTokens: r.inputTokens,
    cachedTokens: r.cachedTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    systemHash: r.systemHash,
    toolsHash: r.toolsHash,
    prefixHash: r.prefixHash,
    messageCount: r.messageCount,
    turnFirstMessageCount: r.turnFirstMessageCount,
    messageHashes: (r.messageHashes as string[] | null) ?? null,
    tools: (r.tools as StepRow["tools"] | null) ?? [],
    repeats: (r.repeats as StepRow["repeats"] | null) ?? { identicalRun: 0, alternatingPair: 0 },
    cacheBreak: (r.cacheBreak as StepRow["cacheBreak"]) ?? null,
    endReason: r.endReason,
    subagentId: r.subagentId,
  }));

  const report = buildFrictionReport(rows, 10);
  if (arg("--json") !== undefined) {
    console.log(JSON.stringify({ days, ...report }, null, 2));
  } else {
    console.log(`Window: last ${days} day(s) (max ${limit} rows)\n`);
    console.log(formatFrictionMarkdown(report));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
