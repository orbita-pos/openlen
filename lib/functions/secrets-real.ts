// lib/functions/secrets-real.ts — LOS SECRETOS CON LO DE VERDAD (spec local
// 2026-10-11, Parte 4): el almacén cifrado, las `SUPABASE_*` de cada entorno
// para medir los 4 KB, y el motor configurado. Sin motor (oscuro), null.

import "server-only";

import type { SecretsCli } from "@/lib/backend/cli-core";
import { getBackendByProject } from "@/lib/backend/registry";
import { autorDelCambio } from "@/lib/projects/autor-del-cambio";

import { functionBaseEnv } from "./base-env";
import { realDeployDeps } from "./deploy";
import { applyFunctionEnv } from "./deploy-core";
import { secretNamesOf } from "./secret-store";
import { pgSecretStore } from "./secret-store-pg";
import { setFunctionSecrets, unsetFunctionSecrets, type SecretsDeps } from "./secrets-core";

export function realSecretsDeps(): SecretsDeps | null {
  const deploy = realDeployDeps();
  if (!deploy) return null;
  return {
    store: pgSecretStore,
    // Sin backend todavía, guardar un secreto no lo crea (lib/functions/base-env.ts).
    baseEnv: (projectId, env) =>
      functionBaseEnv(projectId, env, { hasBackend: async (p) => (await getBackendByProject(p)) !== null, target: (p, e) => deploy.target(p, e) }),
    apply: (projectId, env) => applyFunctionEnv(projectId, env, deploy),
  };
}

/** Los NOMBRES por entorno, para Len (`request_secrets`, el ESTADO). Sin valores. */
export async function functionSecretNames(projectId: string): Promise<{ draft: string[]; live: string[] } | null> {
  if (!realSecretsDeps()) return null;
  return secretNamesOf(await pgSecretStore.list(projectId));
}

/** `supabase secrets …` de la terminal de Len: SIEMPRE el borrador. */
export function secretsCliFor(projectId: string): SecretsCli | null {
  const deps = realSecretsDeps();
  if (!deps) return null;
  return {
    async list() {
      return (await deps.store.list(projectId)).filter((r) => r.environment === "draft").map((r) => ({ name: r.name, digest: r.digest }));
    },
    async set(entries) {
      const r = await setFunctionSecrets(
        projectId,
        Object.entries(entries).map(([name, value]) => ({ environment: "draft" as const, name, value })),
        autorDelCambio(),
        deps,
      );
      return r.ok ? { ok: true } : { ok: false, message: `${r.message}\n` };
    },
    async unset(names) {
      await unsetFunctionSecrets(projectId, "draft", names, deps);
    },
  };
}
