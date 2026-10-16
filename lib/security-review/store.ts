// lib/security-review/store.ts — where reviews and acceptances live: the
// interface, and an in-memory one for the tests. Postgres: store-pg.ts.

import type { Finding, ReviewRecord, ReviewStatus } from "./types";

export interface NewReview {
  readonly projectId: string;
  readonly fingerprint: string;
  readonly status: ReviewStatus;
  readonly phase0: readonly Finding[];
  readonly fileHashes: Readonly<Record<string, string>>;
  readonly startedAt: Date;
}

export interface FinishedReview {
  readonly status: "done" | "failed";
  readonly findings: readonly Finding[];
  readonly costCentiCredits: number;
  readonly failReason: string | null;
  readonly finishedAt: Date;
}

export interface SecurityReviewStore {
  get(projectId: string, fingerprint: string): Promise<ReviewRecord | null>;
  /** false when this project already has a review of this fingerprint (another request won). */
  insert(r: NewReview): Promise<boolean>;
  /** Only a `running` review is finished; any other is left as it is. The run's cost is ADDED to what the review
   *  already cost (a retried review keeps what its earlier runs spent). */
  finish(projectId: string, fingerprint: string, f: FinishedReview): Promise<void>;
  /** A `failed` or `skipped_budget` review runs again: `running` from `at`, keeping its cost. false for any other. */
  restart(projectId: string, fingerprint: string, at: Date): Promise<boolean>;
  /** The project's newest `done` review. */
  latestDone(projectId: string): Promise<ReviewRecord | null>;
  /** Started in [from, to): this project's reviews that used the model, and what ALL reviews cost. */
  usageBetween(projectId: string, from: Date, to: Date): Promise<{ readonly projectModelRuns: number; readonly spentCentiCredits: number }>;
  /** true only the first time: Len is shown a review's findings once. */
  claimShownToAgent(projectId: string, fingerprint: string, at: Date): Promise<boolean>;
  /** «Publicar igual»: who, on the review; and each finding by its key (the first acceptance of a key stays). */
  accept(projectId: string, fingerprint: string, userId: string, findings: readonly Finding[], at: Date): Promise<void>;
  acceptedFindings(projectId: string): Promise<ReadonlyMap<string, Finding>>;
}

const MODEL_STATUSES: ReadonlySet<ReviewStatus> = new Set(["running", "done", "failed"]);

export function memorySecurityReviewStore(): SecurityReviewStore & { readonly reviews: ReviewRecord[] } {
  const reviews: ReviewRecord[] = [];
  const accepted = new Map<string, Map<string, Finding>>();
  const at = (projectId: string, fingerprint: string) => reviews.findIndex((r) => r.projectId === projectId && r.fingerprint === fingerprint);
  return {
    reviews,
    async get(projectId, fingerprint) {
      const i = at(projectId, fingerprint);
      return i < 0 ? null : reviews[i]!;
    },
    async insert(r) {
      if (at(r.projectId, r.fingerprint) >= 0) return false;
      reviews.push({ ...r, findings: [], costCentiCredits: 0, failReason: null, finishedAt: null, shownToAgentAt: null, acceptedBy: null, acceptedAt: null });
      return true;
    },
    async finish(projectId, fingerprint, f) {
      const i = at(projectId, fingerprint);
      if (i >= 0 && reviews[i]!.status === "running") reviews[i] = { ...reviews[i]!, ...f, costCentiCredits: reviews[i]!.costCentiCredits + f.costCentiCredits };
    },
    async restart(projectId, fingerprint, when) {
      const i = at(projectId, fingerprint);
      if (i < 0 || (reviews[i]!.status !== "failed" && reviews[i]!.status !== "skipped_budget")) return false;
      reviews[i] = { ...reviews[i]!, status: "running", findings: [], failReason: null, finishedAt: null, startedAt: when };
      return true;
    },
    async latestDone(projectId) {
      return reviews.filter((r) => r.projectId === projectId && r.status === "done").sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
    },
    async usageBetween(projectId, from, to) {
      const inWindow = reviews.filter((r) => r.startedAt >= from && r.startedAt < to);
      return {
        projectModelRuns: inWindow.filter((r) => r.projectId === projectId && MODEL_STATUSES.has(r.status)).length,
        spentCentiCredits: inWindow.reduce((s, r) => s + r.costCentiCredits, 0),
      };
    },
    async claimShownToAgent(projectId, fingerprint, when) {
      const i = at(projectId, fingerprint);
      if (i < 0 || reviews[i]!.shownToAgentAt) return false;
      reviews[i] = { ...reviews[i]!, shownToAgentAt: when };
      return true;
    },
    async accept(projectId, fingerprint, userId, findings, when) {
      const i = at(projectId, fingerprint);
      if (i >= 0) reviews[i] = { ...reviews[i]!, acceptedBy: userId, acceptedAt: when };
      const m = accepted.get(projectId) ?? new Map<string, Finding>();
      for (const f of findings) if (!m.has(f.key)) m.set(f.key, f);
      accepted.set(projectId, m);
    },
    async acceptedFindings(projectId) {
      return new Map(accepted.get(projectId) ?? []);
    },
  };
}
