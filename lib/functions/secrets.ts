// lib/functions/secrets.ts — LAS REGLAS DE LOS VALORES (spec local 2026-10-11,
// Parte 4, y 2026-10-12, Parte 5): la huella que enseña `supabase secrets list`
// (sha256 en hex, como la de Supabase), los topes de Cloudflare (128 variables
// por script, 5 KB cada una) y los `Deno.env.get("…")` literales que publicar
// comprueba. Puro (node:crypto).

import { createHash } from "node:crypto";

import { FUNCTIONS_DIR } from "./project-files";

/** Lo que admite Cloudflare por variable de un script. */
export const MAX_SECRET_VALUE_BYTES = 5 * 1024;
/** Las variables de un script de Cloudflare, contando las SUPABASE_* del proyecto. */
export const ENV_VARS_MAX = 128;

export function secretDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type EnvFit =
  | { readonly ok: true; readonly used: number }
  | { readonly ok: false; readonly used: number; readonly base: number; readonly available: number };

/** ¿Caben `base` (las `SUPABASE_*` de ese entorno) y los secretos juntos? */
export function fitEnv(base: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): EnvFit {
  const used = Object.keys({ ...base, ...secrets }).length;
  if (used <= ENV_VARS_MAX) return { ok: true, used };
  const b = Object.keys(base).length;
  return { ok: false, used, base: b, available: Math.max(0, ENV_VARS_MAX - b) };
}

/** Lo que lee Len (la CLI) y la ruta cuando no caben. En inglés. */
export function envTooLargeMessage(f: Extract<EnvFit, { ok: false }>): string {
  return `Edge Function secrets don't fit: a function gets ${ENV_VARS_MAX} environment variables and these would be ${f.used} (the project's own SUPABASE_* variables are ${f.base}). ${f.available} are left for secrets: remove some.`;
}

const FUENTE = /\.(?:ts|tsx|js|jsx|mjs)$/;
const LITERAL = /Deno\.env\.get\(\s*(["'`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\)/g;

/** Los nombres que las funciones leen con `Deno.env.get("…")` LITERAL, sin las
 *  `SUPABASE_*` (las trae toda función). Un nombre calculado no se ve. */
export function literalEnvNames(files: Readonly<Record<string, string>>): string[] {
  const out = new Set<string>();
  for (const [ruta, texto] of Object.entries(files)) {
    if (!ruta.startsWith(FUNCTIONS_DIR) || !FUENTE.test(ruta)) continue;
    for (const m of texto.matchAll(LITERAL)) if (!m[2]!.startsWith("SUPABASE_")) out.add(m[2]!);
  }
  return [...out].sort();
}

export function missingSecrets(required: readonly string[], have: Iterable<string>): string[] {
  const hay = new Set(have);
  return required.filter((n) => !hay.has(n));
}
