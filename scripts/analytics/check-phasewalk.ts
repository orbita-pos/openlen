// Diagnostic: print the current DB row for bio-phasewalk.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const r = await db
    .select({
      id: schema.templates.id,
      contentHash: schema.templates.contentHash,
      storageKey: schema.templates.storageKey,
      storageUrl: schema.templates.storageUrl,
      size: schema.templates.size,
      updatedAt: schema.templates.updatedAt,
    })
    .from(schema.templates)
    .where(eq(schema.templates.id, "bio-phasewalk"))
    .limit(1);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(r[0], null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
