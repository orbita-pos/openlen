// Test-only: a table as Drizzle declares it — every column with its default, its primary key (composite too) — but all
// nullable, for PGlite tests that go through Drizzle, which names every column of the table in its INSERT and SELECT.
import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";

import * as schema from "@/lib/db/schema";

const dialect = new PgDialect();

function defaultOf(value: unknown): string | null {
  if (value === undefined) return null;
  if (is(value, SQL)) return dialect.sqlToQuery(value).sql;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

export function tableSql(table: PgTable): string {
  const { name, columns, primaryKeys } = getTableConfig(table);
  const cols = columns.map((c) => {
    const d = c.hasDefault ? defaultOf(c.default) : null;
    return `"${c.name}" ${c.getSQLType()}${c.primary ? " primary key" : ""}${d ? ` default ${d}` : ""}`;
  });
  const keys = primaryKeys.map((k) => `primary key (${k.columns.map((c) => `"${c.name}"`).join(", ")})`);
  return `create table "${name}" (${[...cols, ...keys].join(", ")})`;
}

export function projectsTableSql(): string {
  return tableSql(schema.projects);
}
