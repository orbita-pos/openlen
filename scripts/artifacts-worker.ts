import "@inariwatch/capture/auto";
import { setTimeout } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { artifactsEnabled, getArtifactRuntime } from "../lib/artifacts/runtime";
import { runArtifactJob } from "../lib/artifacts/worker";
import { collectArtifactGarbage } from "../lib/artifacts/garbage";
import { ArtifactError } from "../lib/artifacts/types";
import { createArtifactAdapters } from "../lib/artifacts/adapters";
import { artifactChargePolicy, createArtifactBilling } from "../lib/artifacts/billing";

async function main() {
  if (!artifactsEnabled()) { console.log("artifact worker: disabled"); return; }
  const runtime = getArtifactRuntime();
  const controller = new AbortController();
  const shutdown = () => controller.abort(new ArtifactError("worker_shutdown"));
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  const once = process.argv.includes("--once");
  try {
    const storage = await runtime.storage();
    const workerId = `worker-${randomUUID()}`;
    const adapters = createArtifactAdapters(process.env);
    const policy=artifactChargePolicy(process.env);
    const billing=policy?createArtifactBilling(runtime.database,policy):undefined;
    do {
      const claim = await runtime.jobs.claimArtifactJob(workerId);
      if (claim) {
        const result = await runArtifactJob(claim, { ...runtime, storage, adapters, billing }, controller.signal);
        // No prompt, query, dataset, private path, or provider error body here.
        console.log(JSON.stringify({ jobId: result.jobId, status: result.status, code: result.code }));
      } else {
        await collectArtifactGarbage(runtime.database, storage);
        if (!once) await setTimeout(2_000, undefined, { signal: controller.signal }).catch(() => undefined);
      }
    } while (!once && !controller.signal.aborted);
  } finally { process.removeListener("SIGTERM", shutdown); process.removeListener("SIGINT", shutdown); await runtime.close(); }
}
main().catch(() => { console.error("artifact worker failed; inspect job status and monitoring"); process.exitCode = 1; });
