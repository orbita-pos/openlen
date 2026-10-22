// lib/stripe/store-pg.ts — THE STRIPE TABLES IN THE APP'S DATABASE
// (`stripeAccounts`, `stripeObjects`; spec local 2026-10-21-stripe-integration, §7).

import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { StripeStore } from "./store";

const A = schema.stripeAccounts;
const O = schema.stripeObjects;

export const pgStripeStore: StripeStore = {
  async getAccount(projectId, env) {
    const [r] = await db.select().from(A).where(and(eq(A.projectId, projectId), eq(A.environment, env))).limit(1);
    return r ?? null;
  },
  async putAccount(row) {
    const values = { ...row, checkedAt: new Date() };
    await db
      .insert(A)
      .values(values)
      .onConflictDoUpdate({
        target: [A.projectId, A.environment],
        set: { accountId: values.accountId, accountName: values.accountName, keyKind: values.keyKind, chargesEnabled: values.chargesEnabled, checkedAt: values.checkedAt },
      });
  },
  async deleteAccount(projectId, env) {
    await db.delete(A).where(and(eq(A.projectId, projectId), eq(A.environment, env)));
  },
  async listObjects(projectId) {
    return db.select().from(O).where(eq(O.projectId, projectId)).orderBy(asc(O.createdAt), asc(O.testId));
  },
  async recordTestObject(r) {
    await db
      .insert(O)
      .values({
        projectId: r.projectId,
        testId: r.testId,
        kind: r.kind,
        source: r.source,
        testUrl: r.testUrl ?? null,
        lookupKey: r.lookupKey ?? null,
        functionName: r.functionName ?? null,
        secretName: r.secretName ?? null,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [O.projectId, O.testId],
        set: {
          testUrl: sql`coalesce(excluded."testUrl", ${O.testUrl})`,
          lookupKey: sql`coalesce(excluded."lookupKey", ${O.lookupKey})`,
          functionName: sql`coalesce(excluded."functionName", ${O.functionName})`,
          secretName: sql`coalesce(excluded."secretName", ${O.secretName})`,
          source: sql`case when ${O.source} = 'cli' then 'cli' else excluded."source" end`,
        },
      });
  },
  async setTwin(projectId, testId, twin) {
    await db
      .update(O)
      .set({ liveId: twin.liveId, liveUrl: twin.liveUrl ?? null, fingerprint: twin.fingerprint, syncedAt: new Date() })
      .where(and(eq(O.projectId, projectId), eq(O.testId, testId)));
  },
  async clearTwin(projectId, testId) {
    await db
      .update(O)
      .set({ liveId: null, liveUrl: null, fingerprint: null, syncedAt: null })
      .where(and(eq(O.projectId, projectId), eq(O.testId, testId)));
  },
  async forgetTestObject(projectId, testId) {
    await db.delete(O).where(and(eq(O.projectId, projectId), eq(O.testId, testId)));
  },
};
