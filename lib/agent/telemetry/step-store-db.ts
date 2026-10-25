// The real database behind the step store (layer 0 of Len 3.1). Kept apart from
// `step-store.ts` so the store's tests never import `lib/db` (on the development
// machine `.env.local` points at production).
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { agentRequestSteps } from "@/lib/db/schema";
import type { CallKind } from "./cache-break";
import type { StepRow, StepStoreDb } from "./step-store";

type DbRow = typeof agentRequestSteps.$inferSelect;

function fromDb(r: DbRow): StepRow {
  return {
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
  };
}

export const drizzleStepStoreDb: StepStoreDb = {
  async insert(rows) {
    await db.insert(agentRequestSteps).values(
      rows.map((r) => ({
        ...r,
        messageHashes: r.messageHashes ? [...r.messageHashes] : null,
        tools: [...r.tools],
      })),
    );
  },
  async lastWithHashes(projectId, kind) {
    const rows = await db
      .select()
      .from(agentRequestSteps)
      .where(and(eq(agentRequestSteps.projectId, projectId), eq(agentRequestSteps.kind, kind), isNotNull(agentRequestSteps.messageHashes)))
      .orderBy(desc(agentRequestSteps.createdAt), desc(agentRequestSteps.step))
      .limit(1);
    return rows[0] ? fromDb(rows[0]) : null;
  },
  async deleteOlderThan(cutoff) {
    const deleted = await db.delete(agentRequestSteps).where(lt(agentRequestSteps.createdAt, cutoff)).returning({ id: agentRequestSteps.id });
    return deleted.length;
  },
};
