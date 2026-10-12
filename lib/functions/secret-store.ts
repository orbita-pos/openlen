// lib/functions/secret-store.ts — DÓNDE VIVEN LOS SECRETOS de las funciones
// (spec local 2026-10-11, Parte 4). El de Postgres está en secret-store-pg.ts;
// éste, en memoria, para las pruebas. 🔴 `list` NUNCA lleva valores: sólo la
// huella (la de `supabase secrets list`). Los valores salen únicamente por
// `values`, hacia la función (sus variables) y hacia el tapado.

import type { FunctionsEnvironment } from "./engines/types";
import { secretDigest } from "./secrets";

export interface SecretRow {
  readonly environment: FunctionsEnvironment;
  readonly name: string;
  readonly digest: string;
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

export interface SecretStore {
  /** Por entorno (`draft` antes que `live`) y por nombre. Sin valores. */
  list(projectId: string): Promise<SecretRow[]>;
  /** Nombre → valor, en claro, de UN entorno. */
  values(projectId: string, env: FunctionsEnvironment): Promise<Record<string, string>>;
  /** Crea o sustituye, todos de una vez. */
  set(projectId: string, env: FunctionsEnvironment, entries: Readonly<Record<string, string>>, by: string | null): Promise<void>;
  /** Los que había y se quitaron, en orden. */
  unset(projectId: string, env: FunctionsEnvironment, names: readonly string[]): Promise<string[]>;
}

/** Los nombres por entorno, para Len (el ESTADO, `request_secrets`). */
export function secretNamesOf(rows: readonly SecretRow[]): { draft: string[]; live: string[] } {
  const de = (e: FunctionsEnvironment) => rows.filter((r) => r.environment === e).map((r) => r.name).sort();
  return { draft: de("draft"), live: de("live") };
}

export function memorySecretStore(now: () => Date = () => new Date()): SecretStore {
  const filas = new Map<string, { projectId: string; value: string; row: SecretRow }>();
  const k = (p: string, e: FunctionsEnvironment, n: string) => `${p}|${e}|${n}`;
  const orden = (a: SecretRow, b: SecretRow) =>
    a.environment !== b.environment ? (a.environment === "draft" ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  return {
    async list(p) {
      return [...filas.values()].filter((f) => f.projectId === p).map((f) => f.row).sort(orden);
    },
    async values(p, e) {
      return Object.fromEntries([...filas.values()].filter((f) => f.projectId === p && f.row.environment === e).map((f) => [f.row.name, f.value]));
    },
    async set(p, e, entries, by) {
      for (const [name, value] of Object.entries(entries)) {
        filas.set(k(p, e, name), { projectId: p, value, row: { environment: e, name, digest: secretDigest(value), updatedAt: now(), updatedBy: by } });
      }
    },
    async unset(p, e, names) {
      const out: string[] = [];
      for (const n of names) if (filas.delete(k(p, e, n))) out.push(n);
      return out.sort();
    },
  };
}
