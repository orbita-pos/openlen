import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  createVisualEngine2AReviewSession,
  loadVisualEngine2AReviewSource,
  persistVisualEngine2AReviewSession,
  resumeVisualEngine2AReviewSession,
  type VisualEngine2AReviewSession,
} from "@/lib/generation/visual-engine-2a-review-session";
import { recordVisualEnginePilotComparison } from "@/lib/generation/visual-engine-pilot-store";
import { startVisualEngine2AReviewerServer } from "@/tools/visual-engine-2a-reviewer/server";

const root = join(process.cwd(), "scratch", "visual-engine-2a");
const sessionPath = join(root, "review-session.json");

async function evidenceSource() {
  const source = await loadVisualEngine2AReviewSource(root);
  if (source.rows.length !== 75) throw new Error("Review requires exactly 75 verified evidence manifests");
  return source;
}

async function main() {
  const reviewer = {
    name: process.env.OPENLEN_REVIEWER_NAME?.trim() ?? "",
    email: process.env.OPENLEN_REVIEWER_EMAIL?.trim() ?? "",
  };
  if (!reviewer.name || !/^\S+@\S+\.\S+$/.test(reviewer.email)) throw new Error("Reviewer runtime identity is required");
  const source = await evidenceSource();
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
