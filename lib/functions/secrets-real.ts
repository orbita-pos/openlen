// lib/functions/secrets-real.ts — LOS SECRETOS CON LO DE VERDAD (spec local
// 2026-10-11, Parte 4): el almacén cifrado, las `SUPABASE_*` de cada entorno
// para medir los 4 KB, y el motor configurado. Sin motor (oscuro), null.

import "server-only";

import { defaultFunctionEnv } from "./default-env";
import { realDeployDeps } from "./deploy";
import { applyFunctionEnv } from "./deploy-core";
import { secretNamesOf } from "./secret-store";
import { pgSecretStore } from "./secret-store-pg";
import type { SecretsDeps } from "./secrets-core";

export function realSecretsDeps(): SecretsDeps | null {
  const deploy = realDeployDeps();
  if (!deploy) return null;
  return {
    store: pgSecretStore,
    baseEnv: async (projectId, env) => defaultFunctionEnv(await deploy.target(projectId, env)),
    apply: (projectId, env) => applyFunctionEnv(projectId, env, deploy),
  };
}

/** Los NOMBRES por entorno, para Len (`request_secrets`, el ESTADO). Sin valores. */
export async function functionSecretNames(projectId: string): Promise<{ draft: string[]; live: string[] } | null> {
  if (!realSecretsDeps()) return null;
  return secretNamesOf(await pgSecretStore.list(projectId));
}
