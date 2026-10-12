// lib/functions/secret-names.ts — CÓMO SE PUEDE LLAMAR UN SECRETO de las Edge
// Functions (spec local 2026-10-11, Parte 4). Sin imports: lo usan la ruta, la
// CLI de la terminal, la herramienta de Len y la tarjeta del chat (cliente).
//
// Lo de Supabase (su API: hasta 256 caracteres y nunca `SUPABASE_`) más lo de
// AWS Lambda, que es donde acaban como variables de entorno (fase 3): la clave
// empieza por letra y sigue con letras, cifras y `_`, y las `AWS_*`/`LAMBDA_*`
// son del sistema (`Deno.env.toObject()` ya las esconde).

export const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]+$/;
export const SECRET_NAME_MAX = 256;
export const RESERVED_SECRET_PREFIXES = ["SUPABASE_", "AWS_", "LAMBDA_"] as const;

export type SecretNameProblem = { readonly kind: "reserved"; readonly prefix: string } | { readonly kind: "invalid" };

export function secretNameProblem(name: string): SecretNameProblem | null {
  const prefix = RESERVED_SECRET_PREFIXES.find((p) => name.startsWith(p));
  if (prefix) return { kind: "reserved", prefix };
  if (name.length > SECRET_NAME_MAX || !SECRET_NAME_RE.test(name)) return { kind: "invalid" };
  return null;
}

/** Lo que lee Len (la CLI, la herramienta) cuando un nombre no vale. En inglés,
 *  con las frases de la CLI de Supabase («Env name cannot start with …»,
 *  «Invalid Function name: … Must start with …»). */
export function secretNameMessage(name: string, p: SecretNameProblem): string {
  return p.kind === "reserved"
    ? `Env name cannot start with ${p.prefix}: ${name}`
    : `Invalid secret name: ${name}. Must start with a letter, and only include letters, digits and underscores. (^[A-Za-z][A-Za-z0-9_]+$)`;
}
