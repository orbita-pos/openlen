// scripts/usage-events-migrate.ts
// Crea la tabla `usageEvents` (idempotente): los eventos de uso de la pantalla
// de Crear, lib/uso/. Se usa en vez de `db:push` porque el push del esquema
// completo se para en un prompt AJENO; esto aplica SÓLO este DDL. Mantener en
// sintonía con `usageEvents` en lib/db/schema.ts.
//
// Sin GRANT a propósito: `infra/db/roles.sql` da a `openlen_app` DML sobre toda
// tabla FUTURA que cree `openlen_migrate` (ALTER DEFAULT PRIVILEGES), igual que
// con `pageData`.
//
// Run: npm run usage-events:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "usageEvents" (
      "id"        text PRIMARY KEY,
      "userId"    text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name"      text NOT NULL,
      "sessionId" text,
      "data"      jsonb NOT NULL DEFAULT '{}'::jsonb,
      "ts"        timestamp(3) NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "usageEvents_name_ts_idx"
      ON "usageEvents" ("name", "ts");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "usageEvents_user_ts_idx"
      ON "usageEvents" ("userId", "ts");
  `);
  console.log("usageEvents: tabla e índices listos");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
