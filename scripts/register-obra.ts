// One-off: register the OBRA architecture template (id `obra`) into the live
// catalog + mark featured, and ARCHIVE the old `mono` template so it no longer
// shows in the gallery. Reuses CreateSchema + upsertTemplate; skips the
// sandbox-unreachable inline screenshot (backfill from the box).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-obra.ts

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate, archiveTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

async function main(): Promise<void> {
  const html = await readFile("templates/starter/obra.html", "utf8");
  const payload = {
    id: "obra",
    name: "Obra",
    family: "architecture",
    accent: "#B5532A",
    pitch: "Prefab modular homes, delivered whole.",
    description:
      "Architecture-studio landing for prefab/modular homes — an oversized wordmark with a corten house punching through the type, a model catalog and a line-drawing process gallery.",
    mode: "light",
    html,
    status: "published",
  };

  const parsed = CreateSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("Invalid payload:", JSON.stringify(parsed.error.flatten(), null, 2));
    process.exit(1);
  }

  const rec = await upsertTemplate(parsed.data);
  console.log(`upserted   : ${rec.id}  (${rec.status})  ${rec.storageUrl}`);

  await db
    .update(schema.templates)
    .set({ featured: true, updatedAt: new Date() })
    .where(eq(schema.templates.id, rec.id));
  console.log(`  featured : true ✓`);

  await archiveTemplate("mono");
  console.log(`  archived : mono → removed from gallery ✓`);

  console.log("\nDONE — Obra is live (featured); Mono is gone from the gallery.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
