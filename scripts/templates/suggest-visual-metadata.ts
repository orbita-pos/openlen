import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTemplates } from "@/lib/templates/store";
import { runVisualMetadataSuggestionBatch } from "@/lib/templates/visual-metadata-review-workflow";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
  const out = arg("--out");
  if (!out) throw new Error("--out is required");
  const force = process.argv.includes("--force");
  const templates = await listTemplates({ status: "published" });
  const batch = await runVisualMetadataSuggestionBatch(templates, { force });
  writeFileSync(resolve(out), `${JSON.stringify(batch.rows, null, 2)}\n`, "utf8");
  console.log(`attempted=${batch.attempted} failed=${batch.failed} out=${resolve(out)}`);
  if (batch.shouldFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
