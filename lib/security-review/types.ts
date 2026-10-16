// lib/security-review/types.ts — the shapes of the security review at publish
// (spec local 2026-10-15-security-review-design). Pure types: the client
// imports them too.

import type { AppDeProyecto } from "@/lib/projects/types";

export type Severity = "HIGH" | "MEDIUM";

/** The deterministic rules (phase 0). */
export type RuleId = "rls_disabled" | "policy_open_write" | "secret_in_client" | "test_secret_in_client";

export interface Finding {
  /** Stable across reviews: an acceptance is remembered by it. */
  readonly key: string;
  readonly source: "rule" | "model";
  readonly severity: Severity;
  /** A `RuleId`, or the model's category (`sql_injection`, `missing_authorization`…). */
  readonly category: string;
  readonly file: string | null;
  readonly line: number | null;
  /** The model's, in the owner's language. Empty for a rule: the interface words it from `params`. */
  readonly description: string;
  readonly exploitScenario: string;
  readonly recommendation: string;
  /** A rule's details for the interface (`table`, `policy`, `command`, `provider`, `variable`). Never a secret's value. */
  readonly params?: Readonly<Record<string, string>>;
}

export type ReviewStatus = "running" | "done" | "failed" | "skipped_budget" | "skipped_scope";

export type PolicyCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

export interface TableDump {
  readonly name: string;
  readonly rls: boolean;
}

export interface PolicyDump {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly command: PolicyCommand;
  /** false for `AS RESTRICTIVE`: it only narrows, it never opens. */
  readonly permissive: boolean;
  /** `public` stands for PUBLIC. */
  readonly roles: readonly string[];
  readonly using: string | null;
  readonly withCheck: string | null;
}

export interface BucketDump {
  readonly id: string;
  readonly public: boolean;
}

export interface SchemaDump {
  readonly tables: readonly TableDump[];
  readonly policies: readonly PolicyDump[];
  readonly buckets: readonly BucketDump[];
}

/** Everything a review looks at, read once. */
export interface ReviewInputs {
  readonly projectId: string;
  readonly ownerId: string;
  readonly app: AppDeProyecto | null;
  readonly homeHtml: string;
  /** slug → the page's HTML. */
  readonly pages: Readonly<Record<string, string>>;
  /** The project's folder: path → content. */
  readonly files: Readonly<Record<string, string>>;
  readonly productionEnv: Readonly<Record<string, string>>;
  /** It has a backend record (a database, now or later). */
  readonly hasBackend: boolean;
  /** The draft database's schema; null without one (none yet, or this server has no cluster). */
  readonly schema: SchemaDump | null;
}

export interface ReviewRecord {
  readonly projectId: string;
  readonly fingerprint: string;
  readonly status: ReviewStatus;
  readonly phase0: readonly Finding[];
  readonly findings: readonly Finding[];
  readonly fileHashes: Readonly<Record<string, string>>;
  readonly costCentiCredits: number;
  readonly failReason: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly shownToAgentAt: Date | null;
  readonly acceptedBy: string | null;
  readonly acceptedAt: Date | null;
  /** The project was published with this review: its copy of the files is the base of the next one. */
  readonly publishedAt: Date | null;
}

/** What the owner and Len see of a review. */
export interface ReviewView {
  readonly fingerprint: string;
  readonly status: ReviewStatus;
  /** HIGH and not accepted: they hold the publish back. */
  readonly blocking: readonly Finding[];
  readonly medium: readonly Finding[];
  readonly accepted: readonly Finding[];
}
