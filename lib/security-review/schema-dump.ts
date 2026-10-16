// lib/security-review/schema-dump.ts — what the draft database lets the public
// key do: each table of `public` with its RLS switch, every policy of `public`
// and `storage` written out, and the Storage buckets. Read straight from the
// catalog, in one transaction (spec local 2026-10-15-security-review-design, 4.2).
// Every table of `public` is granted to anon and authenticated
// (lib/backend/schema.ts), so RLS and its policies are the only boundary.

import type { BackendProject } from "@/lib/backend/router";
import { listStorageBuckets } from "@/lib/backend/storage/dashboard";

import type { BucketDump, PolicyCommand, PolicyDump, SchemaDump, TableDump } from "./types";

const TABLES_SQL = `
select c.relname as name, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname`;

// `polroles` holds 0 for PUBLIC; `pg_get_expr` gives the expression back as Postgres keeps it.
const POLICIES_SQL = `
select n.nspname as schema, c.relname as table_name, p.polname as name, p.polcmd::text as cmd,
       p.polpermissive as permissive,
       coalesce((select json_agg(case when r = 0 then 'public' else pg_get_userbyid(r)::text end order by r)
                   from unnest(p.polroles) as r), '[]'::json) as roles,
       pg_get_expr(p.polqual, p.polrelid) as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'storage')
 order by n.nspname, c.relname, p.polname`;

const COMMANDS: Readonly<Record<string, PolicyCommand>> = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" };

const asJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const textOrNull = (v: unknown): string | null => (v == null ? null : String(v));

// The catalog is readable by any role, so tables and policies are read with the
// project database's own connection (`authenticator` in production). The
// `storage` schema is not: the buckets come from the owner's panel reader,
// which reads as service_role, and a project without Storage answers none.
export async function dumpSchema(project: BackendProject): Promise<SchemaDump> {
  const { tables, policies } = await readCatalog(project);
  const buckets: BucketDump[] = await listStorageBuckets(project)
    .then((all) => all.map((b) => ({ id: b.id, public: b.public })))
    .catch(() => []);
  return { tables, policies, buckets };
}

async function readCatalog(project: BackendProject): Promise<Pick<SchemaDump, "tables" | "policies">> {
  return project.db.transaction(async (q) => {
    const tables: TableDump[] = (await q(TABLES_SQL)).rows.map((r) => ({ name: String(r.name), rls: r.rls === true }));
    const policies: PolicyDump[] = (await q(POLICIES_SQL)).rows.map((r) => ({
      schema: String(r.schema),
      table: String(r.table_name),
      name: String(r.name),
      command: COMMANDS[String(r.cmd)] ?? "ALL",
      permissive: r.permissive !== false,
      roles: (asJson(r.roles) as string[] | null) ?? [],
      using: textOrNull(r.using_expr),
      withCheck: textOrNull(r.check_expr),
    }));
    return { tables, policies };
  });
}
