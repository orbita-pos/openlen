// One-off: register the SPORTS family templates into the live catalog
// (R2 HTML body + Postgres row) and mark them featured. Reuses the same Zod
// validation + upsert as `templates:add`, but skips the inline reference
// screenshot (that step needs GET access to templates.openlen.com /
// images.openlen.com, which this sandbox can't reach — backfill it from the
// box with `templates:capture-screenshots` after deploy).
//
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/register-sports.ts
//
// Pre-req: run scripts/upload-sports-images.ts first so the poster URLs resolve.

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { upsertTemplate } from "@/lib/templates/store";
import { CreateSchema } from "@/lib/templates/admin-schemas";

const TEMPLATES = [
  {
    id: "apex-freedom",
    name: "Apex Freedom",
    accent: "#d20a0a",
    mode: "dark",
    pitch: "La jaula te espera — MMA en su máxima expresión.",
    description:
      "Landing de evento de MMA: hero cinematográfico de cartelera, peleas estelares, rankings de peleadores y CTA de entradas.",
  },
  {
    id: "champions-final",
    name: "Champions Final",
    accent: "#1330c8",
    mode: "dark",
    pitch: "La final que define la temporada.",
    description:
      "Landing de liga de fútbol: hero con carrusel de fotos del equipo, calendario de partidos, plantilla y últimas noticias.",
  },
  {
    id: "vegas-faceoff",
    name: "Vegas Faceoff",
    accent: "#c8102e",
    mode: "dark",
    pitch: "Cara a cara — la noche de boxeo de Las Vegas.",
    description:
      "Landing de velada de boxeo: hero de careo, cartelera de combates, rankings y entradas, en clave noir de Las Vegas.",
  },
] as const;

async function main(): Promise<void> {
  for (const t of TEMPLATES) {
    const html = await readFile(`templates/starter/${t.id}.html`, "utf8");
    const payload = { ...t, family: "sports", html, status: "published" };
    const parsed = CreateSchema.safeParse(payload);
    if (!parsed.success) {
      console.error(`Invalid payload (${t.id}):`, JSON.stringify(parsed.error.flatten(), null, 2));
      process.exit(1);
    }
    const rec = await upsertTemplate(parsed.data);
    await db
      .update(schema.templates)
      .set({ featured: true, updatedAt: new Date() })
      .where(eq(schema.templates.id, rec.id));
    console.log(`${rec.id.padEnd(16)} upserted ${String(rec.size).padStart(6)}b  featured ✓  ${rec.storageUrl}`);
  }
  console.log("\nDONE — 3 sports templates live in the gallery (featured).");
  console.log("Follow-up (from the box, post-deploy): npm run templates:capture-screenshots");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
