// Delete the smoke-test row inserted by smoke-beacon.ts so it doesn't
// skew the real Insights dashboard. Match-and-delete by the unique
// referrer marker the smoke script set.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const r = await db
    .delete(schema.pageEvents)
    .where(eq(schema.pageEvents.referrer, "smoke-test"));
  // eslint-disable-next-line no-console
  console.log(`Deleted ${r.rowCount ?? 0} smoke-test rows.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
