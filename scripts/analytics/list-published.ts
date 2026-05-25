// One-shot — list every project that has a live subdomain so the
// snippet-injection republish script knows what to target.

import { and, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: schema.projects.id,
      subdomain: schema.projects.subdomain,
      userId: schema.projects.userId,
      publishedAt: schema.projects.publishedAt,
      publishedReleaseSha: schema.projects.publishedReleaseSha,
    })
    .from(schema.projects)
    .where(
      and(
        isNotNull(schema.projects.subdomain),
        isNotNull(schema.projects.publishedAt),
      ),
    );

  // eslint-disable-next-line no-console
  console.log(`Found ${rows.length} published projects:\n`);
  for (const r of rows) {
    // eslint-disable-next-line no-console
    console.log(
      `  ${(r.subdomain ?? "").padEnd(28)} ${r.publishedReleaseSha ?? "(no sha)"}  ${r.publishedAt?.toISOString() ?? ""}`,
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
