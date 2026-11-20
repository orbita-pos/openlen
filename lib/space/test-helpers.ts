// Test-only: the `projects` table as Drizzle declares it (every column, all nullable but the key), for PGlite tests
// that insert through Drizzle — which names every column of the table in its INSERT.
import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "@/lib/db/schema";

export function projectsTableSql(): string {
  const { columns } = getTableConfig(schema.projects);
  return `create table "projects" (${columns.map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? " primary key" : ""}`).join(", ")})`;
}
