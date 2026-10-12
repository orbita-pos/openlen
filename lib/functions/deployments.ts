// lib/functions/deployments.ts — QUÉ HAY DESPLEGADO en cada entorno de un
// proyecto (spec local 2026-10-11, Parte 2): el hash, las funciones y su
// `verify_jwt`, y aparte sus sourcemaps (pesan; sólo se leen ante un error).
// El de Postgres está en deployments-pg.ts; éste, en memoria, para las pruebas.

import type { FunctionsEnvironment } from "./engines/types";

export interface DeploymentRecord {
  readonly projectId: string;
  readonly environment: FunctionsEnvironment;
  readonly catalog: string;
  readonly hash: string;
  readonly functions: readonly { readonly name: string; readonly verifyJwt: boolean }[];
  readonly deployedAt: Date;
}

export interface DeploymentStore {
  get(projectId: string, env: FunctionsEnvironment): Promise<DeploymentRecord | null>;
  maps(projectId: string, env: FunctionsEnvironment): Promise<Record<string, string>>;
  put(rec: DeploymentRecord, maps: Readonly<Record<string, string>>): Promise<void>;
  delete(projectId: string, env: FunctionsEnvironment): Promise<void>;
}

export function memoryDeploymentStore(): DeploymentStore {
  const filas = new Map<string, { rec: DeploymentRecord; maps: Record<string, string> }>();
  const k = (p: string, e: FunctionsEnvironment) => `${p}|${e}`;
  return {
    async get(p, e) {
      return filas.get(k(p, e))?.rec ?? null;
    },
    async maps(p, e) {
      return filas.get(k(p, e))?.maps ?? {};
    },
    async put(rec, maps) {
      filas.set(k(rec.projectId, rec.environment), { rec, maps: { ...maps } });
    },
    async delete(p, e) {
      filas.delete(k(p, e));
    },
  };
}
