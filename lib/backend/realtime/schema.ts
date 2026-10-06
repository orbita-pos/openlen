// El esquema `realtime` de Supabase Realtime en la base de UN proyecto: el
// volcado que ellos mismos cargan en cada base nueva
// (lib/backend/realtime/schema-dump.ts), con la adaptación de roles de siempre
// (como lib/backend/schema.ts con GoTrue y lib/backend/storage/schema.ts):
//
//   · `postgres` → el rol de desarrollador del proyecto (`ol_<ref>`).
//   · `supabase_admin` (el administrador de su plataforma) → el administrador
//     del clúster, que es quien lo aplica (`CURRENT_USER`).
//   · `dashboard_user` (su panel) no existe aquí: fuera sus permisos.
//   · Su bloque `DO` inicial crea `supabase_realtime_admin` con NOREPLICATION y
//     le da `SET ON PARAMETER log_min_messages`: un administrador sin
//     superusuario no puede escribir ninguna de las dos. Lo sustituye
//     REALTIME_CLUSTER_ROLES_SQL (los roles son del clúster, no de la base).
//   · Los `SET` de sesión del volcado pasan a `LOCAL`: se aplica por una
//     conexión del pool y no se puede quedar con `search_path = ''`.
//
// El volcado viene de `pg_dump`: todo calificado y `search_path = ''`, así que
// nada de lo que haya en `public` (del desarrollador) entra en juego mientras
// lo aplica el administrador.

import type { SqlRunner } from "../db";
import { REALTIME_DUMP_SQL } from "./schema-dump";

/** Idempotente. Su bloque `DO` (cabecera del volcado) sin lo que exige
 *  superusuario, más `grant … to authenticator`: las sesiones del servicio
 *  entran por el pool de `authenticator`, como las de storage. */
export const REALTIME_CLUSTER_ROLES_SQL = `
do $$ begin
  if not exists (select from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin nologin noinherit;
  end if;
end $$;
alter role supabase_realtime_admin set search_path to 'public', 'extensions', 'realtime';
grant anon to supabase_realtime_admin with inherit false;
grant authenticated to supabase_realtime_admin with inherit false;
grant service_role to supabase_realtime_admin with inherit false;
grant supabase_realtime_admin to authenticator;
`;

const DEV_ROLE_RE = /^ol_[a-z]{20}$/;

// La cabecera del volcado: «creates the supabase_realtime_admin role».
const ROLE_BLOCK_RE = /^DO \$\$\nBEGIN\n {2}IF NOT EXISTS \(SELECT FROM pg_catalog\.pg_roles WHERE rolname = 'supabase_realtime_admin'\) THEN\n[\s\S]*?\nEND \$\$;\n/m;

/** El volcado con la adaptación de roles (arriba). Lanza si el volcado ya no
 *  tiene la forma que se adapta: un Supabase nuevo se mira antes de aplicarlo. */
export function realtimeSchemaSql(devRole: string): string {
  if (!DEV_ROLE_RE.test(devRole)) throw new Error(`rol de desarrollador no válido: ${devRole}`);
  if (!ROLE_BLOCK_RE.test(REALTIME_DUMP_SQL)) throw new Error("el volcado de realtime ya no empieza por su bloque de roles");
  return REALTIME_DUMP_SQL.replace(ROLE_BLOCK_RE, "")
    .split("\n")
    .filter((line) => !/\bdashboard_user\b/.test(line))
    .map((line) => (/^SET [a-z_]+ = /.test(line) ? line.replace(/^SET /, "SET LOCAL ") : line))
    .join("\n")
    .replace("SELECT pg_catalog.set_config('search_path', '', false);", "SELECT pg_catalog.set_config('search_path', '', true);")
    .replace(/ OWNER TO supabase_admin;/g, " OWNER TO CURRENT_USER;")
    // Su `GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin` va al FINAL
    // del volcado; antes, cada `ALTER … OWNER TO supabase_realtime_admin` pide
    // que el nuevo dueño pueda crear en el esquema (un superusuario no lo nota).
    // El mismo permiso, adelantado.
    .replace(
      "ALTER SCHEMA realtime OWNER TO CURRENT_USER;",
      "ALTER SCHEMA realtime OWNER TO CURRENT_USER;\nGRANT USAGE, CREATE ON SCHEMA realtime TO supabase_realtime_admin;",
    )
    .replace(/ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin /g, "ALTER DEFAULT PRIVILEGES ")
    .replace(/\bTO postgres\b/g, `TO ${devRole}`);
}

/** Monta el esquema `realtime` en la base de UN proyecto, conectados como su
 *  dueño (el administrador del clúster), dentro de una transacción (los `SET
 *  LOCAL` del volcado). El rol de desarrollador y los de
 *  REALTIME_CLUSTER_ROLES_SQL ya existen. Idempotente. */
export async function initRealtimeSchema(db: SqlRunner, opts: { devRole: string }): Promise<void> {
  const dev = opts.devRole;
  const sql = realtimeSchemaSql(dev);
  const ready = await db.query(`select to_regclass('realtime.subscription') is not null as ok`);
  if (ready.rows[0]?.ok === true) return;

  await db.exec(sql);

  // Su init-script (00000000000003-post-setup.sql) crea la publicación de
  // `postgres`: aquí del desarrollador, para que su migración haga
  // `alter publication supabase_realtime add table …`, como en su documentación.
  await db.exec(`
    do $$ begin
      if not exists (select from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
      end if;
    end $$;
    alter publication supabase_realtime owner to ${dev};
  `);

  // Como storage con `supabase_storage_admin`: hereda el ser dueño (políticas
  // en realtime.messages, los canales privados) y NO puede `set role`.
  // `authenticator` usa el esquema: `apply_rls` vuelve al usuario de la sesión
  // (`set_config('role', null)`) y sigue con sus tipos y funciones (es
  // NOINHERIT: no le llega el USAGE de anon), y es el pool del servicio (ver la
  // decisión de `list_changes` partida en d-tiempo-real.md). Las suscripciones
  // NO hace falta que las lea: `apply_rls` las lee en su DECLARE, aún como
  // `supabase_realtime_admin`. Medido con production-roles.pglite.test.ts.
  await db.exec(`
    grant supabase_realtime_admin to ${dev} with inherit true, set false;
    grant usage on schema realtime to authenticator;
  `);
}
