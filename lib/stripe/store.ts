// lib/stripe/store.ts — WHAT OPENLEN REMEMBERS ABOUT A PROJECT'S STRIPE (spec
// local 2026-10-21-stripe-integration, §7). Two things:
//   · the account behind each environment's key (never the key: that one is a
//     function secret, encrypted in `functionSecrets`);
//   · the project's test-mode objects (what Len created with the `stripe`
//     command, or what the published files name) and, once published, their
//     live-mode twin.
// The Postgres one is in store-pg.ts; this file has the interface and the
// in-memory one, for tests.

import type { StripeEnv } from "./api";
import type { StripeKeyKind } from "./key-check";

export type StripeObjectKind = "product" | "price" | "payment_link" | "shipping_rate" | "portal_configuration" | "webhook_endpoint";

export interface StripeAccountRow {
  readonly projectId: string;
  readonly environment: StripeEnv;
  readonly accountId: string;
  readonly accountName: string | null;
  readonly keyKind: StripeKeyKind;
  readonly chargesEnabled: boolean | null;
  readonly checkedAt: Date;
}

export interface StripeObjectRow {
  readonly projectId: string;
  readonly kind: StripeObjectKind;
  readonly testId: string;
  readonly testUrl: string | null;
  readonly lookupKey: string | null;
  readonly functionName: string | null;
  readonly secretName: string | null;
  /** Created by Len with the `stripe` command, or found in the published files. */
  readonly source: "cli" | "files";
  readonly liveId: string | null;
  readonly liveUrl: string | null;
  /** What the test object looked like when it was copied: a different one means copy again. */
  readonly fingerprint: string | null;
  readonly createdAt: Date;
  readonly syncedAt: Date | null;
}

export type TestObjectRecord = Pick<StripeObjectRow, "projectId" | "kind" | "testId" | "source"> &
  Partial<Pick<StripeObjectRow, "testUrl" | "lookupKey" | "functionName" | "secretName">>;

export interface StripeStore {
  getAccount(projectId: string, env: StripeEnv): Promise<StripeAccountRow | null>;
  putAccount(row: Omit<StripeAccountRow, "checkedAt">): Promise<void>;
  deleteAccount(projectId: string, env: StripeEnv): Promise<void>;
  /** In creation order. */
  listObjects(projectId: string): Promise<StripeObjectRow[]>;
  /** Upsert by (project, test id): the fields it brings are filled, the others kept; "cli" wins over "files". */
  recordTestObject(row: TestObjectRecord): Promise<void>;
  setTwin(projectId: string, testId: string, twin: { readonly liveId: string; readonly liveUrl?: string | null; readonly fingerprint: string }): Promise<void>;
  clearTwin(projectId: string, testId: string): Promise<void>;
  forgetTestObject(projectId: string, testId: string): Promise<void>;
}

export function memoryStripeStore(now: () => Date = () => new Date()): StripeStore {
  const accounts = new Map<string, StripeAccountRow>();
  const objects = new Map<string, StripeObjectRow>();
  const accountKey = (p: string, e: StripeEnv) => `${p}|${e}`;
  const objectKey = (p: string, t: string) => `${p}|${t}`;
  return {
    async getAccount(projectId, env) {
      return accounts.get(accountKey(projectId, env)) ?? null;
    },
    async putAccount(row) {
      accounts.set(accountKey(row.projectId, row.environment), { ...row, checkedAt: now() });
    },
    async deleteAccount(projectId, env) {
      accounts.delete(accountKey(projectId, env));
    },
    async listObjects(projectId) {
      return [...objects.values()].filter((r) => r.projectId === projectId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async recordTestObject(r) {
      const k = objectKey(r.projectId, r.testId);
      const old = objects.get(k);
      objects.set(k, {
        projectId: r.projectId,
        kind: r.kind,
        testId: r.testId,
        testUrl: r.testUrl ?? old?.testUrl ?? null,
        lookupKey: r.lookupKey ?? old?.lookupKey ?? null,
        functionName: r.functionName ?? old?.functionName ?? null,
        secretName: r.secretName ?? old?.secretName ?? null,
        source: old?.source === "cli" ? "cli" : r.source,
        liveId: old?.liveId ?? null,
        liveUrl: old?.liveUrl ?? null,
        fingerprint: old?.fingerprint ?? null,
        createdAt: old?.createdAt ?? now(),
        syncedAt: old?.syncedAt ?? null,
      });
    },
    async setTwin(projectId, testId, twin) {
      const k = objectKey(projectId, testId);
      const old = objects.get(k);
      if (!old) return;
      objects.set(k, { ...old, liveId: twin.liveId, liveUrl: twin.liveUrl ?? null, fingerprint: twin.fingerprint, syncedAt: now() });
    },
    async clearTwin(projectId, testId) {
      const k = objectKey(projectId, testId);
      const old = objects.get(k);
      if (!old) return;
      objects.set(k, { ...old, liveId: null, liveUrl: null, fingerprint: null, syncedAt: null });
    },
    async forgetTestObject(projectId, testId) {
      objects.delete(objectKey(projectId, testId));
    },
  };
}
