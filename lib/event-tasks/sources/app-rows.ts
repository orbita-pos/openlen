// THE `app_rows` SOURCE (spec local 2026-11-03-len-que-avisa, §7.2): new rows of a table of the app's PRODUCTION
// base — the reservation that notifies nobody today. Read with the production read-only role (BYPASSRLS: with a
// visitor's RLS a well-locked table would return nothing), never the draft. New rows only: the keys of the tables
// Len writes are uuids that don't grow, so the cursor goes on a creation column plus the key as tie-break, both
// kept as Postgres wrote them (text) so no microsecond is lost on the way through JavaScript.
//
// SQL holds only names checked against the live schema and quoted as identifiers, and values the code produced
// (the cursor), quoted as literals. Condition values never reach SQL: the trigger matches them in TypeScript.
import "server-only";

import { z } from "zod";

import type { QueryOutcome } from "@/lib/backend/cli-core";
import { queryLive } from "@/lib/backend/live-read";

import { SourceError, type EventSource, type SourceChange } from "./types";

export interface AppRowsParams {
  readonly table: string;
  readonly created_column: string;
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
const CREATION_TYPES = new Set(["timestamp with time zone", "timestamp without time zone", "date"]);

export const quoteIdent = (name: string): string => `"${name.replace(/\0/g, "").replace(/"/g, '""')}"`;
export const quoteLiteral = (value: string): string => `'${value.replace(/\0/g, "").replace(/'/g, "''")}'`;

const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "contains", "gt", "lt", "exists"]),
  value: z.union([z.string(), z.number()]).optional(),
});

const paramsSchema = z.object({
  table: z.string().min(1),
  created_column: z.string().min(1),
  conditions: z.array(conditionSchema).optional(),
}) as z.ZodType<AppRowsParams>;

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

export const appRowsSource: EventSource<AppRowsParams, AppRowsState> = {
  kind: "app_rows",
  paramsSchema,
  declaration: {
    table: { type: "STRING", description: "app_rows: the table of the app's production base to watch for new rows." },
    created_column: { type: "STRING", description: "app_rows: the table's creation timestamp column, such as created_at." },
  },

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
    const pk = await queryLive(
      projectId,
      `SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.table_schema = 'public' AND tc.table_name = ${quoteLiteral(params.table)} AND tc.constraint_type = 'PRIMARY KEY' ORDER BY kcu.ordinal_position`,
    );
    const keyColumn = pk?.kind === "rows" ? String(pk.rows[0]?.[0] ?? "") : "";
    if (!keyColumn) return { ok: false, reason: `Table "${params.table}" has no primary key.` };
    const t = quoteIdent(params.table);
    const c = quoteIdent(params.created_column);
    const k = quoteIdent(keyColumn);
    const newest = await queryLive(projectId, `SELECT ${c}::text AS ${AT}, ${k}::text AS ${KEY} FROM ${t} ORDER BY ${c} DESC, ${k}::text DESC LIMIT 1`);
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
      `SELECT *, ${c}::text AS ${AT}, ${k}::text AS ${KEY} FROM ${t} WHERE ${c} > ${at} OR (${c} = ${at} AND ${k}::text > ${key}) ORDER BY ${c}, ${k}::text LIMIT ${PAGE}`,
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

  async read(projectId, params, { keys, state }) {
    const t = quoteIdent(params.table);
    const k = quoteIdent(state.key_column);
    const c = quoteIdent(params.created_column);
    const items = keys.length === 0 ? [] : objects(await rowsOf(projectId, `SELECT * FROM ${t} WHERE ${k}::text IN (${keys.map(quoteLiteral).join(", ")})`));
    const previous = objects(await rowsOf(projectId, `SELECT * FROM ${t} ORDER BY ${c} DESC LIMIT ${BEFORE}`));
    return { items, previous };
  },
};
