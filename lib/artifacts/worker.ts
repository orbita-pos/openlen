import { createHash } from "node:crypto";
import { requireArtifactAccess } from "./access";
import { validateAdapterResult } from "./contracts";
import { datasetsFromRevision } from "./data";
import { resolveArtifactAssets } from "./assets";
import type {ArtifactAudioUploads} from "./assets";
import type { ArtifactBilling } from "./billing";
import type { ArtifactJobs } from "./jobs";
import type { ArtifactStorage } from "./private-storage";
import type { ArtifactStore } from "./store";
import { ArtifactError, type ArtifactAdapter, type ArtifactDatabase, type ArtifactKind, type ArtifactOutput, type JobClaim, type JobOutcome } from "./types";

export interface ArtifactWorkerDeps {
  readonly database: ArtifactDatabase;
  readonly store: ArtifactStore;
  readonly jobs: ArtifactJobs;
  readonly storage: ArtifactStorage;
  readonly adapters: Partial<Record<ArtifactKind, ArtifactAdapter>>;
  readonly billing?: ArtifactBilling;
  readonly audioUploads?:ArtifactAudioUploads;
}

export async function runArtifactJob(claim: JobClaim, deps: ArtifactWorkerDeps, signal: AbortSignal): Promise<JobOutcome> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let externalStarted = false;
  let externalOutcomeKnown = false;
  let commitStarted = false;
  const stored: string[] = [];
  const timer = setInterval(() => { void deps.jobs.heartbeat(claim).then((ok) => { if (!ok) controller.abort(new ArtifactError("lease_lost")); }, () => controller.abort(new ArtifactError("heartbeat_failed"))); }, 10_000);
  timer.unref();
  try {
    controller.signal.throwIfAborted();
    const ctx = await deps.jobs.contextForJob(claim.job);
    const artifact = await requireArtifactAccess(deps.database, ctx, claim.job.artifactId, "write");
    const revision = await deps.store.getRevision(ctx, artifact.id, claim.job.revision);
    if (!revision.sealedAt) throw new ArtifactError("revision_not_sealed");
    const adapter = deps.adapters[artifact.kind];
    if (!adapter) throw new ArtifactError("format_unavailable");
    const assets = await resolveArtifactAssets(ctx, revision, deps.store, deps.storage,deps.audioUploads,deps.database);
    const result = await adapter({ artifact, revision, assets, datasets: datasetsFromRevision(revision), jobOptions: claim.job.options,jobIdentity:{id:claim.job.id,fencingToken:claim.fencingToken} }, controller.signal, {
      beforeIsolatedRender:async()=>{controller.signal.throwIfAborted();if(!await deps.jobs.heartbeat(claim))throw new ArtifactError("lease_lost");},
      beforeExternalCall: async (model) => {
        if (!deps.billing || !model) throw new ArtifactError("charge_policy_unavailable");
        await deps.billing.startAttempt(claim, ctx, artifact.kind, model); externalStarted = true;
      },
      recordExternalOutcome: async (outcome) => {
        if (!externalStarted || !deps.billing) throw new ArtifactError("external_attempt_missing");
        await deps.billing.recordOutcome(claim, outcome); externalOutcomeKnown = outcome.outcome !== "unknown";
      },
    });
    controller.signal.throwIfAborted();
    await deps.jobs.advance(claim, "validating");
    validateAdapterResult(result);
    await deps.jobs.advance(claim, "storing");
    const outputs: ArtifactOutput[] = result.outputs.map((file) => {
      const hash = createHash("sha256").update(file.bytes).digest("hex");
      return { key: `${artifact.projectId}/${artifact.id}/${revision.revision}/${claim.job.id}/${claim.fencingToken}/${hash}/${file.name}`, hash, bytes: file.bytes.length, mime: file.mime, format: file.format };
    });
    // Register cleanup before the first write, including uncertain uploads and
    // objects whose project is deleted while this renderer is still running.
    await deps.jobs.trackOutputObjects(claim, outputs);
    for (const [index, file] of result.outputs.entries()) {
      controller.signal.throwIfAborted();
      const { key, hash } = outputs[index]!;
      await deps.storage.put(key, file.bytes); stored.push(key);
      const actual = await deps.storage.get(key);
      if (actual.length !== file.bytes.length || createHash("sha256").update(actual).digest("hex") !== hash) throw new ArtifactError("stored_output_corrupt");
    }
    controller.signal.throwIfAborted();
    commitStarted = true;
    await deps.store.recordArtifactResult(claim, { outputs, evidence: result.evidence, ...(externalStarted ? { settle: async (tx) => { await deps.billing!.settleArtifactAttempt(tx, claim); } } : {}) });
    return { jobId: claim.job.id, status: "completed" };
  } catch (error) {
    if (commitStarted) {
      const [committed] = await deps.database.query(`select "status" from "artifactJobs" where "id"=$1`, [claim.job.id]).catch(() => []);
      if (committed?.status === "completed") return { jobId: claim.job.id, status: "completed" };
      // A failed COMMIT response does not prove rollback. Leave the objects for
      // reconciliation rather than deleting bytes that may already be visible.
    } else for (const key of stored) await deps.storage.delete(key).catch(() => undefined);
    const [latest] = await deps.database.query(`select "cancelRequested" from "artifactJobs" where "id"=$1`, [claim.job.id]).catch(() => []);
    const cancelled = signal.aborted || latest?.cancelRequested === true;
    let auditFailed = false;
    if (externalStarted && !commitStarted) await deps.billing?.recordFailure(claim).catch(() => { auditFailed = true; });
    const unknownExternal = externalStarted && !externalOutcomeKnown;
    const cleanupUnknown=error instanceof ArtifactError&&error.code==="renderer_cleanup_unknown";
    const status = unknownExternal || commitStarted || auditFailed || cleanupUnknown ? "needs_attention" : cancelled ? "cancelled" : "failed";
    const code = cleanupUnknown ? "renderer_cleanup_unknown" : commitStarted ? "result_commit_unknown" : auditFailed ? "external_audit_incomplete" : unknownExternal ? "external_outcome_unknown" : cancelled ? "user_cancelled" : error instanceof ArtifactError ? error.code : "export_failed";
    const diagnostics = error instanceof ArtifactError && !externalStarted && /^(artifact_compile_failed|artifact_render_failed|artifact_package_unavailable|slide_element_outside_canvas|slide_text_overflow|slide_layout_unsupported|slide_layout_too_large)$/.test(error.code) && error.message !== error.code ? [error.message] : [];
    if (!(signal.reason instanceof ArtifactError && signal.reason.code === "worker_shutdown")) await deps.jobs.finish(claim, status, code, diagnostics).catch(() => undefined);
    return { jobId: claim.job.id, status, code };
  } finally { clearInterval(timer); signal.removeEventListener("abort", cancel); }
}
