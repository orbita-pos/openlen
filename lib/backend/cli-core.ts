// `supabase …` en la terminal de Len: la parte de la CLI de Supabase que tiene
// sentido aquí, con sus mensajes (supabase/cli, internal/migration y
// internal/db/push). El proyecto ya está «enlazado»: su backend existe desde
// que se pide.
//
//   supabase status                 la URL del proyecto y la clave publicable
//   supabase migration new <name>   supabase/migrations/<AAAAMMDDHHMMSS>_<name>.sql
//   supabase migration list         local frente a remoto
//   supabase db push [--dry-run] [--include-all]
//
// Lo que no se puede aquí lo dice (db reset borraría la base EN VIVO; no hay
// gen types todavía), no lo finge.

import { splitSqlStatements } from "./sql-split";

export interface CliBackend {
  status(): Promise<{ apiUrl: string; publishableKey: string }>;
  /** Las versiones aplicadas (`supabase_migrations.schema_migrations`). */
  remoteMigrations(): Promise<{ version: string; name: string | null }[]>;
  /** Aplica UNA migración en una transacción: sus sentencias y su fila en
   *  `schema_migrations`. Si una falla, `{ failedAt, error }` y no queda nada. */
  applyMigration(m: { version: string; name: string; statements: string[] }): Promise<{ ok: true } | { ok: false; failedAt: number; error: { message: string; code?: string } }>;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Ficheros que la CLI crea (migration new). */
  escribir?: Record<string, string>;
}

const MIGRATIONS_DIR = "/supabase/migrations/";
const MIGRATION_RE = /^([0-9]+)_(.*)\.sql$/;

const ok = (stdout: string, extra: Partial<CliResult> = {}): CliResult => ({ stdout, stderr: "", exitCode: 0, ...extra });
const err = (stderr: string, stdout = ""): CliResult => ({ stdout, stderr, exitCode: 1 });

function timestamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
}

interface LocalMigration {
  version: string;
  name: string;
  file: string;
  path: string;
}

function localMigrations(ficheros: Readonly<Record<string, string>>): { migrations: LocalMigration[]; skipped: string[] } {
  const migrations: LocalMigration[] = [];
  const skipped: string[] = [];
  for (const path of Object.keys(ficheros).sort()) {
    if (!path.startsWith(MIGRATIONS_DIR)) continue;
    const file = path.slice(MIGRATIONS_DIR.length);
    if (file.includes("/")) continue;
    const m = MIGRATION_RE.exec(file);
    if (!m) {
      skipped.push(file);
      continue;
    }
    migrations.push({ version: m[1]!, name: m[2]!, file, path });
  }
  migrations.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return { migrations, skipped };
}

const USAGE = `Supabase CLI (this project's backend is already linked)

Usage:
  supabase [command]

Available Commands:
  status            Show the project URL and its publishable key
  migration new     Create an empty migration in supabase/migrations
  migration list    List local and remote migrations
  db push           Push new migrations to the project database

Flags for db push:
  --dry-run         Print the migrations that would be applied, without applying them
  --include-all     Include migrations older than the last one applied
`;

export async function runCli(args: readonly string[], ficheros: Readonly<Record<string, string>>, backend: CliBackend, now = new Date()): Promise<CliResult> {
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const words = args.filter((a) => !a.startsWith("-"));
  const [cmd, sub, ...rest] = words;

  if (!cmd || flags.has("--help") || flags.has("-h") || cmd === "help") return ok(USAGE);

  if (cmd === "status") {
    const s = await backend.status();
    return ok(`         API URL: ${s.apiUrl}\n Publishable key: ${s.publishableKey}\n`);
  }

  if (cmd === "migration" && sub === "new") {
    const name = rest[0];
    if (!name) return err(`Usage:\n  supabase migration new <migration name>\n\nError: accepts 1 arg(s), received 0\n`);
    const file = `${timestamp(now)}_${name}.sql`;
    return ok(`Created new migration at supabase/migrations/${file}\n`, { escribir: { [`${MIGRATIONS_DIR}${file}`]: "" } });
  }

  if (cmd === "migration" && sub === "list") {
    const { migrations } = localMigrations(ficheros);
    const remote = await backend.remoteMigrations();
    const versions = [...new Set([...migrations.map((m) => m.version), ...remote.map((r) => r.version)])].sort();
    const fmtTime = (v: string) =>
      /^\d{14}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)} ${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}` : v;
    const rows = versions.map((v) => {
      const l = migrations.some((m) => m.version === v) ? v : "";
      const r = remote.some((x) => x.version === v) ? v : "";
      return `   ${l.padEnd(14)} | ${r.padEnd(14)} | ${fmtTime(v)} `;
    });
    return ok(["", "   Local          | Remote         | Time (UTC)          ", "  ----------------|----------------|---------------------", ...rows, ""].join("\n"));
  }

  if (cmd === "db" && sub === "push") {
    const { migrations, skipped } = localMigrations(ficheros);
    let out = "";
    for (const f of skipped) out += `Skipping migration ${f}... (file name must match pattern "<timestamp>_name.sql")\n`;
    out += "Connecting to remote database...\n";
    const remote = await backend.remoteMigrations();
    const remoteSet = new Set(remote.map((r) => r.version));
    const missingLocally = remote.filter((r) => !migrations.some((m) => m.version === r.version));
    if (missingLocally.length > 0) {
      return err(
        `Remote migration versions not found in local migrations directory.\n\nMake sure your local git repo is up-to-date. If the error persists, try repairing the migration history table:\nsupabase migration repair --status reverted ${missingLocally.map((r) => r.version).join(" ")}\n`,
        out,
      );
    }
    const lastRemote = remote.map((r) => r.version).sort().at(-1);
    let pending = migrations.filter((m) => !remoteSet.has(m.version));
    const older = lastRemote ? pending.filter((m) => m.version < lastRemote) : [];
    if (older.length > 0 && !flags.has("--include-all")) {
      return err(
        `Found local migration files to be inserted before the last migration on remote database.\n\nRerun the command with --include-all flag to apply these migrations:\n${older.map((m) => `supabase/migrations/${m.file}`).join("\n")}\n`,
        out,
      );
    }
    if (!flags.has("--include-all") && lastRemote) pending = pending.filter((m) => m.version > lastRemote);
    if (pending.length === 0) return ok(`${out}Remote database is up to date.\n`);
    if (flags.has("--dry-run")) {
      return ok(`${out}DRY RUN: migrations will *not* be pushed to the database.\nWould push these migrations:\n${pending.map((m) => ` • ${m.file}`).join("\n")}\n`);
    }
    for (const m of pending) {
      out += `Applying migration ${m.file}...\n`;
      const statements = splitSqlStatements(ficheros[m.path] ?? "");
      const r = await backend.applyMigration({ version: m.version, name: m.name, statements });
      if (!r.ok) {
        const code = r.error.code ? ` (SQLSTATE ${r.error.code})` : "";
        return err(`ERROR: ${r.error.message}${code}\nAt statement ${r.failedAt}:\n${statements[r.failedAt] ?? ""}\nTry rerunning the command with --debug to troubleshoot the error.\n`, out);
      }
    }
    return ok(`${out}Finished supabase db push.\n`);
  }

  if (cmd === "db" && sub === "reset") {
    return err("supabase db reset is not available here: it would erase this project's live database. Write a new migration that changes what you need, and run supabase db push.\n");
  }
  if (cmd === "gen") return err("supabase gen is not available here yet.\n");
  if (["login", "link", "init", "start", "stop", "projects"].includes(cmd)) {
    return ok("Not needed here: this project is already linked to its backend. Run `supabase status` for its URL and key.\n");
  }
  return err(`Error: unknown command "${[cmd, sub].filter(Boolean).join(" ")}" for "supabase"\nRun 'supabase --help' for usage.\n`);
}
