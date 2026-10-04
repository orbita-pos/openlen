// El backend de las páginas (plans/pages-backend/design.md): la tabla de los
// proyectos que usan la API de Supabase sobre su propia base. Tabla NUEVA con
// IF NOT EXISTS: idempotente. Mantener en sintonía con lib/db/schema.ts
// (`projectBackends`).
//
// 🔴 Cambiarle una COLUMNA después pide su propio ALTER: el IF NOT EXISTS no
// toca una tabla que ya existe.
//
// Run: npm run pages-backend:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectBackends" (
      "projectId" text PRIMARY KEY REFERENCES "projects"("id") ON DELETE CASCADE,
      "ref" text NOT NULL UNIQUE,
      "publishableKey" text NOT NULL UNIQUE,
      "secretKeyHash" text NOT NULL,
      "secretKeyEncrypted" text NOT NULL,
      "jwtSecretEncrypted" text NOT NULL,
      "dbPasswordEncrypted" text NOT NULL,
      "authConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "provisionedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  console.log("[pages-backend:migrate] projectBackends listo");
  process.exit(0);
}

main().catch((err) => {
  console.error("[pages-backend:migrate] falló", err);
  process.exit(1);
});
