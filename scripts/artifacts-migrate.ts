import { createArtifactDatabase } from "../lib/artifacts/database";
import { ARTIFACT_MIGRATION_SQL } from "../lib/artifacts/migration";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const database = createArtifactDatabase(process.env.DATABASE_URL);
  try {
    await database.transaction((tx) => tx.query(ARTIFACT_MIGRATION_SQL));
    console.log("artifacts: tables, indexes and immutable revisions ready");
  } finally { await database.close(); }
}
main().catch(() => { console.error("artifacts migration failed; no changes committed"); process.exitCode = 1; });
