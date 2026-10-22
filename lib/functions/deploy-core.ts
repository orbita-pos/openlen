// lib/functions/deploy-core.ts — DESPLEGAR LAS FUNCIONES DEL BORRADOR (spec local
// 2026-10-11, Parte 2). Como `supabase functions serve`, que recarga al cambiar
// un fichero: cada cambio en /supabase/functions/** o config.toml programa un
// despliegue (2 s después del último), y `supabase functions deploy` lo fuerza.
// Los de un proyecto van EN SERIE y cada uno lee los ficheros de ese momento:
// el último despliega lo último. La puerta, antes de llamar al borrador, espera
// el que esté en curso y, si el motor no tiene lo anotado (un reinicio vació el
// motor local), vuelve a desplegar. Sin base ni motor de verdad: todo entra
// por `DeployDeps` (las pruebas pasan dobles; deploy.ts, lo real).
//
// FASE 2: los secretos de cada entorno van como variables (`functionEnv`), y
// cambiarlos los lleva al motor al momento (`applyFunctionEnv`, con `setEnv`),
// EN SERIE con los despliegues de ese entorno: uno en curso no los pisa.

import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { Plan } from "@/lib/plan";

import type { FunctionsBundle, FunctionsBundleMode } from "./bundler/bundle-functions";
import { FUNCTIONS_CATALOG_CURRENT } from "./catalog";
import { defaultFunctionEnv } from "./default-env";
import type { DeploymentStore } from "./deployments";
import type { Destination, EngineLimits, FunctionsEngine, FunctionsEnvironment } from "./engines/types";
import { FUNCTION_LIMITS, FUNCTION_MEMORY_MB } from "./limits";

export interface DeployTarget {
  readonly ref: string;
  /** La URL de ESE entorno: la propia del borrador, o la principal en producción. */
  readonly url: string;
  readonly publishableKey: string;
  readonly secretKey: string;
  readonly plan: Plan;
  /** Los secretos de ESE entorno, en claro: van como variables de la función. */
  readonly secrets: Readonly<Record<string, string>>;
  /** Project email's variables (lib/project-email/function-env.ts): under the user's secrets. */
  readonly email?: Readonly<Record<string, string>>;
}

export interface DeployDeps {
  readonly engine: FunctionsEngine;
  readonly store: DeploymentStore;
  loadFiles(projectId: string): Promise<Record<string, string>>;
  target(projectId: string, environment: FunctionsEnvironment): Promise<DeployTarget>;
  bundle(files: Readonly<Record<string, string>>, catalog: string, mode: FunctionsBundleMode): Promise<FunctionsBundle | null>;
}

/** Lo que ve la función en `Deno.env`: las `SUPABASE_*` de su entorno, las del correo y sus secretos (que ganan). */
export function functionEnv(t: DeployTarget): Record<string, string> {
  return { ...defaultFunctionEnv(t), ...(t.email ?? {}), ...t.secrets };
}

export function engineLimits(plan: Plan): EngineLimits {
  return { timeoutSec: FUNCTION_LIMITS[plan].timeoutSec, memoryMb: FUNCTION_MEMORY_MB };
}

export type DeployOutcome =
  | { readonly kind: "deployed" | "unchanged"; readonly functions: readonly string[]; readonly warnings: readonly Diagnostico[] }
  | { readonly kind: "removed" }
  | { readonly kind: "failed"; readonly errors: readonly Diagnostico[]; readonly warnings: readonly Diagnostico[] }
  | { readonly kind: "unavailable" }
  | { readonly kind: "engine_error"; readonly message: string };

export async function deployDraft(projectId: string, deps: DeployDeps, o: { readonly files?: Readonly<Record<string, string>> } = {}): Promise<DeployOutcome> {
  const files = o.files ?? (await deps.loadFiles(projectId));
  const b = await deps.bundle(files, FUNCTIONS_CATALOG_CURRENT, "development");
  if (!b) return { kind: "unavailable" };
  if (!b.ok) return { kind: "failed", errors: b.errors, warnings: b.warnings };
  const t = await deps.target(projectId, "draft");
  const dest: Destination = { ref: t.ref, environment: "draft" };
  try {
    if (b.functions.length === 0) {
      await deps.engine.remove(dest);
      await deps.store.delete(projectId, "draft");
      return { kind: "removed" };
    }
    const anotado = await deps.store.get(projectId, "draft");
    if (anotado?.hash === b.hash && (await deps.engine.deployedHash(dest)) === b.hash) {
      return { kind: "unchanged", functions: b.functions.map((f) => f.name), warnings: b.warnings };
    }
    await deps.engine.deploy(dest, { hash: b.hash, files: b.files }, functionEnv(t), engineLimits(t.plan));
  } catch (e) {
    // El motor no pudo (Cloudflare contestó un error, o no contestó): lo de antes
    // sigue sirviendo, y Len lo lee como un diagnóstico (after-write.ts).
    return { kind: "engine_error", message: e instanceof Error ? e.message : String(e) };
  }
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
  return { kind: "deployed", functions: b.functions.map((f) => f.name), warnings: b.warnings };
}

const cadenas = new Map<string, Promise<unknown>>();
const temporizadores = new Map<string, ReturnType<typeof setTimeout>>();

/** Lo de un proyecto en un entorno, de uno en uno y en orden: despliegues y
 *  cambios de variables. Cada trabajo lee lo de SU momento. */
export function serialized<T>(projectId: string, env: FunctionsEnvironment, work: () => Promise<T>): Promise<T> {
  const clave = `${projectId}|${env}`;
  const antes = cadenas.get(clave) ?? Promise.resolve();
  const ahora = antes.catch(() => undefined).then(work);
  cadenas.set(clave, ahora);
  void ahora
    .catch(() => undefined)
    .finally(() => {
      if (cadenas.get(clave) === ahora) cadenas.delete(clave);
    });
  return ahora;
}

/** Lo que esté en curso en ese entorno (sin lanzar). */
export async function pendingFor(projectId: string, env: FunctionsEnvironment): Promise<void> {
  await cadenas.get(`${projectId}|${env}`)?.catch(() => undefined);
}

export function deployDraftSerialized(projectId: string, deps: DeployDeps, o: { readonly files?: Readonly<Record<string, string>> } = {}): Promise<DeployOutcome> {
  return serialized(projectId, "draft", () => deployDraft(projectId, deps, o));
}

export async function pendingDraftDeploy(projectId: string): Promise<void> {
  await pendingFor(projectId, "draft");
}

export function scheduleDraftDeploy(projectId: string, deps: DeployDeps, delayMs = 2_000): void {
  clearTimeout(temporizadores.get(projectId));
  temporizadores.set(
    projectId,
    setTimeout(() => {
      temporizadores.delete(projectId);
      void deployDraftSerialized(projectId, deps)
        .then((r) => {
          // Lo programado no tiene a quién contárselo (no hay turno de Len): al registro.
          if (r.kind === "engine_error") console.error("[functions] el motor rechazó el despliegue del borrador", projectId, r.message);
        })
        .catch((e: unknown) => console.error("[functions] el despliegue del borrador falló", projectId, e));
    }, delayMs),
  );
}

/** Antes de llamar al borrador: lo programado (YA, sin esperar sus 2 s: alguien
 *  guardó y el lienzo está llamando), lo que esté en curso, y lo anotado en el motor. */
export async function ensureDraftDeployed(projectId: string, ref: string, deps: DeployDeps): Promise<void> {
  const programado = temporizadores.get(projectId);
  if (programado) {
    clearTimeout(programado);
    temporizadores.delete(projectId);
    await deployDraftSerialized(projectId, deps).catch(() => undefined);
  }
  await pendingDraftDeploy(projectId);
  const anotado = await deps.store.get(projectId, "draft");
  if (!anotado) return;
  if ((await deps.engine.deployedHash({ ref, environment: "draft" })) === anotado.hash) return;
  await deployDraftSerialized(projectId, deps);
}

/** Los secretos de un entorno cambiaron: al motor YA, con el mismo código
 *  (como `supabase secrets set`). En serie con los despliegues de ese entorno.
 *  Sin nada desplegado, o con el motor vacío (un reinicio), nada: lo que
 *  despliegue o reponga después ya lee los nuevos. */
export function applyFunctionEnv(projectId: string, environment: FunctionsEnvironment, deps: DeployDeps): Promise<void> {
  return serialized(projectId, environment, async () => {
    const anotado = await deps.store.get(projectId, environment);
    if (!anotado) return;
    const t = await deps.target(projectId, environment);
    const dest: Destination = { ref: t.ref, environment };
    if ((await deps.engine.deployedHash(dest)) !== anotado.hash) return;
    await deps.engine.setEnv(dest, functionEnv(t));
  });
}
