// lib/functions/deployments-pg.ts — QUÉ HAY DESPLEGADO, en la base de la app
// (`functionDeployments`). Los sourcemaps van en gzip+base64 y sólo se leen
// cuando hay que traducir una traza.

import "server-only";

import { and, eq } from "drizzle-orm";
import { gunzipSync, gzipSync } from "node:zlib";

import { db, schema } from "@/lib/db";

import type { DeploymentStore } from "./deployments";

const T = schema.functionDeployments;

export const pgDeploymentStore: DeploymentStore = {
  async get(projectId, env) {
    const [row] = await db
      .select({ projectId: T.projectId, environment: T.environment, catalog: T.catalog, hash: T.hash, functions: T.functions, deployedAt: T.deployedAt })
      .from(T)
      .where(and(eq(T.projectId, projectId), eq(T.environment, env)))
      .limit(1);
    return row ?? null;
  },
  async maps(projectId, env) {
    const [row] = await db.select({ m: T.sourceMapsGz }).from(T).where(and(eq(T.projectId, projectId), eq(T.environment, env))).limit(1);
    if (!row?.m) return {};
    return JSON.parse(gunzipSync(Buffer.from(row.m, "base64")).toString("utf8")) as Record<string, string>;
  },
  async put(rec, maps) {
    const sourceMapsGz = Object.keys(maps).length > 0 ? gzipSync(Buffer.from(JSON.stringify(maps))).toString("base64") : null;
    const valores = { catalog: rec.catalog, hash: rec.hash, functions: [...rec.functions], sourceMapsGz, deployedAt: rec.deployedAt };
    await db
      .insert(T)
      .values({ projectId: rec.projectId, environment: rec.environment, ...valores })
      .onConflictDoUpdate({ target: [T.projectId, T.environment], set: valores });
  },
  async delete(projectId, env) {
    await db.delete(T).where(and(eq(T.projectId, projectId), eq(T.environment, env)));
  },
};
