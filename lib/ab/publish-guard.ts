// EVERY PUBLISH DOOR RESPECTS A LIVE EXPERIMENT (review item 13).
//
// A release written without the experiment's manifest ends the split in silence while the row still says `running`; the
// decision that follows (keep A, a harm stop) then rolls back to an OLDER release and undoes what was published in
// between. `publishProject` (the bottom door), `unpublishProject` and `rollbackProject` ask this module first.
import "server-only";

import { abTestingEnabled } from "./enabled";
import { AbExperimentRunningError } from "./errors";
import { buildLiveAbPublish, type LiveAbPublish } from "./live-publish";
import { cancelLiveExperiment, liveExperimentForProject, type AbExperimentRow } from "./store";
import { cleanupAbWorktree } from "./worktree";

export { AbExperimentRunningError };

/** What the caller of `publishProject` says about a live experiment it knows nothing of:
 *  · `keep`   — a SYSTEM republish (republish-all, internal republish): re-emit it, the split survives;
 *  · `ending` — this publish IS the end of the experiment: its own decision (promote B, restore Control), or the owner
 *               who chose «Stop and publish» (the caller closes the row once the publish went through);
 *  · absent   — anyone else (Len Watch, MCP publish…): refused. */
export type AbPublishPolicy = "keep" | "ending";

export interface GuardDeps {
  enabled(): boolean;
  liveExperiment(projectId: string): Promise<AbExperimentRow | null>;
  rebuild(exp: AbExperimentRow, ownerId: string): Promise<LiveAbPublish | null>;
}

const realDeps: GuardDeps = {
  enabled: () => abTestingEnabled(),
  liveExperiment: liveExperimentForProject,
  rebuild: buildLiveAbPublish,
};

const refusal = (exp: AbExperimentRow): AbExperimentRunningError =>
  new AbExperimentRunningError(exp.id, exp.name, exp.targetPath);

/** For `publishProject`. Returns what to publish INSTEAD when a system republish must keep the experiment alive;
 *  `null` = publish as asked. Throws `AbExperimentRunningError` when the publish would end a live experiment. */
export async function resolveAbPublish(
  input: { readonly projectId: string; readonly ownerId: string; readonly policy?: AbPublishPolicy; readonly carriesExperiment: boolean },
  deps: GuardDeps = realDeps,
): Promise<LiveAbPublish | null> {
  if (!deps.enabled() || input.carriesExperiment) return null;
  const live = await deps.liveExperiment(input.projectId);
  if (!live) return null;
  if (input.policy === "ending") return null;
  if (input.policy === "keep") {
    const rebuilt = await deps.rebuild(live, input.ownerId);
    // Can't rebuild it (its copy is gone, nothing published): ending it in silence is the thing to avoid.
    if (!rebuilt) throw refusal(live);
    return rebuilt;
  }
  throw refusal(live);
}

/** For `unpublishProject` and `rollbackProject`: they have no way to keep an experiment alive. */
export async function assertNoLiveExperiment(projectId: string, deps: GuardDeps = realDeps): Promise<void> {
  if (!deps.enabled()) return;
  const live = await deps.liveExperiment(projectId);
  if (live) throw refusal(live);
}

/** After an owner's «Stop and publish» went through: the experiment is over. Called only once the publish succeeded —
 *  a failed publish leaves the experiment live and untouched (review item 14). Never throws: the publish is done. */
export async function endExperimentAfterPublish(exp: AbExperimentRow, actorId: string): Promise<void> {
  try {
    const ended = await cancelLiveExperiment(exp.id, actorId);
    if (!ended) return; // someone decided it meanwhile: not ours to touch
    await cleanupAbWorktree({ parentId: exp.projectId, copyProjectId: exp.copyProjectId, branch: exp.branch });
  } catch (err) {
    console.error("[ab] couldn't close the experiment after the owner stopped it by publishing", exp.id, err);
  }
}
