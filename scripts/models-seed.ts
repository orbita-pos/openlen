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
import { upsertModel, setModelThumbnail } from "../lib/models/store";
import { prepareModelGlb } from "../lib/models/optimize";
import { renderModelThumb } from "../lib/models/thumbs";

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
    let prepared: Buffer;
    try {
      const noOpt = process.env.OPENLEN_SEED_NO_OPTIMIZE === "1";
      const r = await prepareModelGlb(glb, { optimize: !noOpt });
      prepared = r.glb;
      if (r.report) console.log(`      optimized ${(r.report.beforeBytes / 1024).toFixed(0)}KB → ${(r.report.afterBytes / 1024).toFixed(0)}KB (tex→webp: ${r.report.texturesConverted})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: m.id, reason: `optimize: ${msg}` });
      continue;
    }
    try {
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
        sceneSpec: m.sceneSpec,
      });
      console.log(
        `  ok  ${m.id.padEnd(20)} hash=${record.contentHash} size=${record.size}b`,
      );
      baked++;

      if (process.env.OPENLEN_SEED_NO_THUMBS !== "1") {
        try {
          const thumb = await renderModelThumb({ glb: prepared, sceneSpec: m.sceneSpec });
          const url = await setModelThumbnail(m.id, thumb);
          console.log(`      thumb ${url}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`      thumb FAILED ${m.id}: ${msg}`);
        }
      }
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
