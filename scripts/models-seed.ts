// Starter-pack seed: reads `models/starter/*.glb` + manifest and upserts
// each into the database-backed model store. Idempotent — same GLB input
// produces the same content hash and the same DB row.
//
// Run on a fresh self-host install to populate the 3D model picker with
// the 3 out-of-box CC-BY-4.0 models. Beyond that, add more via the admin
// CLI: `npm run models:add`.
//
// Run with: npm run models:seed

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { STARTER_MODELS } from "../models/starter/manifest";
import { upsertModel } from "../lib/models/store";
import { prepareModelGlb } from "../lib/models/optimize";

async function main() {
  console.log(`Seeding ${STARTER_MODELS.length} starter model(s)...`);
  let baked = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const m of STARTER_MODELS) {
    const filePath = resolve("models", "starter", m.fileName);
    let glb: Buffer;
    try {
      glb = await readFile(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: m.id, reason: `read ${filePath}: ${msg}` });
      continue;
    }
    if (glb.byteLength === 0) {
      failed.push({ id: m.id, reason: "empty file" });
      continue;
    }
    try {
      const noOpt = process.env.OPENLEN_SEED_NO_OPTIMIZE === "1";
      const { glb: prepared, report } = await prepareModelGlb(glb, { optimize: !noOpt });
      const record = await upsertModel({
        id: m.id,
        name: m.name,
        family: m.family,
        author: m.author,
        pitch: m.pitch,
        description: m.description,
        glb: prepared,
        license: m.license,
        status: "published",
      });
      console.log(
        `  ok  ${m.id.padEnd(20)} hash=${record.contentHash} size=${record.size}b`,
      );
      if (report) console.log(`      optimized ${(report.beforeBytes / 1024).toFixed(0)}KB → ${(report.afterBytes / 1024).toFixed(0)}KB (tex→webp: ${report.texturesConverted})`);
      baked++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: m.id, reason: `upsert: ${msg}` });
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
