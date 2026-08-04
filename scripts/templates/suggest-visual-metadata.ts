import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTemplates } from "@/lib/templates/store";
import {
  prepareVisualMetadataRetry,
  runVisualMetadataSuggestionBatch,
  writeSuggestionArtifactAtomic,
} from "@/lib/templates/visual-metadata-review-workflow";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
  const out = arg("--out");
  if (!out) throw new Error("--out is required");
  const force = process.argv.includes("--force");
  const retryFlag = process.argv.includes("--retry-failed-from");
  const retryFrom = arg("--retry-failed-from");
  if (retryFlag && !retryFrom) throw new Error("--retry-failed-from requires a path");
  if (force && retryFrom) throw new Error("--force cannot be combined with --retry-failed-from");
  const outputPath = resolve(out);
  const templates = await listTemplates({ status: "published" });
  let templatesToAttempt = templates;
  let seedRows;
  if (retryFrom) {
    const seedValue = JSON.parse(readFileSync(resolve(retryFrom), "utf8")) as unknown;
    const retry = prepareVisualMetadataRetry(templates, seedValue);
    templatesToAttempt = retry.templates;
    seedRows = retry.seedRows;
    await writeSuggestionArtifactAtomic(outputPath, seedRows);
  }
  const batch = await runVisualMetadataSuggestionBatch(templatesToAttempt, {
    force,
    seedRows,
    onCheckpoint: async (rows) => {
      await writeSuggestionArtifactAtomic(outputPath, rows);
    },
  });
  await writeSuggestionArtifactAtomic(outputPath, batch.rows);
  console.log(`attempted=${batch.attempted} failed=${batch.failed} out=${outputPath}`);
  if (batch.shouldFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
