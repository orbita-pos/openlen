import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listTemplates } from "@/lib/templates/store";
import { TemplateVisualMetadataSchema } from "@/lib/templates/visual-metadata";

function inputPath(): string {
  const i = process.argv.indexOf("--input");
  const value = i >= 0 ? process.argv[i + 1] : null;
  if (!value) throw new Error("--input is required");
  return resolve(value);
}

async function main(): Promise<void> {
  const value = JSON.parse(readFileSync(inputPath(), "utf8")) as unknown;
  if (!Array.isArray(value)) throw new Error("input must be an array");
  const published = new Set((await listTemplates({ status: "published" })).map((t) => t.id));
  const seen = new Set<string>();
  const rows = value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`row ${index} is not an object`);
    const id = String((row as Record<string, unknown>).id ?? "");
    if (!published.has(id)) throw new Error(`row ${index}: unknown published template ${id}`);
    if (seen.has(id)) throw new Error(`row ${index}: duplicate template ${id}`);
    seen.add(id);
    const metadata = TemplateVisualMetadataSchema.parse((row as Record<string, unknown>).metadata);
    if (metadata.reviewStatus !== "reviewed") throw new Error(`row ${index}: ${id} is not reviewed`);
    return { id, metadata };
  });
  if (rows.length > 0) {
    const values = sql.join(
      rows.map((row) => sql`(${row.id}, ${JSON.stringify(row.metadata)}::jsonb)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE "templates" AS target
      SET "visualMetadata" = source.metadata,
          "updatedAt" = NOW()
      FROM (VALUES ${values}) AS source(id, metadata)
      WHERE target.id = source.id
    `);
  }
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
