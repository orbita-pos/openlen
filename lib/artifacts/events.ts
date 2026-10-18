import { requireArtifactAccess, requireProjectAccess } from "./access";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase, type ArtifactEvent } from "./types";

const cursorValue = (v: string) => { if (!/^\d{1,19}$/.test(v) || BigInt(v) > 9223372036854775807n) throw new ArtifactError("invalid_cursor"); return v; };
export function createArtifactEvents(database: ArtifactDatabase) {
  async function readArtifactEventPage(ctx: ArtifactContext, after: string, limit = 100): Promise<{events:ArtifactEvent[];cursor:string}> {
    await requireProjectAccess(database, ctx);
    if(!Number.isFinite(limit))throw new ArtifactError("invalid_event_limit");
    const rows = await database.query(`select e.* from "artifactEvents" e where e."projectId"=$1 and e."cursor">$2::bigint order by e."cursor" limit $3`, [ctx.projectId, cursorValue(after), Math.min(100, Math.max(1, Math.floor(limit)))]);
    const result: ArtifactEvent[] = [];
    for (const row of rows) {
      try { await requireArtifactAccess(database, ctx, String(row.artifactId), "read"); }
      catch (error) { if (error instanceof ArtifactError) continue; throw error; }
      result.push({ ...row, cursor: String(row.cursor) } as unknown as ArtifactEvent);
    }
    // Scanning is not acknowledging. Advance across hidden rows while keeping
    // per-person read state untouched and never exposing their artifact ids.
    return {events:result,cursor:rows.length?String(rows.at(-1)!.cursor):after};
  }
  async function listArtifactEvents(ctx:ArtifactContext,after:string,limit=100):Promise<ArtifactEvent[]>{return (await readArtifactEventPage(ctx,after,limit)).events;}
  async function acknowledge(ctx: ArtifactContext, cursor: string): Promise<void> {
    await requireProjectAccess(database, ctx);
    await database.query(`insert into "artifactEventReads" ("projectId","userId","cursor") values ($1,$2,least($3::bigint,coalesce((select max("cursor") from "artifactEvents" where "projectId"=$1),0))) on conflict ("projectId","userId") do update set "cursor"=greatest("artifactEventReads"."cursor",excluded."cursor")`, [ctx.projectId, ctx.actorId, cursorValue(cursor)]);
  }
  async function lastRead(ctx: ArtifactContext): Promise<string> {
    await requireProjectAccess(database, ctx);
    const [row] = await database.query(`select "cursor" from "artifactEventReads" where "projectId"=$1 and "userId"=$2`, [ctx.projectId, ctx.actorId]);
    return row ? String(row.cursor) : "0";
  }
  return { listArtifactEvents, readArtifactEventPage, acknowledge, lastRead };
}
