import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

async function main(): Promise<void> {
  await db.execute(
    sql.raw('ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "visualMetadata" jsonb'),
  );
  console.log("✓ templates.visualMetadata column ensured");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
