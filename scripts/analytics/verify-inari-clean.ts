// Diagnostic: list remaining inari submissions so we can verify the
// Phase D smoke row was deleted and no real lead was nuked.

import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: schema.formSubmissions.id,
      data: schema.formSubmissions.data,
      createdAt: schema.formSubmissions.createdAt,
    })
    .from(schema.formSubmissions)
    .where(
      eq(schema.formSubmissions.projectId, "6c518282-0cb7-4c4e-9d29-30317957ca84"),
    )
    .orderBy(desc(schema.formSubmissions.createdAt))
    .limit(5);

  // eslint-disable-next-line no-console
  console.log(`Remaining inari submissions: ${rows.length}`);
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${r.createdAt?.toISOString() ?? ""}  ${JSON.stringify(r.data).slice(0, 80)}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
