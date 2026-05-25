// One-shot bootstrap: add `featured` boolean column to templates + mark
// the 3 hand-curated top-tier templates as featured. Idempotent.

import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const FEATURED_IDS = ["lume", "kiri", "mundial-26"] as const;

async function main(): Promise<void> {
  // Add column if missing.
  await db.execute(
    sql.raw(
      `ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "featured" boolean NOT NULL DEFAULT false`,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`✓ templates.featured column ensured`);

  // Mark the 3 curated top-tier as featured. Anything else stays false.
  await db
    .update(schema.templates)
    .set({ featured: true })
    .where(inArray(schema.templates.id, [...FEATURED_IDS] as string[]));
  // eslint-disable-next-line no-console
  console.log(`✓ marked featured: ${FEATURED_IDS.join(", ")}`);

  // Defensive: ensure NO other template is accidentally marked featured.
  await db
    .update(schema.templates)
    .set({ featured: false })
    .where(
      sql`${schema.templates.id} NOT IN (${sql.join(
        FEATURED_IDS.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

  // Verify.
  const rows = await db
    .select({ id: schema.templates.id, featured: schema.templates.featured })
    .from(schema.templates)
    .where(eq(schema.templates.featured, true));
  // eslint-disable-next-line no-console
  console.log(`\nFinal featured set (${rows.length} rows):`);
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(`  ${r.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
