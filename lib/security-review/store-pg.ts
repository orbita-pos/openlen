// lib/security-review/store-pg.ts — the security reviews in Postgres. Each write
// is ONE statement; the conditions (only a running review finishes, Len is
// shown a review once, the first acceptance of a key stays) live in its WHERE
// or its ON CONFLICT, so two requests at once can't both win.

import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { SecurityReviewStore } from "./store";

const T = schema.securityReviews;
const A = schema.securityAcceptances;

// Every column but `baseFiles`: the copy of a published version can be big, and only latestPublished reads it.
const RECORD = {
  projectId: T.projectId,
  fingerprint: T.fingerprint,
  status: T.status,
  phase0: T.phase0,
  findings: T.findings,
  fileHashes: T.fileHashes,
  costCentiCredits: T.costCentiCredits,
  failReason: T.failReason,
  startedAt: T.startedAt,
  finishedAt: T.finishedAt,
  shownToAgentAt: T.shownToAgentAt,
  acceptedBy: T.acceptedBy,
  acceptedAt: T.acceptedAt,
  publishedAt: T.publishedAt,
};


const one = (projectId: string, fingerprint: string) => and(eq(T.projectId, projectId), eq(T.fingerprint, fingerprint));

export const pgSecurityReviewStore: SecurityReviewStore = {
  async get(projectId, fingerprint) {
    const [r] = await db.select(RECORD).from(T).where(one(projectId, fingerprint)).limit(1);
    return r ?? null;
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
      .where(and(one(projectId, fingerprint), inArray(T.status, ["failed", "skipped_budget", "skipped_scope"])))
      .returning({ fingerprint: T.fingerprint });
    return out.length > 0;
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
  async markPublished(projectId, fingerprint, files, at) {
    const set = await db
      .update(T)
      .set({ publishedAt: at, baseFiles: { ...files } })
      .where(and(one(projectId, fingerprint), eq(T.status, "done")))
      .returning({ fingerprint: T.fingerprint });
    if (set.length === 0) return;
    // Only the newest copy is a base: the older ones are dropped.
    await db
      .update(T)
      .set({ baseFiles: null })
      .where(and(eq(T.projectId, projectId), ne(T.fingerprint, fingerprint), isNotNull(T.baseFiles)));
  },
  async latestPublished(projectId) {
    const [r] = await db
      .select({ fingerprint: T.fingerprint, files: T.baseFiles })
      .from(T)
      .where(and(eq(T.projectId, projectId), isNotNull(T.baseFiles)))
      .orderBy(desc(T.publishedAt))
      .limit(1);
    return r?.files ? { fingerprint: r.fingerprint, files: r.files } : null;
  },
};
