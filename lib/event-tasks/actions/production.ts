// WHAT A CARD'S ACTIONS ARE CHECKED AGAINST (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): production,
// read with the read-only role (`queryLive`), never written. Names are quoted as identifiers and values as literals (the
// `app_rows` source's own quoting); whether a value fits its column is Postgres's answer when it reads the query, since it
// converts the literal to the column's type then — `WHERE false` makes sure no row is even looked at.
import "server-only";

import type { QueryOutcome } from "@/lib/backend/cli-core";
import { queryLive } from "@/lib/backend/live-read";

import { quoteIdent, quoteLiteral } from "../sources/app-rows";

export interface TableColumn {
  readonly name: string;
  readonly type: string;
}

const objects = (o: Extract<QueryOutcome, { kind: "rows" }>): Record<string, unknown>[] => o.rows.map((row) => Object.fromEntries(o.columns.map((c, i) => [c, row[i]])));

/** The table's columns in order, or null when the table or production isn't there. */
export async function tableColumns(projectId: string, table: string): Promise<{ columns: TableColumn[] } | null> {
  const o = await queryLive(
    projectId,
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${quoteLiteral(table)} ORDER BY ordinal_position`,
  );
  if (o?.kind !== "rows" || o.rows.length === 0) return null;
  return { columns: objects(o).map((c) => ({ name: String(c.column_name), type: String(c.data_type) })) };
}

/** One row by its key, or null, as Postgres's own JSON — a date or a time comes as the text Postgres writes, never a
 *  JS Date, so a card's «before» compares equal when the owner applies it. A read that fails throws, with its message. */
export async function readRow(projectId: string, table: string, keyColumn: string, key: string): Promise<Record<string, unknown> | null> {
  const o = await queryLive(projectId, `SELECT to_jsonb(r) AS row FROM ${quoteIdent(table)} r WHERE r.${quoteIdent(keyColumn)}::text = ${quoteLiteral(key)} LIMIT 1`);
  if (o === null) throw new Error("The app has no production base.");
  if (o.kind !== "rows") throw new Error(o.kind === "error" ? o.message : "Production could not be read.");
  const cell = o.rows[0]?.[0];
  if (cell === undefined || cell === null) return null;
  return (typeof cell === "string" ? JSON.parse(cell) : cell) as Record<string, unknown>;
}

/** Null when `value` fits `column`'s type; else Postgres's reason. */
export async function castCheck(projectId: string, table: string, column: string, value: string): Promise<string | null> {
  const o = await queryLive(projectId, `SELECT 1 FROM ${quoteIdent(table)} WHERE false AND ${quoteIdent(column)} = ${quoteLiteral(value)}`);
  if (o === null) return "The app has no production base.";
  return o.kind === "rows" ? null : o.kind === "error" ? o.message : "Production could not be read.";
}
