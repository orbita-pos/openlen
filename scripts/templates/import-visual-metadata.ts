import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/lib/db";
import { listTemplates } from "@/lib/templates/store";
import {
  executeReviewedMetadataUpdate,
  validateReviewedMetadataInput,
} from "@/lib/templates/visual-metadata-review-workflow";

function inputPath(): string {
  const i = process.argv.indexOf("--input");
  const value = i >= 0 ? process.argv[i + 1] : null;
  if (!value) throw new Error("--input is required");
  return resolve(value);
}

async function main(): Promise<void> {
  const value = JSON.parse(readFileSync(inputPath(), "utf8")) as unknown;
  const published = new Set((await listTemplates({ status: "published" })).map((t) => t.id));
  const rows = validateReviewedMetadataInput(value, published);
  await executeReviewedMetadataUpdate(rows, (query) => db.execute(query));
  const finalTemplates = await listTemplates({ status: "published" });
  const reviewed = finalTemplates.filter((t) => t.visualMetadata?.reviewStatus === "reviewed").length;
  const unreviewed = finalTemplates.filter((t) => t.visualMetadata?.reviewStatus === "unreviewed").length;
  const missing = finalTemplates.filter((t) => t.visualMetadata === null).length;
  console.log(`imported=${rows.length}`);
  console.log(`published=${finalTemplates.length} reviewed=${reviewed} unreviewed=${unreviewed} missing=${missing}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
