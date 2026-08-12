import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { DerivedSectionCompilationReportSchema, type DerivedSectionCompilationReport } from "@/lib/generation/derived-section-contracts";

export function parseDerivedRollbackReportPath(argv: readonly string[], cwd = process.cwd()): string {
  if (argv.length !== 1 || !argv[0].startsWith("--report=")) throw new Error("invalid_rollback_argument");
  const candidate = resolve(cwd, argv[0].slice("--report=".length));
  const root = resolve(cwd, "scratch", "visual-engine-derived-sections", "history");
  const rel = relative(root, candidate);
  if (isAbsolute(rel) || rel.startsWith("..") || normalize(candidate) !== candidate || !/^[a-f0-9]{64}\.json$/.test(rel.replaceAll("\\", "/"))) throw new Error("invalid_rollback_report_path");
  return candidate;
}

export async function restoreDerivedSectionCatalog(report: DerivedSectionCompilationReport, execute: (query: unknown) => Promise<unknown>): Promise<void> {
  const parsed = DerivedSectionCompilationReportSchema.parse(report);
  if (parsed.accepted.length === 0) throw new Error("empty_rollback_catalog");
  const ids = parsed.accepted.map((row) => row.id);
  await execute(sql`
    WITH candidates AS (
      SELECT "id" FROM "sections"
      WHERE "id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND "provenance" IS NOT NULL
    ), restored AS (
      UPDATE "sections" SET "status" = 'published', "updatedAt" = now(), "publishedAt" = COALESCE("publishedAt", now())
      WHERE "id" IN (SELECT "id" FROM candidates)
        AND (SELECT COUNT(*) FROM candidates) = ${ids.length}
      RETURNING "id"
    )
    UPDATE "sections" SET "status" = 'archived', "updatedAt" = now()
    WHERE "provenance" IS NOT NULL AND "id" NOT IN (SELECT "id" FROM restored)
      AND (SELECT COUNT(*) FROM restored) = ${ids.length}
  `);
}

async function main(): Promise<void> {
  const path = parseDerivedRollbackReportPath(process.argv.slice(2));
  const report = DerivedSectionCompilationReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const { db } = await import("@/lib/db");
  await restoreDerivedSectionCatalog(report, (query) => db.execute(query as Parameters<typeof db.execute>[0]));
  console.log(JSON.stringify({ event: "derived_section_catalog_rollback", ok: true, catalogManifestHash: report.catalogManifestHash, restoredCount: report.accepted.length }));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch(() => { console.error(JSON.stringify({ event: "derived_section_catalog_rollback", ok: false, code: "rollback_failed" })); process.exitCode = 1; });
