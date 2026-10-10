// Las migraciones que una base YA corrió, como las guarda Supabase en
// `supabase_migrations.schema_migrations` (version, name, statements). Es lo
// que se publica: lo que se PROBÓ en el borrador, con sus sentencias, no el
// fichero que haya ahora (spec local 2026-10-09, 6.1).

import "server-only";

import { dbNameOf, type ScopeCreds } from "./environments";
import { withAdmin, withLogin } from "./pg";
import { devRoleOf } from "./provision";

export interface RecordedMigration {
  readonly version: string;
  readonly name: string | null;
  readonly statements: readonly string[];
}

export type ApplyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failedAt: number; readonly error: { readonly message: string; readonly code?: string } };

export function migrationLabel(m: Pick<RecordedMigration, "version" | "name">): string {
  return m.name ? `${m.version}_${m.name}` : m.version;
}

export async function readRecordedMigrations(scope: string): Promise<RecordedMigration[]> {
  const { rows } = await withAdmin(dbNameOf(scope), (r) =>
    r.query(`select version, name, coalesce(statements, '{}') as statements from supabase_migrations.schema_migrations order by version`),
  );
  return rows.map((row) => ({
    version: String(row.version),
    name: row.name == null ? null : String(row.name),
    statements: (row.statements as string[]).map(String),
  }));
}

function pgError(e: unknown): { message: string; code?: string } {
  const er = e as { message?: string; code?: string };
  return { message: er.message ?? String(e), ...(er.code ? { code: er.code } : {}) };
}

/** Sentencias como el rol de desarrollador, en UNA transacción. `record`, si
 *  viene, deja además su fila en `schema_migrations`. */
export async function runStatementsAs(
  creds: ScopeCreds,
  statements: readonly string[],
  record?: { version: string; name: string | null },
): Promise<ApplyResult> {
  return withLogin(dbNameOf(creds.scope), devRoleOf(creds.ref), creds.password, async (c) => {
    let failedAt = -1;
    try {
      await c.query("BEGIN");
      for (let i = 0; i < statements.length; i++) {
        failedAt = i;
        await c.query(statements[i]!);
      }
      failedAt = -1;
      if (record) {
        await c.query(`insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)`, [
          record.version,
          record.name,
          statements,
        ]);
      }
      await c.query("COMMIT");
      return { ok: true } as const;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      return { ok: false, failedAt: Math.max(0, failedAt), error: pgError(e) } as const;
    }
  });
}

export function applyMigrationAs(creds: ScopeCreds, m: RecordedMigration): Promise<ApplyResult> {
  return runStatementsAs(creds, m.statements, { version: m.version, name: m.name });
}
