// lib/workspace-v2/function-secrets-request.ts — GUARDAR SECRETOS DESDE LA
// INTERFAZ (spec local 2026-10-11, Parte 4): la tarjeta de Len, «Guardar como
// secreto» del compositor y los que faltan al publicar hablan con
// `/api/projects/[id]/function-secrets` por aquí. Los valores van; no vuelven.

export type SecretEnvironment = "draft" | "live";

export interface SecretInput {
  readonly environment: SecretEnvironment;
  readonly name: string;
  readonly value: string;
}

export type SaveSecretsOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "too_large"; readonly environment: SecretEnvironment; readonly availableVars: number }
  | { readonly kind: "invalid_name"; readonly name: string }
  | { readonly kind: "error" };

const rutaDe = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/function-secrets`;

export async function postFunctionSecrets(projectId: string, secrets: readonly SecretInput[], f: typeof fetch = fetch): Promise<SaveSecretsOutcome> {
  try {
    const res = await f(rutaDe(projectId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secrets }) });
    if (res.ok) return { kind: "saved" };
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 422 && data.error === "env_too_large") {
      return { kind: "too_large", environment: data.environment === "live" ? "live" : "draft", availableVars: Number(data.availableVars ?? 0) };
    }
    if (data.error === "invalid_name") return { kind: "invalid_name", name: String(data.name ?? "") };
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/** ¿Guarda secretos este servidor? (sin motor de funciones, no). */
export async function functionSecretsAvailable(projectId: string, f: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await f(rutaDe(projectId), { cache: "no-store" });
    if (!res.ok) return false;
    return ((await res.json()) as { available?: unknown }).available === true;
  } catch {
    return false;
  }
}
