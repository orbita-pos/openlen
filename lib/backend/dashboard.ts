// El panel del dueño (plans/pages-backend/design.md, fase 6): lo que hacen el
// editor de tablas y Authentication → Users de Supabase, sobre la base del
// proyecto.
//
// Las tablas van por NUESTRO /rest/v1 como `service_role`, que salta RLS: el
// editor de tablas de Supabase también ve todas las filas, porque el dueño es
// el dueño de los datos. Así no hay un segundo generador de SQL: las mismas
// reglas, los mismos errores y los mismos tipos que ve la página. Los usuarios
// van por nuestro GoTrue (invitar, borrar) y por su almacén (cerrar sesiones,
// que GoTrue no ofrece a un administrador).

import type { AuthContext } from "./auth/handler";
import { handleAuth } from "./auth/handler";
import { deleteSessions, listUsers } from "./auth/store";
import { handleRest } from "./rest/handler";
import type { BackendProject } from "./router";

export interface ColumnInfo {
  readonly name: string;
  /** Como lo escribe Postgres (`format_type`): `bigint`, `numeric(10,2)`… */
  readonly type: string;
  readonly nullable: boolean;
  readonly hasDefault: boolean;
  readonly identity: "always" | "by_default" | null;
  readonly generated: boolean;
}

export interface TableInfo {
  readonly name: string;
  readonly rls: boolean;
  readonly policies: number;
  /** Vacía si la tabla no tiene clave primaria: entonces no se cambia por fila. */
  readonly primaryKey: readonly string[];
  readonly columns: readonly ColumnInfo[];
}

export type Row = Record<string, unknown>;
type Failure = { readonly error: string };

const AUD = "authenticated";
const MAX_ROWS = 100;
const USERS_PER_PAGE = 50;

/** El contexto de GoTrue como `service_role`: lo que vale la clave secreta. */
export function serviceAuthContext(project: BackendProject): AuthContext {
  return {
    db: project.db,
    config: project.auth.config,
    sendMail: project.auth.sendMail,
    jwtSecret: project.jwtSecret,
    keyRole: "service_role",
    apikey: null,
  };
}

// ─── Tablas ─────────────────────────────────────────────────────────────────

const TABLES_SQL = `
select c.relname as name, c.relrowsecurity as rls,
  (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
  coalesce((
    select json_agg(a.attname order by k.ord)
      from pg_index i
      cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
     where i.indrelid = c.oid and i.indisprimary
  ), '[]'::json) as pk
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname`;

const COLUMNS_SQL = `
select c.relname as table_name, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
  not a.attnotnull as nullable, a.atthasdef as has_default, a.attidentity::text as identity,
  a.attgenerated::text as generated
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
 order by c.relname, a.attnum`;

const asJson = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);

export async function listTables(project: BackendProject): Promise<TableInfo[]> {
  const { tables, columns } = await project.db.transaction(async (q) => ({
    tables: (await q(TABLES_SQL)).rows,
    columns: (await q(COLUMNS_SQL)).rows,
  }));
  return tables.map((t) => ({
    name: String(t.name),
    rls: t.rls === true,
    policies: Number(t.policies),
    primaryKey: (asJson(t.pk) as string[]).map(String),
    columns: columns
      .filter((c) => c.table_name === t.name)
      .map((c) => ({
        name: String(c.name),
        type: String(c.type),
        nullable: c.nullable === true,
        hasDefault: c.has_default === true,
        identity: c.identity === "a" ? "always" : c.identity === "d" ? "by_default" : null,
        generated: typeof c.generated === "string" && c.generated !== "",
      })),
  }));
}

async function findTable(project: BackendProject, table: string): Promise<TableInfo | Failure> {
  const found = (await listTables(project)).find((t) => t.name === table);
  return found ?? { error: `table "${table}" not found in the public schema` };
}

/** Una petición a nuestro /rest/v1 como `service_role`. */
async function rest(
  project: BackendProject,
  table: string,
  query: URLSearchParams,
  init: { method: string; body?: unknown; prefer?: string },
): Promise<{ ok: true; body: unknown; total: number | null } | Failure> {
  const origin = new URL(project.auth.config.externalUrl).origin;
  const qs = query.toString();
  const req = new Request(`${origin}/rest/v1/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      ...(init.prefer ? { prefer: init.prefer } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const res = await handleRest(req, `/${table}`, { db: project.db, role: "service_role", claims: { role: "service_role" } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (body ?? {}) as { message?: string; details?: string | null };
    return { error: [e.message ?? `HTTP ${res.status}`, e.details].filter(Boolean).join(" — ") };
  }
  const range = res.headers.get("content-range");
  const total = range && /\/(\d+)$/.test(range) ? Number(/\/(\d+)$/.exec(range)![1]) : null;
  return { ok: true, body, total };
}

/** Los filtros `col=eq.valor` de la clave. El valor de `eq.` se toma tal cual
 *  (PostgREST: `pSingleVal`), así que no se entrecomilla. */
function keyFilter(table: TableInfo, key: Row): URLSearchParams | Failure {
  if (table.primaryKey.length === 0) return { error: `table "${table.name}" has no primary key: rows can't be changed one by one` };
  const q = new URLSearchParams();
  for (const col of table.primaryKey) {
    const v = key[col];
    if (v === undefined || v === null) return { error: `the primary key of "${table.name}" needs "${col}"` };
    q.set(col, `eq.${String(v)}`);
  }
  return q;
}

const SIMPLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function readRows(
  project: BackendProject,
  table: string,
  page: { offset: number; limit: number },
): Promise<{ rows: Row[]; total: number } | Failure> {
  const info = await findTable(project, table);
  if ("error" in info) return info;
  const q = new URLSearchParams({ select: "*" });
  const order = info.primaryKey.filter((c) => SIMPLE_NAME.test(c));
  if (order.length > 0 && order.length === info.primaryKey.length) q.set("order", order.map((c) => `${c}.asc`).join(","));
  q.set("limit", String(Math.max(1, Math.min(MAX_ROWS, Math.floor(page.limit)))));
  q.set("offset", String(Math.max(0, Math.floor(page.offset))));
  const r = await rest(project, table, q, { method: "GET", prefer: "count=exact" });
  if ("error" in r) return r;
  const rows = r.body as Row[];
  return { rows, total: r.total ?? rows.length };
}

export async function insertRow(project: BackendProject, table: string, values: Row): Promise<{ row: Row } | Failure> {
  const info = await findTable(project, table);
  if ("error" in info) return info;
  const r = await rest(project, table, new URLSearchParams({ select: "*" }), { method: "POST", body: values, prefer: "return=representation" });
  if ("error" in r) return r;
  return { row: (r.body as Row[])[0] ?? {} };
}

export async function updateRow(project: BackendProject, table: string, key: Row, values: Row): Promise<{ row: Row } | Failure> {
  const info = await findTable(project, table);
  if ("error" in info) return info;
  const q = keyFilter(info, key);
  if ("error" in q) return q;
  q.set("select", "*");
  const r = await rest(project, table, q, { method: "PATCH", body: values, prefer: "return=representation" });
  if ("error" in r) return r;
  const rows = r.body as Row[];
  return rows[0] ? { row: rows[0] } : { error: "that row no longer exists" };
}

export async function deleteRow(project: BackendProject, table: string, key: Row): Promise<{ ok: true } | Failure> {
  const info = await findTable(project, table);
  if ("error" in info) return info;
  const q = keyFilter(info, key);
  if ("error" in q) return q;
  const r = await rest(project, table, q, { method: "DELETE" });
  return "error" in r ? r : { ok: true };
}

// ─── Usuarios ───────────────────────────────────────────────────────────────

export interface PanelUser {
  readonly id: string;
  readonly email: string | null;
  readonly createdAt: string;
  readonly lastSignInAt: string | null;
  readonly confirmed: boolean;
  /** Invitado y sin aceptar todavía. */
  readonly invited: boolean;
  readonly banned: boolean;
}

const iso = (v: Date | string | null | undefined): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

export async function listAuthUsers(project: BackendProject, page: number): Promise<{ users: PanelUser[]; total: number }> {
  const { users, total } = await project.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    return listUsers(q, AUD, Math.max(1, Math.floor(page)), USERS_PER_PAGE);
  });
  return {
    total,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: iso(u.created_at)!,
      lastSignInAt: iso(u.last_sign_in_at),
      confirmed: Boolean(u.email_confirmed_at),
      invited: Boolean(u.invited_at) && !u.email_confirmed_at,
      banned: Boolean(u.banned_until) && new Date(u.banned_until!).getTime() > Date.now(),
    })),
  };
}

async function auth(project: BackendProject, method: string, path: string, body?: unknown): Promise<{ ok: true } | Failure> {
  const ctx = serviceAuthContext(project);
  const req = new Request(`${ctx.config.externalUrl}/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await handleAuth(req, `/${path}`, ctx);
  if (res.ok) return { ok: true };
  const e = (await res.json().catch(() => ({}))) as { msg?: string; message?: string; error_description?: string };
  return { error: e.msg ?? e.message ?? e.error_description ?? `HTTP ${res.status}` };
}

/** Lo que hace «Invite user» en Supabase: el usuario y su correo de invitación. */
export function inviteUser(project: BackendProject, email: string): Promise<{ ok: true } | Failure> {
  return auth(project, "POST", "invite", { email });
}

export function deleteAuthUser(project: BackendProject, userId: string): Promise<{ ok: true } | Failure> {
  return auth(project, "DELETE", `admin/users/${encodeURIComponent(userId)}`);
}

/** Cierra todas sus sesiones: sus refresh tokens dejan de valer y su token,
 *  que GoTrue comprueba contra `auth.sessions`, también. */
export async function signOutUser(project: BackendProject, userId: string): Promise<{ ok: true }> {
  await project.db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_auth_admin', true)`);
    await deleteSessions(q, userId, "", "global");
  });
  return { ok: true };
}
