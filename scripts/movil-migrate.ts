// Las tablas de la app del teléfono (idempotente). Como los demás *-migrate:
// en vez de db:push, para no tocar otra deriva pendiente. Mantener en sintonía
// con lib/db/schema.ts. Run: npm run movil:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "movilCodigos" (
    "huella" text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "estado" text NOT NULL,
    "creadoEn" timestamp NOT NULL DEFAULT now(),
    "usadoEn" timestamp
  );`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "movilLlaves" (
    "huella" text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "nombre" text,
    "creadoEn" timestamp NOT NULL DEFAULT now(),
    "ultimoUso" timestamp
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "movilLlaves_userId_idx" ON "movilLlaves" ("userId");`);
  console.log("tablas de la app del teléfono listas.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
