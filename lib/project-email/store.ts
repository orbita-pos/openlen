// lib/project-email/store.ts — the EmailStore in memory, for the tests of
// everything above it. The contract both implementations keep is
// store-contract.ts; the Postgres one is store-pg.ts.

import { randomUUID } from "node:crypto";

import { normalizeAddress, WENT_OUT, type EmailDomainRow, type EmailMessageRow, type EmailStore, type SuppressionReason } from "./types";

export type { EmailStore } from "./types";

export function memoryEmailStore(now: () => Date = () => new Date()): EmailStore {
  const domains = new Map<string, EmailDomainRow>();
  const messages: EmailMessageRow[] = [];
  const suppressions = new Map<string, { address: string; reason: SuppressionReason; createdAt: Date }>();
  const usage = new Map<string, number>();
  const blocks = new Set<string>();
  const sKey = (projectId: string, address: string) => `${projectId}|${normalizeAddress(address)}`;

  return {
    async getDomain(projectId) {
      return domains.get(projectId) ?? null;
    },
    async domainByHost(sendingHost) {
      return [...domains.values()].find((d) => d.sendingHost === sendingHost) ?? null;
    },
    async putDomain(row) {
      const other = [...domains.values()].find((d) => d.sendingHost === row.sendingHost && d.projectId !== row.projectId);
      if (other) throw new Error(`sending host ${row.sendingHost} belongs to another project`);
      domains.set(row.projectId, { ...row, createdAt: domains.get(row.projectId)?.createdAt ?? now() });
    },
    async setDomainStatus(projectId, status, at) {
      const d = domains.get(projectId);
      if (!d) return;
      domains.set(projectId, { ...d, status, lastCheckedAt: at, verifiedAt: d.verifiedAt ?? (status === "ready" ? at : null) });
    },
    async deleteDomain(projectId) {
      domains.delete(projectId);
    },
    async domainsToCheck() {
      return [...domains.values()].filter((d) => d.status !== "failed");
    },
    async logMessage(row) {
      const id = randomUUID();
      messages.push({ ...row, toAddress: normalizeAddress(row.toAddress), id, createdAt: now() });
      return id;
    },
    async setStatusByResendId(resendId, status, reason) {
      const i = messages.findIndex((m) => m.resendId === resendId);
      if (i === -1) return null;
      messages[i] = { ...messages[i]!, status, reason };
      return { projectId: messages[i]!.projectId, toAddress: messages[i]!.toAddress };
    },
    async recentMessages(projectId, limit) {
      return messages
        .filter((m) => m.projectId === projectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
    async deleteMessagesBefore(date) {
      const before = messages.length;
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.createdAt < date) messages.splice(i, 1);
      return before - messages.length;
    },
    async countSentSince(ownerId, kind, since) {
      return messages.filter((m) => m.ownerId === ownerId && m.kind === kind && WENT_OUT.includes(m.status) && m.createdAt >= since).length;
    },
    async countMessages(f) {
      const to = f.toAddress === undefined ? undefined : normalizeAddress(f.toAddress);
      return messages.filter(
        (m) =>
          m.projectId === f.projectId &&
          m.kind === f.kind &&
          WENT_OUT.includes(m.status) &&
          m.createdAt >= f.since &&
          (to === undefined || m.toAddress === to) &&
          (f.tag === undefined || m.tag === f.tag),
      ).length;
    },
    async isSuppressed(projectId, address, kind) {
      const s = suppressions.get(sKey(projectId, address));
      if (!s) return false;
      return s.reason !== "unsubscribed" || kind !== "auth";
    },
    async suppress(projectId, address, reason) {
      const k = sKey(projectId, address);
      suppressions.set(k, { address: normalizeAddress(address), reason, createdAt: suppressions.get(k)?.createdAt ?? now() });
    },
    async unsuppress(projectId, address) {
      suppressions.delete(sKey(projectId, address));
    },
    async listSuppressions(projectId) {
      return [...suppressions.entries()].filter(([k]) => k.startsWith(`${projectId}|`)).map(([, v]) => ({ ...v }));
    },
    async addUsage(ownerId, month, n) {
      const k = `${ownerId}|${month}`;
      const total = (usage.get(k) ?? 0) + n;
      usage.set(k, total);
      return total;
    },
    async usage(ownerId, month) {
      return usage.get(`${ownerId}|${month}`) ?? 0;
    },
    async isBlocked(projectId, ownerId) {
      return blocks.has(`project|${projectId}`) || blocks.has(`owner|${ownerId}`);
    },
    async block(scope, id) {
      blocks.add(`${scope}|${id}`);
    },
    async unblock(scope, id) {
      blocks.delete(`${scope}|${id}`);
    },
  };
}
