// WHAT FOLLOWS A SYSTEM RE-EMIT OF A LIVE EXPERIMENT (review of G4+G5, minor 9): the republish that kept the split alive wrote a new
// release, so the experiment's release is that one now (`recordReemittedRelease`) — and if the re-emit put NEW overrides in the
// manifest (assets Variant B changed since the launch), the edge may still hold them for up to thirty days: they are purged like the
// ones the launch purged.
import "server-only";

import { purgeExperimentEdge } from "./edge-purge";
import { getExperimentById, recordReemittedRelease } from "./store";

export interface ReemitDeps {
  record: typeof recordReemittedRelease;
  purge: typeof purgeExperimentEdge;
  /** Takes the split of an experiment that is no longer live down from the live release; `false` = nothing to put back. */
  takeDown(experimentId: string, ownerId: string, subdomain: string): Promise<boolean>;
}

const REAL: ReemitDeps = {
  record: recordReemittedRelease,
  purge: purgeExperimentEdge,
  takeDown: async (experimentId, ownerId, subdomain) => {
    const row = await getExperimentById(experimentId);
    if (!row) return false;
    return (await import("./lifecycle")).takeSplitDown(row, ownerId, subdomain);
  },
};

/** Never throws: the release is live, and what's left here is bookkeeping and a best-effort purge. */
export async function recordAndPurgeReemit(
  exp: { readonly id: string; readonly targetPath: string; readonly includeLocales: boolean },
  subdomain: string,
  publish: { readonly sha?: string | null; readonly abOverrides?: readonly string[] },
  languages: readonly string[],
  ownerId: string,
  deps: ReemitDeps = REAL,
): Promise<void> {
  try {
    const result = await deps.record(exp.id, publish.sha ?? null, publish.abOverrides);
    if (!result.recorded) {
      // A decision closed the experiment while the re-emit was publishing, and the re-emit's swap landed over it: the live release
      // carries a split nobody is judging (rejected B served to half the visitors). Take it down NOW (the reconcile pass would, later).
      console.error(`[publish] a system re-emit of ${exp.id} landed, but the experiment was closed meanwhile: taking the split down`);
      await deps.takeDown(exp.id, ownerId, subdomain).catch((err: unknown) => {
        console.error(`[publish] couldn't take the split of ${exp.id} down after its re-emit; the reconcile pass will try`, err);
      });
      return;
    }
    if (result.added.length > 0) {
      await deps.purge(subdomain, { targetPath: exp.targetPath, includeLocales: exp.includeLocales, overridePaths: result.added }, languages);
    }
  } catch (err) {
    console.error("[publish] couldn't record the re-emitted experiment release", exp.id, err);
  }
}
