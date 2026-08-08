import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  createVisualEngine2AReviewSession,
  loadVisualEngine2AReviewSource,
  persistVisualEngine2AReviewSession,
  resumeVisualEngine2AReviewSession,
  validateVisualEngine2AReviewCoverage,
  type VisualEngine2AReviewSession,
} from "@/lib/generation/visual-engine-2a-review-session";
import { recordVisualEnginePilotComparison } from "@/lib/generation/visual-engine-pilot-store";
import { startVisualEngine2AReviewerServer } from "@/tools/visual-engine-2a-reviewer/server";

const root = join(process.cwd(), "scratch", "visual-engine-2a");
const sessionPath = join(root, "review-session.json");

async function evidenceSource() {
  return loadVisualEngine2AReviewSource(root);
}

function resultRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Record<string, unknown>[] : [];
}

async function reviewLedger() {
  const result = await db.execute(sql`
    SELECT "id", "ordinal", "status"
    FROM "visualEnginePilotRuns" WHERE "phase" = '2a' ORDER BY "ordinal"
  `);
  return resultRows(result).map((row) => ({
    pilotRunId: typeof row.id === "string" ? row.id : "",
    ordinal: Number(row.ordinal),
    technicalSuccess: row.status === "adapted",
  }));
}

async function main() {
  const reviewer = {
    name: process.env.OPENLEN_REVIEWER_NAME?.trim() ?? "",
    email: process.env.OPENLEN_REVIEWER_EMAIL?.trim() ?? "",
  };
  if (!reviewer.name || !/^\S+@\S+\.\S+$/.test(reviewer.email)) throw new Error("Reviewer runtime identity is required");
  const source = await evidenceSource();
  validateVisualEngine2AReviewCoverage(source.rows, await reviewLedger());
  let session: VisualEngine2AReviewSession;
  try {
    const serialized = await readFile(sessionPath, "utf8");
    session = resumeVisualEngine2AReviewSession(JSON.parse(serialized) as VisualEngine2AReviewSession, source.sourceSha, source.rows);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    session = createVisualEngine2AReviewSession(source.sourceSha, source.rows);
    await persistVisualEngine2AReviewSession(sessionPath, session);
  }
  await writeJsonAtomic(join(root, "reviewer-identity.json"), reviewer);
  const token = randomBytes(32).toString("base64url");
  const running = await startVisualEngine2AReviewerServer({
    token, session, evidenceRoot: root,
    persist: (next) => persistVisualEngine2AReviewSession(sessionPath, next),
    recordComparison: (runId, comparison) => recordVisualEnginePilotComparison(runId, comparison),
  });
  console.log(`Open ${running.origin}/#${token}`);
  const close = async () => { await running.close(); process.exit(0); };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2A reviewer failed (details redacted)."); process.exitCode = 1; });
}
