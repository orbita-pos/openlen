// lib/security-review/store-pg.ts — the security reviews in Postgres. Each write
// is ONE statement; the conditions (only a running review finishes, Len is
// shown a review once, the first acceptance of a key stays) live in its WHERE
// or its ON CONFLICT, so two requests at once can't both win.

import "server-only";

import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { SecurityReviewStore } from "./store";
import type { ReviewRecord } from "./types";

const T = schema.securityReviews;
const A = schema.securityAcceptances;

function toRecord(r: typeof T.$inferSelect): ReviewRecord {
  return {
    projectId: r.projectId,
    fingerprint: r.fingerprint,
    status: r.status,
    phase0: r.phase0,
    findings: r.findings,
    fileHashes: r.fileHashes,
    costCentiCredits: r.costCentiCredits,
    failReason: r.failReason,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    shownToAgentAt: r.shownToAgentAt,
    acceptedBy: r.acceptedBy,
    acceptedAt: r.acceptedAt,
  };
}

const one = (projectId: string, fingerprint: string) => and(eq(T.projectId, projectId), eq(T.fingerprint, fingerprint));

export const pgSecurityReviewStore: SecurityReviewStore = {
  async get(projectId, fingerprint) {
    const [r] = await db.select().from(T).where(one(projectId, fingerprint)).limit(1);
    return r ? toRecord(r) : null;
  },
  async insert(r) {
    const out = await db
      .insert(T)
      .values({ projectId: r.projectId, fingerprint: r.fingerprint, status: r.status, phase0: [...r.phase0], fileHashes: { ...r.fileHashes }, startedAt: r.startedAt })
      .onConflictDoNothing()
      .returning({ fingerprint: T.fingerprint });
    return out.length > 0;
  },
  async finish(projectId, fingerprint, f) {
    await db
      .update(T)
      .set({ status: f.status, findings: [...f.findings], costCentiCredits: sql`${T.costCentiCredits} + ${f.costCentiCredits}`, failReason: f.failReason, finishedAt: f.finishedAt })
      .where(and(one(projectId, fingerprint), eq(T.status, "running")));
  },
  async restart(projectId, fingerprint, at) {
    const out = await db
      .update(T)
      .set({ status: "running", findings: [], failReason: null, finishedAt: null, startedAt: at })
      .where(and(one(projectId, fingerprint), inArray(T.status, ["failed", "skipped_budget"])))
      .returning({ fingerprint: T.fingerprint });
    return out.length > 0;
  },
  async latestDone(projectId) {
    const [r] = await db.select().from(T).where(and(eq(T.projectId, projectId), eq(T.status, "done"))).orderBy(desc(T.startedAt)).limit(1);
    return r ? toRecord(r) : null;
  },
  async usageBetween(projectId, from, to) {
    const [r] = await db
      .select({
        runs: sql<number>`count(*) filter (where ${T.projectId} = ${projectId} and ${T.status} in ('running', 'done', 'failed'))::int`,
        spent: sql<number>`coalesce(sum(${T.costCentiCredits}), 0)::int`,
      })
      .from(T)
      .where(and(gte(T.startedAt, from), lt(T.startedAt, to)));
    return { projectModelRuns: Number(r?.runs ?? 0), spentCentiCredits: Number(r?.spent ?? 0) };
  },
  async claimShownToAgent(projectId, fingerprint, at) {
    const out = await db.update(T).set({ shownToAgentAt: at }).where(and(one(projectId, fingerprint), isNull(T.shownToAgentAt))).returning({ fingerprint: T.fingerprint });
    return out.length > 0;
  },
  async accept(projectId, fingerprint, userId, findings, at) {
    await db.update(T).set({ acceptedBy: userId, acceptedAt: at }).where(one(projectId, fingerprint));
    if (findings.length === 0) return;
    await db
      .insert(A)
      .values(findings.map((f) => ({ projectId, key: f.key, finding: f, acceptedBy: userId, acceptedAt: at })))
      .onConflictDoNothing();
  },
  async acceptedFindings(projectId) {
    const rows = await db.select({ key: A.key, finding: A.finding }).from(A).where(eq(A.projectId, projectId));
    return new Map(rows.map((r) => [r.key, r.finding]));
  },
};
