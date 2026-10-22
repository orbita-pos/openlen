// lib/functions/secrets-core.ts — GUARDAR Y QUITAR SECRETOS (spec local
// 2026-10-11, Parte 4), lo mismo para la tarjeta (la ruta) y para `supabase
// secrets set/unset` (la terminal): nombres válidos, valores de hasta 5 KB, que
// quepan en las 128 variables de un script de Cloudflare CON lo que ya hay —todo o
// nada—, y al motor al momento. Sin base ni motor de verdad: todo entra por `SecretsDeps`.

import type { FunctionsEnvironment } from "./engines/types";
import { secretNameMessage, secretNameProblem } from "./secret-names";
import type { SecretStore } from "./secret-store";
import { envTooLargeMessage, fitEnv, MAX_SECRET_VALUE_BYTES } from "./secrets";

export interface SecretEntry {
  readonly environment: FunctionsEnvironment;
  readonly name: string;
  readonly value: string;
}

/** A hook refused a value (Stripe: a live key for the draft…). `message` is for Len, in English. */
export interface SecretRejection {
  readonly environment: FunctionsEnvironment;
  readonly name: string;
  readonly reason: string;
  readonly message: string;
}

/** What a provider adds to the door (lib/stripe/secret-hooks.ts, spec local
 *  2026-10-21-stripe-integration §6.1): a check before saving —a rejection saves
 *  nothing— with its `commit` once the values are stored, and the names that go
 *  with one being removed. */
export type SecretsHookPrepared =
  | { readonly rejection: SecretRejection }
  | { readonly commit?: () => Promise<void>; readonly unverified?: readonly { readonly environment: FunctionsEnvironment; readonly name: string }[] };

export interface SecretsHook {
  prepare?(projectId: string, entries: readonly SecretEntry[]): Promise<SecretsHookPrepared>;
  beforeUnset?(projectId: string, env: FunctionsEnvironment, names: readonly string[]): Promise<readonly string[]>;
}

export interface SecretsDeps {
  readonly store: SecretStore;
  /** Las variables que toda función ya trae en ese entorno (`SUPABASE_*`): cuentan en las 128 variables. */
  baseEnv(projectId: string, env: FunctionsEnvironment): Promise<Record<string, string>>;
  /** Al motor, al momento (`applyFunctionEnv`). */
  apply(projectId: string, env: FunctionsEnvironment): Promise<void>;
  /** Los de cada proveedor (Stripe). */
  readonly hooks?: readonly SecretsHook[];
}

export type SetSecretsResult =
  | {
      readonly ok: true;
      readonly saved: readonly { readonly environment: FunctionsEnvironment; readonly name: string }[];
      /** Saved without the provider confirming them (it didn't answer). */
      readonly unverified?: readonly { readonly environment: FunctionsEnvironment; readonly name: string }[];
    }
  | { readonly ok: false; readonly error: "invalid_name" | "value_too_long"; readonly name: string; readonly message: string }
  | ({ readonly ok: false; readonly error: "rejected" } & SecretRejection)
  | {
      readonly ok: false;
      readonly error: "env_too_large";
      readonly environment: FunctionsEnvironment;
      readonly usedVars: number;
      readonly baseVars: number;
      readonly availableVars: number;
      readonly message: string;
    };

const ENTORNOS: readonly FunctionsEnvironment[] = ["draft", "live"];

// Medir y guardar, DE UNO EN UNO por proyecto: dos guardados a la vez (la
// tarjeta y `supabase secrets set`) no pasan juntos de las 128 variables. En
// `globalThis`, como el motor: en desarrollo Next carga este módulo una vez por
// ruta, y la tarjeta y la terminal son rutas distintas.
const COLAS = Symbol.for("openlen.functions.secrets.queue");
type ConColas = typeof globalThis & { [COLAS]?: Map<string, Promise<unknown>> };

function inSeries<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const colas = ((globalThis as ConColas)[COLAS] ??= new Map());
  const ahora = (colas.get(projectId) ?? Promise.resolve()).then(fn, fn);
  const cola = ahora.catch(() => undefined);
  colas.set(projectId, cola);
  void cola.then(() => {
    if (colas.get(projectId) === cola) colas.delete(projectId);
  });
  return ahora;
}

export async function setFunctionSecrets(projectId: string, entries: readonly SecretEntry[], by: string | null, deps: SecretsDeps): Promise<SetSecretsResult> {
  for (const e of entries) {
    const p = secretNameProblem(e.name);
    if (p) return { ok: false, error: "invalid_name", name: e.name, message: secretNameMessage(e.name, p) };
    if (Buffer.byteLength(e.value, "utf8") > MAX_SECRET_VALUE_BYTES) {
      return { ok: false, error: "value_too_long", name: e.name, message: `The value of ${e.name} is longer than ${MAX_SECRET_VALUE_BYTES} bytes.` };
    }
  }
  // Los ganchos, FUERA de la cola: llaman a la red (Stripe) y no deben frenar los demás guardados.
  const commits: (() => Promise<void>)[] = [];
  const unverified: { environment: FunctionsEnvironment; name: string }[] = [];
  for (const hook of deps.hooks ?? []) {
    const p = await hook.prepare?.(projectId, entries);
    if (!p) continue;
    if ("rejection" in p) return { ok: false, error: "rejected", ...p.rejection };
    if (p.commit) commits.push(p.commit);
    unverified.push(...(p.unverified ?? []));
  }
  const porEntorno = new Map<FunctionsEnvironment, Record<string, string>>();
  for (const e of entries) porEntorno.set(e.environment, { ...(porEntorno.get(e.environment) ?? {}), [e.name]: e.value });
  const noCabe = await inSeries(projectId, async () => {
    // Todo o nada: se mide CADA entorno, con lo que ya tiene, antes de guardar ninguno.
    for (const [env, nuevos] of porEntorno) {
      const f = fitEnv(await deps.baseEnv(projectId, env), { ...(await deps.store.values(projectId, env)), ...nuevos });
      if (!f.ok) {
        return { ok: false, error: "env_too_large", environment: env, usedVars: f.used, baseVars: f.base, availableVars: f.available, message: envTooLargeMessage(f) } as const;
      }
    }
    for (const [env, nuevos] of porEntorno) await deps.store.set(projectId, env, nuevos, by);
    return null;
  });
  if (noCabe) return noCabe;
  for (const commit of commits) {
    // Lo guardado ya es durable: si apuntar la cuenta falla, se vuelve a comprobar la próxima vez.
    await commit().catch((err: unknown) => console.error("[functions] un gancho no pudo confirmar lo guardado", projectId, err));
  }
  for (const env of porEntorno.keys()) {
    // Lo guardado ya es durable: si el motor falla ahora, lo lee el próximo despliegue.
    await deps.apply(projectId, env).catch((err: unknown) => console.error("[functions] los secretos no llegaron al motor", projectId, env, err));
  }
  return {
    ok: true,
    saved: ENTORNOS.flatMap((environment) => Object.keys(porEntorno.get(environment) ?? {}).sort().map((name) => ({ environment, name }))),
    ...(unverified.length > 0 ? { unverified } : {}),
  };
}

export async function unsetFunctionSecrets(projectId: string, env: FunctionsEnvironment, names: readonly string[], deps: SecretsDeps): Promise<string[]> {
  const todos = new Set(names);
  for (const hook of deps.hooks ?? []) for (const extra of (await hook.beforeUnset?.(projectId, env, names)) ?? []) todos.add(extra);
  const removed = await deps.store.unset(projectId, env, [...todos]);
  if (removed.length > 0) {
    await deps.apply(projectId, env).catch((err: unknown) => console.error("[functions] los secretos no llegaron al motor", projectId, env, err));
  }
  return removed;
}
