// LAS VARIABLES DEL AJUSTE EN LA BASE (`projectEnvVars`, spec local 2026-10-10).
// Cada superficie las lee por su entorno (`envVarsFor`: `production` sólo al
// publicar, `draft` todo lo demás) y el diálogo las cambia de una vez
// (`replaceEnvVars`): con la fila del proyecto bloqueada, o entra la lista
// entera o no entra nada, y dos personas a la vez no se pisan (409).
import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { envHashOf, envVersionOf, varsOfTarget } from "./hash";
import { ENV_TARGETS, validateEnvVars, type EnvTarget, type EnvVarInput, type EnvVarProblem, type StoredEnvVar } from "./rules";

export interface EnvVarRow extends StoredEnvVar {
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

export type ReplaceEnvVarsResult =
  | { readonly ok: true; readonly vars: EnvVarRow[] }
  | { readonly ok: false; readonly reason: "not_found" }
  | { readonly ok: false; readonly reason: "conflict"; readonly vars: EnvVarRow[] }
  | { readonly ok: false; readonly reason: "invalid"; readonly problems: EnvVarProblem[] };

// El esquema se lee al llamar, no al importar: este módulo llega por
// `lib/apps/entorno.ts` a rutas cuyas pruebas simulan `@/lib/db` sin esta tabla.
const columns = (t: typeof schema.projectEnvVars) => ({ name: t.name, target: t.target, value: t.value, updatedAt: t.updatedAt, updatedBy: t.updatedBy });
const rowKey = (v: StoredEnvVar) => `${v.target}\u0000${v.name}\u0000${v.value}`;

export async function listEnvVars(projectId: string): Promise<EnvVarRow[]> {
  const t = schema.projectEnvVars;
  return db.select(columns(t)).from(t).where(eq(t.projectId, projectId)).orderBy(asc(t.name), asc(t.target));
}

export async function envVarsFor(projectId: string, target: EnvTarget): Promise<Record<string, string>> {
  const t = schema.projectEnvVars;
  const rows = await db
    .select({ name: t.name, value: t.value })
    .from(t)
    .where(and(eq(t.projectId, projectId), eq(t.target, target)));
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

/** Los nombres y en qué entornos está cada uno, para el estado del proyecto de Len. Sin valores. */
export async function envVarNames(projectId: string): Promise<Record<string, EnvTarget[]>> {
  const out: Record<string, EnvTarget[]> = {};
  for (const r of await listEnvVars(projectId)) (out[r.name] ??= []).push(r.target);
  for (const name of Object.keys(out)) out[name] = ENV_TARGETS.filter((x) => out[name]!.includes(x));
  return out;
}

export async function replaceEnvVars(args: {
  readonly projectId: string;
  /** El dueño (`acceso.duenoId`): la fila se busca con él, como en todo `lib/projects*`. */
  readonly ownerId: string;
  /** Quién guarda: el dueño o un editor. */
  readonly userId: string;
  /** `envVersionOf` de la lista que el diálogo leyó. */
  readonly version: string;
  readonly vars: readonly EnvVarInput[];
}): Promise<ReplaceEnvVarsResult> {
  const t = schema.projectEnvVars;
  return db.transaction(async (tx): Promise<ReplaceEnvVarsResult> => {
    const [project] = await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, args.projectId), eq(schema.projects.userId, args.ownerId)))
      .limit(1)
      .for("update");
    if (!project) return { ok: false, reason: "not_found" };
    const read = () => tx.select(columns(t)).from(t).where(eq(t.projectId, args.projectId)).orderBy(asc(t.name), asc(t.target));
    const current = await read();
    if (envVersionOf(current) !== args.version) return { ok: false, reason: "conflict", vars: current };
    const problems = validateEnvVars(args.vars, current);
    if (problems.length > 0) return { ok: false, reason: "invalid", problems };

    // Lo que no cambió conserva su fecha y su autor.
    const before = new Map(current.map((r) => [rowKey(r), r]));
    const now = new Date();
    await tx.delete(t).where(eq(t.projectId, args.projectId));
    if (args.vars.length > 0) {
      await tx.insert(t).values(
        args.vars.map((v) => {
          const same = before.get(rowKey(v));
          return {
            projectId: args.projectId,
            name: v.name,
            target: v.target,
            value: v.value,
            updatedAt: same?.updatedAt ?? now,
            updatedBy: same ? same.updatedBy : args.userId,
          };
        }),
      );
    }
    await tx
      .update(schema.projects)
      .set({ envHash: envHashOf(varsOfTarget(args.vars, "production")) })
      .where(eq(schema.projects.id, args.projectId));
    return { ok: true, vars: await read() };
  });
}
