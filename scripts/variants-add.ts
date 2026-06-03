// Add the photo-filled layout-variant templates (.photo-variants/) to the live
// catalog via upsertTemplate (uploads HTML to R2 + upserts the DB row). Reads
// metadata from .photo-variants/_meta.json. Published status.
//
// Run: npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/variants-add.ts
import { readFile } from "node:fs/promises";
import { upsertTemplate } from "../lib/templates/store";
import type { TemplateFamily, TemplateMode, TemplateStatus } from "../lib/templates/families";

interface Meta {
  id: string;
  name: string;
  family: string;
  mode: string;
  accent: string;
  pitch: string;
  description: string;
}

async function main() {
  const meta: Meta[] = JSON.parse(await readFile(".photo-variants/_meta.json", "utf8"));
  console.log(`Adding ${meta.length} layout-variant templates to the catalog...`);

  let ok = 0;
  const failed: { id: string; reason: string }[] = [];
  for (const m of meta) {
    let html: string;
    try {
      html = await readFile(`.photo-variants/${m.id}.html`, "utf8");
    } catch (err) {
      failed.push({ id: m.id, reason: `read: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    try {
      const rec = await upsertTemplate({
        id: m.id,
        name: m.name,
        family: m.family as TemplateFamily,
        accent: m.accent,
        pitch: m.pitch,
        description: m.description,
        mode: m.mode as TemplateMode,
        html,
        status: "published" as TemplateStatus,
      });
      console.log(`  ok  ${m.id.padEnd(16)} ${m.family.padEnd(14)} ${m.mode.padEnd(6)} -> ${rec.storageUrl}`);
      ok++;
    } catch (err) {
      failed.push({ id: m.id, reason: `upsert: ${err instanceof Error ? err.message : String(err)}` });
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
