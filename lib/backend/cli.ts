// `supabase …` en la terminal de Len, contra el backend real del proyecto: el
// núcleo (`cli-core.ts`) con las migraciones corridas por el rol de
// desarrollador del proyecto, en su base de PRUEBAS del clúster de las páginas
// (spec local 2026-10-09). Producción sólo se LEE (`db query --linked`).
//
// La primera vez que se pide, el backend se crea (registro + base), como el
// alta perezosa de las rutas: «provisioned automatically when your project
// needs it».

import "server-only";

import { decryptToken, encryptToken } from "@/lib/integrations/crypto";

import { runCli, type CliBackend, type CliResult } from "./cli-core";
import { resetDraftDatabase } from "./draft";
import { claimReadOnlyPassword, credsOf, getEnvironment, type EnvironmentRecord, type ScopeCreds } from "./environments";
import { newDatabasePassword } from "./keys";
import { backendConfigured } from "./pg";
import { provisionReadOnlyRole } from "./read-only";
import { applyMigrationAs, readRecordedMigrations } from "./recorded-migrations";
import { ensureBackend, ensureEnvironmentReady, projectUrl, type BackendRecord } from "./registry";
import { splitSqlOffThread } from "./split-off-thread";
import { runDraftQuery, runLiveQuery } from "./sql-query";

/** La CLI contra la base de PRUEBAS del proyecto: lo que Len empuja va al
 *  borrador; a producción llega al publicar. `e` es null en los comandos que no
 *  tocan la base (status, migration new). `signal`: el del comando; si se corta,
 *  se corta lo que parte el SQL en su hilo (14/10). */
function pgCli(rec: BackendRecord, e: EnvironmentRecord | null, ficheros: Readonly<Record<string, string>>, signal?: AbortSignal): CliBackend {
  const draft = (): ScopeCreds => {
    if (!e) throw new Error("sin base de pruebas");
    return credsOf(rec.ref, rec.dbPasswordEncrypted, e);
  };
  return {
    status: async () => ({ apiUrl: projectUrl(rec.ref), publishableKey: rec.publishableKey }),
    remoteMigrations: async () => (await readRecordedMigrations(draft().scope)).map((m) => ({ version: m.version, name: m.name })),
    liveMigrations: async () => {
      const live = await getEnvironment(rec.projectId, "live");
      if (!live?.provisionedAt) return null;
      return (await readRecordedMigrations(live.scope)).map((m) => ({ version: m.version, name: m.name }));
    },
    applyMigration: (m) => applyMigrationAs(draft(), { version: m.version, name: m.name, statements: m.statements }),
    splitStatements: (sql) => splitSqlOffThread(sql, signal ? { signal } : {}),
    reset: async () => {
      const live = await getEnvironment(rec.projectId, "live");
      const d = draft();
      const r = await resetDraftDatabase({
        draft: d,
        live: live?.provisionedAt ? { scope: live.scope, ref: rec.ref, password: d.password } : null,
        files: ficheros,
        includeLocal: true,
        ...(signal ? { signal } : {}),
      });
      if (r.ok) return r;
      const code = r.error.code ? ` (SQLSTATE ${r.error.code})` : "";
      return { ok: false, message: `ERROR: ${r.error.message}${code}\nIn ${r.name}, statement ${r.failedAt}.` };
    },
    query: async (sql, target) => {
      if (target === "local") return runDraftQuery(draft(), sql);
      const live = await getEnvironment(rec.projectId, "live");
      if (!live?.provisionedAt) return { kind: "no_live" };
      const stored = live.readOnlyPasswordEncrypted ?? (await claimReadOnlyPassword(rec.projectId, encryptToken(newDatabasePassword())));
      const roPassword = decryptToken(stored);
      // Idempotente: crea el rol o le pone la contraseña guardada.
      await provisionReadOnlyRole({ scope: live.scope, ref: rec.ref, password: roPassword });
      return runLiveQuery({ scope: live.scope, roPassword }, sql);
    },
  };
}

export async function runSupabaseCli(
  projectId: string,
  args: readonly string[],
  ficheros: Readonly<Record<string, string>>,
  o: { readonly signal?: AbortSignal } = {},
): Promise<CliResult> {
  if (!backendConfigured()) {
    return { stdout: "", stderr: "Error: this server has no database for project backends (PAGES_DATABASE_URL is not set).\n", exitCode: 1 };
  }
  const rec = await ensureBackend(projectId);
  // Sólo lo que toca la base la crea; `status` o `migration new` no tienen por qué.
  const [cmd, sub] = args.filter((a) => !a.startsWith("-"));
  const touchesDatabase =
    (cmd === "db" && (sub === "push" || sub === "reset" || sub === "query")) || (cmd === "migration" && (sub === "list" || sub === "up"));
  const draft = touchesDatabase ? await ensureEnvironmentReady(rec, "draft") : null;
  // Las Edge Functions (spec local 2026-10-11): import perezoso, como el resto
  // de lo que necesita el motor.
  const { functionsCliFor } = await import("@/lib/functions/deploy");
  const { secretsCliFor } = await import("@/lib/functions/secrets-real");
  return runCli(args, ficheros, { ...pgCli(rec, draft, ficheros, o.signal), functions: functionsCliFor(projectId, rec.ref), secrets: secretsCliFor(projectId) });
}
