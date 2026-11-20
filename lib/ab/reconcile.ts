// THE RECONCILE PASS (review of G4+G5, ruling 5). The database row and the live release can disagree, and the release is what
// the edge serves, so it is the witness. The ways they part:
//   · an owner's «Stop and publish» whose close failed twice — the page is theirs, the row still says «running» (and the next
//     system republish would re-emit the split over it, a late winner card would promote a stale B over their newer page, every
//     later publish would be asked about a test they stopped);
//   · a launch that died between the swap and its final write — the slot stays claimed and nobody can decide it;
//   · a promote whose recording failed after B went live — B is at 100% and the row says the test is still running.
// Before the evaluator judges anything, this pass reads `<live release>/openlen/ab.json` for every live row that no decision is
// applying (`readLiveAb`) and settles each one from what the release says:
//   (a) it HAS started, and the release doesn't name it (no manifest, other experiments only, or no address): the split isn't
//       live. If what is live is Variant B (the published sources are the copy's, not the baseline's), the promotion is recorded
//       as the owner's would have been — `promoted_b`, its bring pending — and B is brought into the draft; otherwise the
//       experiment is closed as `cancelled` by the system: edge purged, copy cleaned up, NOTHING published.
//   (b) it has NOT started and was claimed more than 15 minutes ago (the launch that owned the claim is gone): if the release
//       names it, the launch is finished from the release (start = the claim time, the live sha, the manifest's overrides and
//       split, the branch tip as Variant B's commit); otherwise the slot goes back to the draft.
// It never guesses: a release that can't be read right now changes nothing (a transient error must never close a row over a
// split that is still live); every write is a compare-and-swap that a person's decision or the launch's own final write wins;
// the owner is told once of what the system did on its own.
import "server-only";

import type { EvaluatorProjectInfo } from "./evaluator";
import type { LiveAb } from "./live-manifest";
import type { AbExperimentRow } from "./store";
import { MIN_DURATION_HOURS } from "./stats";
import { AB_SYSTEM_ACTOR } from "./types";

/** `decidedBy` of what the system closed on its own. */
export const SYSTEM_ACTOR = AB_SYSTEM_ACTOR;
/** A launch's lease not refreshed for this long belongs to a launch that is gone: a live one beats every minute. */
export const LAUNCH_CLAIM_STALE_MS = 15 * 60_000;

export type ReconcileVerdict = "closed_by_system" | "promoted_by_system";

export interface ReconcileDeps {
  /** Every live experiment of every project, the claimed launches included. */
  listLive(): Promise<readonly AbExperimentRow[]>;
  project(projectId: string): Promise<EvaluatorProjectInfo | null>;
  readLive(subdomain: string, experimentId: string): Promise<LiveAb>;
  /** (b) finishes a launch from the release; `false` = the launch's own final write (or a person) got there first. */
  finishLaunch(exp: AbExperimentRow, live: Extract<LiveAb, { kind: "live" }>, claimedAt: Date): Promise<boolean>;
  /** (b) gives the claimed slot back to the draft. */
  giveLaunchBack(exp: AbExperimentRow): Promise<void>;
  /** (a) is what is live Variant B? `variant_b` only when the published sources are the experiment's copy's and not the baseline's. */
  whatIsLive(exp: AbExperimentRow): Promise<"variant_b" | "other">;
  /** (a) records the promotion; `null` = it wasn't ours to close (a person decided, or it was settled). */
  recordPromotion(exp: AbExperimentRow, liveSha: string, now: Date): Promise<AbExperimentRow | null>;
  /** (a) what follows a recorded promotion: the edge purge and the bring into the draft. */
  afterPromotion(recorded: AbExperimentRow, project: EvaluatorProjectInfo): Promise<void>;
  /** (a) closes the experiment as cancelled by the system; `null` = it wasn't ours to close. */
  cancel(exp: AbExperimentRow): Promise<AbExperimentRow | null>;
  /** (a) what follows a cancel: the edge purge and the copy's cleanup (best-effort, no publish). */
  afterCancel(original: AbExperimentRow, project: EvaluatorProjectInfo): Promise<void>;
  /** Tells the owner, once. */
  tell(project: EvaluatorProjectInfo, exp: AbExperimentRow, verdict: ReconcileVerdict, now: Date): Promise<void>;
}

export interface ReconcileStats {
  readonly launchesFinished: number;
  readonly launchesReleased: number;
  readonly cancelled: number;
  readonly promoted: number;
}

export async function reconcileLiveExperiments(deps: ReconcileDeps, now: Date = new Date()): Promise<ReconcileStats> {
  let launchesFinished = 0;
  let launchesReleased = 0;
  let cancelled = 0;
  let promoted = 0;

  for (const exp of await deps.listLive()) {
    // A person's decision is being applied: not ours to touch.
    if (exp.decisionStatus === "applying") continue;
    try {
      const project = await deps.project(exp.projectId);
      if (!project) continue;

      // (b) A claimed slot with no start.
      if (!exp.startedAt) {
        // The claim is a lease: its clock is the launch's last heartbeat (a row from before the lease has none: the claim's time).
        const claimedAt = exp.updatedAt;
        const lastBeat = exp.decisionLockedAt ?? exp.updatedAt;
        if (now.getTime() - lastBeat.getTime() < LAUNCH_CLAIM_STALE_MS) continue;
        const live: LiveAb = project.subdomain ? await deps.readLive(project.subdomain, exp.id) : { kind: "none", sha: null };
        if (live.kind === "unknown") continue;
        if (live.kind === "live") {
          if (await deps.finishLaunch(exp, live, claimedAt)) {
            launchesFinished++;
            console.warn(`[ab-reconcile] finished the launch of ${exp.id} from the live release (its launch never wrote the start)`);
          }
        } else {
          await deps.giveLaunchBack(exp);
          launchesReleased++;
          console.warn(`[ab-reconcile] gave back the launch slot of ${exp.id}: the live release doesn't carry it`);
        }
        continue;
      }

      // (a) A started experiment: the release must carry its split.
      const live: LiveAb = project.subdomain ? await deps.readLive(project.subdomain, exp.id) : { kind: "none", sha: null };
      if (live.kind === "unknown" || live.kind === "live") continue;

      if (project.subdomain && live.sha && (await deps.whatIsLive(exp)) === "variant_b") {
        const recorded = await deps.recordPromotion(exp, live.sha, now);
        if (!recorded) continue;
        promoted++;
        console.warn(`[ab-reconcile] ${exp.id}: Variant B is live at 100% with no record; recorded the promotion`);
        await deps.afterPromotion(recorded, project).catch((err: unknown) => {
          console.error("[ab-reconcile] the recorded promotion couldn't be finished (the bring stays pending)", exp.id, err);
        });
        await deps.tell(project, recorded, "promoted_by_system", now).catch((err: unknown) => {
          console.warn("[ab-reconcile] couldn't tell the owner of a recorded promotion", exp.id, err);
        });
        continue;
      }

      const closed = await deps.cancel(exp);
      if (!closed) continue;
      cancelled++;
      console.warn(`[ab-reconcile] ${exp.id} was closed by the system: the live release no longer carries its split`);
      await deps.afterCancel(exp, project).catch((err: unknown) => {
        console.error("[ab-reconcile] couldn't clean up a closed experiment (only clutter now)", exp.id, err);
      });
      await deps.tell(project, closed, "closed_by_system", now).catch((err: unknown) => {
        console.warn("[ab-reconcile] couldn't tell the owner of a closed experiment", exp.id, err);
      });
    } catch (err) {
      // One experiment's failure is that experiment's: the next pass tries again.
      console.warn(`[ab-reconcile] couldn't reconcile ${exp.id}`, err);
    }
  }

  return { launchesFinished, launchesReleased, cancelled, promoted };
}

/** Same files, byte for byte (path → content). */
function sameFiles(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
}

/** The real thing. The evaluator passes how it reads a project and how it tells its owner; everything else is the store, the
 *  release on disk and the lifecycle's own tail of a promotion. Modules load on first use (the evaluator's cost at boot). */
export function defaultReconcileDeps(io: {
  projectInfo(projectId: string): Promise<EvaluatorProjectInfo | null>;
  tell(project: EvaluatorProjectInfo, exp: AbExperimentRow, verdict: ReconcileVerdict, now: Date): Promise<void>;
}): ReconcileDeps {
  const languagesOf = async (projectId: string): Promise<readonly string[]> => {
    const [{ db, schema }, { eq }] = await Promise.all([import("@/lib/db"), import("drizzle-orm")]);
    const [row] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
    return row?.data?.settings?.languages ?? [];
  };

  return {
    listLive: async () => (await import("./store")).listLiveExperiments(),
    project: io.projectInfo,
    readLive: async (subdomain, experimentId) => (await import("./live-manifest")).readLiveAb(subdomain, experimentId),

    finishLaunch: async (exp, live, claimedAt) => {
      const [{ finalizeLaunch }, { branchTip }] = await Promise.all([import("./store"), import("@/lib/len-watch/worktree")]);
      // Variant B's commit as it was at the launch: the branch's tip (nothing commits to it after the launch).
      const tip = exp.branch ? await branchTip(exp.projectId, exp.branch).catch(() => null) : null;
      // Fenced on the claim it read: its token AND its clock — a heartbeat that landed since, or a relaunch's new claim, makes this miss.
      const row = await finalizeLaunch(exp.id, { token: exp.decisionLockToken, lockedAt: exp.decisionLockedAt }, {
        status: "running",
        decisionStatus: "none",
        splitBps: live.splitBps,
        experimentReleaseSha: live.sha,
        overridePaths: [...live.overrides],
        startedAt: claimedAt,
        minEndAt: new Date(claimedAt.getTime() + MIN_DURATION_HOURS * 3_600_000),
        ...(tip ? { variantBCommitOid: tip } : {}),
      });
      return row !== null;
    },
    giveLaunchBack: async (exp) =>
      (await import("./store")).releaseLaunch(exp.id, { token: exp.decisionLockToken, lockedAt: exp.decisionLockedAt }),

    whatIsLive: async (exp) => {
      if (!exp.copyProjectId) return "other";
      const [{ db, schema }, { eq }, { readPublishedSources, snapshotFiles }, { copySources, readFilesAtCommit }] = await Promise.all([
        import("@/lib/db"),
        import("drizzle-orm"),
        import("@/lib/len-watch/published-sources"),
        import("./worktree"),
      ]);
      const [copyRow] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, exp.copyProjectId)).limit(1);
      if (!copyRow) return "other";
      const published = await readPublishedSources(exp.projectId);
      if (!published) return "other";
      const live = await readFilesAtCommit(exp.projectId, published.commitOid);
      // The baseline is live (Control was restored, or nothing changed): that is the end of a test, not a promotion.
      if (exp.baseCommitOid) {
        const base = await readFilesAtCommit(exp.projectId, exp.baseCommitOid).catch(() => null);
        if (base && sameFiles(base, live)) return "other";
      }
      const copy = await copySources(exp.copyProjectId);
      return sameFiles(snapshotFiles(copy.data, copy.folder).versioned, live) ? "variant_b" : "other";
    },

    recordPromotion: async (exp, liveSha, now) =>
      (await import("./store")).closeLiveExperiment(exp.id, {
        status: "promoted_b",
        decisionStatus: "resolved",
        bringState: "pending",
        promotedReleaseSha: liveSha,
        winnerVariant: "b",
        endedAt: exp.endedAt ?? now,
        decidedAt: now,
        decidedBy: SYSTEM_ACTOR,
      }),
    afterPromotion: async (recorded, project) => {
      const { finishPromotion } = await import("./lifecycle");
      await finishPromotion(recorded, project.subdomain!, await languagesOf(recorded.projectId), project.ownerId, project.ownerId);
    },

    cancel: async (exp) => (await import("./store")).cancelLiveExperiment(exp.id, SYSTEM_ACTOR),
    afterCancel: async (original, project) => {
      const [{ purgeExperimentEdge }, { cleanupBestEffort }] = await Promise.all([import("./edge-purge"), import("./lifecycle")]);
      if (project.subdomain) await purgeExperimentEdge(project.subdomain, original, await languagesOf(original.projectId));
      await cleanupBestEffort({ parentId: original.projectId, copyProjectId: original.copyProjectId, branch: original.branch });
    },

    tell: io.tell,
  };
}
