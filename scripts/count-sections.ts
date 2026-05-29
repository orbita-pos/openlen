// Verify the section library state in the DB: total + per-type counts +
// flags. Mirror of count-templates. Run: npm run sections:count

import { listAllSectionsForAdmin } from "../lib/sections/store";
import { SECTION_TYPE_META, SECTION_TYPES } from "../lib/sections/types";

async function main() {
  const rows = await listAllSectionsForAdmin();
  console.log(`Total sections: ${rows.length}\n`);

  for (const type of [...SECTION_TYPES].sort(
    (a, b) => SECTION_TYPE_META[a].order - SECTION_TYPE_META[b].order,
  )) {
    const ofType = rows.filter((r) => r.type === type);
    if (ofType.length === 0) continue;
    const js = ofType.filter((r) => r.needsJs).length;
    const ph = ofType.filter((r) => r.hasPlaceholders).length;
    console.log(
      `  ${type.padEnd(14)} ${String(ofType.length).padStart(2)}` +
        `${js ? `  ${js} js` : ""}${ph ? `  ${ph} placeholders` : ""}`,
    );
  }

  const noStorage = rows.filter((r) => !r.storageUrl).length;
  const published = rows.filter((r) => r.status === "published").length;
  console.log(`\npublished=${published}  missing-storage=${noStorage}`);
  if (noStorage > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
