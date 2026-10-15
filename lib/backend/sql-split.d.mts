/** Splits a migration's SQL into statements, as the Supabase CLI does (see `sql-split.mjs`). */
export function splitSqlStatements(sql: string): string[];
