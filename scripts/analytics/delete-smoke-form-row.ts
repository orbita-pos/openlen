// Surgical delete of the Phase D smoke form submission. Matches on the
// data->>'name' = 'Phase D Smoke' JSONB field so we only touch that row.

import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const result = await db
    .delete(schema.formSubmissions)
    .where(
      sql`${schema.formSubmissions.data}->>'name' IN ('Phase D Smoke', 'Phase D Real Test', 'Phase D Final', 'Post DNS Test')`,
    )
    .returning({ id: schema.formSubmissions.id });
  // eslint-disable-next-line no-console
  console.log(`Deleted ${result.length} smoke row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
