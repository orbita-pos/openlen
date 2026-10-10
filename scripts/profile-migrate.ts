// EL PERFIL DE CADA PERSONA (docs/superpowers/specs/2026-10-10-profile-design.md):
// sus enlaces y sus proyectos fijados. Aditiva e idempotente (IF NOT EXISTS).
// Mantener en sintonía con lib/db/schema.ts (`users.links`, `users.pinnedProjectIds`).
//
// 🔴 OBLIGATORIA en el mismo deploy y ANTES que el código: el adaptador de
// Auth.js (`DrizzleAdapter`, auth.ts) lee TODAS las columnas de `users` al
// entrar con Google; sin ellas, nadie entra con Google.
//
// Run: npm run profile:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "links" jsonb;`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pinnedProjectIds" jsonb;`);
  console.log("[profile:migrate] users.links y users.pinnedProjectIds listas");
  process.exit(0);
}

main().catch((err) => {
  console.error("[profile:migrate] falló", err);
  process.exit(1);
});
