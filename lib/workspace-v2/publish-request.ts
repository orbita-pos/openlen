// Publicar desde la interfaz (el modal y la tarjeta de Len): un solo sitio que
// entiende las respuestas nuevas de los datos (spec local
// 2026-10-09-borrador-y-produccion-de-datos): 428 pide confirmar lo destructivo,
// 422 dice qué migración falló o que producción divergió. Y las Edge Functions
// (spec local 2026-10-11): 428 de secretos que faltan, 422 de funciones que no
// compilan, 502/503 si no se pudieron poner en marcha.
// Y la revisión de seguridad (spec local 2026-10-15): 428 con lo grave, o pendiente mientras corre.

import type { DestructiveChange } from "@/lib/backend/data-changes-types";
import type { Finding, ReviewView } from "@/lib/security-review/types";

import { waitForSecurityReview } from "./security-review-request";

export type PublishOutcome =
  | { readonly kind: "published"; readonly data: Record<string, unknown> }
  | { readonly kind: "needs_confirmation"; readonly destructive: DestructiveChange[]; readonly fingerprint: string }
  | { readonly kind: "migration_failed"; readonly migration: string; readonly message: string }
  | { readonly kind: "diverged"; readonly versions: string[] }
  | { readonly kind: "secrets_required"; readonly missing: string[] }
  | { readonly kind: "functions_do_not_compile"; readonly errors: string[] }
  | { readonly kind: "functions_failed" }
  | { readonly kind: "security_findings"; readonly view: ReviewView }
  | { readonly kind: "security_review_pending"; readonly fingerprint: string }
  // Stripe (spec local 2026-10-21-stripe-integration): the two keys are of different accounts, or copying to live failed.
  | { readonly kind: "stripe_account_mismatch" }
  | { readonly kind: "stripe_sync_failed"; readonly message: string }
  | { readonly kind: "error"; readonly status: number; readonly error: string };

export async function postPublish(projectId: string, body: Record<string, unknown>): Promise<PublishOutcome> {
  const res = await fetch(`/api/projects/${projectId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { kind: "published", data };
  if (res.status === 428 && data.error === "confirmation_required") {
    return { kind: "needs_confirmation", destructive: (data.destructive as DestructiveChange[]) ?? [], fingerprint: String(data.fingerprint ?? "") };
  }
  if (res.status === 428 && data.error === "security_findings") {
    return {
      kind: "security_findings",
      view: {
        fingerprint: String(data.fingerprint ?? ""),
        status: (data.status as ReviewView["status"]) ?? "done",
        blocking: (data.blocking as Finding[]) ?? [],
        medium: (data.medium as Finding[]) ?? [],
        accepted: (data.accepted as Finding[]) ?? [],
      },
    };
  }
  if (res.status === 428 && data.error === "security_review_pending") return { kind: "security_review_pending", fingerprint: String(data.fingerprint ?? "") };
  if (res.status === 428 && data.error === "secrets_required") return { kind: "secrets_required", missing: (data.missing as string[]) ?? [] };
  if (data.error === "functions_do_not_compile") return { kind: "functions_do_not_compile", errors: (data.errors as string[]) ?? [] };
  if (data.error === "functions_deploy_failed" || data.error === "functions_bundler_unavailable") return { kind: "functions_failed" };
  if (data.error === "stripe_account_mismatch") return { kind: "stripe_account_mismatch" };
  if (data.error === "stripe_sync_failed") return { kind: "stripe_sync_failed", message: String(data.message ?? "") };
  if (data.error === "migration_failed") return { kind: "migration_failed", migration: String(data.migration ?? ""), message: String(data.message ?? "") };
  if (data.error === "migrations_diverged") return { kind: "diverged", versions: (data.versions as string[]) ?? [] };
  return { kind: "error", status: res.status, error: typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
}

/** Publicar con la revisión de seguridad corriendo: se espera (el botón sigue
 *  ocupado, nadie tiene que volver a pulsar) y se manda otra vez. Tres esperas
 *  como mucho: después, `security_review_pending` y el que llama lo dice. */
export async function postPublishAfterSecurity(
  projectId: string,
  body: Record<string, unknown>,
  onView: (v: ReviewView) => void,
  wait: (projectId: string, fingerprint: string) => Promise<ReviewView | null> = waitForSecurityReview,
): Promise<PublishOutcome> {
  let outcome = await postPublish(projectId, body);
  for (let k = 0; k < 3 && outcome.kind === "security_review_pending"; k++) {
    onView({ fingerprint: outcome.fingerprint, status: "running", blocking: [], medium: [], accepted: [] });
    const done = await wait(projectId, outcome.fingerprint);
    if (done) onView(done);
    outcome = await postPublish(projectId, body);
  }
  return outcome;
}
