// lib/functions/deploy.ts — DESPLEGAR, CON LO DE VERDAD: el motor configurado,
// el registro en Postgres, los ficheros de /supabase/ del proyecto, su backend
// (ref, la URL de cada entorno, claves), sus secretos y el plan de su dueño.

import "server-only";

import { eq } from "drizzle-orm";

import { listProjectFiles } from "@/lib/backend/files";
import { draftProjectUrl, ensureBackend, projectUrl } from "@/lib/backend/registry";
import { db, schema } from "@/lib/db";
import { decryptToken } from "@/lib/integrations/crypto";
import { planFromDb, type Plan } from "@/lib/plan";

import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { FunctionsCli } from "@/lib/backend/cli-core";

import { functionDiagnosticsAfterWrite } from "./after-write";
import { bundleFunctions } from "./bundler/bundle-functions";
import { deployDraftSerialized, scheduleDraftDeploy, type DeployDeps } from "./deploy-core";
import { pgDeploymentStore } from "./deployments-pg";
import { functionsEnabled, functionsEngine } from "./engines";
import { pgSecretStore } from "./secret-store-pg";

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
    async target(projectId, environment) {
      const rec = await ensureBackend(projectId);
      const owner = await ownerOf(projectId);
      if (!owner) throw new Error(`no existe el proyecto ${projectId}`);
      // Una función llama a SUPABASE_URL sin Origin: el borrador, con su ref propio.
      const url = environment === "draft" ? await draftProjectUrl(rec) : projectUrl(rec.ref);
      const secretKey = decryptToken(rec.secretKeyEncrypted);
      const secrets = await pgSecretStore.values(projectId, environment);
      const [{ emailFunctionEnv }, { emailEnabledIn }, { pgEmailStore }] = await Promise.all([
        import("@/lib/project-email/function-env"),
        import("@/lib/project-email/enabled"),
        import("@/lib/project-email/store-pg"),
      ]);
      const enabled = emailEnabledIn();
      const email = emailFunctionEnv({ enabled, envUrl: url, secretKey, userSecrets: secrets, domain: enabled ? await pgEmailStore.getDomain(projectId) : null });
      return { ref: rec.ref, url, publishableKey: rec.publishableKey, secretKey, plan: owner.plan, secrets, email };
    },
    bundle: (files, catalog, mode) => bundleFunctions({ files, catalog, mode }),
  };
}

/** Lo llama la carpeta del proyecto al guardar o borrar algo de las funciones. */
export function scheduleDraftDeployIfEnabled(projectId: string): void {
  const deps = realDeployDeps();
  if (deps) scheduleDraftDeploy(projectId, deps);
}

/** `supabase functions …` contra lo de verdad; null sin motor. */
export function functionsCliFor(projectId: string, ref: string): FunctionsCli | null {
  const deps = realDeployDeps();
  if (!deps) return null;
  return {
    ref,
    async deploy(ficheros) {
      const r = await deployDraftSerialized(projectId, deps, { files: ficheros });
      if (r.kind === "failed") {
        return { ok: false, message: `Error: failed to bundle the Edge Functions:\n${r.errors.map((d) => `${d.ruta.slice(1)}:${d.linea}:${d.columna}: ${d.mensaje}`).join("\n")}\n` };
      }
      if (r.kind === "unavailable") return { ok: false, message: "Error: the bundler didn't answer. Try again in a moment.\n" };
      if (r.kind === "engine_error") return { ok: false, message: `Error: failed to deploy the Edge Functions: ${r.message}\n` };
      return { ok: true, functions: r.kind === "removed" ? [] : r.functions };
    },
    async deployedAt() {
      const fechas = async (env: "draft" | "live") => {
        const d = await pgDeploymentStore.get(projectId, env);
        return d ? Object.fromEntries(d.functions.map((f) => [f.name, d.deployedAt])) : {};
      };
      return { draft: await fechas("draft"), live: await fechas("live") };
    },
    async draftBaseUrl() {
      const rec = await ensureBackend(projectId);
      return `${await draftProjectUrl(rec)}/functions/v1/`;
    },
  };
}

/** Tras Edit/Write/bash: despliega el borrador y devuelve lo que no compila. */
export async function draftDeployAfterWrite(projectId: string, written: readonly string[]): Promise<Diagnostico[]> {
  const deps = realDeployDeps();
  if (!deps) return [];
  return functionDiagnosticsAfterWrite(written, () => deployDraftSerialized(projectId, deps));
}
