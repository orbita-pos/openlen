// lib/functions/publish.ts — LAS FUNCIONES AL PUBLICAR, CON LO DE VERDAD (spec
// local 2026-10-11, Parte 2). `publishProject` llama a `prepare…` ANTES de
// reclamar la dirección (no compilan → 422; faltan secretos → 428: no ha
// cambiado nada) y a su `deploy()` dentro del `beforeSwap`, tras las
// migraciones (si falla, la release no se activa). `publish` de Len ve lo
// mismo antes de enseñar la tarjeta. Sin motor (oscuro), null: publicar
// ignora las funciones.

import "server-only";

import { realDeployDeps } from "./deploy";
import { deployLiveRelease, prepareLiveRelease } from "./live-core";
import {
  diagnosticLine,
  FunctionsBundlerUnavailableError,
  FunctionsDeployFailedError,
  FunctionsDoNotCompileError,
  type FunctionsReleasePreview,
} from "./publish-errors";

export async function prepareFunctionsForPublish(
  projectId: string,
  o: { readonly mode: "owner" | "system"; readonly skipMissingSecrets: boolean; readonly swap?: (text: string) => string; readonly sourcesFrom?: string },
): Promise<{ deploy(swap?: (text: string) => string): Promise<void>; readonly functions: readonly string[] } | null> {
  const deps = realDeployDeps();
  if (!deps) return null;
  const release = await prepareLiveRelease(projectId, deps, o);
  if (release.kind === "none") return null;
  return {
    // Stripe (spec local 2026-10-21-stripe-integration, §6.4): the live ids, once copied, go into the bundle.
    deploy: (swap) =>
      deployLiveRelease(projectId, release, deps, swap).catch((e: unknown) => {
        throw new FunctionsDeployFailedError(e);
      }),
    functions: release.kind === "deploy" ? release.bundle.functions.map((f) => f.name) : [],
  };
}

/** Lo que `publish` le cuenta a Len antes de la tarjeta. null = nada que decir. */
export async function previewFunctionsForPublish(projectId: string): Promise<FunctionsReleasePreview | null> {
  const deps = realDeployDeps();
  if (!deps) return null;
  try {
    const r = await prepareLiveRelease(projectId, deps, { mode: "owner", skipMissingSecrets: true });
    if (r.kind !== "deploy") return null;
    return { kind: "ok", functions: r.bundle.functions.map((f) => f.name), missingSecrets: r.missingSecrets };
  } catch (e) {
    if (e instanceof FunctionsDoNotCompileError) return { kind: "errors", errors: e.errors.map(diagnosticLine) };
    if (e instanceof FunctionsBundlerUnavailableError) return { kind: "unavailable" };
    throw e;
  }
}
