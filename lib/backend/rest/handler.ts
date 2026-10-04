// /rest/v1: lo que hace PostgREST con una petición, para la base de UN
// proyecto (plans/pages-backend/design.md). Porte de su Plan/Query/Response
// (v16.4) en lo que supabase-js usa; los recursos embebidos llegan en la fase 4.
//
// Todo corre en UNA transacción con el rol de la petición (`set_config('role',
// …, true)`) y sus claims (`request.jwt.claims`), como PostgREST: las políticas
// RLS las hace cumplir Postgres, no este código.

import { RollbackWith, transactionOrRollback, type ProjectDatabase, type TxQuery } from "../db";
import { fromPgError, PostgrestError } from "./errors";
import { parseQueryString, type ParsedQuery } from "./parse";
import { buildReadPlan, countSql, readSql, rootConditions, rootRange, type PlanSource } from "./read-plan";
import { parsePreferences, preferenceApplied, shouldCount, type Preferences } from "./preferences";
import {
  closestName,
  findFunctions,
  findTable,
  listFunctionNames,
  listTableNames,
  type ColumnInfo,
  type FunctionInfo,
  type TableInfo,
} from "./schema-cache";
import { ident, jsonBodySql, Params, qualified } from "./sql";

export type ApiRole = "anon" | "authenticated" | "service_role";

export interface RestContext {
  readonly db: ProjectDatabase;
  readonly role: ApiRole;
  readonly claims: Record<string, unknown>;
}

/** Los esquemas que se exponen. Supabase expone también `graphql_public`, que
 *  aquí no existe. */
const EXPOSED_SCHEMAS = ["public"] as const;

/** Los `statement_timeout` de los roles, del arranque de Supabase. PostgREST
 *  los aplica al cambiar de rol («impersonated role settings»). */
const ROLE_TIMEOUT: Record<ApiRole, string | null> = { anon: "3s", authenticated: "8s", service_role: null };

type Media =
  | { kind: "json"; strip: boolean; contentType: string }
  | { kind: "object"; strip: boolean; contentType: string }
  | { kind: "csv"; contentType: string };

function negotiate(accept: string | null): Media {
  const options = (accept ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (options.length === 0) return { kind: "json", strip: false, contentType: "application/json; charset=utf-8" };
  for (const raw of options) {
    const [type, ...params] = raw.split(";").map((s) => s.trim());
    const strip = params.includes("nulls=stripped");
    if (type === "application/json" || type === "*/*" || type === "application/*") {
      return { kind: "json", strip: false, contentType: "application/json; charset=utf-8" };
    }
    if (type === "application/vnd.pgrst.array+json") {
      return { kind: "json", strip, contentType: `application/vnd.pgrst.array+json${strip ? ";nulls=stripped" : ""}; charset=utf-8` };
    }
    if (type === "application/vnd.pgrst.object+json") {
      return { kind: "object", strip, contentType: `application/vnd.pgrst.object+json${strip ? ";nulls=stripped" : ""}; charset=utf-8` };
    }
    if (type === "text/csv") return { kind: "csv", contentType: "text/csv; charset=utf-8" };
  }
  throw new PostgrestError(406, {
    code: "PGRST107",
    message: `None of these media types are available: ${options.join(", ")}`,
    details: null,
    hint: null,
  });
}

function bodyFor(media: Media, scalar: "row" | "scalar" | "scalarSet" = "row"): string {
  if (media.kind === "csv") {
    return (
      `(SELECT coalesce(string_agg(a.k, ','), '') FROM (SELECT json_object_keys(r)::text as k FROM ( SELECT row_to_json(hh) as r from pgrst_source as hh limit 1) s) a)` +
      ` || '\n' || coalesce(string_agg(substring(_postgrest_t::text, 2, length(_postgrest_t::text) - 2), '\n'), '')`
    );
  }
  const strip = (s: string) => (media.strip ? `json_strip_nulls(${s})` : s);
  const agg = scalar === "row" ? "json_agg(_postgrest_t)" : "json_agg(_postgrest_t.pgrst_scalar)";
  if (media.kind === "object" || scalar === "scalar") return `coalesce(${strip(`${agg}->0`)}, 'null')`;
  return `coalesce(${strip(agg)}, '[]')`;
}

/** `contentRangeH`. */
function contentRange(lower: number, upper: number, total: number | null): string {
  const totalStr = total === null ? "*" : String(total);
  return total !== 0 && lower <= upper ? `${lower}-${upper}/${totalStr}` : `*/${totalStr}`;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(e: PostgrestError): Response {
  return json(e.body, e.status, e.headers);
}

interface RunResult {
  total: number | null;
  pageTotal: number;
  body: string;
  inserted: number | null;
  gucStatus: string | null;
  gucHeaders: string | null;
}

async function setupTransaction(q: TxQuery, req: Request, path: string, ctx: RestContext, readOnly: boolean) {
  if (readOnly) await q("SET TRANSACTION READ ONLY");
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  await q(
    `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true),
            set_config('request.method', $3, true), set_config('request.path', $4, true),
            set_config('request.headers', $5, true)`,
    [ctx.role, JSON.stringify(ctx.claims), req.method, path, JSON.stringify(headers)],
  );
  const timeout = ROLE_TIMEOUT[ctx.role];
  if (timeout) await q(`select set_config('statement_timeout', $1, true)`, [timeout]);
}

async function run(q: TxQuery, sql: string, params: Params): Promise<RunResult> {
  const r = await q(sql, params.values);
  const row = r.rows[0] ?? {};
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    total: n(row.total_result_set),
    pageTotal: n(row.page_total) ?? 0,
    body: typeof row.body === "string" ? row.body : row.body === null || row.body === undefined ? "" : JSON.stringify(row.body),
    inserted: n(row.response_inserted),
    gucStatus: (row.response_status as string | null) ?? null,
    gucHeaders: (row.response_headers as string | null) ?? null,
  };
}

const RESPONSE_GUCS =
  `nullif(current_setting('response.headers', true), '') AS response_headers, ` +
  `nullif(current_setting('response.status', true), '') AS response_status`;

/** `response.status` / `response.headers` que una función puede poner. */
function applyGucs(r: RunResult, status: number, headers: Record<string, string>): number {
  if (r.gucHeaders) {
    try {
      for (const obj of JSON.parse(r.gucHeaders) as Record<string, string>[]) Object.assign(headers, obj);
    } catch {
      throw new PostgrestError(500, {
        code: "PGRST111",
        message: "response.headers guc must be a JSON array composed of objects with a single key and a string value",
        details: null,
        hint: null,
      });
    }
  }
  if (r.gucStatus) {
    const s = Number(r.gucStatus);
    if (!Number.isInteger(s) || s < 100 || s > 599) {
      throw new PostgrestError(500, { code: "PGRST112", message: "response.status guc must be a valid status code", details: null, hint: null });
    }
    return s;
  }
  return status;
}

function singularity(n: number): PostgrestError {
  return new PostgrestError(406, {
    code: "PGRST116",
    message: "Cannot coerce the result to a single JSON object",
    details: `The result contains ${n} rows`,
    hint: null,
  });
}

async function tableOr404(q: TxQuery, schema: string, name: string): Promise<TableInfo> {
  const t = await findTable(q, schema, name);
  if (t) return t;
  const close = closestName(name, await listTableNames(q, schema));
  throw new PostgrestError(404, {
    code: "PGRST205",
    message: `Could not find the table '${schema}.${name}' in the schema cache`,
    details: null,
    hint: close ? `Perhaps you meant the table '${schema}.${close}'` : null,
  });
}

// ─── Lecturas ───────────────────────────────────────────────────────────────

function tableSource(table: TableInfo, fromSql?: string): PlanSource {
  return { name: table.name, fromSql: fromSql ?? qualified(table.schema, table.name).sql, alias: table.name, columns: table.columns };
}

async function read(q: TxQuery, table: TableInfo, qs: ParsedQuery, prefs: Preferences, media: Media) {
  const p = new Params();
  const plan = await buildReadPlan(q, table.schema, tableSource(table), qs);
  const range = rootRange(plan);
  const source = readSql(plan, plan.root, p);
  const counting = shouldCount(prefs);
  const ranged = range !== undefined && (range.limit !== null || range.offset > 0);
  const countCte = counting && ranged ? `, pgrst_source_count AS (${countSql(plan, plan.root, p)})` : "";
  const total = counting ? (ranged ? "(SELECT pg_catalog.count(*) FROM pgrst_source_count)" : "pg_catalog.count(_postgrest_t)") : "null::bigint";
  const sql =
    `WITH pgrst_source AS ( ${source} ) ${countCte} SELECT ${total} AS total_result_set, ` +
    `pg_catalog.count(_postgrest_t) AS page_total, (${bodyFor(media)})::text AS body, ${RESPONSE_GUCS} ` +
    `FROM ( SELECT * FROM pgrst_source ) _postgrest_t`;
  return { result: await run(q, sql, p), offset: range?.offset ?? 0 };
}

// ─── Escrituras ─────────────────────────────────────────────────────────────

function parseBody(text: string): { value: unknown; isObject: boolean } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PostgrestError(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null });
  }
  if (value === null || typeof value !== "object") {
    throw new PostgrestError(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null });
  }
  return { value, isObject: !Array.isArray(value) };
}

/** Las columnas del cuerpo: las de `columns=` o las claves (todas iguales en
 *  un array). Una que la tabla no tiene es PGRST204. */
function payloadColumns(value: unknown, isObject: boolean, qs: ParsedQuery, table: TableInfo): ColumnInfo[] {
  let names: string[];
  if (qs.columns) names = qs.columns;
  else if (isObject) names = Object.keys(value as object);
  else {
    const rows = value as Record<string, unknown>[];
    const first = rows[0] ? Object.keys(rows[0]).sort() : [];
    for (const r of rows) {
      const keys = r && typeof r === "object" ? Object.keys(r).sort() : null;
      if (!keys || keys.join("\u0000") !== first.join("\u0000")) {
        throw new PostgrestError(400, { code: "PGRST102", message: "All object keys must match", details: null, hint: null });
      }
    }
    names = rows[0] ? Object.keys(rows[0]) : [];
  }
  return names.map((n) => {
    const c = table.columns.find((col) => col.name === n);
    if (!c) {
      throw new PostgrestError(400, {
        code: "PGRST204",
        message: `Could not find the '${n}' column of '${table.name}' in the schema cache`,
        details: null,
        hint: null,
      });
    }
    return c;
  });
}

/** Las filas que devuelve una escritura: el plan sobre `pgrst_source`, con sus
 *  embebidos; los filtros de la raíz ya fueron los de la escritura. */
async function returnedRows(q: TxQuery, table: TableInfo, qs: ParsedQuery, p: Params, representation: boolean): Promise<string> {
  if (!representation) return "SELECT * FROM pgrst_source";
  const plan = await buildReadPlan(q, table.schema, tableSource(table, "pgrst_source"), qs);
  return readSql(plan, plan.root, p, { skipConditions: true });
}

async function insert(q: TxQuery, table: TableInfo, qs: ParsedQuery, prefs: Preferences, media: Media, bodyText: string) {
  const qi = qualified(table.schema, table.name);
  const { value, isObject } = parseBody(bodyText || "{}");
  const cols = payloadColumns(value, isObject, qs, table);
  const p = new Params();
  const representation = prefs.representation === "representation";
  const merge = prefs.resolution === "merge-duplicates";
  const conflictCols = prefs.resolution ? (qs.onConflict ?? table.pk) : [];
  const inc = `set_config('pgrst.inserted', (coalesce(nullif(current_setting('pgrst.inserted', true),'')::int, 0) + 1)::text, true) <> '0'`;
  const dec = `set_config('pgrst.inserted', (coalesce(nullif(current_setting('pgrst.inserted', true),'')::int, 0) - 1)::text, true) <> '-1'`;
  let onConflict = "";
  if (prefs.resolution && conflictCols.length > 0) {
    onConflict =
      ` ON CONFLICT(${conflictCols.map(ident).join(", ")}) ` +
      (prefs.resolution === "ignore-duplicates" || cols.length === 0
        ? "DO NOTHING"
        : `DO UPDATE SET ${cols.map((c) => `${ident(c.name)} = EXCLUDED.${ident(c.name)}`).join(", ")} WHERE ${dec}`);
  }
  const mutation =
    `INSERT INTO ${qi.sql}${cols.length > 0 ? `(${cols.map((c) => ident(c.name)).join(", ")})` : ""} ` +
    jsonBodySql(JSON.stringify(value), isObject, cols, p, { includeSelect: true, limitOne: false, withDefaults: prefs.missing === "default" }) +
    (merge ? `WHERE ${inc}` : "") +
    onConflict +
    ` RETURNING ${representation ? `${qi.sql}.*` : "1"}`;
  const sql =
    `WITH pgrst_source AS (${mutation}) SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, ` +
    `${representation ? `(${bodyFor(media)})::text` : "''"} AS body, ${RESPONSE_GUCS}, ` +
    `${merge ? "nullif(current_setting('pgrst.inserted', true),'')::int" : "''"} AS response_inserted ` +
    `FROM (${await returnedRows(q, table, qs, p, representation)}) _postgrest_t`;
  return run(q, sql, p);
}

function requireWhere(kind: "UPDATE" | "DELETE", where: string[]): void {
  // Supabase carga pg-safeupdate: un UPDATE o un DELETE sin WHERE es un error,
  // y PostgREST lo devuelve como 400 (`mapSQLtoHTTP`, el caso de "21000").
  if (where.length === 0) {
    throw new PostgrestError(400, { code: "21000", message: `${kind} requires a WHERE clause`, details: null, hint: null });
  }
}

async function update(q: TxQuery, table: TableInfo, qs: ParsedQuery, prefs: Preferences, media: Media, bodyText: string) {
  const qi = qualified(table.schema, table.name);
  const { value, isObject } = parseBody(bodyText || "{}");
  const cols = payloadColumns(value, isObject, qs, table);
  const p = new Params();
  const where = rootConditions(await buildReadPlan(q, table.schema, tableSource(table), qs), p);
  const representation = prefs.representation === "representation";
  let mutation: string;
  if (cols.length === 0) {
    mutation = `SELECT ${representation ? `${ident(table.name)}.*` : "NULL"} FROM ${qi.sql} AS ${ident(table.name)} WHERE false`;
  } else {
    requireWhere("UPDATE", where);
    mutation =
      `UPDATE ${qi.sql} SET ${cols.map((c) => `${ident(c.name)} = pgrst_body.${ident(c.name)}`).join(", ")} ` +
      jsonBodySql(JSON.stringify(value), isObject, cols, p, { includeSelect: false, limitOne: false, withDefaults: prefs.missing === "default" }) +
      ` WHERE ${where.join(" AND ")} RETURNING ${representation ? `${qi.sql}.*` : "1"}`;
  }
  const sql =
    `WITH pgrst_source AS (${mutation}) SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, ` +
    `${representation ? `(${bodyFor(media)})::text` : "''"} AS body, ${RESPONSE_GUCS}, '' AS response_inserted ` +
    `FROM (${await returnedRows(q, table, qs, p, representation)}) _postgrest_t`;
  return run(q, sql, p);
}

async function remove(q: TxQuery, table: TableInfo, qs: ParsedQuery, prefs: Preferences, media: Media) {
  const qi = qualified(table.schema, table.name);
  const p = new Params();
  const where = rootConditions(await buildReadPlan(q, table.schema, tableSource(table), qs), p);
  requireWhere("DELETE", where);
  const representation = prefs.representation === "representation";
  const mutation = `DELETE FROM ${qi.sql} WHERE ${where.join(" AND ")} RETURNING ${representation ? `${qi.sql}.*` : "1"}`;
  const sql =
    `WITH pgrst_source AS (${mutation}) SELECT '' AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, ` +
    `${representation ? `(${bodyFor(media)})::text` : "''"} AS body, ${RESPONSE_GUCS}, '' AS response_inserted ` +
    `FROM (${await returnedRows(q, table, qs, p, representation)}) _postgrest_t`;
  return run(q, sql, p);
}

// ─── RPC ────────────────────────────────────────────────────────────────────

async function chooseFunction(q: TxQuery, schema: string, name: string, keys: readonly string[]): Promise<FunctionInfo> {
  const fns = await findFunctions(q, schema, name);
  const matches = fns.filter((f) => {
    const single = f.params.length === 1 && f.params[0]!.name === "" && ["json", "jsonb"].includes(f.params[0]!.type);
    if (single) return true;
    const names = new Set(f.params.map((x) => x.name));
    return keys.every((k) => names.has(k)) && f.params.every((x) => x.hasDefault || keys.includes(x.name));
  });
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new PostgrestError(300, {
      code: "PGRST203",
      message: `Could not choose the best candidate function between: ${matches
        .map((f) => `${schema}.${name}(${f.params.map((x) => `${x.name} => ${x.type}`).join(", ")})`)
        .join(", ")}`,
      details: null,
      hint: "Try renaming the parameters or the function itself in the database so function overloading can be resolved",
    });
  }
  const prms = keys.join(", ");
  const close = fns.length === 0 ? closestName(name, await listFunctionNames(q, schema)) : null;
  throw new PostgrestError(404, {
    code: "PGRST202",
    message: `Could not find the function ${schema}.${name}${keys.length === 0 ? " without parameters" : `(${prms})`} in the schema cache`,
    details:
      `Searched for the function ${schema}.${name}` +
      (keys.length === 0 ? " without parameters" : ` with parameter${keys.length > 1 ? "s " : " "}${prms}`) +
      " or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
    hint: close ? `Perhaps you meant to call the function ${schema}.${close}` : null,
  });
}

async function callRpc(
  q: TxQuery,
  schema: string,
  fn: FunctionInfo,
  args: { kind: "json"; value: Record<string, unknown> } | { kind: "direct"; value: [string, string][] },
  qs: ParsedQuery,
  prefs: Preferences,
  media: Media,
) {
  const p = new Params();
  const fnQi = qualified(schema, fn.name).sql;
  const single = fn.params.length === 1 && fn.params[0]!.name === "" && ["json", "jsonb"].includes(fn.params[0]!.type);
  let fromCall: string;
  const callIt = (argument: string) =>
    fn.returnsScalar ? `(SELECT ${fnQi}(${argument}) pgrst_scalar) pgrst_call` : `${fnQi}(${argument}) pgrst_call`;
  if (single) {
    fromCall = `FROM ${callIt(`${p.add(JSON.stringify(args.kind === "json" ? args.value : Object.fromEntries(args.value)))}::${fn.params[0]!.type}`)}`;
  } else if (args.kind === "direct") {
    const named = fn.params
      .filter((x) => args.value.some(([k]) => k === x.name))
      .map((x) => `${x.variadic ? "VARIADIC " : ""}${ident(x.name)} := ${p.add(args.value.find(([k]) => k === x.name)![1])}::${x.type}`);
    fromCall = `FROM ${callIt(named.join(", "))}`;
  } else {
    const used = fn.params.filter((x) => x.name in args.value);
    if (used.length === 0) fromCall = `FROM ${callIt("")}`;
    else {
      const cols = used.map((x) => ({ name: x.name, type: x.type, default: null, nullable: true }));
      fromCall =
        jsonBodySql(JSON.stringify(args.value), true, cols, p, { includeSelect: false, limitOne: true, withDefaults: false }) +
        `, LATERAL ${callIt(used.map((x) => `${x.variadic ? "VARIADIC " : ""}${ident(x.name)} := pgrst_body.${ident(x.name)}`).join(", "))}`;
    }
  }
  const call = `SELECT ${fn.returnsScalar ? "pgrst_call.pgrst_scalar" : "*"} ${fromCall}`;
  let rowsSql: string;
  if (fn.returnsScalar) {
    rowsSql = `SELECT * FROM pgrst_source`;
  } else {
    const plan = await buildReadPlan(q, schema, { name: fn.name, fromSql: "pgrst_source", alias: fn.name, columns: [] }, qs);
    rowsSql = readSql(plan, plan.root, p);
  }
  const scalarKind = fn.returnsScalar ? (fn.returnsSet ? "scalarSet" : "scalar") : "row";
  const singleRow = !fn.returnsSet && !fn.returnsScalar;
  const body = singleRow && media.kind !== "csv" ? `coalesce(json_agg(_postgrest_t)->0, 'null')` : bodyFor(media, scalarKind);
  const counting = shouldCount(prefs);
  const sql =
    `WITH pgrst_source AS (${call}) SELECT ${counting ? "pg_catalog.count(_postgrest_t)" : "null::bigint"} AS total_result_set, ` +
    `${fn.returnsSet ? "pg_catalog.count(_postgrest_t)" : "1"} AS page_total, (${body})::text AS body, ${RESPONSE_GUCS}, '' AS response_inserted ` +
    `FROM (${rowsSql}) _postgrest_t`;
  return run(q, sql, p);
}

// ─── Entrada ────────────────────────────────────────────────────────────────

export async function handleRest(req: Request, subpath: string, ctx: RestContext): Promise<Response> {
  try {
    return await handle(req, subpath, ctx);
  } catch (err) {
    if (err instanceof PostgrestError) return errorResponse(err);
    return errorResponse(fromPgError(err, ctx.role !== "anon"));
  }
}

async function handle(req: Request, subpath: string, ctx: RestContext): Promise<Response> {
  const url = new URL(req.url);
  const segments = subpath.split("/").filter(Boolean).map(decodeURIComponent);
  const method = req.method.toUpperCase();
  const isRead = method === "GET" || method === "HEAD";

  if (segments.length === 0) {
    throw new PostgrestError(404, { code: "PGRST126", message: "Root endpoint metadata is disabled", details: null, hint: null });
  }
  const isRpc = segments[0] === "rpc" && segments.length === 2;
  if (!isRpc && segments.length !== 1) {
    throw new PostgrestError(404, { code: "PGRST125", message: "Invalid path specified in request URL", details: null, hint: null });
  }

  const profile = req.headers.get(isRead ? "accept-profile" : "content-profile");
  const schema = profile ?? "public";
  if (!(EXPOSED_SCHEMAS as readonly string[]).includes(schema)) {
    throw new PostgrestError(406, {
      code: "PGRST106",
      message: `Invalid schema: ${schema}`,
      details: null,
      hint: `Only the following schemas are exposed: ${EXPOSED_SCHEMAS.join(", ")}`,
    });
  }

  const media = negotiate(req.headers.get("accept"));
  const prefs = parsePreferences(req.headers);
  if (prefs.handling === "strict" && prefs.invalid.length > 0) {
    throw new PostgrestError(400, {
      code: "PGRST122",
      message: "Invalid preferences given with handling=strict",
      details: `Invalid preferences: ${prefs.invalid.join(", ")}`,
      hint: null,
    });
  }
  const applied = preferenceApplied(prefs);
  const baseHeaders = (): Record<string, string> => ({ ...(applied ? { "Preference-Applied": applied } : {}) });
  const bodyText = isRead || method === "DELETE" ? "" : await req.text();

  if (isRpc) {
    const name = segments[1]!;
    if (!["GET", "HEAD", "POST"].includes(method)) {
      throw new PostgrestError(405, { code: "PGRST101", message: `Cannot use the ${method} method on RPC`, details: null, hint: null });
    }
    const qs = parseQueryString(url.search, { isRpcRead: isRead });
    let args: { kind: "json"; value: Record<string, unknown> } | { kind: "direct"; value: [string, string][] };
    if (isRead) args = { kind: "direct", value: qs.rpcParams };
    else {
      const { value, isObject } = parseBody(bodyText || "{}");
      if (!isObject) throw new PostgrestError(400, { code: "PGRST102", message: "Empty or invalid json", details: null, hint: null });
      args = { kind: "json", value: value as Record<string, unknown> };
    }
    return transactionOrRollback(ctx.db, async (q) => {
      await setupTransaction(q, req, url.pathname, ctx, isRead);
      const keys = args.kind === "json" ? Object.keys(args.value) : args.value.map(([k]) => k);
      const fn = await chooseFunction(q, schema, name, keys);
      if (isRead && fn.volatility === "v") {
        throw new PostgrestError(405, { code: "PGRST101", message: `Cannot use the ${method} method on RPC`, details: null, hint: null });
      }
      const r = await callRpc(q, schema, fn, args, qs, prefs, media);
      const headers = baseHeaders();
      if (fn.returnsVoid) {
        headers["Content-Range"] = contentRange(0, r.pageTotal - 1, r.total);
        return new Response(null, { status: applyGucs(r, 204, headers), headers });
      }
      if (media.kind === "object" && fn.returnsSet && r.pageTotal !== 1) throw singularity(r.pageTotal);
      const offset = qs.ranges[""]?.offset ?? 0;
      headers["Content-Range"] = contentRange(offset, offset + r.pageTotal - 1, r.total);
      headers["Content-Type"] = media.contentType;
      const status = applyGucs(r, 200, headers);
      return new Response(method === "HEAD" ? null : r.body, { status, headers });
    });
  }

  const tableName = segments[0]!;
  const qs = parseQueryString(url.search);

  if (isRead) {
    return transactionOrRollback(ctx.db, async (q) => {
      await setupTransaction(q, req, url.pathname, ctx, true);
      const table = await tableOr404(q, schema, tableName);
      const { result: r, offset } = await read(q, table, qs, prefs, media);
      if (media.kind === "object" && r.pageTotal !== 1) throw singularity(r.pageTotal);
      const upper = offset + r.pageTotal - 1;
      const headers = baseHeaders();
      headers["Content-Range"] = contentRange(offset, upper, r.total);
      headers["Content-Location"] = `/${tableName}${url.search}`;
      headers["Content-Type"] = media.contentType;
      let status = 200;
      if (r.total !== null) {
        if (offset > r.total) status = 416;
        else if (1 + upper - offset < r.total) status = 206;
      }
      if (status === 416) {
        return json(
          {
            code: "PGRST103",
            message: "Requested range not satisfiable",
            details: `An offset of ${offset} was requested, but there are only ${r.total} rows.`,
            hint: null,
          },
          416,
          { "Content-Range": headers["Content-Range"]! },
        );
      }
      status = applyGucs(r, status, headers);
      return new Response(method === "HEAD" ? null : r.body, { status, headers });
    });
  }

  if (method === "POST" || method === "PATCH" || method === "DELETE") {
    return transactionOrRollback(ctx.db, async (q) => {
      await setupTransaction(q, req, url.pathname, ctx, false);
      const table = await tableOr404(q, schema, tableName);
      const r =
        method === "POST"
          ? await insert(q, table, qs, prefs, media, bodyText)
          : method === "PATCH"
            ? await update(q, table, qs, prefs, media, bodyText)
            : await remove(q, table, qs, prefs, media);
      const representation = prefs.representation === "representation";
      if (representation && media.kind === "object" && r.pageTotal !== 1) throw new RollbackWith(errorResponse(singularity(r.pageTotal)));
      if (prefs.handling === "strict" && prefs.maxAffected !== undefined && method !== "POST" && r.pageTotal > prefs.maxAffected) {
        throw new RollbackWith(
          errorResponse(
            new PostgrestError(400, {
              code: "PGRST124",
              message: "Query result exceeds max-affected preference constraint",
              details: `The query affects ${r.pageTotal} rows`,
              hint: null,
            }),
          ),
        );
      }
      const headers = baseHeaders();
      const total = shouldCount(prefs) ? r.pageTotal : null;
      headers["Content-Range"] = method === "PATCH" ? contentRange(0, r.pageTotal - 1, total) : contentRange(1, 0, total);
      let status: number;
      if (method === "POST") status = prefs.resolution === "merge-duplicates" && (r.inserted ?? 0) <= 0 ? 200 : 201;
      else status = representation ? 200 : 204;
      if (representation) headers["Content-Type"] = media.contentType;
      status = applyGucs(r, status, headers);
      return new Response(representation ? r.body : null, { status, headers });
    });
  }

  throw new PostgrestError(405, { code: "PGRST117", message: `Unsupported HTTP method: ${method}`, details: null, hint: null });
}
