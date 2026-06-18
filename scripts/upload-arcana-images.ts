// One-off: upload the optimized ARCANA template images to the openlen-images R2
// bucket under the `arcana/` prefix → images.openlen.com/arcana/<file>.
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/upload-arcana-images.ts

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getOpenLenImageStorage } from "../lib/storage/openlen-images";

async function main(): Promise<void> {
  const dir = "templates/starter/arcana-assets";
  const files = readdirSync(dir).filter((f) => f.endsWith(".webp")).sort();
  const usingR2 = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY
  );
  if (!usingR2) {
    console.error("R2_* env vars not set — would write to the local filesystem fallback. Aborting.");
    process.exit(1);
  }
  console.log(`Uploading ${files.length} files → images.openlen.com/arcana/\n`);
  const storage = getOpenLenImageStorage();
  for (const f of files) {
    const body = readFileSync(join(dir, f));
    const res = await storage.upload({ key: `arcana/${f}`, contentType: "image/webp", body });
    console.log(`OK  ${f.padEnd(14)} ${(res.size / 1024).toFixed(0).padStart(4)}KB  ->  ${res.url}`);
  }
  console.log("\nUPLOAD DONE");
}

main().catch((e) => {
  console.error("\nUPLOAD FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
