// Periodic evaluator for OpenLen Edge A/B Testing (Plan 3).
// Runs every 30 minutes inside the Next.js Node.js process (started from instrumentation.ts),
// evaluates every `running` experiment with `computeExperimentMetrics` + `evaluateAbStats`:
//   - Snapshots metrics + daily rollup into `abExperimentDaily`.
//   - Auto-stops immediately on `harm_stop` (>30% drop at >=95% prob) and notifies owner.
//   - Transitions to `winner_ready` / `inconclusive` with `decisionStatus = "pending"` when a
//     verdict is reached (respecting `snoozeUntil`); notifies directly if the project has no
//     assistant with `morningSummary = true`, otherwise lets the 8 a.m. morning summary deliver it.
import "server-only";

import { eq } from "drizzle-orm";

import { abTestingEnabled } from "./enabled";
import type { AbResultEvent } from "@/lib/notifications/types";
import type { AbMetricsSnapshot, AbVariant } from "./types";
import type { AbExperimentRow } from "./store";
import { abNotificationTexts } from "./texts";

export const EVALUATOR_INTERVAL_MS = 30 * 60_000;

export interface EvaluatorProjectInfo {
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly subdomain: string | null;
  readonly assistant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly morningSummary: boolean;
    readonly summaryLocale: string | null;
  } | null;
}

export interface EvaluatorDeps {
  listRunning(): Promise<readonly AbExperimentRow[]>;
  projectInfo(projectId: string): Promise<EvaluatorProjectInfo | null>;
  computeMetrics(exp: AbExperimentRow, now: Date): Promise<AbMetricsSnapshot>;
  saveSnapshot(
    expId: string,
    patch: {
      metricsSnapshot: AbMetricsSnapshot;
      evaluatedAt: Date;
      status?: AbExperimentRow["status"];
      decisionStatus?: AbExperimentRow["decisionStatus"];
      winnerVariant?: AbVariant | null;
      endedAt?: Date;
      notifiedAt?: Date;
    },
  ): Promise<void>;
  upsertDaily(expId: string, dayIso: string, snapshot: AbMetricsSnapshot): Promise<void>;
  autoStopForHarm(exp: AbExperimentRow, ownerId: string, subdomain: string): Promise<void>;
  notify(event: AbResultEvent, dedupeKey: string): Promise<void>;
  readonly siteUrl: string;
}

export interface EvaluatorRunStats {
  readonly evaluated: number;
  readonly winners: number;
  readonly inconclusive: number;
  readonly harmStopped: number;
  readonly notifiedDirectly: number;
}

export async function evaluateRunningExperiments(
  deps: EvaluatorDeps,
  now: Date = new Date(),
): Promise<EvaluatorRunStats> {
  const running = await deps.listRunning();
  const dayIso = now.toISOString().slice(0, 10);
  let evaluated = 0;
  let winners = 0;
  let inconclusive = 0;
  let harmStopped = 0;
  let notifiedDirectly = 0;

  for (const exp of running) {
    if (!exp.startedAt) continue;
    try {
      const info = await deps.projectInfo(exp.projectId);
      if (!info) continue;

      const snapshot = await deps.computeMetrics(exp, now);
      await deps.upsertDaily(exp.id, dayIso, snapshot);
      evaluated++;

      const { stats } = snapshot;

      // 1. Harm guardrail always acts immediately — never delayed by snoozeUntil or morning summary.
      if (stats.verdict === "harm_stop") {
        if (info.subdomain) {
          await deps.autoStopForHarm(exp, info.ownerId, info.subdomain);
        }
        await deps.saveSnapshot(exp.id, {
          metricsSnapshot: snapshot,
          evaluatedAt: now,
          status: "paused_harm",
          decisionStatus: "resolved",
          winnerVariant: "a",
          endedAt: now,
          notifiedAt: now,
        });
        harmStopped++;

        const locale = info.assistant?.summaryLocale ?? "en";
        const url = info.assistant
          ? `${deps.siteUrl}/${locale}/assistant/${encodeURIComponent(info.assistant.slug)}`
          : `${deps.siteUrl}/${locale}/new?project=${encodeURIComponent(exp.projectId)}&chat=1`;
        const texts = abNotificationTexts(locale, {
          name: exp.name,
          assistantName: info.assistant?.name ?? null,
          verdict: "harm_stop",
          liftPct: Math.round(stats.relativeLift * 100),
          probabilityPct: Math.round(stats.probHarm30 * 100),
          url,
        });
        await deps.notify(
          {
            type: "ab_result",
            projectId: exp.projectId,
            recipientUserId: info.ownerId,
            experimentId: exp.id,
            ...(info.assistant ? { assistantId: info.assistant.id, assistantSlug: info.assistant.slug } : {}),
            locale: texts.locale,
            verdict: "harm_stop",
            title: texts.title,
            push: texts.push,
            emailSubject: texts.emailSubject,
            emailText: texts.emailText,
          },
          `ab_result:${exp.id}:harm_stop`,
        );
        notifiedDirectly++;
        continue;
      }

      // 2. Snoozed by owner («Seguir probando»): keep collecting until snoozeUntil passes.
      const snoozed = exp.snoozeUntil !== null && now < exp.snoozeUntil;
      if (
        snoozed ||
        stats.verdict === "collecting" ||
        stats.verdict === "srm_blocked"
      ) {
        await deps.saveSnapshot(exp.id, {
          metricsSnapshot: snapshot,
          evaluatedAt: now,
        });
        continue;
      }

      // 3. Reached a decision verdict: winner_b | winner_a | inconclusive.
      const nextStatus = stats.verdict === "inconclusive" ? "inconclusive" : "winner_ready";
      if (nextStatus === "inconclusive") inconclusive++;
      else winners++;

      await deps.saveSnapshot(exp.id, {
        metricsSnapshot: snapshot,
        evaluatedAt: now,
        status: nextStatus,
        decisionStatus: "pending",
        winnerVariant: stats.winner,
        endedAt: exp.endedAt ?? now,
        notifiedAt: now,
      });

      // If the project has an assistant with morningSummary ON, wait for the 8 a.m. summary
      // (which reads `pendingDecisionsForProjects`) to avoid double notifications.
      if (info.assistant?.morningSummary) {
        continue;
      }

      const locale = info.assistant?.summaryLocale ?? "en";
      const url = info.assistant
        ? `${deps.siteUrl}/${locale}/assistant/${encodeURIComponent(info.assistant.slug)}`
        : `${deps.siteUrl}/${locale}/new?project=${encodeURIComponent(exp.projectId)}&chat=1&ab=${encodeURIComponent(exp.id)}`;
      const prob =
        stats.verdict === "winner_b"
          ? stats.probBBeatsA
          : stats.verdict === "winner_a"
            ? stats.probABeatsB
            : Math.max(stats.probBBeatsA, stats.probABeatsB);
      const texts = abNotificationTexts(locale, {
        name: exp.name,
        assistantName: info.assistant?.name ?? null,
        verdict: stats.verdict,
        liftPct: Math.round(stats.relativeLift * 100),
        probabilityPct: Math.round(prob * 100),
        url,
      });
      await deps.notify(
        {
          type: "ab_result",
          projectId: exp.projectId,
          recipientUserId: info.ownerId,
          experimentId: exp.id,
          ...(info.assistant ? { assistantId: info.assistant.id, assistantSlug: info.assistant.slug } : {}),
          locale: texts.locale,
          verdict: stats.verdict,
          title: texts.title,
          push: texts.push,
          emailSubject: texts.emailSubject,
          emailText: texts.emailText,
        },
        `ab_result:${exp.id}:${stats.verdict}`,
      );
      notifiedDirectly++;
    } catch (err) {
      console.warn(`[ab-evaluator] failed evaluating ${exp.id}`, err);
    }
  }

  return { evaluated, winners, inconclusive, harmStopped, notifiedDirectly };
}

async function defaultEvaluatorDeps(): Promise<EvaluatorDeps> {
  const [
    { db, schema },
    { assistantOfProject },
    { assistantsEnabled },
    { scheduleNotification },
    { computeExperimentMetrics, upsertExperimentDailySnapshot },
    { listRunningExperiments, updateExperiment },
    { autoStopExperimentForHarm },
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/assistants/store"),
    import("@/lib/assistants/enabled"),
    import("@/lib/notifications/dispatch"),
    import("./metrics"),
    import("./store"),
    import("./lifecycle"),
  ]);

  return {
    listRunning: listRunningExperiments,
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
              summaryLocale: schema.assistants.summaryLocale,
            })
            .from(schema.assistants)
            .where(eq(schema.assistants.id, a.id))
            .limit(1);
          if (row) assistant = row;
        }
      }
      return { ...proj, assistant };
    },
    computeMetrics: (exp, now) =>
      computeExperimentMetrics(
        {
          experimentId: exp.id,
          projectId: exp.projectId,
          primaryMetric: exp.primaryMetric,
          splitBps: exp.splitBps,
          startedAt: exp.startedAt!,
          endedAt: exp.endedAt,
        },
        now,
      ),
    saveSnapshot: async (expId, patch) => {
      await updateExperiment(expId, patch);
    },
    upsertDaily: async (expId, dayIso, snapshot) => {
      await Promise.all([
        upsertExperimentDailySnapshot(expId, dayIso, "a", snapshot.a),
        upsertExperimentDailySnapshot(expId, dayIso, "b", snapshot.b),
      ]);
    },
    autoStopForHarm: async (exp, ownerId, subdomain) => {
      await autoStopExperimentForHarm(exp, ownerId, subdomain);
    },
    notify: (event, key) => scheduleNotification(event, key),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com",
  };
}

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
