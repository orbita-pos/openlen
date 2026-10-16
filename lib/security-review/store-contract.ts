// lib/security-review/store-contract.ts — what any SecurityReviewStore must do,
// as a suite both implementations run: memory (store.test.ts) and Postgres
// (store-pg.pg.test.ts). Not a test file itself: the two test files call it.

import { describe, expect, it } from "vitest";

import type { SecurityReviewStore } from "./store";
import type { Finding } from "./types";

export interface ContractSetup {
  readonly store: SecurityReviewStore;
  /** Two projects that exist (Postgres needs the rows for its foreign keys). */
  readonly projectA: string;
  readonly projectB: string;
}

const T0 = new Date("1999-03-01T10:00:00Z");
const DAY_FROM = new Date("1999-03-01T00:00:00Z");
const DAY_TO = new Date("1999-03-02T00:00:00Z");
const finding = (key: string): Finding => ({ key, source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: key } });

export function describeStoreContract(name: string, setup: () => Promise<ContractSetup>): void {
  describe(`${name}: the SecurityReviewStore contract`, () => {
    it("inserts once per project and fingerprint, and reads it back", async () => {
      const { store, projectA } = await setup();
      expect(await store.insert({ projectId: projectA, fingerprint: "f1", status: "running", phase0: [finding("k1")], fileHashes: { "/a": "h" }, startedAt: T0 })).toBe(true);
      expect(await store.insert({ projectId: projectA, fingerprint: "f1", status: "running", phase0: [], fileHashes: {}, startedAt: T0 })).toBe(false);
      const r = await store.get(projectA, "f1");
      expect(r).toMatchObject({ projectId: projectA, fingerprint: "f1", status: "running", phase0: [finding("k1")], findings: [], fileHashes: { "/a": "h" }, costCentiCredits: 0, failReason: null, finishedAt: null, shownToAgentAt: null, acceptedBy: null });
      expect(await store.get(projectA, "nope")).toBeNull();
    });

    it("finishes only a running review", async () => {
      const { store, projectA } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "run", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.insert({ projectId: projectA, fingerprint: "skip", status: "skipped_scope", phase0: [], fileHashes: {}, startedAt: T0 });
      const fin = { status: "done" as const, findings: [finding("m1")], costCentiCredits: 321, failReason: null, finishedAt: T0 };
      await store.finish(projectA, "run", fin);
      await store.finish(projectA, "skip", fin);
      expect(await store.get(projectA, "run")).toMatchObject({ status: "done", findings: [finding("m1")], costCentiCredits: 321 });
      expect(await store.get(projectA, "skip")).toMatchObject({ status: "skipped_scope", costCentiCredits: 0 });
    });

    it("usageBetween counts this project's model runs and everyone's spend in the window", async () => {
      const { store, projectA, projectB } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "a1", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.insert({ projectId: projectA, fingerprint: "a2", status: "skipped_budget", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.insert({ projectId: projectB, fingerprint: "b1", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.insert({ projectId: projectA, fingerprint: "before", status: "running", phase0: [], fileHashes: {}, startedAt: new Date("1999-02-28T23:00:00Z") });
      await store.finish(projectA, "a1", { status: "done", findings: [], costCentiCredits: 100, failReason: null, finishedAt: T0 });
      await store.finish(projectB, "b1", { status: "failed", findings: [], costCentiCredits: 50, failReason: "x", finishedAt: T0 });
      expect(await store.usageBetween(projectA, DAY_FROM, DAY_TO)).toEqual({ projectModelRuns: 1, spentCentiCredits: 150 });
    });

    it("restart turns a failed or budget-skipped review back to running, keeps what it cost, and finishing adds the new run's cost", async () => {
      const { store, projectA } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "f", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.finish(projectA, "f", { status: "failed", findings: [], costCentiCredits: 40, failReason: "timeout", finishedAt: T0 });
      await store.insert({ projectId: projectA, fingerprint: "b", status: "skipped_budget", phase0: [], fileHashes: {}, startedAt: T0 });
      const later = new Date("1999-03-01T11:00:00Z");
      expect(await store.restart(projectA, "f", later)).toBe(true);
      expect(await store.restart(projectA, "b", later)).toBe(true);
      expect(await store.get(projectA, "f")).toMatchObject({ status: "running", failReason: null, finishedAt: null, costCentiCredits: 40, startedAt: later });
      await store.finish(projectA, "f", { status: "done", findings: [], costCentiCredits: 60, failReason: null, finishedAt: later });
      expect(await store.get(projectA, "f")).toMatchObject({ status: "done", costCentiCredits: 100 });
    });

    it("restart leaves a done or running review alone", async () => {
      const { store, projectA } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "r", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.insert({ projectId: projectA, fingerprint: "d", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.finish(projectA, "d", { status: "done", findings: [], costCentiCredits: 5, failReason: null, finishedAt: T0 });
      expect(await store.restart(projectA, "r", T0)).toBe(false);
      expect(await store.restart(projectA, "d", T0)).toBe(false);
      expect((await store.get(projectA, "d"))?.status).toBe("done");
    });

    it("markPublished keeps the published copy on a done review, and latestPublished is the newest one", async () => {
      const { store, projectA } = await setup();
      for (const fp of ["old", "new"]) {
        await store.insert({ projectId: projectA, fingerprint: fp, status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
        await store.finish(projectA, fp, { status: "done", findings: [], costCentiCredits: 0, failReason: null, finishedAt: T0 });
      }
      expect(await store.latestPublished(projectA)).toBeNull();
      await store.markPublished(projectA, "old", { "/index.html": "<h1>uno</h1>" }, new Date("1999-03-01T11:00:00Z"));
      await store.markPublished(projectA, "new", { "/index.html": "<h1>dos</h1>" }, new Date("1999-03-01T12:00:00Z"));
      expect(await store.latestPublished(projectA)).toEqual({ fingerprint: "new", files: { "/index.html": "<h1>dos</h1>" } });
      expect((await store.get(projectA, "new"))?.publishedAt).toEqual(new Date("1999-03-01T12:00:00Z"));
    });

    it("markPublished does nothing on a review the model didn't finish: it can't be the base of the next one", async () => {
      const { store, projectA } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "skip", status: "skipped_budget", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.insert({ projectId: projectA, fingerprint: "fail", status: "running", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.finish(projectA, "fail", { status: "failed", findings: [], costCentiCredits: 0, failReason: "timeout", finishedAt: T0 });
      await store.markPublished(projectA, "skip", { "/index.html": "x" }, T0);
      await store.markPublished(projectA, "fail", { "/index.html": "x" }, T0);
      expect(await store.latestPublished(projectA)).toBeNull();
    });

    it("claimShownToAgent is true only the first time", async () => {
      const { store, projectA } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "f", status: "done", phase0: [], fileHashes: {}, startedAt: T0 });
      expect(await store.claimShownToAgent(projectA, "f", T0)).toBe(true);
      expect(await store.claimShownToAgent(projectA, "f", T0)).toBe(false);
    });

    it("accept records who accepted and remembers the findings by key; the first acceptance stays", async () => {
      const { store, projectA } = await setup();
      await store.insert({ projectId: projectA, fingerprint: "f", status: "done", phase0: [], fileHashes: {}, startedAt: T0 });
      await store.accept(projectA, "f", "u-editor", [finding("k1"), finding("k2")], T0);
      await store.accept(projectA, "f", "u-other", [{ ...finding("k1"), params: { table: "changed" } }], T0);
      expect(await store.get(projectA, "f")).toMatchObject({ acceptedBy: "u-other" });
      const accepted = await store.acceptedFindings(projectA);
      expect([...accepted.keys()].sort()).toEqual(["k1", "k2"]);
      expect(accepted.get("k1")?.params).toEqual({ table: "k1" });
    });
  });
}
