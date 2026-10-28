import { sql, type SQL } from "drizzle-orm";
/** Compartida con la prueba Postgres en memoria; todas las sentencias son aditivas. */
export async function migrarAvisos(base: { execute(query: SQL): Promise<unknown> }) {
  await base.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "movilLlaves_huella_userId_uidx" ON "movilLlaves" ("huella", "userId")`);
  await base.execute(sql`CREATE TABLE IF NOT EXISTS "movilAvisos" (
    "llaveHuella" text PRIMARY KEY,
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "token" text NOT NULL UNIQUE,
    "actualizadoEn" timestamp NOT NULL DEFAULT now()
  )`);
  await base.execute(sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movilAvisos_llave_usuario_fk' AND conrelid = '"movilAvisos"'::regclass) THEN
      ALTER TABLE "movilAvisos" ADD CONSTRAINT "movilAvisos_llave_usuario_fk" FOREIGN KEY ("llaveHuella", "userId") REFERENCES "movilLlaves" ("huella", "userId") ON DELETE CASCADE;
    END IF;
  END $$`);
  await base.execute(sql`CREATE INDEX IF NOT EXISTS "movilAvisos_userId_idx" ON "movilAvisos" ("userId")`);
}
