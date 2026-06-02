// Throwaway diagnostic for the section-insert save bug: prints a project's
// current data.html length + its recent version history. The PATCH /html route
// writes an "Inserted section" version ONLY when a section-insert save reaches
// the server — so this bisects client-side (no PATCH) vs server-side failure
// without touching the browser or spending tokens.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/spike-diag.ts <projectId>

import { desc, eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

async function main() {
  const id = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!id) {
    console.error("usage: spike-diag <projectId>");
    process.exit(2);
  }
  const p = (
    await db
      .select({ data: schema.projects.data, updatedAt: schema.projects.updatedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1)
  )[0];
  console.log(
    `project: updatedAt=${p?.updatedAt?.toISOString?.() ?? "?"}  data.html len=${p?.data?.html?.length ?? "(none)"}`,
  );
  const vers = await db
    .select()
    .from(schema.projectVersions)
    .where(eq(schema.projectVersions.projectId, id))
    .orderBy(desc(schema.projectVersions.createdAt))
    .limit(12);
  console.log(`\n${vers.length} versions (newest first):`);
  for (const v of vers) {
    console.log(
      `  ${v.createdAt.toISOString()}  [${v.source.padEnd(8)}]  ${v.label.slice(0, 38).padEnd(38)}  ${v.html.length}b`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
