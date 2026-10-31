// THE PUBLISH GATES, in one place: the security review (spec local 2026-10-15), `publishProject`
// with its data, functions and Stripe gates, and the publish route's map of errors to HTTP codes.
// The publish route answers with it, and Len Watch publishes a fix with it — so a fix published at
// 3 a.m. stops at exactly the 428s a person would see (spec local 2026-10-30-len-watch, §5.7).
import "server-only";

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
  source: "person" | "len_watch";
  /** Publishing a Len Watch branch (spec local 2026-10-30-len-watch, §5.5): its sources are this copy's, everything
   *  else the project's; no data changes; reviewed against the project's published base. */
  sourcesFrom?: string;
  /** «Publicar igual» over a Len Watch fix that isn't in the draft yet: that incident, not asked again. */
  acceptLenWatchFix?: string;
}

export interface GatedPublishResult {
  status: number;
  body: Record<string, unknown>;
}

export async function publishThroughGates(i: GatedPublishInput): Promise<GatedPublishResult> {
  // LEN WATCH (spec local 2026-10-30-len-watch, §5.5 step 5): a person's publish while the fix Len published from its
  // branch isn't in the draft would bring the crash back. It waits for «Traer el arreglo» or «Publicar igual».
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

  // LA REVISIÓN DE SEGURIDAD (spec local 2026-10-15): lo grave frena hasta que
  // quien publica lo acepta, y queda apuntado quién. Si la revisión misma falla,
  // no frena: se publica como antes (la fase 0 ya va dentro de la puerta).
  const gate = () =>
    securityReviewer()
      .gate({ projectId: i.projectId, accept: i.acceptSecurityFingerprint, actorId: i.actorId, locale: i.locale ?? "en", ...(i.sourcesFrom ? { sourcesFrom: i.sourcesFrom } : {}) })
      .catch((err: unknown) => {
        console.warn("[publish] security review failed; publishing without it", err);
        return { kind: "open" as const, view: null };
      });
  let seguridad = await gate();
  // Still running: a person has the Publish modal, which waits; Len Watch has nobody in front of it («Publicar solo»
  // at 3 a.m.), so it waits itself, as Len's own `publish` does (`forAgent`), and asks again.
  if (seguridad.kind === "pending" && i.source === "len_watch") {
    await securityReviewer().wait(i.projectId, seguridad.view.fingerprint, AGENT_WAIT_MS).catch(() => null);
    seguridad = await gate();
  }
  if (seguridad.kind === "pending") return { status: 428, body: { error: "security_review_pending", fingerprint: seguridad.view.fingerprint } };
  if (seguridad.kind === "blocked") return { status: 428, body: { error: "security_findings", ...seguridad.view } };

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
      }),
    );
    // Lo publicado es la base de la siguiente revisión (como la rama base de un PR):
    // ésa mira sólo el diff desde aquí. Si no se puede apuntar, la publicación vale igual.
    if (seguridad.view) {
      const reviewer = securityReviewer();
      await (i.sourcesFrom ? reviewer.markPublished(i.projectId, seguridad.view.fingerprint, i.sourcesFrom) : reviewer.markPublished(i.projectId, seguridad.view.fingerprint))
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
    if (err instanceof SubdomainInvalidError) return { status: 400, body: { error: err.reason } };
    if (err instanceof SubdomainTakenError) return { status: 409, body: { error: "taken" } };
    if (err instanceof SubdomainLimitError) return { status: 402, body: { error: "limit_reached", limit: err.limit } };
    if (err instanceof ProjectNotFoundError) return { status: 404, body: { error: "not_found" } };
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
    // eslint-disable-next-line no-console
    console.error("[publish] unexpected error:", err);
    return { status: 500, body: { error: "publish_failed" } };
  }
}
