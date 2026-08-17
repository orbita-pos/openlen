// One-shot repair: the band extractor labelled every template's ordinal-0 band
// `hero`, and in almost every template band 0 is the navigation bar. Measured on
// the published catalog: 343 of 506 heroes are bars, all of ordinal 0. The
// composer picked them as the hero, so a page shipped with TWO navbars — the
// second one with the brief's own text poured into its links.
//
// Metadata only. The stored fragment is never re-uploaded and `contentHash` is
// never re-stamped: a fragment that goes through Cloudflare comes back mutated
// (email obfuscation), and re-stamping is how the catalog lost integrity once.
//
//   npm run sections:reclassify-navbars -- --dry-run
//   npm run sections:reclassify-navbars
import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { listAllSectionsForAdmin } from "../lib/sections/store";
import { looksLikeNavbar } from "../lib/sections/section-shape";

async function main() {
  const apply = !process.argv.includes("--dry-run");
  const records = await listAllSectionsForAdmin();
  const heroes = records.filter((record) => record.type === "hero");
  console.log(`${records.length} sections · ${heroes.length} heroes${apply ? "" : " [DRY RUN]"}\n`);

  const guilty: { id: string; ordinal: number | null }[] = [];
  let unreadable = 0;

  for (const record of heroes) {
    let body: string;
    try {
      const response = await fetch(record.storageUrl);
      if (!response.ok) { unreadable += 1; continue; }
      body = await response.text();
    } catch {
      unreadable += 1;
      continue;
    }
    if (!looksLikeNavbar(body)) continue;
    const provenance = record.provenance as { sourceBandOrdinal?: number } | null;
    guilty.push({ id: record.id, ordinal: provenance?.sourceBandOrdinal ?? null });
  }

  console.log(`bars wearing a hero label: ${guilty.length}`);
  const offBand = guilty.filter((row) => row.ordinal !== 0);
  if (offBand.length > 0) {
    // The whole cause is "ordinal 0 was assumed to be the hero". Anything else
    // is a different bug and must be looked at, not swept along.
    console.log(`⚠️  ${offBand.length} are NOT band 0 — inspect before applying:`);
    for (const row of offBand.slice(0, 20)) console.log(`   ${row.id} (band ${row.ordinal})`);
  }
  if (unreadable > 0) console.log(`⚠️  ${unreadable} heroes could not be read and were left alone`);

  if (!apply) {
    console.log("\nnothing written. Re-run without --dry-run to reclassify.");
    return;
  }
  if (guilty.length === 0) return;

  const ids = guilty.map((row) => row.id);
  const result = await db.execute(sql`
    UPDATE "sections"
       SET "type" = 'navbar',
           "derivedSemantics" = CASE
             WHEN "derivedSemantics" IS NULL THEN NULL
             ELSE jsonb_set("derivedSemantics", '{role}', '"navbar"'::jsonb)
           END
     WHERE "id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
       AND "type" = 'hero'
    RETURNING "id"
  `);
  const rows = (result as { rows?: readonly unknown[] }).rows ?? [];
  console.log(`\nreclassified ${rows.length} sections hero → navbar`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
