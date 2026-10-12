// lib/functions/deploy-core.ts — DESPLEGAR LAS FUNCIONES DEL BORRADOR (spec local
// 2026-10-11, Parte 2). Como `supabase functions serve`, que recarga al cambiar
// un fichero: cada cambio en /supabase/functions/** o config.toml programa un
// despliegue (2 s después del último), y `supabase functions deploy` lo fuerza.
// Los de un proyecto van EN SERIE y cada uno lee los ficheros de ese momento:
// el último despliega lo último. La puerta, antes de llamar al borrador, espera
// el que esté en curso y, si el motor no tiene lo anotado (un reinicio vació el
// motor local), vuelve a desplegar. Sin base ni motor de verdad: todo entra
// por `DeployDeps` (las pruebas pasan dobles; deploy.ts, lo real).

import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { Plan } from "@/lib/plan";

import type { FunctionsBundle } from "./bundler/bundle-functions";
import { FUNCTIONS_CATALOG_CURRENT } from "./catalog";
import { defaultFunctionEnv } from "./default-env";
import type { DeploymentStore } from "./deployments";
import type { Destination, FunctionsEngine } from "./engines/types";
import { FUNCTION_LIMITS, FUNCTION_MEMORY_MB } from "./limits";

export interface DeployTarget {
  readonly ref: string;
  /** La URL propia del borrador. */
  readonly url: string;
  readonly publishableKey: string;
  readonly secretKey: string;
  readonly plan: Plan;
}

export interface DeployDeps {
  readonly engine: FunctionsEngine;
  readonly store: DeploymentStore;
  loadFiles(projectId: string): Promise<Record<string, string>>;
  target(projectId: string): Promise<DeployTarget>;
  bundle(files: Readonly<Record<string, string>>, catalog: string): Promise<FunctionsBundle | null>;
}

export type DeployOutcome =
  | { readonly kind: "deployed" | "unchanged"; readonly functions: readonly string[]; readonly warnings: readonly Diagnostico[] }
  | { readonly kind: "removed" }
  | { readonly kind: "failed"; readonly errors: readonly Diagnostico[]; readonly warnings: readonly Diagnostico[] }
  | { readonly kind: "unavailable" };

export async function deployDraft(projectId: string, deps: DeployDeps, o: { readonly files?: Readonly<Record<string, string>> } = {}): Promise<DeployOutcome> {
  const files = o.files ?? (await deps.loadFiles(projectId));
  const b = await deps.bundle(files, FUNCTIONS_CATALOG_CURRENT);
  if (!b) return { kind: "unavailable" };
  if (!b.ok) return { kind: "failed", errors: b.errors, warnings: b.warnings };
  const t = await deps.target(projectId);
  const dest: Destination = { ref: t.ref, environment: "draft" };
  if (b.functions.length === 0) {
    await deps.engine.remove(dest);
    await deps.store.delete(projectId, "draft");
    return { kind: "removed" };
  }
  const nombres = b.functions.map((f) => f.name);
  const anotado = await deps.store.get(projectId, "draft");
  if (anotado?.hash === b.hash && (await deps.engine.deployedHash(dest)) === b.hash) {
    return { kind: "unchanged", functions: nombres, warnings: b.warnings };
  }
  await deps.engine.deploy(dest, { hash: b.hash, files: b.files }, defaultFunctionEnv(t), {
    timeoutSec: FUNCTION_LIMITS[t.plan].timeoutSec,
    memoryMb: FUNCTION_MEMORY_MB,
  });
  await deps.store.put(
    {
      projectId,
      environment: "draft",
      catalog: FUNCTIONS_CATALOG_CURRENT,
      hash: b.hash,
      functions: b.functions.map((f) => ({ name: f.name, verifyJwt: f.verifyJwt })),
      deployedAt: new Date(),
    },
    b.maps,
  );
  return { kind: "deployed", functions: nombres, warnings: b.warnings };
}

const cadenas = new Map<string, Promise<DeployOutcome>>();
const temporizadores = new Map<string, ReturnType<typeof setTimeout>>();

export function deployDraftSerialized(projectId: string, deps: DeployDeps, o: { readonly files?: Readonly<Record<string, string>> } = {}): Promise<DeployOutcome> {
  const antes = cadenas.get(projectId) ?? Promise.resolve<DeployOutcome>({ kind: "unavailable" });
  const ahora = antes.catch(() => undefined).then(() => deployDraft(projectId, deps, o));
  cadenas.set(projectId, ahora);
  void ahora
    .catch(() => undefined)
    .finally(() => {
      if (cadenas.get(projectId) === ahora) cadenas.delete(projectId);
    });
  return ahora;
}

export async function pendingDraftDeploy(projectId: string): Promise<void> {
  await cadenas.get(projectId)?.catch(() => undefined);
}

export function scheduleDraftDeploy(projectId: string, deps: DeployDeps, delayMs = 2_000): void {
  clearTimeout(temporizadores.get(projectId));
  temporizadores.set(
    projectId,
    setTimeout(() => {
      temporizadores.delete(projectId);
      void deployDraftSerialized(projectId, deps).catch((e: unknown) => console.error("[functions] el despliegue del borrador falló", projectId, e));
    }, delayMs),
  );
}

/** Antes de llamar al borrador: lo que esté en curso, y lo anotado en el motor. */
export async function ensureDraftDeployed(projectId: string, ref: string, deps: DeployDeps): Promise<void> {
  await pendingDraftDeploy(projectId);
  const anotado = await deps.store.get(projectId, "draft");
  if (!anotado) return;
  if ((await deps.engine.deployedHash({ ref, environment: "draft" })) === anotado.hash) return;
  await deployDraftSerialized(projectId, deps);
}
