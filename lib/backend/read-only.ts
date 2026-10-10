// EL ROL DE SÓLO LECTURA DE PRODUCCIÓN (spec local 2026-10-09, sección 8):
// `supabase db query --linked` de Len entra con él. Lo hace de sólo lectura lo
// que PUEDE —SELECT y nada más—, no sólo la transacción; con BYPASSRLS ve lo
// que el dueño ve en su panel. Se crea la primera vez que Len lee producción.

import "server-only";

import { dbNameOf, readOnlyRoleOf } from "./environments";
import { withAdmin } from "./pg";
import { devRoleOf } from "./provision";
import { literal } from "./rest/sql";

export async function provisionReadOnlyRole(o: { scope: string; ref: string; password: string }): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(o.password)) throw new Error("contraseña con caracteres inesperados");
  const dbName = dbNameOf(o.scope);
  const ro = readOnlyRoleOf(o.scope);
  const dev = devRoleOf(o.ref);
  await withAdmin("postgres", async (r) => {
    const exists = await r.query(`select 1 from pg_roles where rolname = $1`, [ro]);
    if (exists.rows.length === 0) {
      await r.exec(`create role ${ro} login noinherit nosuperuser nocreatedb nocreaterole bypassrls password ${literal(o.password)};`);
    } else {
      await r.exec(`alter role ${ro} with password ${literal(o.password)};`);
    }
    await r.exec(`alter role ${ro} set default_transaction_read_only = on; grant connect on database ${dbName} to ${ro};`);
  });
  await withAdmin(dbName, (r) =>
    r.exec(
      `grant usage on schema public to ${ro}; grant select on all tables in schema public to ${ro}; alter default privileges for role ${dev} in schema public grant select on tables to ${ro};`,
    ),
  );
}
