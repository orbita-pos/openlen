// lib/functions/state.ts — LAS FUNCIONES EN EL ESTADO DEL PROYECTO que Len lee
// cada turno (spec local 2026-10-11, Parte 1): cuáles hay en el borrador y en
// producción, y la URL del borrador para su `curl`. Sin motor, nada.

import "server-only";

import { draftProjectUrl, ensureBackend } from "@/lib/backend/registry";

import { pgDeploymentStore } from "./deployments-pg";
import { functionsEnabled } from "./engines";

export async function edgeFunctionsState(projectId: string): Promise<{ draft: string[]; live: string[]; draftUrl: string } | null> {
  if (!functionsEnabled()) return null;
  const [d, l] = await Promise.all([pgDeploymentStore.get(projectId, "draft"), pgDeploymentStore.get(projectId, "live")]);
  if (!d && !l) return null;
  const rec = await ensureBackend(projectId);
  return {
    draft: d?.functions.map((f) => f.name) ?? [],
    live: l?.functions.map((f) => f.name) ?? [],
    draftUrl: `${await draftProjectUrl(rec)}/functions/v1/`,
  };
}
