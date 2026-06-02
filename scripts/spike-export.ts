// Pull a project's current HTML out of the DB into a file, for the Phase 0
// spike (docs/spike-phase0.md). A project's data.html is the LIVE html — in-app
// generation writes it, and Library inserts PATCH it — so this captures exactly
// what you built, no UI export/copy-paste needed.
//
//   npm run spike:export                                   # list recent projects + ids
//   npm run spike:export -- <projectId> spike/01.bespoke.html
//
// DB-only (DATABASE_URL from .env.local) — no Gemini / R2 / network.

import { writeFileSync } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../lib/db";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const id = args[0];
  const out = args[1];

  if (!id) {
    const rows = await db
      .select({
        id: schema.projects.id,
        title: schema.projects.title,
        tags: schema.projects.tags,
        updatedAt: schema.projects.updatedAt,
      })
      .from(schema.projects)
      .orderBy(desc(schema.projects.updatedAt))
      .limit(15);
    console.log("Recent projects (newest first) — copy an id:\n");
    for (const r of rows) {
      const tags = r.tags ?? [];
      const origin = tags.includes("template")
        ? "template"
        : tags.includes("paste")
          ? "paste"
          : tags.length === 0
            ? "ai-gen"
            : (tags[0] ?? "tag");
      console.log(`  ${r.id}  ${(r.title ?? "").slice(0, 40).padEnd(40)}  [${origin}]`);
    }
    console.log("\nThen: npm run spike:export -- <id> spike/01.bespoke.html");
    return;
  }

  if (!out) {
    console.error("usage: npm run spike:export -- <projectId> <outFile.html>");
    process.exit(2);
  }

  const rows = await db
    .select({ data: schema.projects.data, title: schema.projects.title })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    console.error(`No project with id ${id}`);
    process.exit(1);
  }
  const html = row.data?.html;
  if (!html || typeof html !== "string") {
    console.error(`Project ${id} has no data.html`);
    process.exit(1);
  }
  writeFileSync(out, html, "utf8");
  console.log(`Wrote ${out}  (${html.length} bytes)  — "${row.title}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
