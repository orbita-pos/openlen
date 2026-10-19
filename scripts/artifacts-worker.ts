import { setTimeout } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { artifactsEnabled, createArtifactCoreRuntime } from "../lib/artifacts/runtime-core";
import { runArtifactJob } from "../lib/artifacts/worker";
import { collectArtifactGarbage } from "../lib/artifacts/garbage";
import { ArtifactError } from "../lib/artifacts/types";
import { createArtifactAdapters } from "../lib/artifacts/adapters";
import { artifactChargePolicy, createArtifactBilling } from "../lib/artifacts/billing";
import { verifyArtifactInstallation } from "../lib/artifacts/install-check";
import {reconcileArtifactContainers} from "../lib/artifacts/container-supervisor";
import {readArtifactOperations} from "../lib/artifacts/operations";
import {getAssetStorage} from "../lib/projects/assets";

async function main() {
  if(process.argv.includes("--verify-install")){console.log(JSON.stringify(await verifyArtifactInstallation()));return;}
  if (!artifactsEnabled()) { console.log("artifact worker: disabled"); return; }
  const runtime = createArtifactCoreRuntime(process.env);
  const controller = new AbortController();
  const shutdown = () => controller.abort(new ArtifactError("worker_shutdown"));
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  const once = process.argv.includes("--once");
  try {
    if(process.argv.includes("--status")){
      console.log(JSON.stringify(await readArtifactOperations(runtime.database)));
      return;
    }
    const storage = await runtime.storage();
    const workerId = `worker-${randomUUID()}`;
    const adapters = createArtifactAdapters(process.env);
    const policy=artifactChargePolicy(process.env);
    const billing=policy?createArtifactBilling(runtime.database,policy):undefined;
    do {
      if(process.env.OPENLEN_ARTIFACT_RENDERER_IMAGE){
        if(process.platform!=="linux")throw new ArtifactError("renderer_requires_linux");
        await reconcileArtifactContainers(runtime.database);
      }
      const claim = await runtime.jobs.claimArtifactJob(workerId);
      if (claim) {
        const result = await runArtifactJob(claim, { ...runtime, storage, adapters, billing,audioUploads:getAssetStorage() }, controller.signal);
        // No prompt, query, dataset, private path, or provider error body here.
        console.log(JSON.stringify({ jobId: result.jobId, status: result.status, code: result.code }));
        if(result.code==="renderer_cleanup_unknown")throw new ArtifactError("renderer_cleanup_unknown");
      } else {
        await collectArtifactGarbage(runtime.database, storage);
        if (!once) await setTimeout(2_000, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    } while (!once && !controller.signal.aborted);
  } finally { process.removeListener("SIGTERM", shutdown); process.removeListener("SIGINT", shutdown); await runtime.close(); }
}
main().catch(error => { console.error(process.argv.includes("--verify-install")?`artifact install check failed: ${error instanceof Error?error.message.slice(0,1000):"unknown"}`:"artifact worker failed; inspect job status and monitoring"); process.exitCode = 1; });
