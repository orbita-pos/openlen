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
  type VisualEngine2AReviewSession,
} from "@/lib/generation/visual-engine-2a-review-session";
import { VISUAL_ENGINE_2C_CASES } from "@/lib/generation/visual-engine-2c-cohort";
import { validateVisualEngine2CReviewCoverage } from "@/lib/generation/visual-engine-2c-eval";
import { recordVisualEnginePilotComparison } from "@/lib/generation/visual-engine-pilot-store";
import { startVisualEngine2AReviewerServer } from "@/tools/visual-engine-2a-reviewer/server";

const root = join(process.cwd(), "scratch", "visual-engine-2c");
const evidenceRoot = join(root, "evidence");
const sessionPath = join(root, "review-session.json");

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Record<string, unknown>[] : [];
}

async function reviewLedger() {
  const result = await db.execute(sql`
    SELECT "id", "ordinal", "status" FROM "visualEnginePilotRuns"
    WHERE "phase" = '2c' ORDER BY "ordinal"
  `);
  return rows(result).map((row) => {
    const ordinal = Number(row.ordinal);
    const cohort = VISUAL_ENGINE_2C_CASES[ordinal - 1];
    return {
      pilotRunId: typeof row.id === "string" ? row.id : "",
      ordinal,
      acceptedRepair: cohort?.class === "repairable" && row.status === "adapted",
    };
  });
}

async function main() {
  const reviewer = {
    name: process.env.OPENLEN_REVIEWER_NAME?.trim() ?? "",
    email: process.env.OPENLEN_REVIEWER_EMAIL?.trim() ?? "",
  };
  if (!reviewer.name || !/^\S+@\S+\.\S+$/.test(reviewer.email)) throw new Error("Reviewer runtime identity is required");
  const source = await loadVisualEngine2AReviewSource(evidenceRoot);
  validateVisualEngine2CReviewCoverage(source.rows, await reviewLedger());
  let session: VisualEngine2AReviewSession;
  try {
    session = resumeVisualEngine2AReviewSession(
      JSON.parse(await readFile(sessionPath, "utf8")) as VisualEngine2AReviewSession,
      source.sourceSha,
      source.rows,
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    session = createVisualEngine2AReviewSession(source.sourceSha, source.rows);
    await persistVisualEngine2AReviewSession(sessionPath, session);
  }
  await writeJsonAtomic(join(root, "reviewer-identity.json"), reviewer);
  const token = randomBytes(32).toString("base64url");
  const running = await startVisualEngine2AReviewerServer({
    token, session, evidenceRoot,
    persist: (next) => persistVisualEngine2AReviewSession(sessionPath, next),
    recordComparison: (runId, comparison) => recordVisualEnginePilotComparison(runId, comparison),
  });
  console.log(`Open ${running.origin}/#${token} (Normal copy = desktop; Copy neutralized = mobile for 2C)`);
  const close = async () => { await running.close(); process.exit(0); };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2C reviewer failed (details redacted)."); process.exitCode = 1; });
}
