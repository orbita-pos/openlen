// lib/functions/deploy.ts — DESPLEGAR, CON LO DE VERDAD: el motor configurado,
// el registro en Postgres, los ficheros de /supabase/ del proyecto, su backend
// (ref, URL propia del borrador, claves) y el plan de su dueño.

import "server-only";

import { eq } from "drizzle-orm";

import { listProjectFiles } from "@/lib/backend/files";
import { draftProjectUrl, ensureBackend } from "@/lib/backend/registry";
import { db, schema } from "@/lib/db";
import { decryptToken } from "@/lib/integrations/crypto";
import { planFromDb, type Plan } from "@/lib/plan";

import { bundleFunctions } from "./bundler/bundle-functions";
import { scheduleDraftDeploy, type DeployDeps } from "./deploy-core";
import { pgDeploymentStore } from "./deployments-pg";
import { functionsEnabled, functionsEngine } from "./engines";

/** El dueño del proyecto y su plan: la cuota, la bolsa y el tiempo límite son
 *  los SUYOS (como los créditos de Len). Sin `lib/limits.ts`, que arrastra el
 *  binding nativo de rate-limit. */
export async function ownerOf(projectId: string): Promise<{ readonly userId: string; readonly plan: Plan } | null> {
  const [row] = await db
    .select({ userId: schema.projects.userId, plan: schema.users.plan })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return row ? { userId: row.userId, plan: planFromDb(row.plan) } : null;
}

export function realDeployDeps(): DeployDeps | null {
  const engine = functionsEngine();
  if (!engine || !functionsEnabled()) return null;
  return {
    engine,
    store: pgDeploymentStore,
    loadFiles: (projectId) => listProjectFiles(projectId, "/supabase/"),
    async target(projectId) {
      const rec = await ensureBackend(projectId);
      const owner = await ownerOf(projectId);
      if (!owner) throw new Error(`no existe el proyecto ${projectId}`);
      return {
        ref: rec.ref,
        url: await draftProjectUrl(rec),
        publishableKey: rec.publishableKey,
        secretKey: decryptToken(rec.secretKeyEncrypted),
        plan: owner.plan,
      };
    },
    bundle: (files, catalog) => bundleFunctions({ files, catalog, mode: "development" }),
  };
}

/** Lo llama la carpeta del proyecto al guardar o borrar algo de las funciones. */
export function scheduleDraftDeployIfEnabled(projectId: string): void {
  const deps = realDeployDeps();
  if (deps) scheduleDraftDeploy(projectId, deps);
}
