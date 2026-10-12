// Publicar desde la interfaz (el modal y la tarjeta de Len): un solo sitio que
// entiende las respuestas nuevas de los datos (spec local
// 2026-10-09-borrador-y-produccion-de-datos): 428 pide confirmar lo destructivo,
// 422 dice qué migración falló o que producción divergió. Y las Edge Functions
// (spec local 2026-10-11): 428 de secretos que faltan, 422 de funciones que no
// compilan, 502/503 si no se pudieron poner en marcha.

import type { DestructiveChange } from "@/lib/backend/data-changes-types";

export type PublishOutcome =
  | { readonly kind: "published"; readonly data: Record<string, unknown> }
  | { readonly kind: "needs_confirmation"; readonly destructive: DestructiveChange[]; readonly fingerprint: string }
  | { readonly kind: "migration_failed"; readonly migration: string; readonly message: string }
  | { readonly kind: "diverged"; readonly versions: string[] }
  | { readonly kind: "secrets_required"; readonly missing: string[] }
  | { readonly kind: "functions_do_not_compile"; readonly errors: string[] }
  | { readonly kind: "functions_failed" }
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
  if (res.status === 428 && data.error === "secrets_required") return { kind: "secrets_required", missing: (data.missing as string[]) ?? [] };
  if (data.error === "functions_do_not_compile") return { kind: "functions_do_not_compile", errors: (data.errors as string[]) ?? [] };
  if (data.error === "functions_deploy_failed" || data.error === "functions_bundler_unavailable") return { kind: "functions_failed" };
  if (data.error === "migration_failed") return { kind: "migration_failed", migration: String(data.migration ?? ""), message: String(data.message ?? "") };
  if (data.error === "migrations_diverged") return { kind: "diverged", versions: (data.versions as string[]) ?? [] };
  return { kind: "error", status: res.status, error: typeof data.error === "string" ? data.error : `HTTP ${res.status}` };
}
