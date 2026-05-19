// One-shot migration: re-publish every template in DB through the current
// storage adapter. Used when switching storage backends (e.g. filesystem
// fallback -> R2 once credentials land in .env.local). Reads each row's
// HTML body from the OLD filesystem-fallback location on disk and pushes
// it through upsertTemplate(), which uploads via the now-R2 adapter and
// updates storageKey / storageUrl in the DB.
//
// Idempotent: same HTML produces the same content hash, same storage key.
//
// Run with: npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/templates-republish.ts

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, schema } from "../lib/db";
import { upsertTemplate } from "../lib/templates/store";
import type {
  TemplateFamily,
  TemplateMode,
  TemplateStatus,
} from "../lib/templates/families";

async function main() {
  const rows = await db.select().from(schema.templates);
  console.log(`Republishing ${rows.length} templates via current storage adapter...`);

  let ok = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const row of rows) {
    // The filesystem-fallback adapter writes to ./public/template-objects/
    // keyed by `templates/<id>-<hash>.html`. Read from there directly so
    // we bypass the current (R2) adapter on the read side.
    const fsPath = resolve("public", "template-objects", row.storageKey);
    let html: string;
    try {
      html = await readFile(fsPath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: row.id, reason: `read ${fsPath}: ${msg}` });
      continue;
    }
    try {
      const record = await upsertTemplate({
        id: row.id,
        name: row.name,
        family: row.family as TemplateFamily,
        accent: row.accent,
        pitch: row.pitch,
        description: row.description,
        mode: row.mode as TemplateMode,
        html,
        status: row.status as TemplateStatus,
      });
      console.log(
        `  ok  ${row.id.padEnd(12)} -> ${record.storageUrl}`,
      );
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: row.id, reason: `upsert: ${msg}` });
    }
  }

  console.log(`\nDone. ok=${ok} failed=${failed.length}`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.id} — ${f.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
