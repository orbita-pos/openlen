import { createHash, randomUUID } from "node:crypto";
import { requireArtifactAccess } from "./access";
import type { ArtifactStore } from "./store";
import { ArtifactError, type ArtifactContext, type ArtifactDatabase, type ArtifactJob, type ArtifactOutput, type ArtifactSql, type JobClaim } from "./types";
import { validateArtifactOutputs } from "./state";

export const ACTIVE_JOB_STATES = ["running", "validating", "storing"] as const;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  throw new ArtifactError("invalid_job_options");
}
const jobRow = (row: Record<string, unknown>) => row as unknown as ArtifactJob;

export async function writeJobEvent(tx: ArtifactSql, job: ArtifactJob, type: string): Promise<void> {
  await tx.query(`insert into "artifactEvents" ("projectId","requestId","artifactId","revision","type","jobId") select "projectId","requestId","id",$2,$3,$4 from "artifacts" where "id"=$1 on conflict do nothing`, [job.artifactId, job.revision, type, job.id]);
}
async function markArtifact(tx: ArtifactSql, job: ArtifactJob, status: string) {
  await tx.query(`update "artifacts" set "status"=$3,"updatedAt"=now() where "id"=$1 and "currentRevision"=$2`, [job.artifactId, job.revision, status]);
}

export function createArtifactJobs(database: ArtifactDatabase, store: ArtifactStore) {
  async function getJob(ctx: ArtifactContext, id: string): Promise<ArtifactJob> {
    const [row] = await database.query(`select j.* from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" where j."id"=$1 and a."projectId"=$2`, [id, ctx.projectId]);
    if (!row) throw new ArtifactError("job_not_found");
    await requireArtifactAccess(database, ctx, String(row.artifactId), "read");
    return jobRow(row);
  }
  async function enqueueArtifactJob(ctx: ArtifactContext, id: string, revision: number, operation: string, options: Readonly<Record<string, unknown>>): Promise<ArtifactJob> {
    if (operation !== "export") throw new ArtifactError("invalid_operation");
    const serialized = JSON.stringify(canonical(options));
    if (Buffer.byteLength(serialized) > 64 * 1024) throw new ArtifactError("invalid_job_options");
    const hash = createHash("sha256").update(serialized).digest("hex");
    await store.sealArtifactRevision(ctx, id, revision);
    return database.transaction(async (tx) => {
      await requireArtifactAccess(tx, ctx, id, "write");
      const [row] = await tx.query(`insert into "artifactJobs" ("id","artifactId","revision","actorId","operation","optionsHash","options") values ($1,$2,$3,$4,$5,$6,$7::jsonb) on conflict ("artifactId","revision","operation","optionsHash") do update set "optionsHash"=excluded."optionsHash" returning *`, [randomUUID(), id, revision, ctx.actorId, operation, hash, serialized]);
      const job = jobRow(row!);
      if (job.status === "queued") await markArtifact(tx, job, "queued");
      await writeJobEvent(tx, job, "queued");
      return job;
    });
  }
  async function contextForJob(job: ArtifactJob, tx: ArtifactSql = database): Promise<ArtifactContext> {
    const [row] = await tx.query(`select a."projectId",a."requestId",a."createdBy",p."userId" as "ownerId" from "artifacts" a join "projects" p on p."id"=a."projectId" where a."id"=$1`, [job.artifactId]);
    if (!row) throw new ArtifactError("artifact_not_found");
    return { actorId: job.actorId ?? String(row.createdBy), ownerId: String(row.ownerId), projectId: String(row.projectId), requestId: String(row.requestId), role: "dueno" };
  }
  async function claimArtifactJob(workerId: string): Promise<JobClaim | null> {
    if (!workerId || workerId.length > 128) throw new ArtifactError("invalid_worker_id");
    return database.transaction(async (tx) => {
      // Serialize admission, not rendering. The initial operational limit is one
      // heavy renderer, even if two worker processes overlap during a restart.
      await tx.query(`select pg_advisory_xact_lock(hashtext('openlen.artifact.claim'))`);
      const expired = await tx.query(`update "artifactJobs" set "status"=case when "externalStartedAt" is not null then 'needs_attention' when "cancelRequested" then 'cancelled' else 'failed' end,"errorCode"=case when "externalStartedAt" is not null then 'external_outcome_unknown' when "cancelRequested" then 'user_cancelled' else 'retry_limit' end,"updatedAt"=now() where "status" in ('running','validating','storing') and "leaseUntil"<=now() and ("externalStartedAt" is not null or "attempt">=3 or "cancelRequested") returning *`);
      for (const row of expired) { const job = jobRow(row); await markArtifact(tx, job, job.status); await writeJobEvent(tx, job, job.status); }
      const [count] = await tx.query(`select count(*)::int as n from "artifactJobs" where "status" in ('running','validating','storing') and "leaseUntil">now()`);
      if (Number(count!.n) >= 1) return null;
      for (let n = 0; n < 50; n++) {
        const [row] = await tx.query(`select j.* from "artifactJobs" j join "artifactRevisions" r on r."artifactId"=j."artifactId" and r."revision"=j."revision" where (j."status"='queued' or (j."status" in ('running','validating','storing') and j."leaseUntil"<=now() and j."externalStartedAt" is null)) and not j."cancelRequested" and not exists (select 1 from jsonb_array_elements(r."dependencies") d left join "artifactRevisions" dep on dep."artifactId"=d->>'artifactId' and dep."revision"=(d->>'revision')::integer where dep."artifactId" is null or jsonb_array_length(dep."outputs")=0 or dep."evidence"->>'valid' is distinct from 'true') order by j."createdAt",j."id" for update of j skip locked limit 1`);
        if (!row) return null;
        const candidate = jobRow(row);
        try { await requireArtifactAccess(tx, await contextForJob(candidate, tx), candidate.artifactId, "write"); }
        catch (error) {
          if (!(error instanceof ArtifactError)) throw error;
          await tx.query(`update "artifactJobs" set "status"='failed',"errorCode"='access_revoked' where "id"=$1`, [candidate.id]);
          await markArtifact(tx, candidate, "failed"); await writeJobEvent(tx, candidate, "failed"); continue;
        }
        const token = randomUUID();
        const [claimed] = await tx.query(`update "artifactJobs" set "status"='running',"attempt"="attempt"+1,"workerId"=$2,"fencingToken"=$3,"leaseUntil"=now()+interval '30 seconds',"updatedAt"=now() where "id"=$1 returning *`, [candidate.id, workerId, token]);
        const job = jobRow(claimed!);
        await markArtifact(tx, job, "running"); await writeJobEvent(tx, job, "running");
        return { job, workerId, fencingToken: token, leaseUntil: job.leaseUntil! };
      }
      return null;
    });
  }
  async function heartbeat(claim: JobClaim): Promise<boolean> {
    const rows = await database.query(`update "artifactJobs" set "leaseUntil"=now()+interval '30 seconds' where "id"=$1 and "workerId"=$2 and "fencingToken"=$3 and "leaseUntil">now() and not "cancelRequested" and "status" in ('running','validating','storing') returning "id"`, [claim.job.id, claim.workerId, claim.fencingToken]);
    return rows.length === 1;
  }
  async function advance(claim: JobClaim, status: "validating" | "storing"): Promise<void> {
    const previous = status === "validating" ? "running" : "validating";
    const rows = await database.query(`update "artifactJobs" set "status"=$4,"updatedAt"=now() where "id"=$1 and "workerId"=$2 and "fencingToken"=$3 and "leaseUntil">now() and not "cancelRequested" and "status"=$5 returning *`, [claim.job.id, claim.workerId, claim.fencingToken, status, previous]);
    if (rows.length !== 1) throw new ArtifactError("lease_lost");
    await markArtifact(database, jobRow(rows[0]!), status);
  }
  async function startExternalCall(claim: JobClaim): Promise<void> {
    const rows = await database.query(`update "artifactJobs" set "externalStartedAt"=now() where "id"=$1 and "workerId"=$2 and "fencingToken"=$3 and "status"='running' and "leaseUntil">now() and not "cancelRequested" and "externalStartedAt" is null returning "id"`, [claim.job.id, claim.workerId, claim.fencingToken]);
    if (rows.length !== 1) throw new ArtifactError("lease_lost");
  }
  async function trackOutputObjects(claim: JobClaim, outputs: readonly ArtifactOutput[]): Promise<void> {
    validateArtifactOutputs(outputs);
    await database.transaction(async (tx) => {
      const [job] = await tx.query(`select "id" from "artifactJobs" where "id"=$1 and "fencingToken"=$2 and "workerId"=$3 and "leaseUntil">now() and "status"='storing' and not "cancelRequested" for update`, [claim.job.id, claim.fencingToken, claim.workerId]);
      if (!job) throw new ArtifactError("lease_lost");
      for (const output of outputs) await tx.query(`insert into "artifactObjectGarbage" ("key","artifactId","revision","jobId","fencingToken") values ($1,$2,$3,$4,$5) on conflict do nothing`, [output.key, claim.job.artifactId, claim.job.revision, claim.job.id, claim.fencingToken]);
    });
  }
  async function finish(claim: JobClaim, status: "failed" | "cancelled" | "needs_attention", code: string): Promise<void> {
    await database.transaction(async (tx) => {
      const [row] = await tx.query(`update "artifactJobs" set "status"=$4,"errorCode"=$5,"updatedAt"=now() where "id"=$1 and "workerId"=$2 and "fencingToken"=$3 and "leaseUntil">now() and "status" in ('running','validating','storing') returning *`, [claim.job.id, claim.workerId, claim.fencingToken, status, code]);
      if (!row) throw new ArtifactError("lease_lost");
      const job = jobRow(row); await markArtifact(tx, job, status); await writeJobEvent(tx, job, status);
    });
  }
  async function cancelArtifactJob(ctx: ArtifactContext, id: string): Promise<void> {
    const before = await getJob(ctx, id);
    await requireArtifactAccess(database, ctx, before.artifactId, "write");
    await database.transaction(async (tx) => {
      const [row] = await tx.query(`update "artifactJobs" set "cancelRequested"=true,"status"=case when "status"='queued' then 'cancelled' else "status" end,"updatedAt"=now() where "id"=$1 and "status" in ('queued','running','validating','storing') returning *`, [id]);
      if (row?.status === "cancelled") { const job = jobRow(row); await markArtifact(tx, job, "cancelled"); await writeJobEvent(tx, job, "cancelled"); }
    });
  }
  return { getJob, enqueueArtifactJob, claimArtifactJob, heartbeat, advance, startExternalCall, trackOutputObjects, finish, cancelArtifactJob, contextForJob };
}
export type ArtifactJobs = ReturnType<typeof createArtifactJobs>;
