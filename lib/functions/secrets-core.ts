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

export interface SecretsDeps {
  readonly store: SecretStore;
  /** Las variables que toda función ya trae en ese entorno (`SUPABASE_*`): cuentan en las 128 variables. */
  baseEnv(projectId: string, env: FunctionsEnvironment): Promise<Record<string, string>>;
  /** Al motor, al momento (`applyFunctionEnv`). */
  apply(projectId: string, env: FunctionsEnvironment): Promise<void>;
}

export type SetSecretsResult =
  | { readonly ok: true; readonly saved: readonly { readonly environment: FunctionsEnvironment; readonly name: string }[] }
  | { readonly ok: false; readonly error: "invalid_name" | "value_too_long"; readonly name: string; readonly message: string }
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
  for (const env of porEntorno.keys()) {
    // Lo guardado ya es durable: si el motor falla ahora, lo lee el próximo despliegue.
    await deps.apply(projectId, env).catch((err: unknown) => console.error("[functions] los secretos no llegaron al motor", projectId, env, err));
  }
  return {
    ok: true,
    saved: ENTORNOS.flatMap((environment) => Object.keys(porEntorno.get(environment) ?? {}).sort().map((name) => ({ environment, name }))),
  };
}

export async function unsetFunctionSecrets(projectId: string, env: FunctionsEnvironment, names: readonly string[], deps: SecretsDeps): Promise<string[]> {
  const removed = await deps.store.unset(projectId, env, names);
  if (removed.length > 0) {
    await deps.apply(projectId, env).catch((err: unknown) => console.error("[functions] los secretos no llegaron al motor", projectId, env, err));
  }
  return removed;
}
