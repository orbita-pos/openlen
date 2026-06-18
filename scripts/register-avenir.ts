// One-off: register the AVENIR electric-car template (id `avenir`) into the live
// catalog + mark featured. Reuses CreateSchema + upsertTemplate; skips the
// sandbox-unreachable inline screenshot (backfill card assets from local-card-assets.ts).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-avenir.ts

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

async function main(): Promise<void> {
  const html = await readFile("templates/starter/avenir.html", "utf8");
  const payload = {
    id: "avenir",
    name: "Avenir",
    family: "hardware",
    accent: "#2C5BE6",
    pitch: "Página de producto de coche eléctrico de lujo — hero a sangre, stats enormes, carruseles e interior inmersivo.",
    description:
      "Landing de producto de un coche eléctrico de lujo, estilo automotriz premium minimalista: hero fotográfico a pantalla completa, banda de stats, secciones a sangre, carruseles de interior y características, sección oscura de detalles y un cierre 've a cualquier parte'. Base clara, acento azul único.",
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

  console.log("\nDONE — Avenir is live in the gallery (featured).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
