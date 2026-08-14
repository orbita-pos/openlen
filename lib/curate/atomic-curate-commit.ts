import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";

export interface AtomicCurateCommitInput {
  readonly projectId: string;
  readonly userId: string;
  readonly title: string;
  readonly brief: string;
  readonly profileId: string | null;
  readonly logoUrl: string | null;
  readonly credits: number;
  readonly data: ProjectData;
}

export interface AtomicCurateCommitDeps {
  readonly execute: (query: SQL) => Promise<{ readonly rows?: readonly unknown[] }>;
}

export class AtomicCurateCommitError extends Error {
  readonly code: "invalid_input" | "statement_failed" | "not_committed";
  constructor(code: AtomicCurateCommitError["code"]) {
    super(`atomic_curate_commit_${code}`);
    this.name = "AtomicCurateCommitError";
    this.code = code;
  }
}

function valid(input: AtomicCurateCommitInput): boolean {
  return input.projectId.length > 0
    && input.userId.length > 0
    && input.title.length > 0
    && input.brief.length > 0
    && Number.isSafeInteger(input.credits)
    && input.credits > 0
    && typeof input.data?.html === "string"
    && input.data.html.length > 0;
}

/** One PostgreSQL statement: if either the debit CTE or INSERT fails, the
 * statement rolls back as a unit on both supported Drizzle drivers. */
export async function commitCurateProjectAndDebit(
  input: AtomicCurateCommitInput,
  deps: AtomicCurateCommitDeps = { execute: (query) => db.execute(query) as Promise<{ rows?: readonly unknown[] }> },
): Promise<void> {
  if (!valid(input)) throw new AtomicCurateCommitError("invalid_input");
  const serializedData = JSON.stringify(input.data);
  let result: { readonly rows?: readonly unknown[] };
  try {
    result = await deps.execute(sql`
    WITH "debited" AS (
      UPDATE "users"
      SET "credits" = GREATEST(0, "credits" - ${input.credits})
      WHERE "id" = ${input.userId}
        AND "credits" >= ${input.credits}
      RETURNING "id"
    )
    INSERT INTO "projects" (
      "id", "userId", "title", "brief", "thumbnailUrl", "tags", "status", "profileId", "logoUrl", "data"
    )
    SELECT
      ${input.projectId}, ${input.userId}, ${input.title}, ${input.brief}, NULL,
      ARRAY['curated']::text[], 'draft', ${input.profileId}, ${input.logoUrl}, ${serializedData}::jsonb
    FROM "debited"
    RETURNING "id"
    `);
  } catch {
    throw new AtomicCurateCommitError("statement_failed");
  }
  const rows = result.rows as readonly { id?: unknown }[] | undefined;
  if (!rows?.some((row) => row.id === input.projectId)) throw new AtomicCurateCommitError("not_committed");
}
