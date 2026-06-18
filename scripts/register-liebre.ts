// One-off: register the LIEBRE streetwear template (id `liebre`) into the live
// catalog + mark featured. Reuses CreateSchema + upsertTemplate; skips the
// sandbox-unreachable inline screenshot (backfill card assets from local-card-assets.ts).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-liebre.ts

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

async function main(): Promise<void> {
  const html = await readFile("templates/starter/liebre.html", "utf8");
  const payload = {
    id: "liebre",
    name: "Liebre",
    family: "fashion",
    accent: "#FF1F6B",
    pitch: "Marca de streetwear con mascota 3D — hero color-block, drops numerados, tienda y manifiesto.",
    description:
      "Landing de marca de ropa/streetwear estilo character-brand: hero split con una mascota 3D, marquee de drops, beneficios, tienda de productos y manifiesto. Acento magenta único sobre negro, tipografía pesada.",
    mode: "dark",
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

  console.log("\nDONE — Liebre is live in the gallery (featured).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
