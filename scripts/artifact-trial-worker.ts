/**
 * THE WORKER OF THE PAID LEN 3.0 TRIAL (scripts/artifact-trial.ts starts it).
 *
 * The same loop as scripts/artifacts-worker.ts — claim a job, `runArtifactJob`
 * with the real adapters, billing and storage — with two differences, both test
 * glue:
 *
 * - The isolated renderer goes through the WSL bridge to the REAL container
 *   supervisor (the worker itself runs on Windows, next to the repo toolchain).
 * - Before every paid provider call, the trial budget (lib/artifacts/acceptance/
 *   trial-budget.ts) must allow it: Len's recorded spend (written by the runner
 *   to --state) plus every provider attempt so far, unknown ones at their worst
 *   case, plus this call's worst case, under the approved cap.
 *
 * It refuses to start on anything but a local throwaway database.
 */
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { createArtifactCoreRuntime } from "../lib/artifacts/runtime-core";
import { runArtifactJob } from "../lib/artifacts/worker";
import { ArtifactError, type ArtifactKind } from "../lib/artifacts/types";
import { createArtifactAdapters } from "../lib/artifacts/adapters";
import { artifactChargePolicy, createArtifactBilling } from "../lib/artifacts/billing";
import { getAssetStorage } from "../lib/projects/assets";
import { createBridge } from "../lib/artifacts/acceptance/bridge-client";
import { requireTrialDatabase, trialAllows, type PaidKind, type TrialAttempt, type TrialLimits } from "../lib/artifacts/acceptance/trial-budget";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

interface TrialState { readonly projectId: string; readonly capUsd: number; readonly lenUsd: number; readonly limits: TrialLimits }

async function main() {
  const statePath = arg("--state"), bridgeFile = arg("--bridge"), node = arg("--node");
  const distro = arg("--distro") ?? "Ubuntu-24.04", image = process.env.OPENLEN_ARTIFACT_RENDERER_IMAGE;
  if (!statePath || !bridgeFile || !node || !image) throw new Error("needs --state, --bridge, --node and OPENLEN_ARTIFACT_RENDERER_IMAGE");
  requireTrialDatabase(process.env.DATABASE_URL ?? "");
  const runtime = createArtifactCoreRuntime(process.env);
  const controller = new AbortController();
  const stop = () => controller.abort(new ArtifactError("worker_shutdown"));
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  // The runner closes our stdin when it is done; that is the stop signal on Windows.
  process.stdin.on("end", stop); process.stdin.resume();
  try {
    const storage = await runtime.storage();
    const bridge = createBridge({ distro, node, bridgeFile, image });
    const adapters = createArtifactAdapters(process.env, (img, fencingToken, admit) => async (packet, signal) => {
      // As containerArtifactRenderer does: re-check the lease right before the container.
      await admit();
      return bridge.render(() => fencingToken, (_p, call) => log({ render: call.kind, ok: call.ok, code: call.code, ms: call.metrics.ms, peakMemoryBytes: call.metrics.peakMemoryBytes, peakPids: call.metrics.peakPids, leftovers: call.leftovers }))(packet, signal);
    });
    // runArtifactJob keeps only a code; the trial needs the cause of a failure too.
    for (const [kind, adapter] of Object.entries(adapters) as [ArtifactKind, NonNullable<(typeof adapters)[ArtifactKind]>][]) {
      adapters[kind] = async (input, signal, hooks) => {
        try { return await adapter(input, signal, hooks); }
        catch (error) { log({ adapterError: kind, name: error instanceof Error ? error.name : typeof error, message: String(error instanceof Error ? error.message : error).slice(0, 800) }); throw error; }
      };
    }
    const policy = artifactChargePolicy(process.env);
    if (!policy) throw new Error("no charge policy: set OPENLEN_ARTIFACT_IMAGE/RENDER/AUDIO_CENTICREDITS for the trial");
    const billing = createArtifactBilling(runtime.database, policy);
    const guarded: typeof billing = {
      ...billing,
      async startAttempt(claim, ctx, kind: ArtifactKind, model) {
        const state = JSON.parse(await readFile(statePath, "utf8")) as TrialState;
        // This trial's calls only: the throwaway database keeps earlier trials, which are not this cap's.
        if (typeof state.projectId !== "string" || !state.projectId) throw new ArtifactError("trial_budget_reached", "the trial state names no project");
        const rows = await runtime.database.query(`select "kind","receipt" from "artifactAttempts" where "projectId"=$1`, [state.projectId]);
        const attempts: TrialAttempt[] = rows.map((r) => ({ kind: r.kind as PaidKind, costMicroUsd: (r.receipt as { costMicroUsd?: number | null } | null)?.costMicroUsd ?? null }));
        const decision = trialAllows(kind as PaidKind, state.lenUsd, attempts, { ...state.limits, capUsd: state.capUsd });
        log({ budget: kind, model, ...decision });
        if (!decision.ok) throw new ArtifactError("trial_budget_reached", decision.reason);
        return billing.startAttempt(claim, ctx, kind, model);
      },
    };
    const workerId = `trial-worker-${randomUUID()}`;
    log({ started: workerId, kinds: Object.keys(adapters) });
    while (!controller.signal.aborted) {
      const claim = await runtime.jobs.claimArtifactJob(workerId);
      if (!claim) { await setTimeout(1_500, undefined, { signal: controller.signal }).catch(() => undefined); continue; }
      log({ claimed: claim.job.id, artifact: claim.job.artifactId, revision: claim.job.revision });
      const result = await runArtifactJob(claim, { ...runtime, storage, adapters, billing: guarded, audioUploads: getAssetStorage() }, controller.signal);
      log({ job: result.jobId, status: result.status, code: result.code });
    }
  } finally {
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    await runtime.close();
  }
}

main().catch((error) => {
  log({ fatal: error instanceof Error ? error.message.slice(0, 1000) : String(error) });
  process.exitCode = 1;
});
