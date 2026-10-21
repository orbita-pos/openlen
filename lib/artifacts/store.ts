import { randomUUID } from "node:crypto";
import { safeArtifactPath, validateArtifactFiles, validateArtifactOutputs } from "./state";
import { requireArtifactAccess, requireProjectAccess, validateDependencies } from "./access";
import { withReferencedDependencies } from "./references";
import {
  ArtifactError, isArtifactError, type Artifact, type ArtifactContext, type ArtifactDatabase, type ArtifactEvidence,
  type ArtifactKind, type ArtifactOutput, type ArtifactRequest, type ArtifactRevision,
  type ArtifactSql, type ArtifactVisibility, type JobClaim,
} from "./types";

export const artifactRow = (r: Record<string, unknown>) => r as unknown as Artifact;
export const revisionRow = (r: Record<string, unknown>) => r as unknown as ArtifactRevision;

export function createArtifactStore(database: ArtifactDatabase) {
  async function getArtifact(ctx: ArtifactContext, id: string, tx: ArtifactSql = database, lock = false): Promise<Artifact> {
    return requireArtifactAccess(tx, ctx, id, "read", new Set(), lock);
  }
  async function getRevision(ctx: ArtifactContext, id: string, revision: number, tx: ArtifactSql = database): Promise<ArtifactRevision> {
    await getArtifact(ctx, id, tx);
    const [row] = await tx.query(`select * from "artifactRevisions" where "artifactId"=$1 and "revision"=$2`, [id, revision]);
    if (!row) throw new ArtifactError("revision_not_found");
    return revisionRow(row);
  }
  async function ensureArtifactRequest(ctx: Omit<ArtifactContext, "requestId">, messageId: string): Promise<ArtifactRequest> {
    if (!messageId || messageId.length > 256) throw new ArtifactError("invalid_message_id");
    await requireProjectAccess(database, ctx, "write");
    const [row] = await database.query(`insert into "artifactRequests" ("id","projectId","sourceMessageId","createdBy") values ($1,$2,$3,$4) on conflict ("projectId","sourceMessageId") do update set "sourceMessageId"=excluded."sourceMessageId" returning *`, [randomUUID(), ctx.projectId, messageId, ctx.actorId]);
    return row as unknown as ArtifactRequest;
  }
  async function createArtifact(ctx: ArtifactContext, input: { kind: ArtifactKind; title: string; brief: string; visibility: ArtifactVisibility; itemKey?: string }): Promise<Artifact> {
    if (!["dashboard", "slides", "image", "motion", "audio"].includes(input.kind) || !["owner", "project"].includes(input.visibility)
      || !input.title?.trim() || input.title.length > 200 || typeof input.brief !== "string" || input.brief.length > 20_000
      || (input.itemKey !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(input.itemKey))) throw new ArtifactError("invalid_artifact");
    return database.transaction(async (tx) => {
      await requireProjectAccess(tx, ctx, "write");
      const [request] = await tx.query(`select "id" from "artifactRequests" where "id"=$1 and "projectId"=$2`, [ctx.requestId, ctx.projectId]);
      if (!request) throw new ArtifactError("request_not_found");
      const id = randomUUID();
      const [row] = await tx.query(`insert into "artifacts" ("id","projectId","requestId","kind","title","brief","createdBy","visibility","itemKey") values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict ("requestId","itemKey") do update set "itemKey"=excluded."itemKey" returning *`, [id, ctx.projectId, ctx.requestId, input.kind, input.title.trim(), input.brief, ctx.actorId, input.visibility, input.itemKey ?? null]);
      if (row!.kind !== input.kind) throw new ArtifactError("artifact_item_conflict");
      await requireArtifactAccess(tx, ctx, String(row!.id), "write");
      await tx.query(`insert into "artifactRevisions" ("artifactId","revision") values ($1,0) on conflict do nothing`, [row!.id]);
      return artifactRow(row!);
    });
  }
  async function writeArtifactFiles(ctx: ArtifactContext, id: string, expectedRevision: number, files: Readonly<Record<string, string>>,
    metadata: Partial<Pick<ArtifactRevision, "manifest" | "dependencies" | "sourceRef">> & { removePaths?: readonly string[]; ownerOnly?: boolean } = {}): Promise<ArtifactRevision> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ArtifactError("invalid_revision");
    const validated = validateArtifactFiles(files);
    return database.transaction(async (tx) => {
      await requireArtifactAccess(tx, ctx, id, "write");
      if (metadata.ownerOnly) await requireProjectAccess(tx, ctx, "data");
      const artifact = await getArtifact(ctx, id, tx, true);
      if (artifact.currentRevision !== expectedRevision) throw new ArtifactError("revision_conflict");
      const before = await getRevision(ctx, id, expectedRevision, tx);
      const privateDependency = await validateDependencies(tx, ctx, id, metadata.dependencies ?? before.dependencies);
      const combined = validateArtifactFiles({ ...before.files, ...validated });
      for (const path of metadata.removePaths ?? []) {
        if (!safeArtifactPath(path)) throw new ArtifactError("invalid_source_path");
        delete combined[path];
      }
      const [row] = await tx.query(`insert into "artifactRevisions" ("artifactId","revision","files","manifest","dependencies","sourceRef") values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) returning *`,
        [id, expectedRevision + 1, JSON.stringify(combined), JSON.stringify(metadata.manifest ?? before.manifest), JSON.stringify(metadata.dependencies ?? before.dependencies), JSON.stringify(metadata.sourceRef === undefined ? before.sourceRef : metadata.sourceRef)]);
      await tx.query(`update "artifacts" set "currentRevision"=$2,"status"='draft',"visibility"=case when $3 then 'owner' else "visibility" end,"updatedAt"=now() where "id"=$1`, [id, expectedRevision + 1, privateDependency || metadata.ownerOnly === true]);
      return revisionRow(row!);
    });
  }
  async function sealArtifactRevision(ctx: ArtifactContext, id: string, expectedRevision: number): Promise<ArtifactRevision> {
    return database.transaction(async (tx) => {
      await requireArtifactAccess(tx, ctx, id, "write");
      const artifact = await getArtifact(ctx, id, tx, true);
      if (artifact.currentRevision !== expectedRevision) throw new ArtifactError("revision_conflict");
      const before = await getRevision(ctx, id, expectedRevision, tx);
      if (before.sealedAt) return before;
      if (Object.keys(before.files).length === 0) throw new ArtifactError("empty_sources");
      const dependencies = withReferencedDependencies(before.dependencies, before.files);
      let privateDependency = false;
      try { privateDependency = await validateDependencies(tx, ctx, id, dependencies); }
      catch (error) {
        const named = dependencies.filter((d) => !before.dependencies.some((b) => b.artifactId === d.artifactId)).map((d) => `${d.artifactId}@${d.revision}`);
        if (isArtifactError(error) && named.length && error.message === error.code) throw new ArtifactError(error.code, `the sources name ${named.join(", ")}; check those ids with list_artifacts/inspect_artifact`);
        throw error;
      }
      const [row] = await tx.query(`update "artifactRevisions" set "sealedAt"=now(),"dependencies"=$3::jsonb where "artifactId"=$1 and "revision"=$2 returning *`, [id, expectedRevision, JSON.stringify(dependencies)]);
      if (privateDependency) await tx.query(`update "artifacts" set "visibility"='owner',"updatedAt"=now() where "id"=$1`, [id]);
      return revisionRow(row!);
    });
  }
  async function recordArtifactResult(claim: JobClaim, result: { outputs: readonly ArtifactOutput[]; evidence: ArtifactEvidence; settle?: (tx: ArtifactSql) => Promise<void> }): Promise<Artifact> {
    validateArtifactOutputs(result.outputs);
    if (result.evidence?.valid !== true || !result.evidence.checks?.length || !Number.isFinite(Date.parse(result.evidence.checkedAt))) throw new ArtifactError("invalid_evidence");
    return database.transaction(async (tx) => {
      const [job] = await tx.query(`select j.*, a."projectId",a."createdBy",p."userId" as "ownerId" from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" join "projects" p on p."id"=a."projectId" where j."id"=$1 for update of j`, [claim.job.id]);
      if (!job || job.fencingToken !== claim.fencingToken || job.workerId !== claim.workerId) throw new ArtifactError("lease_lost");
      const context = { projectId: job.projectId, actorId: job.actorId ?? job.createdBy, ownerId: job.ownerId, requestId: "", role: "dueno" } as ArtifactContext;
      await requireArtifactAccess(tx, context, String(job.artifactId), "write");
      if (job.status === "completed") return getArtifact(context, String(job.artifactId), tx);
      const [active] = await tx.query(`update "artifactJobs" set "status"='completed',"updatedAt"=now() where "id"=$1 and "fencingToken"=$2 and "leaseUntil">now() and not "cancelRequested" and "status"='storing' returning *`, [job.id, claim.fencingToken]);
      if (!active) throw new ArtifactError("lease_lost");
      // Paid settlement and publication share this exact transaction. A crash
      // cannot publish uncharged work or debit an unavailable result.
      await result.settle?.(tx);
      // Append verified exports atomically. Existing download indexes remain
      // stable when another format of the same sealed revision is exported.
      const [sealed] = await tx.query(`update "artifactRevisions" set "outputs"="outputs" || $3::jsonb,"evidence"=$4::jsonb where "artifactId"=$1 and "revision"=$2 and "sealedAt" is not null returning "artifactId"`, [job.artifactId, job.revision, JSON.stringify(result.outputs), JSON.stringify(result.evidence)]);
      if (!sealed) throw new ArtifactError("revision_not_sealed");
      const [artifact] = await tx.query(`update "artifacts" set "lastReadyRevision"=greatest(coalesce("lastReadyRevision",-1),$2),"status"=case when "currentRevision"=$2 then 'ready' else "status" end,"updatedAt"=now() where "id"=$1 returning *`, [job.artifactId, job.revision]);
      await tx.query(`insert into "artifactEvents" ("projectId","requestId","artifactId","revision","type","jobId") values ($1,$2,$3,$4,'ready',$5) on conflict do nothing`, [artifact!.projectId, artifact!.requestId, job.artifactId, job.revision, job.id]);
      return artifactRow(artifact!);
    });
  }
  return { ensureArtifactRequest, createArtifact, getArtifact, getRevision, writeArtifactFiles, sealArtifactRevision, recordArtifactResult };
}
export type ArtifactStore = ReturnType<typeof createArtifactStore>;
