// Backfill script: renders a 512×512 AVIF beauty shot for each curated model
// through the real runtime poster pipeline (same renderer publish posters
// use) and persists it as thumbnailUrl for the model picker cards.
//
// Defaults to published rows only. Pass --all to also backfill draft/archived
// rows (e.g. right after `models:add --status=draft`, before publishing).
//
// Run with: npm run models:thumbs [-- --all]

import { listModels, listAllForAdmin, setModelThumbnail } from "../lib/models/store";
import { renderModelThumb } from "../lib/models/thumbs";

async function main() {
  const all = process.argv.includes("--all");
  const rows = all ? await listAllForAdmin() : await listModels({ status: "published" });

  console.log(`Rendering thumbnails for ${rows.length} model(s) (${all ? "all statuses" : "published"})...`);
  let done = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const row of rows) {
    try {
      const res = await fetch(row.storageUrl);
      if (!res.ok) throw new Error(`fetch ${row.storageUrl}: ${res.status}`);
      const glb = Buffer.from(await res.arrayBuffer());
      const avif = await renderModelThumb({ glb, sceneSpec: row.sceneSpec });
      const url = await setModelThumbnail(row.id, avif);
      console.log(`  ok  ${row.id.padEnd(20)} ${url}`);
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ id: row.id, reason: msg });
    }
  }

  console.log(`\nDone. rendered=${done} failed=${failed.length}`);
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
