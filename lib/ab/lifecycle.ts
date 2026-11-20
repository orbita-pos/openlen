// End-to-end lifecycle orchestration for OpenLen Edge A/B Testing (Plan 3):
//   createAbDraft → launchAbExperiment → (evaluate) → promoteVariantB | keepControlA | extendExperiment
import "server-only";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { assistantOfProject } from "@/lib/assistants/store";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import { db, schema } from "@/lib/db";
import { readPublishedSources } from "@/lib/len-watch/published-sources";
import { publishProject } from "@/lib/projects";
import { publishThroughGates, runSecurityGate } from "@/lib/projects/publish-through-gates";
import { purgeSubdomain } from "@/lib/publish/cache-purge";
import { rollbackToSha } from "@/lib/publish/filesystem";
import { abTestingEnabled } from "./enabled";
import { abSpecOf, loadControlSources } from "./live-publish";
import {
  activeExperimentForTarget,
  claimExperimentDecision,
  createExperimentRow,
  DECISION_LOCK_CLEARED,
  getExperimentById,
  liveExperimentForProject,
  normalizePrimaryMetric,
  normalizeTargetPath,
  releaseDecisionLock,
  toExperimentView,
  updateExperiment,
  type AbExperimentRow,
} from "./store";
import { MIN_DURATION_HOURS, maxDurationDaysOf } from "./stats";
import type { AbExperimentView, AbPrimaryMetric } from "./types";
import {
  cleanupAbWorktree,
  commitAbWorktree,
  copySources,
  createAbWorktree,
  mergeWinnerIntoDraft,
  readPublishedFolder,
} from "./worktree";

export class AbLifecycleError extends Error {
  constructor(
    public readonly code:
      | "disabled"
      | "not_found"
      | "not_published"
      | "apps_not_supported"
      | "already_active"
      | "invalid_state"
      | "security_blocked"
      | "decision_conflict"
      | "missing_target_page"
      // The site was published after the draft was cut: Variant B is built on a base that is no longer the site.
      | "base_moved"
      // Another experiment of the project is live (the release carries one manifest).
      | "ab_already_running",
    message: string,
    public readonly status: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AbLifecycleError";
  }
}

/** A decision that fails gives its lock back as it was; if even that fails, the evaluator's sweep does it in ten minutes
 *  (`releaseStaleDecisionLocks`) — and the error that matters is the decision's, not this one. */
async function giveBackTheLock(id: string): Promise<void> {
  await releaseDecisionLock(id).catch((err: unknown) => {
    console.error("[ab] couldn't give a decision lock back; the evaluator's sweep will", id, err);
  });
}

function newExperimentId(): string {
  return `ab_${randomBytes(4).toString("hex")}`;
}

function newSalt(): string {
  return randomBytes(8).toString("hex");
}

function edgePathsForTarget(targetPath: string, locales: readonly string[]): string[] {
  const paths = targetPath === "/" ? ["/", "/index.html"] : [targetPath, `${targetPath}/`];
  if (targetPath === "/") {
    for (const loc of locales) paths.push(`/${loc}`, `/${loc}/`);
  }
  return paths;
}

/** Create a new draft A/B experiment + isolated `ab/<id>` worktree cloned from
 *  what is currently published (Control A). */
export async function createAbDraft(p: {
  readonly projectId: string;
  readonly ownerId: string;
  readonly actorId: string;
  readonly name: string;
  readonly hypothesis?: string | null;
  readonly targetPath?: string | null;
  readonly primaryMetric?: AbPrimaryMetric;
  readonly includeLocales?: boolean;
  readonly splitBps?: number;
}): Promise<AbExperimentView> {
  if (!abTestingEnabled()) {
    throw new AbLifecycleError("disabled", "A/B testing is disabled", 404);
  }
  const targetPath = normalizeTargetPath(p.targetPath);

  const [project] = await db
    .select({
      id: schema.projects.id,
      userId: schema.projects.userId,
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
      publishedReleaseSha: schema.projects.publishedReleaseSha,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, p.projectId))
    .limit(1);

  if (!project) throw new AbLifecycleError("not_found", "Project not found", 404);
  if (!project.subdomain) {
    throw new AbLifecycleError(
      "not_published",
      "Publish the page first before starting an A/B experiment.",
      400,
    );
  }
  if (project.data?.app) {
    throw new AbLifecycleError(
      "apps_not_supported",
      "A/B testing v1 supports static HTML sites (including multi-page), not React web apps yet.",
      400,
    );
  }

  if (targetPath !== "/") {
    const slug = targetPath.slice(1);
    if (!project.data?.pages?.[slug]) {
      throw new AbLifecycleError(
        "missing_target_page",
        `Target page ${targetPath} does not exist in this project.`,
        400,
      );
    }
  }

  const existing = await activeExperimentForTarget(p.projectId, targetPath);
  if (existing) {
    throw new AbLifecycleError(
      "already_active",
      `An A/B experiment (${existing.id}) is already active for ${targetPath}.`,
      409,
      { existingExperimentId: existing.id },
    );
  }

  const expId = newExperimentId();
  const wt = await createAbWorktree({
    parentId: p.projectId,
    ownerId: p.ownerId,
    experimentId: expId,
  });
  if (!wt) {
    throw new AbLifecycleError(
      "not_published",
      "Could not prepare published baseline for A/B experiment.",
      400,
    );
  }

  const assistant = assistantsEnabled()
    ? await assistantOfProject(p.projectId).catch(() => null)
    : null;

  const splitBps =
    typeof p.splitBps === "number" && Number.isInteger(p.splitBps)
      ? Math.min(9000, Math.max(1000, p.splitBps))
      : 5000;

  try {
    const row = await createExperimentRow({
      id: expId,
      projectId: p.projectId,
      assistantId: assistant?.id ?? null,
      name: p.name.trim().slice(0, 120) || "Prueba A/B",
      hypothesis: p.hypothesis?.trim().slice(0, 500) || null,
      targetPath,
      includeLocales: p.includeLocales === true,
      primaryMetric: normalizePrimaryMetric(p.primaryMetric),
      splitBps,
      salt: newSalt(),
      status: "draft",
      decisionStatus: "none",
      copyProjectId: wt.copyId,
      branch: wt.branch,
      baseCommitOid: wt.base,
      controlReleaseSha: project.publishedReleaseSha ?? null,
      createdBy: p.actorId,
    });
    return toExperimentView(row, project.title);
  } catch (err) {
    await cleanupAbWorktree({
      parentId: p.projectId,
      copyProjectId: wt.copyId,
      branch: wt.branch,
    });
    throw err;
  }
}

/** Launch a draft A/B experiment 50/50 atomically:
 *  SecurityGate → commit worktree → publish Control A + Variant B + ab.json → purge Cloudflare. */
export async function launchAbExperiment(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly ownerId: string;
  readonly actorId: string;
  readonly locale?: string;
  readonly acceptSecurityFingerprint?: string;
  readonly splitBps?: number;
}): Promise<AbExperimentView> {
  if (!abTestingEnabled()) {
    throw new AbLifecycleError("disabled", "A/B testing is disabled", 404);
  }
  const exp = await getExperimentById(p.experimentId);
  if (!exp || exp.projectId !== p.projectId) {
    throw new AbLifecycleError("not_found", "Experiment not found", 404);
  }
  if (exp.status !== "draft" || !exp.copyProjectId) {
    throw new AbLifecycleError(
      "invalid_state",
      `Experiment ${exp.id} cannot be launched from state ${exp.status}.`,
      409,
    );
  }

  const [project] = await db
    .select({
      title: schema.projects.title,
      subdomain: schema.projects.subdomain,
      publishedReleaseSha: schema.projects.publishedReleaseSha,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, p.projectId))
    .limit(1);

  if (!project?.subdomain) {
    throw new AbLifecycleError("not_published", "Project is not published.", 400);
  }

  // One live experiment per project: the release carries ONE manifest, so a second launch would end the first
  // (review item 15). Drafts don't count.
  const running = await liveExperimentForProject(p.projectId);
  if (running && running.id !== exp.id) {
    throw new AbLifecycleError(
      "ab_already_running",
      `Another A/B test (${running.name}) is running on this site. Decide it (keep A, promote B) before launching a new one.`,
      409,
      { runningExperimentId: running.id },
    );
  }

  // 0. Re-baseline (review item 12). The draft was cut from the version published that day (`baseCommitOid`); if the
  //    site was published since, Control would be the new version but Variant B is built on the old one, and promoting
  //    it — or «keeping A» — would undo that publication. Nothing is published: Len cuts the variant again.
  const control = await loadControlSources(p.projectId, p.ownerId);
  if (!control) {
    throw new AbLifecycleError("not_published", "Published baseline missing.", 400);
  }
  if (!exp.baseCommitOid || exp.baseCommitOid !== control.published.commitOid) {
    throw new AbLifecycleError(
      "base_moved",
      "The site was published since this variant was drafted, so Variant B is built on an older version than the one that is live now. Ask Len to create the variant again from the current page.",
      409,
    );
  }

  // 1. Run security gate on Variant B's worktree copy before shipping.
  const security = await runSecurityGate({
    projectId: p.projectId,
    actorId: p.actorId,
    locale: p.locale ?? "en",
    sourcesFrom: exp.copyProjectId,
    ...(p.acceptSecurityFingerprint ? { accept: p.acceptSecurityFingerprint } : {}),
  });
  if ("stop" in security) {
    throw new AbLifecycleError(
      "security_blocked",
      "Security review requires attention before launching Variant B.",
      security.stop.status,
      security.stop.body,
    );
  }

  // 2. Commit any uncommitted Len edits on branch `ab/<expId>`.
  const tipOid = await commitAbWorktree(exp.copyProjectId, p.ownerId, exp.id);

  // 3. Variant B's sources (Control's were loaded above).
  const variantBSrc = await copySources(exp.copyProjectId);
  const splitBps =
    typeof p.splitBps === "number" && Number.isInteger(p.splitBps)
      ? Math.min(9000, Math.max(1000, p.splitBps))
      : exp.splitBps;

  // The release to fall back on when the experiment ends is the one live AT LAUNCH — never the one stored when the
  // draft was made (item 12): going back to that one would undo every publication in between.
  const controlReleaseSha = project.publishedReleaseSha ?? null;

  // 4. Publish atomic release containing Control A + `openlen/ab/<id>/b/` + `openlen/ab.json`.
  const pub = await publishProject({
    projectId: p.projectId,
    userId: p.ownerId,
    subdomain: project.subdomain,
    skipFlightCheck: true,
    dataChanges: { mode: "skip" },
    sourcesOverride: { data: control.data, folder: control.folder },
    protectReleaseShas: controlReleaseSha ? [controlReleaseSha] : [],
    abExperiment: abSpecOf(exp, variantBSrc, splitBps),
  });

  // 5. Purge previous cached Control HTML from Cloudflare PoPs immediately.
  const langs = control.data.settings?.languages ?? [];
  await purgeSubdomain(project.subdomain, edgePathsForTarget(exp.targetPath, langs)).catch(
    () => undefined,
  );

  const now = new Date();
  const minEndAt = new Date(now.getTime() + MIN_DURATION_HOURS * 3_600_000);
  const updated = await updateExperiment(exp.id, {
    status: "running",
    decisionStatus: "none",
    splitBps,
    variantBCommitOid: tipOid,
    controlReleaseSha,
    experimentReleaseSha: pub.sha ?? null,
    startedAt: now,
    minEndAt,
  });

  return toExperimentView(updated ?? exp, project.title);
}

/** Promote Variant B to 100% production (clean release without ab.json → restores
 *  Cloudflare s-maxage=3600), purge CF, and 3-way merge B into the owner's draft. */
export async function promoteVariantB(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly ownerId: string;
  readonly actorId: string;
  readonly locale?: string;
}): Promise<{
  readonly experiment: AbExperimentView;
  readonly bringState: "brought" | "conflict";
  readonly conflictPaths?: readonly string[];
}> {
  const locked = await claimExperimentDecision(p.experimentId, p.projectId);
  if (!locked) {
    throw new AbLifecycleError(
      "decision_conflict",
      "Experiment is not awaiting a decision or is already being applied.",
      409,
    );
  }

  try {
    const [project] = await db
      .select({ title: schema.projects.title, subdomain: schema.projects.subdomain })
      .from(schema.projects)
      .where(eq(schema.projects.id, p.projectId))
      .limit(1);

    if (!project?.subdomain || !locked.copyProjectId) {
      throw new AbLifecycleError("invalid_state", "Missing subdomain or Variant B worktree.", 409);
    }

    const gated = await publishThroughGates({
      projectId: p.projectId,
      actorId: p.actorId,
      ownerId: p.ownerId,
      subdomain: project.subdomain,
      locale: p.locale ?? "en",
      source: "ab_promote",
      sourcesFrom: locked.copyProjectId,
    });
    if (gated.status !== 200) {
      throw new AbLifecycleError(
        "security_blocked",
        "Promoting Variant B was stopped by a publish gate.",
        gated.status,
        gated.body,
      );
    }

    const promotedSha = typeof gated.body.sha === "string" ? gated.body.sha : null;
    await purgeSubdomain(project.subdomain, ["/", "/index.html", locked.targetPath]).catch(
      () => undefined,
    );

    // Three-way merge Variant B into owner's draft.
    let bringState: "brought" | "conflict" = "brought";
    let conflictPaths: readonly string[] | undefined;
    if (locked.baseCommitOid && locked.branch) {
      const merged = await mergeWinnerIntoDraft({
        projectId: p.projectId,
        ownerId: p.ownerId,
        actorId: p.actorId,
        baseCommitOid: locked.baseCommitOid,
        branch: locked.branch,
      });
      if (merged.kind === "conflict") {
        bringState = "conflict";
        conflictPaths = merged.paths;
      }
    }

    // If merge succeeded cleanly, tear down worktree + branch; on conflict, keep
    // the branch alive so Len can finish merging when requested.
    if (bringState === "brought") {
      await cleanupAbWorktree({
        parentId: p.projectId,
        copyProjectId: locked.copyProjectId,
        branch: locked.branch,
      });
    } else if (locked.copyProjectId) {
      await cleanupAbWorktree({
        parentId: p.projectId,
        copyProjectId: locked.copyProjectId,
        branch: null,
      });
    }

    const now = new Date();
    const updated = await updateExperiment(locked.id, {
      status: "promoted_b",
      decisionStatus: "resolved",
      bringState,
      promotedReleaseSha: promotedSha,
      winnerVariant: "b",
      endedAt: locked.endedAt ?? now,
      decidedAt: now,
      decidedBy: p.actorId,
      ...DECISION_LOCK_CLEARED,
      copyProjectId: null,
    });

    return {
      experiment: toExperimentView(updated ?? locked, project.title),
      bringState,
      ...(conflictPaths ? { conflictPaths } : {}),
    };
  } catch (err) {
    await giveBackTheLock(locked.id);
    throw err;
  }
}

/** Restore clean Control A at 100% (no ab.json), purge Cloudflare, clean up worktree. */
async function restoreControlLive(
  exp: AbExperimentRow,
  ownerId: string,
  subdomain: string,
): Promise<void> {
  if (exp.controlReleaseSha) {
    try {
      await rollbackToSha(subdomain, exp.controlReleaseSha);
      await db
        .update(schema.projects)
        .set({ publishedReleaseSha: exp.controlReleaseSha, updatedAt: new Date() })
        .where(eq(schema.projects.id, exp.projectId))
        .catch(() => undefined);
      await purgeSubdomain(subdomain, ["/", "/index.html", exp.targetPath]).catch(() => undefined);
      return;
    } catch {
      // Control release dir was pruned or missing on disk — fall through to clean republish.
    }
  }
  const controlSrc = await readPublishedSources(exp.projectId);
  if (controlSrc) {
    const controlFolder = await readPublishedFolder(exp.projectId, controlSrc);
    await publishProject({
      projectId: exp.projectId,
      userId: ownerId,
      subdomain,
      skipFlightCheck: true,
      dataChanges: { mode: "skip" },
      sourcesOverride: { data: controlSrc.data, folder: controlFolder },
      // Restoring Control IS the end of the experiment: the door must not refuse it.
      abLive: "ending",
    });
    await purgeSubdomain(subdomain, ["/", "/index.html", exp.targetPath]).catch(() => undefined);
  }
}

/** Owner chooses «Quedarme con la original» (keep Control A). */
export async function keepControlA(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly ownerId: string;
  readonly actorId: string;
}): Promise<AbExperimentView> {
  const locked = await claimExperimentDecision(p.experimentId, p.projectId);
  if (!locked) {
    throw new AbLifecycleError(
      "decision_conflict",
      "Experiment is not awaiting a decision or is already being applied.",
      409,
    );
  }

  try {
    const [project] = await db
      .select({ title: schema.projects.title, subdomain: schema.projects.subdomain })
      .from(schema.projects)
      .where(eq(schema.projects.id, p.projectId))
      .limit(1);

    if (project?.subdomain) {
      await restoreControlLive(locked, p.ownerId, project.subdomain);
    }
    await cleanupAbWorktree({
      parentId: p.projectId,
      copyProjectId: locked.copyProjectId,
      branch: locked.branch,
    });

    const now = new Date();
    const updated = await updateExperiment(locked.id, {
      status: "kept_a",
      decisionStatus: "resolved",
      winnerVariant: "a",
      copyProjectId: null,
      endedAt: locked.endedAt ?? now,
      decidedAt: now,
      decidedBy: p.actorId,
      ...DECISION_LOCK_CLEARED,
    });
    return toExperimentView(updated ?? locked, project?.title);
  } catch (err) {
    await giveBackTheLock(locked.id);
    throw err;
  }
}

/** Owner chooses «Seguir probando»: keep testing. It really continues (review item 19): the experiment goes back to
 *  `running`, its window REOPENS (`endedAt` cleared — the metrics stop at it) and ITS hard stop moves out to the end of
 *  the extension if that is later than the one it had (`maxEndAt`; the global 21 days would end a run that is already on
 *  day 22 at the next pass). Verdicts are held back until the extension is over (`snoozeUntil`). */
export async function extendExperiment(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly actorId: string;
  readonly extraDays?: number;
}): Promise<AbExperimentView> {
  const locked = await claimExperimentDecision(p.experimentId, p.projectId);
  if (!locked) {
    throw new AbLifecycleError(
      "decision_conflict",
      "Experiment cannot be extended right now.",
      409,
    );
  }
  try {
    const days = Math.min(14, Math.max(1, p.extraDays ?? 7));
    const targetDate = new Date(Date.now() + days * 24 * 3_600_000);
    const currentStop = locked.startedAt
      ? locked.startedAt.getTime() + maxDurationDaysOf(locked) * 24 * 3_600_000
      : 0;
    const updated = await updateExperiment(locked.id, {
      status: "running",
      decisionStatus: "none",
      ...DECISION_LOCK_CLEARED,
      endedAt: null,
      winnerVariant: null,
      minEndAt: targetDate,
      snoozeUntil: targetDate,
      maxEndAt: new Date(Math.max(currentStop, targetDate.getTime())),
      decidedBy: p.actorId,
    });
    return toExperimentView(updated ?? locked);
  } catch (err) {
    await giveBackTheLock(locked.id);
    throw err;
  }
}

/** Auto-stop guardrail when evaluator detects severe harm (>30% drop at >=95% confidence). */
export async function autoStopExperimentForHarm(
  exp: AbExperimentRow,
  ownerId: string,
  subdomain: string,
): Promise<AbExperimentRow | null> {
  await restoreControlLive(exp, ownerId, subdomain);
  await cleanupAbWorktree({
    parentId: exp.projectId,
    copyProjectId: exp.copyProjectId,
    branch: exp.branch,
  });
  const now = new Date();
  return updateExperiment(exp.id, {
    status: "paused_harm",
    decisionStatus: "resolved",
    winnerVariant: "a",
    copyProjectId: null,
    endedAt: now,
    notifiedAt: now,
  });
}

/** Retry three-way merge after a conflict or cancel a draft experiment cleanly. */
export async function cancelAbDraft(p: {
  readonly projectId: string;
  readonly experimentId: string;
}): Promise<AbExperimentView> {
  const exp = await getExperimentById(p.experimentId);
  if (!exp || exp.projectId !== p.projectId) {
    throw new AbLifecycleError("not_found", "Experiment not found", 404);
  }
  if (exp.status !== "draft") {
    throw new AbLifecycleError("invalid_state", "Only draft experiments can be cancelled.", 409);
  }
  await cleanupAbWorktree({
    parentId: p.projectId,
    copyProjectId: exp.copyProjectId,
    branch: exp.branch,
  });
  const updated = await updateExperiment(exp.id, {
    status: "cancelled",
    decisionStatus: "resolved",
    copyProjectId: null,
    endedAt: new Date(),
  });
  return toExperimentView(updated ?? exp);
}

export async function retryBringWinner(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly ownerId: string;
  readonly actorId: string;
}): Promise<{ readonly status: "brought" | "conflict" | "nothing"; readonly paths?: readonly string[] }> {
  const exp = await getExperimentById(p.experimentId);
  if (!exp || exp.projectId !== p.projectId || !exp.baseCommitOid || !exp.branch) {
    throw new AbLifecycleError("not_found", "Experiment branch not found", 404);
  }
  const merged = await mergeWinnerIntoDraft({
    projectId: p.projectId,
    ownerId: p.ownerId,
    actorId: p.actorId,
    baseCommitOid: exp.baseCommitOid,
    branch: exp.branch,
  });
  if (merged.kind === "conflict") {
    await updateExperiment(exp.id, { bringState: "conflict" });
    return { status: "conflict", paths: merged.paths };
  }
  await updateExperiment(exp.id, { bringState: "brought" });
  await cleanupAbWorktree({ parentId: p.projectId, copyProjectId: null, branch: exp.branch });
  return { status: merged.kind };
}
