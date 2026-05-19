// Starter-pack seed: reads `templates/starter/*.html` + manifest and upserts
// each into the database-backed template store. Idempotent — same input
// produces the same content hash and the same DB row.
//
// Run on a fresh self-host install to populate the gallery with the 3
// out-of-box templates. Beyond that, add more via the admin path
// (`npm run templates:add` or /admin/templates UI).
//
// Run with: npm run templates:seed

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { STARTER_TEMPLATES } from "../templates/starter/manifest";
import { upsertTemplate } from "../lib/templates/store";

async function main() {
  console.log(`Seeding ${STARTER_TEMPLATES.length} starter template(s)...`);
  let baked = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const t of STARTER_TEMPLATES) {
    const filePath = resolve("templates", "starter", t.fileName);
    let html: string;
    try {
      html = await readFile(filePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: t.id, reason: `read ${filePath}: ${msg}` });
      continue;
    }
    if (!html.trim()) {
      failed.push({ id: t.id, reason: "empty file" });
      continue;
    }
    try {
      const record = await upsertTemplate({
        id: t.id,
        name: t.name,
        family: t.family,
        accent: t.accent,
        pitch: t.pitch,
        description: t.description,
        mode: t.mode,
        html,
        status: "published",
      });
      console.log(
        `  ok  ${t.id.padEnd(12)} hash=${record.contentHash} size=${record.size}b`,
      );
      baked++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: t.id, reason: `upsert: ${msg}` });
    }
  }

  console.log(`\nDone. baked=${baked} failed=${failed.length}`);
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
