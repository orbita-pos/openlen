// lib/functions/secrets.ts — LAS REGLAS DE LOS VALORES (spec local 2026-10-11,
// Parte 4): la huella que enseña `supabase secrets list` (sha256 en hex, como
// la de Supabase), el tope de 4 KB de variables de Lambda y los
// `Deno.env.get("…")` literales que publicar comprueba. Puro (node:crypto).

import { createHash } from "node:crypto";

import { FUNCTIONS_DIR } from "./project-files";

/** El `maxLength` del valor en la API de Supabase (`CreateSecretBody`). */
export const MAX_SECRET_VALUE_BYTES = 24_576;
/** Las variables de una Lambda, todas juntas. */
export const ENV_LIMIT_BYTES = 4096;

export function secretDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Lo que mide AWS: el JSON de las variables (su error cita «String measured:
 *  {…}»). Contarlo así es lo más estricto: lo que cabe aquí, cabe allí. */
export function envSizeBytes(env: Readonly<Record<string, string>>): number {
  return Buffer.byteLength(JSON.stringify(env), "utf8");
}

export type EnvFit =
  | { readonly ok: true; readonly usedBytes: number }
  | { readonly ok: false; readonly usedBytes: number; readonly baseBytes: number; readonly availableBytes: number };

/** ¿Caben `base` (las `SUPABASE_*` de ese entorno) y los secretos juntos? */
export function fitEnv(base: Readonly<Record<string, string>>, secrets: Readonly<Record<string, string>>): EnvFit {
  const usedBytes = envSizeBytes({ ...base, ...secrets });
  if (usedBytes <= ENV_LIMIT_BYTES) return { ok: true, usedBytes };
  const baseBytes = envSizeBytes(base);
  return { ok: false, usedBytes, baseBytes, availableBytes: Math.max(0, ENV_LIMIT_BYTES - baseBytes) };
}

/** Lo que lee Len (la CLI) y la ruta cuando no caben. En inglés. */
export function envTooLargeMessage(f: Extract<EnvFit, { ok: false }>): string {
  return `Edge Function secrets don't fit: a function gets ${ENV_LIMIT_BYTES} bytes of environment variables and these would take ${f.usedBytes} (the project's own SUPABASE_* variables take ${f.baseBytes}). ${f.availableBytes} bytes are left for secrets: remove or shorten some.`;
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
