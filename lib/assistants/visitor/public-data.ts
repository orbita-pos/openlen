// WHAT THE PAGE'S DATA SHOWS ANYONE (spec local 2026-11-06-asistente-propio, §4.2; phase 2B): read at publish from
// PRODUCTION's catalog — never the draft — with the environment's read-only role (lib/backend/live-read.ts), and kept
// with what she knows (`assistantProjects.publicData`). It is the list `read_public_data` may read, and what the
// visitor prompt describes; fixed until the next publish, so every visitor of the business shares one cached prefix.
//
// "Anyone" = the `anon` role (the publishable key): every table of `public` is granted to it (lib/backend/schema.ts),
// so what it can read is decided by RLS — a table with RLS off, or with a PERMISSIVE SELECT/ALL policy for anon or
// public — and, for a view, by its own SELECT grant (a view runs with its owner's rights).
import type { PublicTable } from "@/lib/db/schema";
import type { QueryOutcome } from "@/lib/backend/cli-core";

export const PUBLIC_DATA_MAX_TABLES = 30;
export const PUBLIC_DATA_MAX_COLUMNS = 40;

export const PUBLIC_TABLES_SQL = `
with anon as (select oid from pg_roles where rolname = 'anon')
select c.relname as table_name,
       coalesce(json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
                  filter (where a.attnum is not null), '[]'::json) as columns
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
 where n.nspname = 'public'
   and c.relkind in ('r', 'p', 'v', 'm')
   and has_table_privilege((select oid from anon), c.oid, 'SELECT')
   and (c.relkind in ('v', 'm')
        or not c.relrowsecurity
        or exists (select 1 from pg_policy p
                    where p.polrelid = c.oid and p.polpermissive and p.polcmd in ('r', '*')
                      and (0 = any(p.polroles) or (select oid from anon) = any(p.polroles))))
 group by c.relname
 order by c.relname
 limit ${PUBLIC_DATA_MAX_TABLES}`;

type Query = (projectId: string, environment: "draft" | "live", sql: string) => Promise<QueryOutcome | null>;

function columnsOf(raw: unknown): { name: string; type: string }[] {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is { name: string; type: string } => typeof c?.name === "string" && typeof c?.type === "string")
    .slice(0, PUBLIC_DATA_MAX_COLUMNS)
    .map((c) => ({ name: c.name, type: c.type }));
}

/** [] without a backend or without production (never published): she has no data. null when the read FAILS: «don't
 *  know», so the publish keeps what she had instead of wiping it (final review). */
export async function publicDataOf(projectId: string, query?: Query): Promise<PublicTable[] | null> {
  try {
    const run = query ?? (await import("@/lib/backend/live-read")).queryBackendReadOnly;
    const out = await run(projectId, "live", PUBLIC_TABLES_SQL);
    if (!out || out.kind === "no_live") return [];
    if (out.kind !== "rows") return null;
    const name = out.columns.indexOf("table_name");
    const cols = out.columns.indexOf("columns");
    return out.rows
      .slice(0, PUBLIC_DATA_MAX_TABLES)
      .map((r) => ({ name: String(r[name]), columns: columnsOf(r[cols]) }))
      .filter((t) => t.name && t.columns.length > 0);
  } catch (err) {
    console.warn("[assistants] what the page's data shows anyone couldn't be read", err);
    return null;
  }
}
