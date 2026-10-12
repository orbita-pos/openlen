// lib/functions/deployments-pg.ts — QUÉ HAY DESPLEGADO, en la base de la app
// (`functionDeployments`). Los sourcemaps y el paquete de producción van en
// gzip+base64 y sólo se leen cuando hacen falta (traducir una traza; reponer
// producción).

import "server-only";

import { and, eq } from "drizzle-orm";
import { gunzipSync, gzipSync } from "node:zlib";

import { db, schema } from "@/lib/db";

import type { DeploymentStore } from "./deployments";

const T = schema.functionDeployments;
const gz = (o: Readonly<Record<string, string>>) => gzipSync(Buffer.from(JSON.stringify(o))).toString("base64");
const ungz = (s: string) => JSON.parse(gunzipSync(Buffer.from(s, "base64")).toString("utf8")) as Record<string, string>;

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
    return ungz(row.m);
  },
  async put(rec, maps, bundle) {
    const sourceMapsGz = Object.keys(maps).length > 0 ? gz(maps) : null;
    const valores = { catalog: rec.catalog, hash: rec.hash, functions: [...rec.functions], sourceMapsGz, bundleGz: bundle ? gz(bundle) : null, deployedAt: rec.deployedAt };
    await db
      .insert(T)
      .values({ projectId: rec.projectId, environment: rec.environment, ...valores })
      .onConflictDoUpdate({ target: [T.projectId, T.environment], set: valores });
  },
  async bundle(projectId, env) {
    const [row] = await db.select({ b: T.bundleGz }).from(T).where(and(eq(T.projectId, projectId), eq(T.environment, env))).limit(1);
    return row?.b ? ungz(row.b) : null;
  },
  async delete(projectId, env) {
    await db.delete(T).where(and(eq(T.projectId, projectId), eq(T.environment, env)));
  },
};
