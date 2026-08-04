import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTemplates } from "@/lib/templates/store";
import { suggestVisualMetadata } from "@/lib/templates/suggest-visual-metadata";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main(): Promise<void> {
  const out = arg("--out");
  if (!out) throw new Error("--out is required");
  const force = process.argv.includes("--force");
  const templates = await listTemplates({ status: "published" });
  const rows: Array<Record<string, unknown>> = [];
  let attempted = 0;
  let failed = 0;
  for (const template of templates) {
    if (!force && template.visualMetadata?.reviewStatus === "reviewed") continue;
    attempted++;
    const result = await suggestVisualMetadata(template);
    if (!result.ok) failed++;
    rows.push({
      id: template.id,
      name: template.name,
      screenshotUrl: template.screenshotUrl,
      metadata: result.ok ? result.metadata : null,
      error: result.ok ? null : `${result.kind}: ${result.message}`,
    });
  }
  writeFileSync(resolve(out), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  console.log(`attempted=${attempted} failed=${failed} out=${resolve(out)}`);
  if (attempted > 0 && failed / attempted > 0.10) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
