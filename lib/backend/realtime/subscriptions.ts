// Las suscripciones de `postgres_changes`, como Supabase Realtime
// (supabase/realtime @ f86df8c3, Apache-2.0,
// lib/extensions/postgres_cdc_rls/subscriptions.ex): sus filtros con sus
// errores (`parse_subscription_params`, probado con sus doctests) y su consulta
// de alta en `realtime.subscription`, literal.
//
// Corre por el pool de `authenticator` como `supabase_realtime_admin`, el dueño
// de la tabla (en Supabase, el usuario de base de su servicio).

import type { ProjectDatabase } from "../db";

/** Sus operadores (`@filter_types`). */
const FILTER_TYPES = ["eq", "neq", "lt", "lte", "gt", "gte", "in", "like", "ilike", "is", "match", "imatch", "isdistinct"];

/** Una condición de `realtime.subscription.filters`: columna, operador, valor, negada. */
export type Filter = readonly [column: string, op: string, value: string, negate: boolean];

export interface SubscriptionParams {
  /** `*`, `INSERT`, `UPDATE` o `DELETE`. */
  readonly action: string;
  readonly schema: string;
  readonly table: string;
  readonly filters: readonly Filter[];
  readonly selectedColumns: readonly string[] | null;
}

export type ParsedParams = { readonly ok: true; readonly params: SubscriptionParams } | { readonly ok: false; readonly error: string };

/** El `inspect` de Elixir para lo que sale en sus mensajes (cadenas, listas,
 *  mapas, tuplas de filtros). */
function inspect(v: unknown): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(inspect).join(", ")}]`;
  if (typeof v === "object") {
    const entries = Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)} => ${inspect((v as Record<string, unknown>)[k])}`);
    return `%{${entries.join(", ")}}`;
  }
  return String(v);
}

/** Su `to_log`: las cadenas tal cual, lo demás con `inspect`. */
const toLog = (v: unknown): string => (typeof v === "string" ? v : inspect(v));

const filterToLog = (f: Filter) => `{${JSON.stringify(f[0])}, ${JSON.stringify(f[1])}, ${JSON.stringify(f[2])}, ${String(f[3])}}`;

/** Su `params_to_log`. */
function paramsToLog(p: SubscriptionParams): string {
  return `event: ${p.action}, schema: ${p.schema}, table: ${p.table}, filters: [${p.filters.map(filterToLog).join(", ")}], select: ${toLog(p.selectedColumns)}`;
}

function actionFilter(params: Record<string, unknown>): string {
  const event = params.event;
  if (event === "*") return "*";
  if (typeof event === "string") {
    const up = event.toUpperCase();
    if (up === "INSERT" || up === "UPDATE" || up === "DELETE") return up;
  }
  return "*";
}

/** Su `split_top_level`: comas fuera de paréntesis y de comillas. */
function splitTopLevel(filter: string): string[] {
  const acc: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  let prev = "";
  for (let i = 0; i < filter.length; i++) {
    const ch = filter[i]!;
    if (quoted) {
      if (ch === "\\" && i + 1 < filter.length) {
        const next = filter[i + 1]!;
        current += ch + next;
        prev = next;
        i++;
      } else if (ch === '"') {
        quoted = false;
        current += ch;
        prev = ch;
      } else {
        current += ch;
        prev = ch;
      }
      continue;
    }
    if (ch === '"' && (prev === "." || prev === "(" || prev === ",")) {
      quoted = true;
      current += ch;
      prev = ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
      prev = ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
      prev = ch;
    } else if (ch === "," && depth === 0) {
      acc.push(current);
      current = "";
      prev = "";
    } else {
      current += ch;
      prev = ch;
    }
  }
  acc.push(current);
  return acc;
}

/** Su `unquote_value`: `"…"` sin comillas y con sus escapes; mal cerrado, tal cual. */
function unquoteValue(value: string): string {
  if (!value.startsWith('"')) return value;
  let out = "";
  for (let i = 1; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      out += value[i + 1]!;
      i++;
    } else if (ch === '"') {
      return i === value.length - 1 ? out : value;
    } else {
      out += ch;
    }
  }
  return value;
}

function parseSegment(segment: string): { ok: true; filter: Filter } | { ok: false; error: string } {
  const trimmed = segment.trim();
  if (trimmed === "") return { ok: false, error: "filter must not contain empty segments (check for extra commas)" };
  const eq = trimmed.indexOf("=");
  if (eq < 0) return { ok: false, error: inspect([trimmed]) };
  const col = trimmed.slice(0, eq);
  let rest = trimmed.slice(eq + 1);
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot < 0) return { ok: false, error: inspect([rest]) };
  const type = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  if (!FILTER_TYPES.includes(type)) return { ok: false, error: inspect([type, value]) };
  if (type === "in") {
    if (value.length >= 2 && value.startsWith("(") && value.endsWith(")")) return { ok: true, filter: [col, type, `{${value.slice(1, -1)}}`, negate] };
    return { ok: false, error: "`in` filter value must be wrapped by parentheses" };
  }
  return { ok: true, filter: [col, type, unquoteValue(value), negate] };
}

function parseFilters(filter: string): { ok: true; filters: Filter[] } | { ok: false; error: string } {
  const trimmed = filter.trim();
  if (trimmed === "") return { ok: true, filters: [] };
  const filters: Filter[] = [];
  for (const segment of splitTopLevel(trimmed)) {
    const r = parseSegment(segment);
    if (!r.ok) return r;
    filters.push(r.filter);
  }
  return { ok: true, filters };
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** Su `parse_subscription_params`. */
export function parseSubscriptionParams(params: Record<string, unknown>): ParsedParams {
  const action = actionFilter(params);
  let selectedColumns: string[] | null = null;
  if (Array.isArray(params.select)) selectedColumns = params.select.filter(isStr);
  else if (isStr(params.select)) {
    return { ok: false, error: 'Error parsing `select` params: expected a list of column name strings, e.g. select: ["col1", "col2"]' };
  }
  const ok = (schema: string, table: string, filters: Filter[]): ParsedParams => {
    if (selectedColumns !== null && (schema === "*" || table === "*")) {
      return { ok: false, error: "Column selection is not supported for wildcard subscriptions. Provide an explicit schema and table name." };
    }
    return { ok: true, params: { action, schema, table, filters, selectedColumns } };
  };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(params, k);
  const { schema, table, filter } = params;
  if (isStr(schema) && isStr(table) && isStr(filter)) {
    const f = parseFilters(filter);
    return f.ok ? ok(schema, table, f.filters) : { ok: false, error: `Error parsing \`filter\` params: ${f.error}` };
  }
  if (isStr(schema) && isStr(table) && !has("filter")) return ok(schema, table, []);
  if (isStr(schema) && !has("table") && !has("filter")) return ok(schema, "*", []);
  if (isStr(table) && !has("schema") && !has("filter")) return ok("public", table, []);
  const shown = has("user_token") || has("auth_token") ? "<redacted>" : inspect(params);
  return { ok: false, error: `No subscription params provided. Please provide at least a \`schema\` or \`table\` to subscribe to: ${shown}` };
}

/** Un literal de array de Postgres (PGlite no convierte los arrays de JS). */
function pgArray(values: readonly (string | boolean)[]): string {
  return `{${values.map((v) => (typeof v === "boolean" ? (v ? "t" : "f") : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;
}

/** Su consulta de alta (`Subscriptions.query/5`), literal. */
const INSERT_SUBSCRIPTION = `with sub_tables as (
    select
    rr.entity
    from
    pg_publication_tables pub,
    lateral (
    select
    format('%I.%I', pub.schemaname, pub.tablename)::regclass entity
    ) rr
    where
    pub.pubname = $1
    and pub.schemaname like (case $2 when '*' then '%' else $2 end) escape ''
    and pub.tablename like (case $3 when '*' then '%' else $3 end) escape ''
 )
 insert into realtime.subscription as x(
    subscription_id,
    entity,
    filters,
    claims,
    action_filter,
    selected_columns
  )
  select
    $4::text::uuid,
    sub_tables.entity,
    (
      select coalesce(
        array_agg(row(c, o::realtime.equality_op, v, n)::realtime.user_defined_filter),
        '{}'::realtime.user_defined_filter[]
      )
      from unnest($6::text[], $7::text[], $8::text[], $9::boolean[]) as f(c, o, v, n)
    ),
    $5,
    $10,
    $11
  from
    sub_tables
    on conflict
    (subscription_id, entity, filters, action_filter, coalesce(selected_columns, '{}'))
    do update set
    claims = excluded.claims,
    created_at = now()
  returning
     id`;

/** La publicación de Supabase (su `publication` por defecto). */
export const PUBLICATION = "supabase_realtime";

export class SubscribeError extends Error {}

/** Su `Subscriptions.create`: todas o ninguna, en una transacción. */
export async function createSubscriptions(
  db: ProjectDatabase,
  list: readonly { readonly id: string; readonly claims: Record<string, unknown>; readonly params: SubscriptionParams }[],
): Promise<void> {
  await db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_realtime_admin', true)`);
    for (const s of list) {
      const p = s.params;
      let rowCount: number;
      try {
        const r = await q(INSERT_SUBSCRIPTION, [
          PUBLICATION,
          p.schema,
          p.table,
          s.id,
          JSON.stringify(s.claims),
          pgArray(p.filters.map((f) => f[0])),
          pgArray(p.filters.map((f) => f[1])),
          pgArray(p.filters.map((f) => f[2])),
          pgArray(p.filters.map((f) => f[3])),
          p.action,
          p.selectedColumns === null ? null : pgArray(p.selectedColumns),
        ]);
        rowCount = r.rows.length;
      } catch (err) {
        throw new SubscribeError(
          `Unable to subscribe to changes with given parameters. An exception happened so please check your connect parameters: [${paramsToLog(p)}]. Exception: ${(err as Error).message}`,
        );
      }
      if (rowCount === 0) {
        throw new SubscribeError(`Unable to subscribe to changes with given parameters. Please check Realtime is enabled for the given connect parameters: [${paramsToLog(p)}]`);
      }
    }
  });
}

/** Su `Subscriptions.delete_multi`. */
export async function deleteSubscriptions(db: ProjectDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (q) => {
    await q(`select set_config('role', 'supabase_realtime_admin', true)`);
    await q(`delete from realtime.subscription where subscription_id = any($1::uuid[])`, [`{${ids.join(",")}}`]);
  });
}
