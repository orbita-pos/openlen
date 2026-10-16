// lib/security-review/schema-dump.ts — what the draft database lets the public
// key do: each table of `public` with its RLS switch, every policy of `public`
// and `storage` written out, and the Storage buckets. Read straight from the
// catalog, in one transaction (spec local 2026-10-15-security-review-design, 4.2).
// Every table of `public` is granted to anon and authenticated
// (lib/backend/schema.ts), so RLS and its policies are the only boundary.

import type { BackendProject } from "@/lib/backend/router";

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

const BUCKETS_PRESENT_SQL = `select to_regclass('storage.buckets') is not null as present`;
const BUCKETS_SQL = `select id, public from storage.buckets order by id`;

const COMMANDS: Readonly<Record<string, PolicyCommand>> = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" };

const asJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
const textOrNull = (v: unknown): string | null => (v == null ? null : String(v));

export async function dumpSchema(project: BackendProject): Promise<SchemaDump> {
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
    const present = (await q(BUCKETS_PRESENT_SQL)).rows[0]?.present === true;
    const buckets: BucketDump[] = present
      ? (await q(BUCKETS_SQL)).rows.map((r) => ({ id: String(r.id), public: r.public === true }))
      : [];
    return { tables, policies, buckets };
  });
}
