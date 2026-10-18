import { requireArtifactAccess, requireProjectAccess } from "./access";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase, type ArtifactEvent } from "./types";

const cursorValue = (v: string) => { if (!/^\d{1,19}$/.test(v) || BigInt(v) > 9223372036854775807n) throw new ArtifactError("invalid_cursor"); return v; };
export function createArtifactEvents(database: ArtifactDatabase) {
  async function listArtifactEvents(ctx: ArtifactContext, after: string, limit = 100): Promise<ArtifactEvent[]> {
    await requireProjectAccess(database, ctx);
    const rows = await database.query(`select e.* from "artifactEvents" e join "artifacts" a on a."id"=e."artifactId" where e."projectId"=$1 and e."cursor">$2::bigint and (a."visibility"='project' or $3=$4) order by e."cursor" limit $5`, [ctx.projectId, cursorValue(after), ctx.actorId, ctx.ownerId, Math.min(100, Math.max(1, Math.floor(limit)))]);
    const result: ArtifactEvent[] = [];
    for (const row of rows) {
      try { await requireArtifactAccess(database, ctx, String(row.artifactId), "read"); }
      catch (error) { if (error instanceof ArtifactError) continue; throw error; }
      result.push({ ...row, cursor: String(row.cursor) } as unknown as ArtifactEvent);
    }
    return result;
  }
  async function acknowledge(ctx: ArtifactContext, cursor: string): Promise<void> {
    await requireProjectAccess(database, ctx);
    await database.query(`insert into "artifactEventReads" ("projectId","userId","cursor") values ($1,$2,least($3::bigint,coalesce((select max("cursor") from "artifactEvents" where "projectId"=$1),0))) on conflict ("projectId","userId") do update set "cursor"=greatest("artifactEventReads"."cursor",excluded."cursor")`, [ctx.projectId, ctx.actorId, cursorValue(cursor)]);
  }
  async function lastRead(ctx: ArtifactContext): Promise<string> {
    await requireProjectAccess(database, ctx);
    const [row] = await database.query(`select "cursor" from "artifactEventReads" where "projectId"=$1 and "userId"=$2`, [ctx.projectId, ctx.actorId]);
    return row ? String(row.cursor) : "0";
  }
  return { listArtifactEvents, acknowledge, lastRead };
}
