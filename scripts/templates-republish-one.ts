// Republish a SINGLE template from its in-repo starter HTML, preserving every
// piece of DB metadata. Fills the gap `templates:republish` can't: that script
// is bulk-only, ignores args, and reads the stale local-FS object instead of
// your edited starter file. This reads `templates/starter/<id>.html` (or
// --file=) and pushes it through upsertTemplate() against the live adapter
// (R2 when R2_* env is set), updating storageKey/storageUrl in the DB.
//
// Does NOT re-capture the S2 reference screenshot — use this for edits that
// don't change the desktop layout (e.g. a mobile-only media query). If the
// desktop look changed, run `templates:add` instead so the screenshot refreshes.
//
// Run:
//   npm run templates:republish-one -- apex-freedom
//   npm run templates:republish-one -- apex-freedom --file=templates/starter/apex-freedom.html

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { upsertTemplate } from "../lib/templates/store";
import type {
  TemplateFamily,
  TemplateMode,
  TemplateStatus,
} from "../lib/templates/families";

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  const fileFlag = args
    .find((a) => a.startsWith("--file="))
    ?.slice("--file=".length);
  if (!id) {
    console.error(
      "Usage: npm run templates:republish-one -- <id> [--file=path/to.html]",
    );
    process.exit(2);
  }

  const filePath = fileFlag ?? `templates/starter/${id}.html`;
  const [row] = await db
    .select()
    .from(schema.templates)
    .where(eq(schema.templates.id, id));
  if (!row) {
    console.error(`No template row for id "${id}".`);
    process.exit(1);
  }

  const html = await readFile(resolve(filePath), "utf8");
  console.log(
    `Republishing "${id}" from ${filePath} (${html.length} bytes) — preserving metadata...`,
  );

  const record = await upsertTemplate({
    id: row.id,
    name: row.name,
    family: row.family as TemplateFamily,
    accent: row.accent,
    pitch: row.pitch,
    description: row.description,
    mode: row.mode as TemplateMode,
    html,
    // Preserve subpages — upsert always writes the pages column.
    pages: (row.pages as Array<{ slug: string; html: string }>) ?? [],
    status: row.status as TemplateStatus,
  });

  console.log(`ok -> ${record.storageUrl}  (hash ${record.contentHash})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
