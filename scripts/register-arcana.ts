// One-off: register the ARCANA fighting-saga portal template (id `arcana`) into
// the live catalog + mark featured. Reuses CreateSchema + upsertTemplate; skips
// the sandbox-unreachable inline screenshot (backfill thumbnails/tiles from the box).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-arcana.ts

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

async function main(): Promise<void> {
  const html = await readFile("templates/starter/arcana.html", "utf8");
  const payload = {
    id: "arcana",
    name: "Arcana",
    family: "gaming",
    accent: "#F2C200",
    pitch: "Portal de saga de lucha — 8 campeones arcanos, key-art cinematográfico y filmstrip de roster.",
    description:
      "Portal oficial de una saga de videojuego de lucha al estilo King of Fighters: hero full-bleed con key-art, tipografía pesada en itálica, acento amarillo sobre negro, base de datos de personajes y filmstrip de roster.",
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

  console.log("\nDONE — Arcana is live in the gallery (featured).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
