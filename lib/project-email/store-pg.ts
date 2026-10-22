// lib/project-email/store-pg.ts — THE PROJECT EMAIL TABLES IN THE APP'S DATABASE
// (spec local 2026-10-22-email-integration, §7). The contract is store-contract.ts.
// The suppression list is the one the broadcasts already had (`email` column).

import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { normalizeAddress, WENT_OUT, type EmailDomainRow, type EmailStore } from "./types";

const D = schema.emailDomains;
const M = schema.emailMessages;
const S = schema.emailSuppressions;
const U = schema.emailUsage;
const B = schema.emailBlocks;

function domainRow(r: typeof D.$inferSelect): EmailDomainRow {
  return { ...r, records: r.records ?? [] };
}

export const pgEmailStore: EmailStore = {
  async getDomain(projectId) {
    const [r] = await db.select().from(D).where(eq(D.projectId, projectId)).limit(1);
    return r ? domainRow(r) : null;
  },
  async domainByHost(sendingHost) {
    const [r] = await db.select().from(D).where(eq(D.sendingHost, sendingHost)).limit(1);
    return r ? domainRow(r) : null;
  },
  async putDomain(row) {
    // The UNIQUE on sendingHost refuses another project's host.
    await db
      .insert(D)
      .values({ ...row, records: [...row.records] })
      .onConflictDoUpdate({
        target: D.projectId,
        set: {
          domain: row.domain,
          sendingHost: row.sendingHost,
          showAsRoot: row.showAsRoot,
          resendDomainId: row.resendDomainId,
          records: [...row.records],
          status: row.status,
          lastCheckedAt: row.lastCheckedAt,
          verifiedAt: row.verifiedAt,
        },
      });
  },
  async setDomainStatus(projectId, status, at) {
    await db
      .update(D)
      // In raw SQL a Date would go out in local time and `timestamp` drops the offset: the ISO string,
      // cast, is UTC, as Drizzle writes these columns.
      .set({ status, lastCheckedAt: at, ...(status === "ready" ? { verifiedAt: sql`coalesce(${D.verifiedAt}, ${at.toISOString()}::timestamp)` } : {}) })
      .where(eq(D.projectId, projectId));
  },
  async deleteDomain(projectId) {
    await db.delete(D).where(eq(D.projectId, projectId));
  },
  async domainsToCheck() {
    return (await db.select().from(D).where(ne(D.status, "failed"))).map(domainRow);
  },
  async logMessage(row) {
    const id = randomUUID();
    await db.insert(M).values({ ...row, toAddress: normalizeAddress(row.toAddress), id });
    return id;
  },
  async setStatusByResendId(resendId, status, reason) {
    const [r] = await db.update(M).set({ status, reason }).where(eq(M.resendId, resendId)).returning({ projectId: M.projectId, toAddress: M.toAddress });
    return r ?? null;
  },
  async recentMessages(projectId, limit) {
    return db.select().from(M).where(eq(M.projectId, projectId)).orderBy(desc(M.createdAt)).limit(limit);
  },
  async deleteMessagesBefore(date) {
    const r = await db.delete(M).where(lt(M.createdAt, date)).returning({ id: M.id });
    return r.length;
  },
  async countSentSince(ownerId, kind, since) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(M)
      .where(and(eq(M.ownerId, ownerId), inArray(M.kind, kind === "app" ? ["app", "form"] : [kind]), inArray(M.status, [...WENT_OUT]), gte(M.createdAt, since)));
    return r?.n ?? 0;
  },
  async countMessages(f) {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(M)
      .where(
        and(
          eq(M.projectId, f.projectId),
          eq(M.kind, f.kind),
          inArray(M.status, [...WENT_OUT]),
          gte(M.createdAt, f.since),
          ...(f.toAddress === undefined ? [] : [eq(M.toAddress, normalizeAddress(f.toAddress))]),
          ...(f.tag === undefined ? [] : [eq(M.tag, f.tag)]),
        ),
      );
    return r?.n ?? 0;
  },
  async isSuppressed(projectId, address, kind) {
    const [r] = await db
      .select({ reason: S.reason })
      .from(S)
      .where(and(eq(S.projectId, projectId), eq(S.email, normalizeAddress(address))))
      .limit(1);
    if (!r) return false;
    return r.reason !== "unsubscribed" || kind !== "auth";
  },
  async suppress(projectId, address, reason) {
    const row = db.insert(S).values({ projectId, email: normalizeAddress(address), reason });
    // An unsubscribe never weakens a bounce or a complaint: those stop the sign-in emails too.
    await (reason === "unsubscribed" ? row.onConflictDoNothing({ target: [S.projectId, S.email] }) : row.onConflictDoUpdate({ target: [S.projectId, S.email], set: { reason } }));
  },
  async unsuppress(projectId, address) {
    await db.delete(S).where(and(eq(S.projectId, projectId), eq(S.email, normalizeAddress(address))));
  },
  async listSuppressions(projectId) {
    return db.select({ address: S.email, reason: S.reason, createdAt: S.createdAt }).from(S).where(eq(S.projectId, projectId)).orderBy(desc(S.createdAt));
  },
  async addUsage(ownerId, month, n) {
    const [r] = await db
      .insert(U)
      .values({ ownerId, month, sent: n })
      .onConflictDoUpdate({ target: [U.ownerId, U.month], set: { sent: sql`${U.sent} + ${n}` } })
      .returning({ sent: U.sent });
    return r?.sent ?? n;
  },
  async usage(ownerId, month) {
    const [r] = await db.select({ sent: U.sent }).from(U).where(and(eq(U.ownerId, ownerId), eq(U.month, month))).limit(1);
    return r?.sent ?? 0;
  },
  async isBlocked(projectId, ownerId) {
    const [r] = await db
      .select({ id: B.id })
      .from(B)
      .where(or(and(eq(B.scope, "project"), eq(B.id, projectId)), and(eq(B.scope, "owner"), eq(B.id, ownerId))))
      .limit(1);
    return Boolean(r);
  },
  async block(scope, id, reason) {
    await db.insert(B).values({ scope, id, reason }).onConflictDoUpdate({ target: [B.scope, B.id], set: { reason } });
  },
  async unblock(scope, id) {
    await db.delete(B).where(and(eq(B.scope, scope), eq(B.id, id)));
  },
};
