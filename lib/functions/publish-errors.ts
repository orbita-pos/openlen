// lib/functions/publish-errors.ts — POR QUÉ NO SE PUBLICAN LAS FUNCIONES (spec
// local 2026-10-11, Parte 2) y cómo lo contesta la ruta de publicar. Puro: lo
// importan el núcleo, la ruta, las republicaciones y la herramienta de Len.

import type { Diagnostico } from "@/lib/agent/diagnosticos";

export class FunctionsDoNotCompileError extends Error {
  constructor(readonly errors: readonly Diagnostico[]) {
    super("las funciones no compilan para producción");
  }
}

export class FunctionsBundlerUnavailableError extends Error {
  constructor() {
    super("el empaquetador de las funciones no contestó");
  }
}

/** Un `Deno.env.get("…")` literal sin valor en producción: 428 con la tarjeta. */
export class FunctionSecretsMissingError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`faltan secretos en producción: ${missing.join(", ")}`);
  }
}

/** El despliegue a producción falló dentro de `beforeSwap`: la release no se activa. */
export class FunctionsDeployFailedError extends Error {
  constructor(readonly reason: unknown) {
    super(`el despliegue de producción falló: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
}

/** Una republicación del sistema que cambiaría las funciones de producción:
 *  las publica el dueño (quien llama salta el proyecto, como con los datos). */
export class FunctionsNeedOwnerError extends Error {
  constructor() {
    super("las funciones de producción cambiarían: las publica el dueño");
  }
}

/** `ruta:línea:columna — mensaje`, el formato de las apps (`textoDeDiagnostico`). */
export function diagnosticLine(d: Diagnostico): string {
  return `${d.ruta}:${d.linea}:${d.columna} — ${d.mensaje}`;
}

/** Lo que `publish` le cuenta a Len ANTES de la tarjeta. */
export type FunctionsReleasePreview =
  | { readonly kind: "ok"; readonly functions: readonly string[]; readonly missingSecrets: readonly string[] }
  | { readonly kind: "errors"; readonly errors: readonly string[] }
  | { readonly kind: "unavailable" };

export function functionsPublishErrorBody(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof FunctionsDoNotCompileError) return { status: 422, body: { error: "functions_do_not_compile", errors: err.errors.map(diagnosticLine) } };
  if (err instanceof FunctionSecretsMissingError) return { status: 428, body: { error: "secrets_required", missing: [...err.missing] } };
  if (err instanceof FunctionsBundlerUnavailableError) return { status: 503, body: { error: "functions_bundler_unavailable" } };
  if (err instanceof FunctionsDeployFailedError) return { status: 502, body: { error: "functions_deploy_failed" } };
  return null;
}
