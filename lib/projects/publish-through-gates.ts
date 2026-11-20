// THE PUBLISH GATES, in one place: the security review (spec local 2026-10-15), `publishProject`
// with its data, functions and Stripe gates, and the publish route's map of errors to HTTP codes.
// The publish route answers with it, and Len Watch publishes a fix with it — so a fix published at
// 3 a.m. stops at exactly the 428s a person would see (spec local 2026-10-30-len-watch, §5.7).
import { ProjectIsSpaceError } from "@/lib/space/errors";
import { ProjectIsToolError } from "@/lib/tools/errors";
import "server-only";

import { AbBringPendingError, AbExperimentRunningError } from "@/lib/ab/errors";
import { AppNoCompilaError, textoDeDiagnostico } from "@/lib/apps/compilador";
import { dataChangesErrorBody } from "@/lib/backend/data-changes";
import { functionsPublishErrorBody } from "@/lib/functions/publish-errors";
import { ProjectNotFoundError, publishProject, SubdomainInvalidError, SubdomainLimitError, SubdomainTakenError } from "@/lib/projects";
import { conAutor } from "@/lib/projects/autor-del-cambio";
import { securityReviewer } from "@/lib/security-review/real";
import { AGENT_WAIT_MS } from "@/lib/security-review/review";
import { stripePublishErrorBody } from "@/lib/stripe/publish-errors";

export interface GatedPublishInput {
  projectId: string;
  /** Who publishes: a person, or the owner on whose behalf Len Watch publishes. */
  actorId: string;
  ownerId: string;
  subdomain: string;
  languages?: string[];
  confirmFingerprint?: string;
  copyDraftData?: boolean;
  skipMissingSecrets?: boolean;
  acceptSecurityFingerprint?: string;
  locale?: string;
  source: "person" | "len_watch" | "ab_promote";
  /** Publishing a Len Watch branch (spec local 2026-10-30-len-watch, §5.5): its sources are this copy's, everything
   *  else the project's; no data changes; reviewed against the project's published base. */
  sourcesFrom?: string;
  /** «Publicar igual» over a Len Watch fix that isn't in the draft yet: that incident, not asked again. */
  acceptLenWatchFix?: string;
  /** The owner confirmed stopping a live A/B experiment to publish the draft («Stop and publish»). Only a person's. The
   *  experiment is closed AFTER the publish went through, never before (review item 14). */
  stopActiveAb?: boolean;
}

export interface GatedPublishResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * LA REVISIÓN DE SEGURIDAD (spec local 2026-10-15): lo grave frena hasta que quien publica lo acepta, y queda
 * apuntado quién. Si la revisión misma falla, no frena: se publica como antes (la fase 0 ya va dentro de la
 * puerta). Shared by publishing and by installing a tool (spec local 2026-11-04-herramientas-hechas-por-len, §4.2).
 * `stop` is the 428 to answer; otherwise `fingerprint` is the reviewed version to mark (null when there was none).
 */
export async function runSecurityGate(i: {
  readonly projectId: string;
  readonly actorId: string;
  readonly accept?: string;
  readonly locale: string;
  readonly sourcesFrom?: string;
  /** Nobody is in front of it (Len Watch's «Publicar solo» at 3 a.m.): it waits itself, as Len's own `publish`
   *  does (`forAgent`), and asks again. A person has the Publish modal, which waits. */
  readonly waitWhenPending?: boolean;
}): Promise<{ stop: GatedPublishResult } | { fingerprint: string | null }> {
  const gate = () =>
    securityReviewer()
      .gate({ projectId: i.projectId, accept: i.accept, actorId: i.actorId, locale: i.locale, ...(i.sourcesFrom ? { sourcesFrom: i.sourcesFrom } : {}) })
      .catch((err: unknown) => {
        console.warn("[publish] security review failed; publishing without it", err);
        return { kind: "open" as const, view: null };
      });
  let seguridad = await gate();
  if (seguridad.kind === "pending" && i.waitWhenPending) {
    await securityReviewer().wait(i.projectId, seguridad.view.fingerprint, AGENT_WAIT_MS).catch(() => null);
    seguridad = await gate();
  }
  if (seguridad.kind === "pending") return { stop: { status: 428, body: { error: "security_review_pending", fingerprint: seguridad.view.fingerprint } } };
  if (seguridad.kind === "blocked") return { stop: { status: 428, body: { error: "security_findings", ...seguridad.view } } };
  return { fingerprint: seguridad.view?.fingerprint ?? null };
}

export async function publishThroughGates(i: GatedPublishInput): Promise<GatedPublishResult> {
  // A LIVE A/B EXPERIMENT (review items 13, 14). The owner is asked first (428); the answer `stopActiveAb` publishes as the
  // end of the experiment, which is closed only once the publish succeeded. Every other source meets the door itself in
  // `publishProject`, which refuses (409 below); the experiment's own promote is the end of it.
  const { abTestingEnabled } = await import("@/lib/ab/enabled");
  let stopping: import("@/lib/ab/store").AbExperimentRow | null = null;
  if (i.source === "person" && abTestingEnabled()) {
    // The A/B tables are read for the owner's publish only. If they can't be (the database, a migration not run yet), the
    // answer is a clean 503 with its own code — never a raw 500 «publish_failed» from deep in a lookup — and nothing is
    // published: not knowing whether a test is running is not a reason to end it (G1+G3 review, item 22).
    const unavailable = (err: unknown): GatedPublishResult => {
      // eslint-disable-next-line no-console
      console.error("[publish] couldn't read the A/B experiments", err);
      return { status: 503, body: { error: "ab_unavailable" } };
    };
    const abStore = await import("@/lib/ab/store");
    let live: Awaited<ReturnType<typeof abStore.liveExperimentForProject>>;
    try {
      live = await abStore.liveExperimentForProject(i.projectId);
    } catch (err) {
      return unavailable(err);
    }
    if (live && !i.stopActiveAb) {
      return { status: 428, body: { error: "ab_experiment_running", experimentId: live.id, name: live.name, targetPath: live.targetPath } };
    }
    if (live) stopping = live;
    // A promoted Variant B that isn't in the draft yet (it clashed with their edits, or waits for Len): publishing the draft
    // now would send the page WITHOUT it and undo the promotion. It waits for them to bring it in or discard it (review item 26).
    let unbrought: Awaited<ReturnType<typeof abStore.pendingBringForProject>>;
    try {
      unbrought = await abStore.pendingBringForProject(i.projectId);
    } catch (err) {
      return unavailable(err);
    }
    if (unbrought) {
      return { status: 428, body: { error: "ab_bring_pending", experimentId: unbrought.id, name: unbrought.name, bringState: unbrought.bringState } };
    }
  }
  const abLive = stopping || i.source === "ab_promote" ? ({ abLive: "ending" } as const) : {};
  /** «Stop and publish» holds the experiment's decision lock for the whole publish (see below). */
  let held: import("@/lib/ab/decision-lock").HeldDecision | null = null;

  // LEN WATCH (spec local 2026-10-30-len-watch, §5.5 step 5): a person's publish while the fix Len published from its
  // branch isn't in the draft yet would bring the crash back. It waits for «Traer el arreglo» or «Publicar igual».
  if (i.source === "person") {
    const bring = await import("@/lib/len-watch/bring");
    const pending = await bring.pendingFix(i.projectId).catch((err: unknown) => {
      console.warn("[publish] couldn't tell whether a Len Watch fix is pending; publishing", err);
      return null;
    });
    if (pending && i.acceptLenWatchFix !== pending.incidentId) {
      return { status: 428, body: { error: "len_watch_fix_pending", incidentId: pending.incidentId, branch: pending.branch } };
    }
    if (pending) await bring.declineFix(pending.incidentId);
  }

  const seguridad = await runSecurityGate({
    projectId: i.projectId,
    actorId: i.actorId,
    ...(i.acceptSecurityFingerprint ? { accept: i.acceptSecurityFingerprint } : {}),
    locale: i.locale ?? "en",
    ...(i.sourcesFrom ? { sourcesFrom: i.sourcesFrom } : {}),
    waitWhenPending: i.source === "len_watch",
  });
  if ("stop" in seguridad) return seguridad.stop;

  // «STOP AND PUBLISH» TAKES THE DECISION FIRST (review: writers outside the claim). The owner's publish swaps the live release;
  // while the harm brake or another decision holds the lock, a swap in between would be rolled back over, or would undo theirs,
  // and the owner never told. So it claims the experiment like any decision does — and if it can't, it says so.
  if (stopping) {
    try {
      const claimed = await (await import("@/lib/ab/store")).claimExperimentDecision(stopping.id, i.projectId);
      if (!claimed) {
        return {
          status: 409,
          body: { error: "ab_decision_in_progress", experimentId: stopping.id, name: stopping.name },
        };
      }
      stopping = claimed;
      held = (await import("@/lib/ab/decision-lock")).holdDecision(claimed);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[publish] couldn't claim the A/B experiment to stop it", err);
      return { status: 503, body: { error: "ab_unavailable" } };
    }
  }

  try {
    // La versión «Publicado» lleva el nombre de quien publicó (lib/projects/autor-del-cambio.ts).
    const result = await conAutor(i.actorId, () =>
      publishProject({
        projectId: i.projectId,
        userId: i.ownerId,
        subdomain: i.subdomain,
        languages: i.languages,
        // A branch never carries data changes: the draft's migrations are the owner's, half done (§5.5).
        dataChanges: i.sourcesFrom ? { mode: "skip" } : { mode: "owner", confirmFingerprint: i.confirmFingerprint, copyDraftData: i.copyDraftData },
        functions: { skipMissingSecrets: i.skipMissingSecrets === true },
        ...(i.sourcesFrom ? { sourcesFrom: i.sourcesFrom } : {}),
        ...abLive,
      }),
    );
    // The owner stopped the test by publishing over it: it is over now that the publish went through — and not before,
    // so a publish that fails leaves the split live and untouched (review item 14).
    if (stopping) await (await import("@/lib/ab/publish-guard")).endExperimentAfterPublish(stopping, i.actorId);
    // Lo publicado es la base de la siguiente revisión (como la rama base de un PR):
    // ésa mira sólo el diff desde aquí. Si no se puede apuntar, la publicación vale igual.
    if (seguridad.fingerprint) {
      const reviewer = securityReviewer();
      await (i.sourcesFrom ? reviewer.markPublished(i.projectId, seguridad.fingerprint, i.sourcesFrom) : reviewer.markPublished(i.projectId, seguridad.fingerprint))
        .catch((err: unknown) => console.warn("[publish] could not keep the published version as the security review's base", err));
    }
    // A person published: if Len Watch had an incident open, it checks whether the site loads now.
    if (i.source === "person") {
      void import("@/lib/len-watch/orchestrate")
        .then((m) => m.afterOwnerPublish(i.projectId))
        .catch((err: unknown) => console.warn("[len-watch] after-publish check failed", err));
    }
    return { status: 200, body: result as unknown as Record<string, unknown> };
  } catch (err) {
    // The publish failed: the experiment is as it was, and the lock goes back as it was (fenced on its own token).
    await held?.release();
    const mapped = publishErrorResult(err);
    if (mapped) return mapped;
    // eslint-disable-next-line no-console
    console.error("[publish] unexpected error:", err);
    return { status: 500, body: { error: "publish_failed" } };
  } finally {
    held?.stop();
  }
}

/** The publish's own errors as the answer a route gives (status and body): the subdomain, the data, Stripe, the Edge Functions,
 *  an app that doesn't compile, a live experiment. `null` = not one of ours, the caller decides (a 500). The publish route and
 *  the A/B launch both answer through it, so a launch that stops at a missing secret says so instead of «launch_failed». */
export function publishErrorResult(err: unknown): GatedPublishResult | null {
  if (err instanceof SubdomainInvalidError) return { status: 400, body: { error: err.reason } };
  if (err instanceof SubdomainTakenError) return { status: 409, body: { error: "taken" } };
  if (err instanceof SubdomainLimitError) return { status: 402, body: { error: "limit_reached", limit: err.limit } };
  if (err instanceof ProjectNotFoundError) return { status: 404, body: { error: "not_found" } };
  if (err instanceof ProjectIsToolError) return { status: 409, body: { error: "tool_installs" } };
  if (err instanceof ProjectIsSpaceError) return { status: 409, body: { error: "space_never_publishes" } };
  // A live A/B experiment this publish would have ended (review item 13): Len Watch, MCP, or a person whose publish raced a launch.
  if (err instanceof AbExperimentRunningError) return { status: 409, body: err.body };
  // A promoted winner not in the draft yet (review): the door refuses a publish from the draft; the person resolves it.
  if (err instanceof AbBringPendingError) return { status: 428, body: err.body };
  // Una app web que no compila no se publica (spec local 2026-10-07-apps):
  // se dice qué fichero y qué línea, para el dueño y para Len.
  if (err instanceof AppNoCompilaError) return { status: 422, body: { error: "app_does_not_compile", errors: err.errores.map(textoDeDiagnostico) } };
  // Los datos (spec local 2026-10-09): una migración que falla en producción,
  // o lo destructivo sin confirmar.
  const dataError = dataChangesErrorBody(err);
  if (dataError) return dataError;
  // Stripe (spec local 2026-10-21-stripe-integration, §6.4): keys of two accounts, or the copy to live mode failed.
  const stripeError = stripePublishErrorBody(err);
  if (stripeError) return stripeError;
  // Las Edge Functions (spec local 2026-10-11): no compilan, faltan secretos,
  // o su despliegue falló (la página no cambió).
  const fnError = functionsPublishErrorBody(err);
  if (fnError) return fnError;
  return null;
}
