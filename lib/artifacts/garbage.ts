import type { ArtifactDatabase } from "./types";
import type { ArtifactStorage } from "./private-storage";

/** Delayed object outbox: never delete a referenced or uncertain result. */
export async function collectArtifactGarbage(database: ArtifactDatabase, storage: ArtifactStorage, limit = 100): Promise<number> {
  const rows = await database.query(`select g."key" from "artifactObjectGarbage" g where g."notBefore"<=now() and not exists (select 1 from "artifactRevisions" r where r."artifactId"=g."artifactId" and r."revision"=g."revision" and r."outputs" @> jsonb_build_array(jsonb_build_object('key',g."key"))) and not exists (select 1 from "artifactJobs" j where j."id"=g."jobId" and (j."status"='needs_attention' or (j."fencingToken"=g."fencingToken" and j."status" in ('running','validating','storing') and j."leaseUntil">now()))) order by g."notBefore" limit $1`, [Math.min(100, Math.max(1, Math.floor(limit)))]);
  let removed = 0;
  for (const row of rows) {
    try {
      await storage.delete(String(row.key));
      await database.query(`delete from "artifactObjectGarbage" where "key"=$1`, [row.key]);
      removed++;
    } catch { /* Keep the outbox entry for a later retry. */ }
  }
  return removed;
}
