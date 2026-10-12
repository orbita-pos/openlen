// lib/functions/state.ts — LAS FUNCIONES EN EL ESTADO DEL PROYECTO que Len lee
// cada turno (spec local 2026-10-11, Partes 1 y 4): cuáles hay en el borrador y
// en producción, la URL del borrador para su `curl`, y los NOMBRES de los
// secretos de cada entorno (nunca un valor). Sin motor, nada.

import "server-only";

import { draftProjectUrl, ensureBackend } from "@/lib/backend/registry";

import { pgDeploymentStore } from "./deployments-pg";
import { functionsEnabled } from "./engines";
import { secretNamesOf } from "./secret-store";
import { pgSecretStore } from "./secret-store-pg";

export async function edgeFunctionsState(
  projectId: string,
): Promise<{ draft: string[]; live: string[]; draftUrl: string; secrets: { draft: string[]; live: string[] } } | null> {
  if (!functionsEnabled()) return null;
  const [d, l, filas] = await Promise.all([pgDeploymentStore.get(projectId, "draft"), pgDeploymentStore.get(projectId, "live"), pgSecretStore.list(projectId)]);
  if (!d && !l && filas.length === 0) return null;
  const rec = await ensureBackend(projectId);
  return {
    draft: d?.functions.map((f) => f.name) ?? [],
    live: l?.functions.map((f) => f.name) ?? [],
    draftUrl: `${await draftProjectUrl(rec)}/functions/v1/`,
    secrets: secretNamesOf(filas),
  };
}
