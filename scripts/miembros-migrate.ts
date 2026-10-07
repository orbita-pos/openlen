// COMPARTIR EL PROYECTO: los miembros del editor, sus invitaciones, lo que
// gastan con Len, el tope del dueño y quién pidió cada turno. Idempotente (IF
// NOT EXISTS). Mantener en sintonía con lib/db/schema.ts (`projectMembers`,
// `projectInvites`, `projectMemberSpend`, `projects.topeMensualMiembros`,
// `projectChatMessages.autorId`, `projectVersions.autorId`,
// `projectFileVersions.autorId`).
//
// 🔴 OBLIGATORIA en el mismo deploy que el código: `accesoAlProyecto`
// (lib/projects/acceso.ts) lee `projectMembers` en cada petición que abre un
// proyecto, y sin la tabla esa consulta falla.
//
// Run: npm run miembros:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectMembers" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "userId" text NOT NULL,
      "rol" text NOT NULL,
      "invitedBy" text,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "projectMembers_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE,
      CONSTRAINT "projectMembers_userId_users_id_fk"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "projectMembers_project_user_uq" ON "projectMembers" ("projectId", "userId");
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "projectMembers_userId_idx" ON "projectMembers" ("userId");`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectInvites" (
      "tokenHash" text PRIMARY KEY,
      "projectId" text NOT NULL,
      "email" text NOT NULL,
      "rol" text NOT NULL,
      "invitedBy" text NOT NULL,
      "expires" timestamp NOT NULL,
      "used" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "projectInvites_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "projectInvites_projectId_idx" ON "projectInvites" ("projectId");`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "projectMemberSpend" (
      "projectId" text NOT NULL,
      "userId" text NOT NULL,
      "mes" text NOT NULL,
      "creditos" integer NOT NULL DEFAULT 0,
      CONSTRAINT "projectMemberSpend_projectId_userId_mes_pk" PRIMARY KEY ("projectId", "userId", "mes"),
      CONSTRAINT "projectMemberSpend_projectId_projects_id_fk"
        FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE
    );
  `);
  await db.execute(sql`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "topeMensualMiembros" integer;`);
  await db.execute(sql`ALTER TABLE "projectChatMessages" ADD COLUMN IF NOT EXISTS "autorId" text;`);
  // Quién hizo cada versión (lib/projects/autor-del-cambio.ts).
  await db.execute(sql`ALTER TABLE "projectVersions" ADD COLUMN IF NOT EXISTS "autorId" text;`);
  await db.execute(sql`ALTER TABLE "projectFileVersions" ADD COLUMN IF NOT EXISTS "autorId" text;`);
  console.log("[miembros:migrate] projectMembers, projectInvites, projectMemberSpend y columnas listas");
  process.exit(0);
}

main().catch((err) => {
  console.error("[miembros:migrate] falló", err);
  process.exit(1);
});
