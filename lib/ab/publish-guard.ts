// EVERY PUBLISH DOOR RESPECTS A LIVE EXPERIMENT (review item 13).
//
// A release written without the experiment's manifest ends the split in silence while the row still says `running`; the
// decision that follows (keep A, a harm stop) then rolls back to an OLDER release and undoes what was published in
// between. `publishProject` (the bottom door), `unpublishProject` and `rollbackProject` ask this module first.
import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { purgeExperimentEdge } from "./edge-purge";
import { abTestingEnabled } from "./enabled";
import { AbExperimentRunningError, AbRepublishSkipped } from "./errors";
import { buildLiveAbPublish, type LiveAbPublish } from "./live-publish";
import { closeDecision, liveExperimentForProject, type AbExperimentRow } from "./store";
import { cleanupAbWorktree } from "./worktree";

export { AbExperimentRunningError, AbRepublishSkipped };

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
    // A system republish takes no claim. So it leaves alone an experiment whose decision is being applied (or whose launch
    // hasn't finished): re-emitting under it would swap a split release over what that decision is publishing.
    if (live.decisionStatus === "applying" || !live.startedAt) {
      console.warn(`[ab] a system republish skipped project ${input.projectId}: a decision or a launch is in progress on ${live.id}`);
      throw new AbRepublishSkipped("decision_in_progress", `A decision on the A/B test "${live.name}" is being applied: this republish is skipped.`);
    }
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

/** What closing the experiment needs (injected by the test). */
export interface EndDeps {
  /** Closes the experiment as cancelled, FENCED on the lock the owner's «Stop and publish» holds (`exp.decisionLockToken`). */
  cancel(exp: AbExperimentRow, actorId: string): Promise<AbExperimentRow | null>;
  cleanup(p: { parentId: string; copyProjectId: string | null; branch: string | null }): Promise<void>;
  /** Purges what the edge keeps of the ended experiment (its target page, its languages, the assets B overrode). */
  purge(exp: AbExperimentRow): Promise<void>;
}
const realEnd: EndDeps = {
  cancel: (exp, actorId) => {
    const now = new Date();
    return closeDecision(exp.id, exp.decisionLockToken, {
      status: "cancelled",
      decisionStatus: "resolved",
      copyProjectId: null,
      endedAt: now,
      decidedAt: now,
      decidedBy: actorId,
    });
  },
  cleanup: cleanupAbWorktree,
  purge: async (exp) => {
    const [row] = await db.select({ subdomain: schema.projects.subdomain, data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, exp.projectId)).limit(1);
    if (row?.subdomain) await purgeExperimentEdge(row.subdomain, exp, row.data?.settings?.languages ?? []);
  },
};

/** After an owner's «Stop and publish» went through: the experiment is over. Called only once the publish succeeded —
 *  a failed publish leaves the experiment live and untouched (review item 14). Never throws: the publish is done. A close
 *  that fails is tried once more (G1+G3 review, item 20): the row must not stay `running` with a release that carries no
 *  split. If both fail it says so, loudly. */
export async function endExperimentAfterPublish(exp: AbExperimentRow, actorId: string, deps: EndDeps = realEnd): Promise<void> {
  let ended: AbExperimentRow | null = null;
  let failure: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      ended = await deps.cancel(exp, actorId);
      failure = null;
      break;
    } catch (err) {
      failure = err;
    }
  }
  if (failure) {
    console.error("[ab] couldn't close the experiment after the owner stopped it by publishing (it still says running)", exp.id, failure);
    return;
  }
  if (!ended) return; // someone decided it meanwhile: not ours to touch
  // The owner's publish purged «/» and its own pages; the experiment's target, languages and B's assets are this purge's.
  await deps.purge(exp).catch((err: unknown) => console.error("[ab] couldn't purge the stopped experiment from the edge", exp.id, err));
  await deps
    .cleanup({ parentId: exp.projectId, copyProjectId: exp.copyProjectId, branch: exp.branch })
    .catch((err: unknown) => console.error("[ab] couldn't clean up the stopped experiment's worktree", exp.id, err));
}
