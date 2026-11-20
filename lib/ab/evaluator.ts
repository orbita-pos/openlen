// Periodic evaluator for OpenLen Edge A/B Testing (Plan 3).
// Runs every 30 minutes inside the Next.js Node.js process (started from instrumentation.ts),
// evaluates every `running` experiment with `computeExperimentMetrics` + `evaluateAbStats`:
//   - Snapshots metrics + daily rollup into `abExperimentDaily`.
//   - Auto-stops on `harm_stop` (>30% drop at >=95% prob) and notifies owner.
//   - Transitions to `winner_ready` / `inconclusive` with `decisionStatus = "pending"` when a
//     verdict is reached (respecting `snoozeUntil`); notifies directly if the project has no
//     assistant with `morningSummary = true`, otherwise lets the 8 a.m. morning summary deliver it.
//
// It never overwrites a person (review items 21, 22):
//   - an experiment whose decision is being applied is skipped, and every write is a compare-and-swap that only lands on a
//     `running` experiment with no decision taken (`saveEvaluation`); a write that doesn't land changes — and tells — nothing;
//   - the harm brake CLAIMS the decision first, the same claim a person's takes (`autoStopExperimentForHarm`);
//   - a pass gives back the lock of a decision that died (`releaseStaleDecisionLocks`);
//   - notices are AT LEAST once: the notification is queued first (its dedupe key keeps it from doubling) and `notifiedAt`
//     is set only after it was queued; a pass also sends the ones a deploy cut in between (final status, `notifiedAt` null).
import "server-only";

import { eq } from "drizzle-orm";

import { abTestingEnabled } from "./enabled";
import type { AbResultEvent } from "@/lib/notifications/types";
import type { AbMetricsSnapshot, AbStatsResult } from "./types";
import type { AbEvaluationPatch, AbExperimentRow } from "./store";
import type { ReconcileVerdict } from "./reconcile";
import { abNotificationTexts } from "./texts";
import { AB_SYSTEM_ACTOR } from "./types";

export const EVALUATOR_INTERVAL_MS = 30 * 60_000;

export interface EvaluatorProjectInfo {
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly subdomain: string | null;
  /** The OWNER'S language, as Len Watch writes its notices in (`watchLocale`): the one they write to Len in, then their
   *  interface's, the page's only when nothing is known about them (review item 29). The notices and their links use it. */
  readonly locale: string;
  readonly assistant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly morningSummary: boolean;
  } | null;
}

export interface EvaluatorDeps {
  /** Gives back the locks of decisions that died (an `applying` older than ten minutes); returns their ids. */
  releaseStaleLocks(now: Date): Promise<readonly string[]>;
  /** The reconcile pass (`./reconcile`): settles the rows the live release disagrees with, BEFORE anything is judged. Settles
   *  its experiments one by one and never throws for one of them. */
  reconcileLive?(now: Date): Promise<void>;
  listRunning(): Promise<readonly AbExperimentRow[]>;
  /** Experiments that ended in a verdict (winner, inconclusive, harm stop) and were never announced. */
  listUnannounced(): Promise<readonly AbExperimentRow[]>;
  projectInfo(projectId: string): Promise<EvaluatorProjectInfo | null>;
  computeMetrics(exp: AbExperimentRow, now: Date): Promise<AbMetricsSnapshot>;
  /** A compare-and-swap: lands only on a `running` experiment with no decision taken. `false` = it didn't. */
  saveSnapshot(expId: string, patch: AbEvaluationPatch): Promise<boolean>;
  upsertDaily(expId: string, dayIso: string, snapshot: AbMetricsSnapshot): Promise<void>;
  /** Claims the decision, puts Control back and closes the experiment as `paused_harm`. `null` = the claim was lost
   *  (a person is deciding, or it was decided): nothing was touched. */
  autoStopForHarm(
    exp: AbExperimentRow,
    ownerId: string,
    subdomain: string | null,
    snapshot: AbMetricsSnapshot,
    now: Date,
  ): Promise<{ readonly restored: boolean } | null>;
  notify(event: AbResultEvent, dedupeKey: string): Promise<void>;
  markNotified(expId: string, at: Date): Promise<void>;
  readonly siteUrl: string;
}

export interface EvaluatorRunStats {
  readonly evaluated: number;
  readonly winners: number;
  readonly inconclusive: number;
  readonly harmStopped: number;
  readonly notifiedDirectly: number;
}

type Announced = "winner_b" | "winner_a" | "inconclusive" | "harm_stop";
type Told = Announced | ReconcileVerdict;

/** Queues the notice for an experiment that reached a verdict and, once it IS queued, marks it told. A queue that fails
 *  throws: `notifiedAt` stays null and the next pass sends it. */
async function announce(
  deps: EvaluatorDeps,
  info: EvaluatorProjectInfo,
  exp: AbExperimentRow,
  verdict: Told,
  stats: Pick<AbStatsResult, "relativeLift" | "probBBeatsA" | "probABeatsB" | "probHarm30" | "reason">,
  extra: { readonly restored?: boolean },
  now: Date,
): Promise<void> {
  const locale = info.locale;
  const url = info.assistant
    ? `${deps.siteUrl}/${locale}/assistant/${encodeURIComponent(info.assistant.slug)}`
    : `${deps.siteUrl}/${locale}/new?project=${encodeURIComponent(exp.projectId)}&chat=1&ab=${encodeURIComponent(exp.id)}`;
  const prob =
    verdict === "harm_stop"
      ? stats.probHarm30
      : verdict === "winner_b"
        ? stats.probBBeatsA
        : verdict === "winner_a"
          ? stats.probABeatsB
          : Math.max(stats.probBBeatsA, stats.probABeatsB);
  const texts = abNotificationTexts(locale, {
    name: exp.name,
    assistantName: info.assistant?.name ?? null,
    verdict,
    liftPct: Math.round(stats.relativeLift * 100),
    probabilityPct: Math.round(prob * 100),
    url,
    ...(extra.restored === false ? { restored: false } : {}),
    ...(stats.reason ? { reason: stats.reason } : {}),
  });
  await deps.notify(
    {
      type: "ab_result",
      projectId: exp.projectId,
      recipientUserId: info.ownerId,
      experimentId: exp.id,
      ...(info.assistant ? { assistantId: info.assistant.id, assistantSlug: info.assistant.slug } : {}),
      locale: texts.locale,
      verdict,
      title: texts.title,
      push: texts.push,
      emailSubject: texts.emailSubject,
      emailText: texts.emailText,
    },
    `ab_result:${exp.id}:${verdict}`,
  );
  await deps.markNotified(exp.id, now);
}

/** What an experiment that already ended says, read from its row: harm stop, or the verdict its snapshot reached. */
function verdictOfEnded(exp: AbExperimentRow): Told {
  // What the reconcile pass did on its own (nobody decided it): its own notice.
  if (exp.decidedBy === AB_SYSTEM_ACTOR && exp.status === "cancelled") return "closed_by_system";
  if (exp.decidedBy === AB_SYSTEM_ACTOR && exp.status === "promoted_b") return "promoted_by_system";
  if (exp.status === "paused_harm") return "harm_stop";
  if (exp.status === "inconclusive") return "inconclusive";
  return exp.winnerVariant === "a" ? "winner_a" : "winner_b";
}

export async function evaluateRunningExperiments(
  deps: EvaluatorDeps,
  now: Date = new Date(),
): Promise<EvaluatorRunStats> {
  let evaluated = 0;
  let winners = 0;
  let inconclusive = 0;
  let harmStopped = 0;
  let notifiedDirectly = 0;
  const dayIso = now.toISOString().slice(0, 10);

  // 0. A decision that died holds `applying` forever: give its lock back, as it was.
  try {
    const released = await deps.releaseStaleLocks(now);
    if (released.length > 0) console.warn(`[ab-evaluator] gave back ${released.length} stale decision lock(s)`, released);
  } catch (err) {
    console.warn("[ab-evaluator] couldn't sweep stale decision locks", err);
  }

  // 0b. THE RECONCILE PASS (review of G4+G5, ruling 5): what the live release says about every live experiment, before any of
  //     them is judged — a split that isn't live any more is closed, a launch that never finished is settled, a promotion whose
  //     recording was lost is recorded. A failure here never stops the pass.
  try {
    await deps.reconcileLive?.(now);
  } catch (err) {
    console.warn("[ab-evaluator] the reconcile pass failed", err);
  }

  // 1. The notices a deploy cut between the verdict and the queue (review item 22). Before the loop, so a notice the loop
  //    sends now isn't read back here. The ones the morning summary says are not ours (it marks them told).
  try {
    for (const exp of await deps.listUnannounced()) {
      try {
        const info = await deps.projectInfo(exp.projectId);
        if (!info) continue;
        const verdict = verdictOfEnded(exp);
        // The morning summary delivers a winner or a no-result (it marks them told); a harm stop and what the system did on its
        // own are never in it: they are sent here.
        if ((verdict === "winner_b" || verdict === "winner_a" || verdict === "inconclusive") && info.assistant?.morningSummary) continue;
        const stats = exp.metricsSnapshot?.stats ?? { relativeLift: 0, probBBeatsA: 0, probABeatsB: 0, probHarm30: 0 };
        await announce(deps, info, exp, verdict, stats, { restored: verdict === "harm_stop" ? info.subdomain !== null : true }, now);
        notifiedDirectly++;
      } catch (err) {
        console.warn(`[ab-evaluator] couldn't send the notice of ${exp.id}`, err);
      }
    }
  } catch (err) {
    console.warn("[ab-evaluator] couldn't list the notices still to send", err);
  }

  const running = await deps.listRunning();
  for (const exp of running) {
    if (!exp.startedAt) continue;
    // A person is applying a decision: not ours to touch.
    if (exp.decisionStatus === "applying") continue;
    try {
      const info = await deps.projectInfo(exp.projectId);
      if (!info) continue;

      const snapshot = await deps.computeMetrics(exp, now);
      await deps.upsertDaily(exp.id, dayIso, snapshot);
      evaluated++;

      const { stats } = snapshot;

      // 2. Harm guardrail acts immediately — never delayed by snoozeUntil or morning summary — but it CLAIMS the decision
      //    first, like a person: if one is deciding, or it was decided, it does nothing.
      if (stats.verdict === "harm_stop") {
        const stopped = await deps.autoStopForHarm(exp, info.ownerId, info.subdomain, snapshot, now);
        if (!stopped) continue;
        harmStopped++;
        await announce(deps, info, exp, "harm_stop", stats, { restored: stopped.restored }, now);
        notifiedDirectly++;
        continue;
      }

      // 3. Snoozed by owner («Seguir probando»): keep collecting until snoozeUntil passes.
      const snoozed = exp.snoozeUntil !== null && now < exp.snoozeUntil;
      if (
        snoozed ||
        stats.verdict === "collecting" ||
        stats.verdict === "srm_blocked"
      ) {
        await deps.saveSnapshot(exp.id, { metricsSnapshot: snapshot, evaluatedAt: now });
        continue;
      }

      // 4. Reached a decision verdict: winner_b | winner_a | inconclusive. Only if no person got there first.
      const nextStatus = stats.verdict === "inconclusive" ? "inconclusive" : "winner_ready";
      const landed = await deps.saveSnapshot(exp.id, {
        metricsSnapshot: snapshot,
        evaluatedAt: now,
        status: nextStatus,
        decisionStatus: "pending",
        winnerVariant: stats.winner,
        endedAt: exp.endedAt ?? now,
      });
      if (!landed) continue;
      if (nextStatus === "inconclusive") inconclusive++;
      else winners++;

      // If the project has an assistant with morningSummary ON, wait for the 8 a.m. summary
      // (which reads `pendingDecisionsForProjects`) to avoid double notifications.
      if (info.assistant?.morningSummary) {
        continue;
      }

      await announce(deps, info, exp, stats.verdict as Announced, stats, {}, now);
      notifiedDirectly++;
    } catch (err) {
      console.warn(`[ab-evaluator] failed evaluating ${exp.id}`, err);
    }
  }

  return { evaluated, winners, inconclusive, harmStopped, notifiedDirectly };
}

export async function defaultEvaluatorDeps(): Promise<EvaluatorDeps> {
  const [
    { db, schema },
    { assistantOfProject },
    { assistantsEnabled },
    { scheduleNotification },
    { computeExperimentMetrics, upsertExperimentDailySnapshot, metricsInputOf },
    { listRunningExperiments, listUnannouncedResults, markExperimentNotified, releaseStaleDecisionLocks, saveEvaluation },
    { autoStopExperimentForHarm },
    { projectForWatch },
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/assistants/store"),
    import("@/lib/assistants/enabled"),
    import("@/lib/notifications/dispatch"),
    import("./metrics"),
    import("./store"),
    import("./lifecycle"),
    import("@/lib/len-watch/owner"),
  ]);

  const deps: EvaluatorDeps = {
    releaseStaleLocks: (now) => releaseStaleDecisionLocks(now),
    reconcileLive: async (now) => {
      const { reconcileLiveExperiments, defaultReconcileDeps } = await import("./reconcile");
      await reconcileLiveExperiments(
        defaultReconcileDeps({
          projectInfo: (projectId) => deps.projectInfo(projectId),
          tell: (project, exp, verdict, at) => announce(deps, project, exp, verdict, NO_STATS, {}, at),
        }),
        now,
      );
    },
    listRunning: listRunningExperiments,
    listUnannounced: listUnannouncedResults,
    projectInfo: async (projectId) => {
      const [proj] = await db
        .select({
          id: schema.projects.id,
          ownerId: schema.projects.userId,
          title: schema.projects.title,
          subdomain: schema.projects.subdomain,
        })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .limit(1);
      if (!proj) return null;
      let assistant: EvaluatorProjectInfo["assistant"] = null;
      if (assistantsEnabled()) {
        const a = await assistantOfProject(projectId).catch(() => null);
        if (a) {
          const [row] = await db
            .select({
              id: schema.assistants.id,
              name: schema.assistants.name,
              slug: schema.assistants.slug,
              morningSummary: schema.assistants.morningSummary,
            })
            .from(schema.assistants)
            .where(eq(schema.assistants.id, a.id))
            .limit(1);
          if (row) assistant = row;
        }
      }
      // Len Watch's own reading of the owner's language; a failure to read it is "en", never a missed notice.
      const locale = await projectForWatch(projectId).then((p) => p?.locale ?? "en", () => "en");
      return { ...proj, locale, assistant };
    },
    computeMetrics: (exp, now) =>
      computeExperimentMetrics(metricsInputOf({ ...exp, startedAt: exp.startedAt! }), now),
    saveSnapshot: saveEvaluation,
    upsertDaily: async (expId, dayIso, snapshot) => {
      await Promise.all([
        upsertExperimentDailySnapshot(expId, dayIso, "a", snapshot.a),
        upsertExperimentDailySnapshot(expId, dayIso, "b", snapshot.b),
      ]);
    },
    autoStopForHarm: (exp, ownerId, subdomain, snapshot, now) =>
      autoStopExperimentForHarm(exp, ownerId, subdomain, snapshot, now),
    notify: (event, key) => scheduleNotification(event, key),
    markNotified: markExperimentNotified,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com",
  };
  return deps;
}

/** The numbers a notice that isn't about a result (the system closed or recorded something) has: none. */
const NO_STATS = { relativeLift: 0, probBBeatsA: 0, probABeatsB: 0, probHarm30: 0 };

let started: { stop(): void } | null = null;

/** Starts once per Next.js Node.js process from `instrumentation.ts`. */
export function startAbEvaluator(
  o: { env?: Readonly<Record<string, string | undefined>>; deps?: EvaluatorDeps } = {},
): { stop(): void } {
  if (!abTestingEnabled(o.env)) return { stop() {} };
  if (started) return started;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let running = false;

  void (o.deps ? Promise.resolve(o.deps) : defaultEvaluatorDeps())
    .then(async (deps) => {
      if (stopped) return;
      const pass = async () => {
        if (running) return;
        running = true;
        try {
          const stats = await evaluateRunningExperiments(deps, new Date());
          if (stats.winners + stats.inconclusive + stats.harmStopped > 0) {
            console.log(
              `[ab-evaluator] evaluated=${stats.evaluated} winners=${stats.winners} inconclusive=${stats.inconclusive} harm=${stats.harmStopped}`,
            );
          }
        } catch (err) {
          console.error("[ab-evaluator] pass failed", err);
        } finally {
          running = false;
        }
      };
      await pass();
      if (stopped) return;
      timer = setInterval(() => void pass(), EVALUATOR_INTERVAL_MS);
      timer.unref?.();
    })
    .catch((err) => console.error("[ab-evaluator] could not start", err));

  return (started = {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      started = null;
    },
  });
}
