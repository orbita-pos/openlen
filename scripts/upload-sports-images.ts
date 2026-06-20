// One-off: upload the SPORTS family template images to the openlen-images R2
// bucket under each template's slug prefix → images.openlen.com/<slug>/<file>.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/upload-sports-images.ts
//
// Source: templates/starter/<slug>-assets/*.webp (committed alongside the templates).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getOpenLenImageStorage } from "../lib/storage/openlen-images";

const SLUGS = ["apex-freedom", "champions-final", "vegas-faceoff"];

async function main(): Promise<void> {
  const usingR2 = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY
  );
  if (!usingR2) {
    console.error(
      "R2_* env vars not set — would write to the local filesystem fallback, not images.openlen.com. Aborting.",
    );
    process.exit(1);
  }
  console.log(
    `Storage: R2 — ${process.env.R2_IMAGES_BUCKET || "openlen-images"} → ${process.env.R2_IMAGES_PUBLIC_URL || "https://images.openlen.com"}\n`,
  );

  const storage = getOpenLenImageStorage();
  let n = 0;
  for (const slug of SLUGS) {
    const dir = `templates/starter/${slug}-assets`;
    const files = readdirSync(dir).filter((f) => f.endsWith(".webp")).sort();
    console.log(`${slug}: ${files.length} files`);
    for (const f of files) {
      const body = readFileSync(join(dir, f));
      const res = await storage.upload({ key: `${slug}/${f}`, contentType: "image/webp", body });
      console.log(`  OK ${f.padEnd(26)} ${(res.size / 1024).toFixed(0).padStart(4)}KB  ->  ${res.url}`);
      n++;
    }
  }
  console.log(`\nUPLOAD DONE — ${n} files`);
}

main().catch((e) => {
  console.error("\nUPLOAD FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
