// THE `app_rows` SOURCE (spec local 2026-11-03-len-que-avisa, §7.2): new rows of a table of the app's PRODUCTION
// base — the reservation that notifies nobody today. Read with the production read-only role (BYPASSRLS: with a
// visitor's RLS a well-locked table would return nothing), never the draft. New rows only: the keys of the tables
// Len writes are uuids that don't grow, so the cursor goes on a creation column plus the key as tie-break, both
// kept as Postgres wrote them (text) so no microsecond is lost on the way through JavaScript.
//
// SQL holds only names checked against the live schema and quoted as identifiers, and values the code produced
// (the cursor), quoted as literals. Condition values never reach SQL: the trigger matches them in TypeScript.
import "server-only";

import type { z } from "zod";

import type { QueryOutcome } from "@/lib/backend/cli-core";
import { queryLive } from "@/lib/backend/live-read";

import { appRowsParamsSchema } from "./declarations";
import { MATCHING_MAX, SourceError, type EventSource, type SourceChange, type SourceMatch } from "./types";

export interface AppRowsParams {
  readonly table: string;
  readonly created_column: string;
  /** Wake N hours after a row was created, as it is then, instead of when it is created. */
  readonly after_hours?: number;
  readonly conditions?: readonly { readonly field: string; readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists"; readonly value?: string | number }[];
}

export interface AppRowsState {
  readonly cursor: { readonly at: string; readonly key: string };
  /** The table's primary key, found at creation. */
  readonly key_column: string;
}

/** A page of new rows per check: a bulk import continues on the next check from the 200th. */
const PAGE = 200;
const BEFORE = 20;
const AT = "__openlen_at";
const KEY = "__openlen_key";
// Not `date`: rows of one day tie on it and the key's order is not arrival order (uuids), so a cursor past one
// row of the day would skip the later ones that sort before it (final review I5).
const CREATION_TYPES = new Set(["timestamp with time zone", "timestamp without time zone"]);

export const quoteIdent = (name: string): string => `"${name.replace(/\0/g, "").replace(/"/g, '""')}"`;
export const quoteLiteral = (value: string): string => `'${value.replace(/\0/g, "").replace(/'/g, "''")}'`;

const paramsSchema = appRowsParamsSchema as unknown as z.ZodType<AppRowsParams>;

/** With `after_hours`, only the rows at least that old — by Postgres's clock, the one that wrote them. An integer the
 *  schema checked (1–720), so it goes in the SQL as a number. */
function comeOfAge(params: AppRowsParams, c: string): string {
  const hours = params.after_hours;
  return typeof hours === "number" && Number.isInteger(hours) && hours > 0 ? ` AND ${c} <= now() - make_interval(hours => ${hours})` : "";
}

/** The rows of a result as objects, without the cursor's own columns. */
function objects(o: Extract<QueryOutcome, { kind: "rows" }>): Record<string, unknown>[] {
  return o.rows.map((row) => Object.fromEntries(o.columns.map((c, i) => [c, row[i]])));
}

function failed(o: QueryOutcome | null): never {
  if (o === null) throw new SourceError("no_live", "The app has no production base yet: it is created on its first publish.");
  if (o.kind === "error") {
    if (o.code === "42703") throw new SourceError("column_missing", o.message);
    if (o.code === "42P01") throw new SourceError("table_missing", o.message);
    throw new SourceError("read_failed", o.message);
  }
  throw new SourceError("read_failed", `unexpected answer: ${o.kind}`);
}

async function rowsOf(projectId: string, sql: string): Promise<Extract<QueryOutcome, { kind: "rows" }>> {
  const o = await queryLive(projectId, sql);
  if (o?.kind !== "rows") failed(o);
  return o;
}

function summaryOf(row: Record<string, unknown>, keyColumn: string): string {
  return Object.entries(row)
    .filter(([c]) => c !== keyColumn)
    .slice(0, 3)
    .map(([c, v]) => `${c}: ${v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

/** The rows whose fields equal the values. A field is a column of the table (checked against the live schema, then
 *  quoted); a value is a literal Postgres casts to that column's type, so «21:00» equals a `time` and «4» an `int`. */
async function matchingRows(projectId: string, params: AppRowsParams, match: readonly SourceMatch[]): Promise<Record<string, unknown>[]> {
  const columns = objects(
    await rowsOf(projectId, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${quoteLiteral(params.table)} ORDER BY ordinal_position`),
  ).map((r) => String(r.column_name));
  const unknown = match.find((m) => !columns.includes(m.field));
  if (unknown) throw new SourceError("column_missing", `Table "${params.table}" has no column "${unknown.field}". Columns: ${columns.join(", ")}.`);
  const where = match.map((m) => `${quoteIdent(m.field)} = ${quoteLiteral(m.value)}`).join(" AND ");
  return objects(await rowsOf(projectId, `SELECT * FROM ${quoteIdent(params.table)} WHERE ${where} ORDER BY ${quoteIdent(params.created_column)} DESC LIMIT ${MATCHING_MAX}`));
}

export const appRowsSource: EventSource<AppRowsParams, AppRowsState> = {
  kind: "app_rows",
  paramsSchema,
  // A row of the watched table can be changed by the owner's «Aplicar»; a row with an address can be answered.
  offers: { dataChange: true, replies: ["email"] },

  async validate(projectId, params) {
    const columns = await queryLive(
      projectId,
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${quoteLiteral(params.table)}`,
    );
    if (columns === null) return { ok: false, reason: "The app has no production base yet: publish it first, then create the task." };
    if (columns.kind !== "rows") return { ok: false, reason: columns.kind === "error" ? columns.message : "The production base could not be read." };
    const types = new Map(objects(columns).map((c) => [String(c.column_name), String(c.data_type)]));
    if (types.size === 0) return { ok: false, reason: `There is no table "${params.table}" in the app's production base.` };
    const created = types.get(params.created_column);
    if (!created || !CREATION_TYPES.has(created)) {
      return {
        ok: false,
        reason: `Table "${params.table}" has no timestamp or date column "${params.created_column}" saying when each row was created; a migration can add one (created_at timestamptz default now()).`,
      };
    }
    // From the catalog, not information_schema: `table_constraints` hides the keys of a table the role can only
    // SELECT, and production's read-only role can only SELECT (final review C1). The first column of the key.
    const pk = await queryLive(
      projectId,
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0] WHERE i.indrelid = to_regclass('public.' || quote_ident(${quoteLiteral(params.table)})) AND i.indisprimary`,
    );
    if (pk?.kind !== "rows") return { ok: false, reason: pk?.kind === "error" ? pk.message : "The production base could not be read." };
    const keyColumn = String(pk.rows[0]?.[0] ?? "");
    if (!keyColumn) return { ok: false, reason: `Table "${params.table}" has no primary key.` };
    const t = quoteIdent(params.table);
    const c = quoteIdent(params.created_column);
    const k = quoteIdent(keyColumn);
    // With after_hours, the newest row already past the mark: what is past it now never fires, what is younger will.
    const newest = await queryLive(projectId, `SELECT ${c}::text AS ${AT}, ${k}::text AS ${KEY} FROM ${t} WHERE true${comeOfAge(params, c)} ORDER BY ${c} DESC, ${k}::text DESC LIMIT 1`);
    if (newest?.kind !== "rows") return { ok: false, reason: newest?.kind === "error" ? newest.message : "The production base could not be read." };
    const last = newest.rows[0];
    return { ok: true, initialState: { cursor: last ? { at: String(last[0]), key: String(last[1]) } : { at: "-infinity", key: "" }, key_column: keyColumn } };
  },

  async observe(projectId, params, state) {
    const t = quoteIdent(params.table);
    const c = quoteIdent(params.created_column);
    const k = quoteIdent(state.key_column);
    const at = quoteLiteral(state.cursor.at);
    const key = quoteLiteral(state.cursor.key);
    const o = await rowsOf(
      projectId,
      `SELECT *, ${c}::text AS ${AT}, ${k}::text AS ${KEY} FROM ${t} WHERE (${c} > ${at} OR (${c} = ${at} AND ${k}::text > ${key}))${comeOfAge(params, c)} ORDER BY ${c}, ${k}::text LIMIT ${PAGE}`,
    );
    const found = objects(o);
    if (found.length === 0) return { state, changes: [] };
    const changes: SourceChange[] = found.map((row) => {
      const { [AT]: rowAt, [KEY]: _key, ...detail } = row;
      return { subject: params.table, summary: summaryOf(detail, state.key_column), detail, at: String(rowAt) };
    });
    const last = found.at(-1)!;
    return { state: { ...state, cursor: { at: String(last[AT]), key: String(last[KEY]) } }, changes };
  },

  async read(projectId, params, { keys, state, match }) {
    const t = quoteIdent(params.table);
    const k = quoteIdent(state.key_column);
    const c = quoteIdent(params.created_column);
    const items = keys.length === 0 ? [] : objects(await rowsOf(projectId, `SELECT * FROM ${t} WHERE ${k}::text IN (${keys.map(quoteLiteral).join(", ")})`));
    const previous = objects(await rowsOf(projectId, `SELECT * FROM ${t} ORDER BY ${c} DESC LIMIT ${BEFORE}`));
    if (!match?.length) return { items, previous };
    return { items, previous, matching: await matchingRows(projectId, params, match) };
  },
};
