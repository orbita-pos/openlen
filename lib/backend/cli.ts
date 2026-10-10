// `supabase …` en la terminal de Len, contra el backend real del proyecto: el
// núcleo (`cli-core.ts`) con las migraciones corridas por el rol de
// desarrollador del proyecto, en su base del clúster de las páginas.
//
// La primera vez que se pide, el backend se crea (registro + base), como el
// alta perezosa de las rutas: «provisioned automatically when your project
// needs it».

import "server-only";

import { runCli, type CliBackend, type CliResult } from "./cli-core";
import { credsOf, type EnvironmentRecord, type ScopeCreds } from "./environments";
import { backendConfigured } from "./pg";
import { applyMigrationAs, readRecordedMigrations } from "./recorded-migrations";
import { ensureBackend, ensureEnvironmentReady, projectUrl, type BackendRecord } from "./registry";

/** La CLI contra la base de PRUEBAS del proyecto (spec local 2026-10-09): lo
 *  que Len empuja va al borrador; a producción llega al publicar. `e` es null
 *  en los comandos que no tocan la base (status, migration new). */
function pgCli(rec: BackendRecord, e: EnvironmentRecord | null): CliBackend {
  const draft = (): ScopeCreds => {
    if (!e) throw new Error("sin base de pruebas");
    return credsOf(rec.ref, rec.dbPasswordEncrypted, e);
  };
  return {
    status: async () => ({ apiUrl: projectUrl(rec.ref), publishableKey: rec.publishableKey }),
    remoteMigrations: async () => (await readRecordedMigrations(draft().scope)).map((m) => ({ version: m.version, name: m.name })),
    applyMigration: (m) => applyMigrationAs(draft(), { version: m.version, name: m.name, statements: m.statements }),
  };
}

export async function runSupabaseCli(
  projectId: string,
  args: readonly string[],
  ficheros: Readonly<Record<string, string>>,
): Promise<CliResult> {
  if (!backendConfigured()) {
    return { stdout: "", stderr: "Error: this server has no database for project backends (PAGES_DATABASE_URL is not set).\n", exitCode: 1 };
  }
  const rec = await ensureBackend(projectId);
  // Sólo `db push` y `migration list` tocan la base; `status` o `migration new`
  // no tienen por qué crearla.
  const [cmd, sub] = args.filter((a) => !a.startsWith("-"));
  const touchesDatabase = (cmd === "db" && sub === "push") || (cmd === "migration" && sub === "list");
  const draft = touchesDatabase ? await ensureEnvironmentReady(rec, "draft") : null;
  return runCli(args, ficheros, pgCli(rec, draft));
}
