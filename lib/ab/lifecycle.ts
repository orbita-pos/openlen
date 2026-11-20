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
import { rollbackToSha } from "@/lib/publish/filesystem";
import { holdDecision } from "./decision-lock";
import { abTestingEnabled } from "./enabled";
import { purgeExperimentEdge } from "./edge-purge";
import { readLiveAb } from "./live-manifest";
import { abSpecOf, loadControlSources } from "./live-publish";
import {
  activeExperimentForTarget,
  claimExperimentDecision,
  claimLaunch,
  createExperimentRow,
  finalizeLaunch,
  getExperimentById,
  liveExperimentForProject,
  normalizePrimaryMetric,
  releaseLaunch,
  normalizeTargetPath,
  toExperimentView,
  transitionBringState,
  updateExperiment,
  type AbExperimentRow,
} from "./store";
import { MIN_DURATION_HOURS, maxDurationDaysOf } from "./stats";
import type { AbExperimentView, AbMetricsSnapshot, AbPrimaryMetric } from "./types";
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

/** The experiment's copy and branch are deleted AFTER its end was recorded, and a cleanup that fails must not undo the end:
 *  the row says what the site is, a leftover copy is only clutter (review: record the end first, clean up best-effort). */
async function cleanupBestEffort(p: { parentId: string; copyProjectId: string | null; branch: string | null }): Promise<void> {
  try {
    await cleanupAbWorktree(p);
  } catch (err) {
    console.error("[ab] couldn't clean up an ended experiment's worktree (it is only clutter now)", p.copyProjectId, err);
  }
}

function newExperimentId(): string {
  return `ab_${randomBytes(4).toString("hex")}`;
}

function newSalt(): string {
  return randomBytes(8).toString("hex");
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
  // Two witnesses that the site moved: the commit the draft was cut from is no longer the published one, or the live RELEASE
  // isn't the one that was live at the draft (content-addressed: a republish of identical content keeps its sha, so that
  // is no move). Either way the draft is stale: it is cancelled — a stale draft counts as active and would answer the
  // re-cut with `already_active` — and the owner is told so (G1+G3 review, items 16 and 17).
  const siteMoved =
    !exp.baseCommitOid ||
    exp.baseCommitOid !== control.published.commitOid ||
    (exp.controlReleaseSha ?? null) !== (project.publishedReleaseSha ?? null);
  if (siteMoved) {
    await cancelAbDraft({ projectId: p.projectId, experimentId: exp.id }).catch((err: unknown) => {
      console.error("[ab] couldn't cancel the stale draft", exp.id, err);
    });
    throw new AbLifecycleError(
      "base_moved",
      "The site was published since this variant was drafted, so Variant B is built on an older version than the one that is live now. The draft was discarded: ask Len to create the variant again from the current page.",
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

  // 3b. TAKE THE PROJECT'S ONE LIVE SLOT before writing anything: the check above is a read, and two launches at the same
  //     instant both pass it. The unique index decides; the loser publishes nothing (review: one live experiment per project).
  //     The claim is `running` with no start yet: nobody can decide it (`claimExperimentDecision` needs a start) and the
  //     evaluator doesn't judge it until the launch finishes — or the reconcile pass settles it from the live release.
  const claimed = await claimLaunch(exp.id);
  if (claimed === "taken") {
    throw new AbLifecycleError(
      "ab_already_running",
      "Another A/B test of this site started a moment ago. Decide it (keep A, promote B) before launching a new one.",
      409,
    );
  }
  if (claimed === "moved") {
    throw new AbLifecycleError("invalid_state", `Experiment ${exp.id} is no longer a draft.`, 409);
  }

  // 4. Publish atomic release containing Control A + `openlen/ab/<id>/b/` + `openlen/ab.json`.
  let pub: { readonly sha?: string; readonly abOverrides?: readonly string[] };
  try {
    pub = await publishProject({
      projectId: p.projectId,
      userId: p.ownerId,
      subdomain: project.subdomain,
      skipFlightCheck: true,
      dataChanges: { mode: "skip" },
      sourcesOverride: { data: control.data, folder: control.folder },
      protectReleaseShas: controlReleaseSha ? [controlReleaseSha] : [],
      abExperiment: abSpecOf(exp, variantBSrc, splitBps),
    });
  } catch (err) {
    // A publish can throw AFTER its release was swapped in (a step past the swap). What the live release says decides: if it
    // carries this experiment the split IS live and the row finishes the launch; if it doesn't, the slot goes back to the draft;
    // if it can't be read now, the slot stays claimed and the reconcile pass settles it from the release (never guess).
    const live = await readLiveAb(project.subdomain, exp.id).catch(() => ({ kind: "unknown" }) as const);
    if (live.kind === "live") {
      console.error("[ab] the launch's publish threw AFTER its release went live; finishing the launch", exp.id, err);
      pub = { sha: live.sha, abOverrides: live.overrides };
    } else if (live.kind === "unknown") {
      console.error("[ab] the launch's publish threw and the live release can't be read; the slot stays claimed for the reconcile pass", exp.id, err);
      throw err;
    } else {
      await releaseLaunch(exp.id).catch((e: unknown) => console.error("[ab] couldn't give the launch slot back", exp.id, e));
      throw err;
    }
  }

  // 5. Purge what the edge kept of the old page: the target (and its languages), and every asset Variant B overrides.
  const overridePaths = pub.abOverrides ? [...pub.abOverrides] : [];
  await purgeExperimentEdge(project.subdomain, { targetPath: exp.targetPath, includeLocales: exp.includeLocales, overridePaths }, control.data.settings?.languages ?? []);

  // 6. The final write is a compare-and-swap on the launch's own claim. If it changes nothing, something settled the row
  //    while the split went live (the reconcile pass): the split is taken down — Control is published again — and the
  //    launch says it didn't happen.
  const now = new Date();
  const minEndAt = new Date(now.getTime() + MIN_DURATION_HOURS * 3_600_000);
  const updated = await finalizeLaunch(exp.id, {
    status: "running",
    decisionStatus: "none",
    splitBps,
    variantBCommitOid: tipOid,
    controlReleaseSha,
    experimentReleaseSha: pub.sha ?? null,
    overridePaths,
    startedAt: now,
    minEndAt,
  });
  if (!updated) {
    console.error("[ab] the launch's final write changed nothing: the row was settled meanwhile; republishing Control", exp.id);
    try {
      await publishProject({
        projectId: p.projectId,
        userId: p.ownerId,
        subdomain: project.subdomain,
        skipFlightCheck: true,
        dataChanges: { mode: "skip" },
        sourcesOverride: { data: control.data, folder: control.folder },
        // Taking the split down IS the end of the experiment: the door must not refuse it.
        abLive: "ending",
      });
      await purgeExperimentEdge(project.subdomain, { targetPath: exp.targetPath, includeLocales: exp.includeLocales, overridePaths }, control.data.settings?.languages ?? []);
    } catch (err) {
      console.error("[ab] couldn't republish Control after a launch that was settled meanwhile", exp.id, err);
    }
    throw new AbLifecycleError("decision_conflict", "The test was settled while it was launching, so it did not start. Your original is live.", 409);
  }

  return toExperimentView(updated, project.title);
}

/** What bringing a promoted Variant B into the owner's draft came to: `brought` (it is in; `nothing` = there was nothing to
 *  bring), `conflict` (it clashed with their edits; the branch stays), `pending` (a Len turn is live: later). */
type BringOutcome =
  | { readonly state: "brought"; readonly kind: "brought" | "nothing" }
  | { readonly state: "conflict"; readonly paths: readonly string[] }
  | { readonly state: "pending" };

async function tryBringIntoDraft(exp: AbExperimentRow, ownerId: string, actorId: string): Promise<BringOutcome> {
  if (!exp.baseCommitOid || !exp.branch) return { state: "brought", kind: "nothing" };
  const merged = await mergeWinnerIntoDraft({
    projectId: exp.projectId,
    ownerId,
    actorId,
    baseCommitOid: exp.baseCommitOid,
    branch: exp.branch,
  });
  if (merged.kind === "busy") return { state: "pending" };
  if (merged.kind === "conflict") return { state: "conflict", paths: merged.paths };
  return { state: "brought", kind: merged.kind };
}

/** Writes down how the bring ended, only if nobody settled it meanwhile (a person's button and the background wait can
 *  race): `brought` deletes the branch too; `conflict` keeps it (Len or the owner finishes it, or discards it). */
async function settleBring(exp: AbExperimentRow, outcome: BringOutcome): Promise<AbExperimentRow | null> {
  if (outcome.state === "pending") return null;
  const moved = await transitionBringState(exp.id, ["pending", "conflict"], {
    bringState: outcome.state,
    copyProjectId: null,
  });
  if (!moved) return null;
  await cleanupAbWorktree({
    parentId: exp.projectId,
    copyProjectId: exp.copyProjectId,
    branch: outcome.state === "brought" ? exp.branch : null,
  });
  return moved;
}

/** A merge that had to wait for Len's live turn is tried again when it ends (up to half an hour, like «Traer el
 *  arreglo»); if nobody asked meanwhile. A restart loses the wait: the card's button and the publish gate still hold it. */
function bringWhenLenIsDone(exp: AbExperimentRow, ownerId: string, actorId: string): void {
  void (async () => {
    const { esperarALen } = await import("@/lib/agent/turnos-desde-el-servidor");
    if (!(await esperarALen(exp.projectId))) return;
    await retryBringWinner({ projectId: exp.projectId, experimentId: exp.id, ownerId, actorId });
  })().catch((err: unknown) => {
    console.warn("[ab] the winner couldn't be brought into the draft after Len's turn", exp.id, err);
  });
}

/** Promote Variant B to 100% production (clean release without ab.json → restores
 *  Cloudflare s-maxage=3600), purge CF, and 3-way merge B into the owner's draft.
 *
 *  Once B is published the decision is MADE: it is recorded right then, and what is left — bringing B into the owner's
 *  draft — never undoes it. That second step can clash (`conflict`), wait for Len's live turn (`pending`) or fail; the
 *  owner's next publish waits until they bring it in or discard it, because it would otherwise send the draft without B
 *  (review item 26). */
export async function promoteVariantB(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly ownerId: string;
  readonly actorId: string;
  readonly locale?: string;
}): Promise<{
  readonly experiment: AbExperimentView;
  readonly bringState: "brought" | "conflict" | "pending";
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
  const held = holdDecision(locked);

  let title: string | undefined;
  let subdomain = "";
  let languages: readonly string[] = [];
  let recorded: AbExperimentRow;
  try {
    const [project] = await db
      .select({ title: schema.projects.title, subdomain: schema.projects.subdomain, data: schema.projects.data })
      .from(schema.projects)
      .where(eq(schema.projects.id, p.projectId))
      .limit(1);
    title = project?.title;
    languages = project?.data?.settings?.languages ?? [];

    if (!project?.subdomain || !locked.copyProjectId) {
      throw new AbLifecycleError("invalid_state", "Missing subdomain or Variant B worktree.", 409);
    }
    subdomain = project.subdomain;

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
    const now = new Date();
    // B is live: the decision is recorded NOW (and the lock is over), the copy and the branch stay until B is in the draft.
    // The write is fenced on this decision's own lock: if the sweep gave it away meanwhile, nothing is overwritten and the
    // reconcile pass records what the release says.
    const closed = await held.close({
      status: "promoted_b",
      decisionStatus: "resolved",
      bringState: "pending",
      promotedReleaseSha: promotedSha,
      winnerVariant: "b",
      endedAt: locked.endedAt ?? now,
      decidedAt: now,
      decidedBy: p.actorId,
    });
    if (!closed) {
      throw new AbLifecycleError(
        "decision_conflict",
        "Variant B went live, but this decision lost its lock before it could be recorded; the system will record it.",
        409,
      );
    }
    recorded = closed;
  } catch (err) {
    await held.release();
    throw err;
  } finally {
    held.stop();
  }

  await purgeExperimentEdge(subdomain, recorded, languages);

  // Three-way merge Variant B into owner's draft. Whatever happens here, B is already live.
  let outcome: BringOutcome = { state: "pending" };
  try {
    outcome = await tryBringIntoDraft(recorded, p.ownerId, p.actorId);
  } catch (err) {
    console.error("[ab] bringing the promoted winner into the draft failed; it stays pending", recorded.id, err);
  }
  // A cleanup error settling the bring must not turn a successful promotion into a 500: B is live and recorded.
  let settled: AbExperimentRow | null = null;
  try {
    settled = await settleBring(recorded, outcome);
  } catch (err) {
    console.error("[ab] settling the promoted winner's bring failed; it stays as it was", recorded.id, err);
  }
  if (outcome.state === "pending") bringWhenLenIsDone(recorded, p.ownerId, p.actorId);

  return {
    experiment: toExperimentView(settled ?? recorded, title),
    bringState: outcome.state,
    ...(outcome.state === "conflict" ? { conflictPaths: outcome.paths } : {}),
  };
}

/** Restore clean Control A at 100% (no ab.json), purge Cloudflare. `true` = a release without the experiment is live now
 *  (rolled back to Control's, or published again from its sources); `false` = there was nothing to restore it from. */
async function restoreControlLive(
  exp: AbExperimentRow,
  ownerId: string,
  subdomain: string,
): Promise<boolean> {
  // The rollback goes back to the release saved at launch — right only while the live release is still the experiment's. If
  // something else was published since, going back would undo it: the published SOURCES are republished instead (below).
  const [live] = await db
    .select({ sha: schema.projects.publishedReleaseSha, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, exp.projectId))
    .limit(1);
  const publishedSince = Boolean(exp.experimentReleaseSha) && (live?.sha ?? null) !== exp.experimentReleaseSha;
  const languages = live?.data?.settings?.languages ?? [];
  if (exp.controlReleaseSha && !publishedSince) {
    try {
      await rollbackToSha(subdomain, exp.controlReleaseSha);
      await db
        .update(schema.projects)
        .set({ publishedReleaseSha: exp.controlReleaseSha, updatedAt: new Date() })
        .where(eq(schema.projects.id, exp.projectId))
        .catch(() => undefined);
      await purgeExperimentEdge(subdomain, exp, languages);
      return true;
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
    await purgeExperimentEdge(subdomain, exp, languages);
    return true;
  }
  return false;
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
  const held = holdDecision(locked);

  try {
    const [project] = await db
      .select({ title: schema.projects.title, subdomain: schema.projects.subdomain })
      .from(schema.projects)
      .where(eq(schema.projects.id, p.projectId))
      .limit(1);

    if (project?.subdomain) {
      // A published project whose Control can't be put back is NOT «kept»: the split is still live. It fails, like the harm brake.
      const restored = await restoreControlLive(locked, p.ownerId, project.subdomain);
      if (!restored) {
        throw new AbLifecycleError("invalid_state", "Control can't be restored: nothing to restore it from.", 409);
      }
    }

    // The end is RECORDED first (fenced on this decision's lock); the copy and the branch are cleaned up after, best-effort.
    const now = new Date();
    const updated = await held.close({
      status: "kept_a",
      decisionStatus: "resolved",
      winnerVariant: "a",
      copyProjectId: null,
      endedAt: locked.endedAt ?? now,
      decidedAt: now,
      decidedBy: p.actorId,
    });
    if (!updated) {
      throw new AbLifecycleError(
        "decision_conflict",
        "Your original is live again, but this decision lost its lock before it could be recorded; the system will record it.",
        409,
      );
    }
    await cleanupBestEffort({ parentId: p.projectId, copyProjectId: locked.copyProjectId, branch: locked.branch });
    return toExperimentView(updated, project?.title);
  } catch (err) {
    await held.release();
    throw err;
  } finally {
    held.stop();
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
  const held = holdDecision(locked);
  try {
    const days = Math.min(14, Math.max(1, p.extraDays ?? 7));
    const targetDate = new Date(Date.now() + days * 24 * 3_600_000);
    const currentStop = locked.startedAt
      ? locked.startedAt.getTime() + maxDurationDaysOf(locked) * 24 * 3_600_000
      : 0;
    const updated = await held.close({
      status: "running",
      decisionStatus: "none",
      endedAt: null,
      winnerVariant: null,
      // A new verdict will be announced as a new notice.
      notifiedAt: null,
      minEndAt: targetDate,
      snoozeUntil: targetDate,
      maxEndAt: new Date(Math.max(currentStop, targetDate.getTime())),
      decidedBy: p.actorId,
    });
    if (!updated) {
      throw new AbLifecycleError("decision_conflict", "The test was decided by someone else while it was being extended.", 409);
    }
    return toExperimentView(updated);
  } catch (err) {
    await held.release();
    throw err;
  } finally {
    held.stop();
  }
}

/** Auto-stop guardrail when the evaluator detects harm (review items 21, 22). It CLAIMS the decision first, the same claim
 *  a person's decision takes: if a person is already deciding (or someone decided), it does nothing and returns `null` —
 *  never a second publish racing the first. With the claim, it puts Control back (`restored`: false only when the project
 *  has no address, so there was nothing live to put back), closes the row as `paused_harm` with the metrics that caused it,
 *  and gives the lock back if anything fails so the next pass tries again. A published project whose original can't be
 *  restored is NOT closed: the split is still live. */
export async function autoStopExperimentForHarm(
  exp: AbExperimentRow,
  ownerId: string,
  subdomain: string | null,
  snapshot: AbMetricsSnapshot,
  now: Date = new Date(),
): Promise<{ readonly restored: boolean } | null> {
  const locked = await claimExperimentDecision(exp.id, exp.projectId);
  if (!locked) return null;
  const held = holdDecision(locked);
  try {
    let restored = false;
    if (subdomain) {
      restored = await restoreControlLive(locked, ownerId, subdomain);
      if (!restored) {
        throw new AbLifecycleError("invalid_state", "Control can't be restored: nothing to restore it from.", 409);
      }
    }
    // Recorded first (fenced on this decision's lock), cleaned up after, best-effort: a cleanup that throws after Control
    // was restored must not give the lock back and leave a live-looking row over a release with no split.
    const closed = await held.close({
      status: "paused_harm",
      decisionStatus: "resolved",
      winnerVariant: "a",
      copyProjectId: null,
      metricsSnapshot: snapshot,
      evaluatedAt: now,
      endedAt: now,
      decidedAt: now,
    });
    if (!closed) {
      throw new AbLifecycleError("decision_conflict", "The harm stop lost its lock before it could be recorded.", 409);
    }
    await cleanupBestEffort({ parentId: locked.projectId, copyProjectId: locked.copyProjectId, branch: locked.branch });
    return { restored };
  } catch (err) {
    await held.release();
    throw err;
  } finally {
    held.stop();
  }
}

/** Cancel a draft experiment cleanly: its copy and branch are deleted. */
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

/** Re-tries bringing a promoted Variant B into the owner's draft: the button of the conflict card, and the wait that
 *  follows a Len turn. Only a PROMOTED experiment whose bring is still open (`pending` or `conflict`) can be brought:
 *  anything else has no branch worth merging, or already had it (review item 26). With a Len turn live it answers
 *  `queued` and tries again when the turn ends. */
export async function retryBringWinner(p: {
  readonly projectId: string;
  readonly experimentId: string;
  readonly ownerId: string;
  readonly actorId: string;
}): Promise<{
  readonly status: "brought" | "conflict" | "nothing" | "queued";
  readonly paths?: readonly string[];
}> {
  const exp = await getExperimentById(p.experimentId);
  if (!exp || exp.projectId !== p.projectId || !exp.baseCommitOid || !exp.branch) {
    throw new AbLifecycleError("not_found", "Experiment branch not found", 404);
  }
  if (exp.status !== "promoted_b") {
    throw new AbLifecycleError("invalid_state", "Only a promoted Variant B can be brought into the draft.", 409);
  }
  if (exp.bringState !== "pending" && exp.bringState !== "conflict") {
    throw new AbLifecycleError("invalid_state", "This Variant B was already brought in, or discarded.", 409);
  }
  const outcome = await tryBringIntoDraft(exp, p.ownerId, p.actorId);
  if (outcome.state === "pending") {
    bringWhenLenIsDone(exp, p.ownerId, p.actorId);
    return { status: "queued" };
  }
  if (outcome.state === "conflict") {
    await transitionBringState(exp.id, ["pending", "conflict"], { bringState: "conflict" });
    return { status: "conflict", paths: outcome.paths };
  }
  await settleBring(exp, outcome);
  return { status: outcome.kind };
}

/** «Don't bring it in»: the owner keeps their draft as it is and gives up Variant B's changes in it. Production stays as
 *  it is — B is live — and the branch is deleted. After this their next publish no longer waits (and WILL publish the draft
 *  without B: that is the choice they just made). */
export async function discardWinnerBring(p: {
  readonly projectId: string;
  readonly experimentId: string;
}): Promise<AbExperimentView> {
  const exp = await getExperimentById(p.experimentId);
  if (!exp || exp.projectId !== p.projectId) {
    throw new AbLifecycleError("not_found", "Experiment not found", 404);
  }
  if (exp.status !== "promoted_b") {
    throw new AbLifecycleError("invalid_state", "Only a promoted Variant B has changes to discard.", 409);
  }
  const moved = await transitionBringState(exp.id, ["pending", "conflict"], { bringState: "declined", copyProjectId: null });
  if (!moved) {
    throw new AbLifecycleError("invalid_state", "This Variant B was already brought in, or discarded.", 409);
  }
  await cleanupAbWorktree({ parentId: exp.projectId, copyProjectId: exp.copyProjectId, branch: exp.branch });
  return toExperimentView(moved);
}
