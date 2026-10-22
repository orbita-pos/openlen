// lib/functions/base-env.ts — LAS `SUPABASE_*` DE UN ENTORNO, PARA CONTAR LAS 128
// variables con sus secretos (spec local 2026-10-12, Parte 5). Un proyecto SIN backend no
// lo gana por guardar un secreto: se mide con unas de la misma forma (los
// mismos generadores, los mismos largos) y el backend lo crea el primer
// despliegue, como siempre.

import { newProjectRef, newPublishableKey, newSecretKey } from "@/lib/backend/keys";
import { publishBaseHost } from "@/lib/publish/deploy-url";

import { emailEnabledIn } from "@/lib/project-email/enabled";
import { emailFunctionEnv } from "@/lib/project-email/function-env";

import { defaultFunctionEnv } from "./default-env";
import type { FunctionsEnvironment } from "./engines/types";

export interface BaseEnvDeps {
  hasBackend(projectId: string): Promise<boolean>;
  target(projectId: string, env: FunctionsEnvironment): Promise<{ readonly url: string; readonly publishableKey: string; readonly secretKey: string }>;
  /** Project email on (default: the server's switch): its three variables count toward the 128 too. */
  email?: boolean;
}

export async function functionBaseEnv(projectId: string, env: FunctionsEnvironment, deps: BaseEnvDeps): Promise<Record<string, string>> {
  // La URL como `projectUrl` (lib/backend/registry.ts), con un ref de los suyos.
  const t = (await deps.hasBackend(projectId))
    ? await deps.target(projectId, env)
    : { url: `https://${newProjectRef()}.${publishBaseHost()}`, publishableKey: newPublishableKey(), secretKey: newSecretKey() };
  // Counted as if the domain were ready (the longest case): measuring is the worst case.
  const email = emailFunctionEnv({ enabled: deps.email ?? emailEnabledIn(), envUrl: t.url, secretKey: t.secretKey, userSecrets: {}, domain: { status: "ready", sendingHost: `notify.${"x".repeat(63)}.com` } });
  return { ...defaultFunctionEnv(t), ...email };
}
