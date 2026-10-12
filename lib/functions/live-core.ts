// lib/functions/live-core.ts — LAS FUNCIONES DE PRODUCCIÓN, AL PUBLICAR (spec
// local 2026-10-11, Parte 2). Antes de reclamar nada, se compilan para
// producción (minificadas) y se comprueban sus secretos (los
// `Deno.env.get("…")` literales); dentro del `beforeSwap` de la publicación
// —tras las migraciones— se despliegan; y si el motor las pierde, la puerta las
// repone con el paquete GUARDADO, nunca con los ficheros de ahora (que son el
// borrador). Sin base ni motor de verdad: todo entra por `DeployDeps`.

import type { FunctionsBundle } from "./bundler/bundle-functions";
import { FUNCTIONS_CATALOG_CURRENT } from "./catalog";
import { engineLimits, functionEnv, pendingFor, serialized, type DeployDeps } from "./deploy-core";
import type { Destination } from "./engines/types";
import { FunctionSecretsMissingError, FunctionsBundlerUnavailableError, FunctionsDoNotCompileError, FunctionsNeedOwnerError } from "./publish-errors";
import { literalEnvNames, missingSecrets } from "./secrets";

type OkBundle = Extract<FunctionsBundle, { ok: true }>;

export type LiveRelease =
  | { readonly kind: "none" }
  | { readonly kind: "remove" }
  | { readonly kind: "deploy"; readonly bundle: OkBundle; readonly missingSecrets: readonly string[] };

export async function prepareLiveRelease(
  projectId: string,
  deps: DeployDeps,
  o: { readonly mode: "owner" | "system"; readonly skipMissingSecrets: boolean },
): Promise<LiveRelease> {
  const files = await deps.loadFiles(projectId);
  const b = await deps.bundle(files, FUNCTIONS_CATALOG_CURRENT, "production");
  if (!b) throw new FunctionsBundlerUnavailableError();
  if (!b.ok) throw new FunctionsDoNotCompileError(b.errors);
  const live = await deps.store.get(projectId, "live");
  if (b.functions.length === 0) {
    if (!live) return { kind: "none" };
    if (o.mode === "system") throw new FunctionsNeedOwnerError();
    return { kind: "remove" };
  }
  if (o.mode === "system") {
    // Sin el dueño no cambia nada de producción: como mucho se repone lo mismo.
    if (live?.hash !== b.hash) throw new FunctionsNeedOwnerError();
    return { kind: "deploy", bundle: b, missingSecrets: [] };
  }
  const t = await deps.target(projectId, "live");
  const missing = missingSecrets(literalEnvNames(files), Object.keys(t.secrets));
  if (missing.length > 0 && !o.skipMissingSecrets) throw new FunctionSecretsMissingError(missing);
  return { kind: "deploy", bundle: b, missingSecrets: missing };
}

/** Dentro del `beforeSwap`: si lanza, la release no se activa. */
export function deployLiveRelease(projectId: string, release: LiveRelease, deps: DeployDeps): Promise<void> {
  return serialized(projectId, "live", async () => {
    if (release.kind === "none") return;
    const t = await deps.target(projectId, "live");
    const dest: Destination = { ref: t.ref, environment: "live" };
    if (release.kind === "remove") {
      await deps.engine.remove(dest);
      await deps.store.delete(projectId, "live");
      return;
    }
    const b = release.bundle;
    const anotado = await deps.store.get(projectId, "live");
    if (anotado?.hash === b.hash && (await deps.engine.deployedHash(dest)) === b.hash) return;
    await deps.engine.deploy(dest, { hash: b.hash, files: b.files }, functionEnv(t), engineLimits(t.plan));
    await deps.store.put(
      {
        projectId,
        environment: "live",
        catalog: FUNCTIONS_CATALOG_CURRENT,
        hash: b.hash,
        functions: b.functions.map((f) => ({ name: f.name, verifyJwt: f.verifyJwt })),
        deployedAt: new Date(),
      },
      b.maps,
      b.files,
    );
  });
}

/** Antes de llamar a producción: lo que esté desplegándose, y si el motor no
 *  tiene lo anotado (un reinicio, otra copia del módulo), el paquete GUARDADO
 *  con los secretos de producción de ahora. Lo normal —el motor lo tiene— no
 *  entra en la serie: cada llamada no espera a las demás. */
export async function ensureLiveDeployed(projectId: string, ref: string, deps: DeployDeps): Promise<void> {
  await pendingFor(projectId, "live");
  const anotado = await deps.store.get(projectId, "live");
  if (!anotado) return;
  const dest: Destination = { ref, environment: "live" };
  if ((await deps.engine.deployedHash(dest)) === anotado.hash) return;
  await serialized(projectId, "live", async () => {
    const otraVez = await deps.store.get(projectId, "live");
    if (!otraVez || (await deps.engine.deployedHash(dest)) === otraVez.hash) return;
    const files = await deps.store.bundle(projectId, "live");
    if (!files) return; // sin paquete guardado: la puerta dará NOT_FOUND
    const t = await deps.target(projectId, "live");
    await deps.engine.deploy(dest, { hash: otraVez.hash, files }, functionEnv(t), engineLimits(t.plan));
  });
}
