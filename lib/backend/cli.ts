// `supabase …` en la terminal de Len, contra el backend real del proyecto: el
// núcleo (`cli-core.ts`) con las migraciones corridas por el rol de
// desarrollador del proyecto, en su base del clúster de las páginas.
//
// La primera vez que se pide, el backend se crea (registro + base), como el
// alta perezosa de las rutas: «provisioned automatically when your project
// needs it».

import "server-only";

import { decryptToken } from "@/lib/integrations/crypto";
import { runCli, type CliBackend, type CliResult } from "./cli-core";
import { backendConfigured, withDeveloper } from "./pg";
import { devRoleOf } from "./provision";
import { ensureBackend, ensureProvisioned, projectUrl, type BackendRecord } from "./registry";

function pgCli(rec: BackendRecord): CliBackend {
  const dev = devRoleOf(rec.ref);
  const password = decryptToken(rec.dbPasswordEncrypted);
  return {
    status: async () => ({ apiUrl: projectUrl(rec.ref), publishableKey: rec.publishableKey }),
    remoteMigrations: () =>
      withDeveloper(dev, dev, password, async (r) => {
        const { rows } = await r.query(`select version, name from supabase_migrations.schema_migrations order by version`);
        return rows.map((row) => ({ version: String(row.version), name: row.name == null ? null : String(row.name) }));
      }),
    applyMigration: (m) =>
      withDeveloper(dev, dev, password, async (r) => {
        let failedAt = -1;
        try {
          await r.exec("BEGIN");
          for (let i = 0; i < m.statements.length; i++) {
            failedAt = i;
            await r.exec(m.statements[i]!);
          }
          failedAt = -1;
          await r.query(`insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)`, [
            m.version,
            m.name,
            m.statements,
          ]);
          await r.exec("COMMIT");
          return { ok: true } as const;
        } catch (e) {
          await r.exec("ROLLBACK").catch(() => {});
          const er = e as { message?: string; code?: string };
          return {
            ok: false,
            failedAt: Math.max(0, failedAt),
            error: { message: er.message ?? String(e), ...(er.code ? { code: er.code } : {}) },
          } as const;
        }
      }),
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
  if ((cmd === "db" && sub === "push") || (cmd === "migration" && sub === "list")) await ensureProvisioned(rec);
  return runCli(args, ficheros, pgCli(rec));
}
