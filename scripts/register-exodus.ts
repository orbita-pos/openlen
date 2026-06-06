// One-off: register the EXODUS aerospace template (id `exodus`) into the live
// catalog + mark featured. Reuses CreateSchema + upsertTemplate; skips the
// sandbox-unreachable inline screenshot (backfill from the box).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-exodus.ts

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

async function main(): Promise<void> {
  const html = await readFile("templates/starter/exodus.html", "utf8");
  const payload = {
    id: "exodus",
    name: "Exodus",
    family: "aerospace",
    accent: "#4F7DF0",
    pitch: "Fully reusable rockets for a future among the stars.",
    description:
      "SpaceX-style aerospace landing — full-viewport mission panels (launch, Mars, vehicles, human spaceflight, satellite network), oversized caps headlines and cinematic monochrome.",
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

  console.log("\nDONE — Exodus is live in the gallery (featured).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
