// Republish photo-enhanced templates: for each <id>.html in a source dir,
// read the enhanced HTML and push it through upsertTemplate() (uploads to R2 +
// updates storageKey/storageUrl/hash in DB), keeping the row's metadata.
//
// Source of HTML is a local dir (default .photo-batch1). To REVERT, point it at
// .photo-export (the untouched originals) — same mechanism, restores the row.
//
// Run: npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/photo-republish.ts [srcDir] [--only=id1,id2]
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { upsertTemplate } from "../lib/templates/store";
import type { TemplateFamily, TemplateMode, TemplateStatus } from "../lib/templates/families";

async function main() {
  const srcDir = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".photo-batch1";
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;

  const files = (await readdir(srcDir)).filter((f) => f.endsWith(".html"));
  let ids = files.map((f) => f.replace(/\.html$/, ""));
  if (only) ids = ids.filter((id) => only.has(id));
  if (ids.length === 0) {
    console.log("nothing to republish");
    return;
  }

  const rows = await db.select().from(schema.templates).where(inArray(schema.templates.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  console.log(`Republishing ${ids.length} enhanced templates from ${srcDir}/ ...`);

  let ok = 0;
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      failed.push({ id, reason: "no DB row" });
      continue;
    }
    let html: string;
    try {
      html = await readFile(join(srcDir, `${id}.html`), "utf8");
    } catch (err) {
      failed.push({ id, reason: `read: ${err instanceof Error ? err.message : String(err)}` });
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
      console.log(`  ok  ${id.padEnd(18)} -> ${record.storageUrl}`);
      ok++;
    } catch (err) {
      failed.push({ id, reason: `upsert: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  console.log(`\nDone. ok=${ok} failed=${failed.length}`);
  for (const f of failed) console.log(`  ✗ ${f.id} — ${f.reason}`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
