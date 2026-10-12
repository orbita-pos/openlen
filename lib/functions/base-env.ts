// lib/functions/base-env.ts — LAS `SUPABASE_*` DE UN ENTORNO, PARA MEDIR LOS 4 KB
// de sus secretos (spec local 2026-10-11, Parte 4). Un proyecto SIN backend no
// lo gana por guardar un secreto: se mide con unas de la misma forma (los
// mismos generadores, los mismos largos) y el backend lo crea el primer
// despliegue, como siempre.

import { newProjectRef, newPublishableKey, newSecretKey } from "@/lib/backend/keys";
import { publishBaseHost } from "@/lib/publish/deploy-url";

import { defaultFunctionEnv } from "./default-env";
import type { FunctionsEnvironment } from "./engines/types";

export interface BaseEnvDeps {
  hasBackend(projectId: string): Promise<boolean>;
  target(projectId: string, env: FunctionsEnvironment): Promise<{ readonly url: string; readonly publishableKey: string; readonly secretKey: string }>;
}

export async function functionBaseEnv(projectId: string, env: FunctionsEnvironment, deps: BaseEnvDeps): Promise<Record<string, string>> {
  if (!(await deps.hasBackend(projectId))) {
    // La URL como `projectUrl` (lib/backend/registry.ts), con un ref de los suyos.
    return defaultFunctionEnv({ url: `https://${newProjectRef()}.${publishBaseHost()}`, publishableKey: newPublishableKey(), secretKey: newSecretKey() });
  }
  return defaultFunctionEnv(await deps.target(projectId, env));
}
