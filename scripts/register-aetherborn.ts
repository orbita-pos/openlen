// One-off: register the AETHERBORN gaming template into the live catalog
// (R2 HTML body + Postgres row) and mark it featured. Reuses the same Zod
// validation + upsert as `templates:add`, but skips the inline reference
// screenshot (that step needs GET access to templates.openlen.com /
// images.openlen.com, which this sandbox can't reach — backfill it from the
// box with `templates:capture-screenshots` if desired).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-aetherborn.ts

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

async function main(): Promise<void> {
  const html = await readFile("templates/starter/aetherborn.html", "utf8");
  const payload = {
    id: "aetherborn",
    name: "Aetherborn",
    family: "gaming",
    accent: "#C8AA6E",
    pitch: "El MOBA 5v5 de estrategia y acción.",
    description:
      "Landing épica de videojuego: hero cinematográfico, selector de campeón por clase y showcase de aspectos.",
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
  console.log(`upserted   : ${rec.id}`);
  console.log(`  status   : ${rec.status}`);
  console.log(`  family   : ${rec.family}`);
  console.log(`  hash     : ${rec.contentHash}`);
  console.log(`  size     : ${rec.size} bytes`);
  console.log(`  storage  : ${rec.storageUrl}`);

  await db
    .update(schema.templates)
    .set({ featured: true, updatedAt: new Date() })
    .where(eq(schema.templates.id, rec.id));
  console.log(`  featured : true ✓`);

  console.log("\nDONE — Aetherborn is live in the gallery (featured).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
