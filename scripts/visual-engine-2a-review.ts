import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  createVisualEngine2AReviewSession,
  persistVisualEngine2AReviewSession,
  resumeVisualEngine2AReviewSession,
  type ReviewEvidencePair,
  type VisualEngine2AReviewSession,
} from "@/lib/generation/visual-engine-2a-review-session";
import { recordVisualEnginePilotComparison } from "@/lib/generation/visual-engine-pilot-store";
import { sha256, type VisualEngine2AEvidenceManifest } from "@/lib/generation/visual-engine-2a-eval";
import { startVisualEngine2AReviewerServer } from "@/tools/visual-engine-2a-reviewer/server";

const root = join(process.cwd(), "scratch", "visual-engine-2a");
const sessionPath = join(root, "review-session.json");

async function evidenceSource(): Promise<{ rows: ReviewEvidencePair[]; sourceSha: string }> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const manifests = entries.filter((entry) => entry.isFile() && entry.name === "manifest.json");
  const rows: ReviewEvidencePair[] = [];
  for (const entry of manifests) {
    const full = join(entry.parentPath, entry.name);
    const manifest = JSON.parse(await readFile(full, "utf8")) as VisualEngine2AEvidenceManifest;
    const directory = relative(root, entry.parentPath).replace(/\\/g, "/");
    rows.push({
      comparisonId: sha256(`${manifest.caseId}/${manifest.scenarioId}`).slice("sha256:".length, "sha256:".length + 24),
      pilotRunId: manifest.pilotRunId,
      baseline: { normal: `${directory}/baselineNormal.jpg`, neutral: `${directory}/baselineNeutral.jpg` },
      candidate: { normal: `${directory}/candidateNormal.jpg`, neutral: `${directory}/candidateNeutral.jpg` },
    });
  }
  rows.sort((left, right) => left.comparisonId.localeCompare(right.comparisonId));
  if (rows.length !== 75) throw new Error("Review requires exactly 75 evidence manifests");
  return { rows, sourceSha: sha256(JSON.stringify(rows)) };
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
    session = resumeVisualEngine2AReviewSession(JSON.parse(serialized) as VisualEngine2AReviewSession, source.sourceSha);
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
