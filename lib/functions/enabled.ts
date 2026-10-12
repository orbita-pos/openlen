// lib/functions/enabled.ts — ¿HAY EDGE FUNCTIONS EN ESTE SERVIDOR? (spec local
// 2026-10-11, Parte 2: «sin motor configurado … el manual de Len no las
// ofrece»). Puro y sin imports pesados (ni el motor ni `pg`): lo leen la puerta,
// la ruta de Len y el manual de Len, que se arma con el `env` que le pasen.

import type { CloudflareConfig } from "./engines/cloudflare-api";

let avisado = false;

function avisar(mensaje: string): void {
  if (avisado) return;
  avisado = true;
  console.warn(mensaje);
}

/** Lo que necesita el motor `cloudflare` (spec local 2026-10-12, Parte 4). */
export const CLOUDFLARE_ENV_VARS = ["OPENLEN_CF_ACCOUNT_ID", "OPENLEN_CF_API_TOKEN", "OPENLEN_CF_NAMESPACE", "OPENLEN_CF_DISPATCH_URL", "OPENLEN_CF_DISPATCH_KEY"] as const;

/** La configuración de Cloudflare, o null si falta alguna. */
export function cloudflareConfigFrom(env: Readonly<Record<string, string | undefined>>): CloudflareConfig | null {
  const v = (k: (typeof CLOUDFLARE_ENV_VARS)[number]) => (env[k] ?? "").trim();
  if (CLOUDFLARE_ENV_VARS.some((k) => !v(k))) return null;
  return {
    accountId: v("OPENLEN_CF_ACCOUNT_ID"),
    apiToken: v("OPENLEN_CF_API_TOKEN"),
    namespace: v("OPENLEN_CF_NAMESPACE"),
    dispatchUrl: v("OPENLEN_CF_DISPATCH_URL"),
    dispatchKey: v("OPENLEN_CF_DISPATCH_KEY"),
  };
}

export function configuredEngineName(env: Readonly<Record<string, string | undefined>> = process.env): "local" | "cloudflare" | null {
  if (env.OPENLEN_FUNCTIONS === "0") return null;
  const v = (env.OPENLEN_FUNCTIONS_ENGINE ?? "").trim();
  if (v === "local") {
    // El motor local corre código ajeno EN el proceso de la app.
    if (env.NODE_ENV === "production" && env.OPENLEN_FUNCTIONS_ALLOW_LOCAL_IN_PRODUCTION !== "1") return null;
    return "local";
  }
  if (v === "cloudflare") {
    if (cloudflareConfigFrom(env)) return "cloudflare";
    const faltan = CLOUDFLARE_ENV_VARS.filter((k) => !(env[k] ?? "").trim());
    avisar(`[functions] OPENLEN_FUNCTIONS_ENGINE="cloudflare" sin ${faltan.join(", ")}: las Edge Functions quedan apagadas.`);
    return null;
  }
  if (v !== "") avisar(`[functions] OPENLEN_FUNCTIONS_ENGINE="${v}" no es un motor de este servidor: las Edge Functions quedan apagadas.`);
  return null;
}

/** Hay motor Y backend de las páginas. La regla del backend es la de
 *  `backendConfigured()` (lib/backend/pg.ts), dicha sobre `env`. */
export function functionsEnabledIn(env: Readonly<Record<string, string | undefined>>): boolean {
  return configuredEngineName(env) !== null && Boolean(env.PAGES_DATABASE_URL && env.PAGES_AUTHENTICATOR_PASSWORD);
}
