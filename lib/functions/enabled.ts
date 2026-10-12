// lib/functions/enabled.ts — ¿HAY EDGE FUNCTIONS EN ESTE SERVIDOR? (spec local
// 2026-10-11, Parte 2: «sin motor configurado … el manual de Len no las
// ofrece»). Puro y sin imports pesados (ni el motor ni `pg`): lo leen la puerta,
// la ruta de Len y el manual de Len, que se arma con el `env` que le pasen.

let avisado = false;

export function configuredEngineName(env: Readonly<Record<string, string | undefined>> = process.env): "local" | null {
  if (env.OPENLEN_FUNCTIONS === "0") return null;
  const v = (env.OPENLEN_FUNCTIONS_ENGINE ?? "").trim();
  if (v === "local") {
    // El motor local corre código ajeno EN el proceso de la app.
    if (env.NODE_ENV === "production" && env.OPENLEN_FUNCTIONS_ALLOW_LOCAL_IN_PRODUCTION !== "1") return null;
    return "local";
  }
  if (v !== "" && !avisado) {
    avisado = true;
    console.warn(`[functions] OPENLEN_FUNCTIONS_ENGINE="${v}" no es un motor de este servidor: las Edge Functions quedan apagadas.`);
  }
  return null;
}

/** Hay motor Y backend de las páginas. La regla del backend es la de
 *  `backendConfigured()` (lib/backend/pg.ts), dicha sobre `env`. */
export function functionsEnabledIn(env: Readonly<Record<string, string | undefined>>): boolean {
  return configuredEngineName(env) !== null && Boolean(env.PAGES_DATABASE_URL && env.PAGES_AUTHENTICATOR_PASSWORD);
}
