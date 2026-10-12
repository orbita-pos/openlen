// lib/functions/default-env.ts — LAS VARIABLES QUE TRAE TODA FUNCIÓN, con los
// nombres de Supabase (spec local 2026-10-11, Parte 1) y el valor de SU
// entorno: en el borrador, `SUPABASE_URL` es la URL propia del borrador (las
// funciones llaman sin Origin). Las antiguas (`SUPABASE_ANON_KEY`,
// `SUPABASE_SERVICE_ROLE_KEY`) llevan las claves nuevas: nuestro backend las
// acepta como `apikey`. Sin `SUPABASE_DB_URL` (Postgres no sale a internet) ni
// `SUPABASE_JWKS` (firmamos con HS256). Puro.

export function defaultFunctionEnv(o: { readonly url: string; readonly publishableKey: string; readonly secretKey: string }): Record<string, string> {
  return {
    SUPABASE_URL: o.url,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: o.publishableKey }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: o.secretKey }),
    SUPABASE_ANON_KEY: o.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: o.secretKey,
  };
}
