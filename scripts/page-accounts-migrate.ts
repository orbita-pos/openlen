// Las CUENTAS de las páginas (plans/page-accounts/design.md) — idempotente.
//
// No crea tablas nuevas: reutiliza las del módulo Miembros, retirado el
// 2026-08-21 con sus tablas conservadas a propósito (`siteMembers`,
// `memberSessions`, `memberLoginTokens`). Una cuenta de una página ES un
// miembro de un sitio: correo, contraseña bcrypt y sesión opaca en la base.
// Lo que les falta es lo que este fichero añade:
//
//   · `siteMembers.role`               — el papel que le dio el dueño.
//   · `memberSessions.ownerUserId`     — la sesión del DUEÑO en su propia
//     página (entra con su cuenta de OpenLen, no es un miembro), y por eso
//     `memberId` deja de ser obligatorio.
//   · `memberLoginTokens.ownerUserId`  — el código de un uso con el que el
//     dueño vuelve de openlen.com a su página ya dentro.
//   · `memberLoginTokens.purpose`      — (F2) para qué es la ficha: confirmar
//     el correo, recuperar, invitar o el permiso de poner contraseña.
//
// Los CREATE van primero, copiados de `scripts/members-migrate.ts` (borrado en
// 07f43193): una base que nunca tuvo Miembros también tiene que poder correr
// esto. Mantener en sintonía con lib/db/schema.ts.
//
// Run: npm run page-accounts:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "siteMembers" (
      "id" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "name" text,
      "status" text NOT NULL DEFAULT 'active',
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "lastLoginAt" timestamp
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "siteMembers_projectId_email_uq"
      ON "siteMembers" ("projectId", "email");
  `);
  await db.execute(sql`ALTER TABLE "siteMembers" ADD COLUMN IF NOT EXISTS "passwordHash" text;`);
  await db.execute(sql`ALTER TABLE "siteMembers" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamp;`);
  await db.execute(sql`ALTER TABLE "siteMembers" ADD COLUMN IF NOT EXISTS "role" text;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "memberLoginTokens" (
      "tokenHash" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "slug" text,
      "expires" timestamp NOT NULL,
      "used" boolean NOT NULL DEFAULT false,
      "createdAt" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    ALTER TABLE "memberLoginTokens"
      ADD COLUMN IF NOT EXISTS "ownerUserId" text REFERENCES "users"("id") ON DELETE CASCADE;
  `);
  // F2: para qué es cada ficha de un uso (confirmar, recuperar, invitar, el
  // permiso de poner contraseña). Null en las del dueño y en las de Miembros.
  await db.execute(sql`ALTER TABLE "memberLoginTokens" ADD COLUMN IF NOT EXISTS "purpose" text;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "memberSessions" (
      "tokenHash" text PRIMARY KEY,
      "projectId" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "memberId" text NOT NULL REFERENCES "siteMembers"("id") ON DELETE CASCADE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "lastSeenAt" timestamp NOT NULL DEFAULT now(),
      "expiresAt" timestamp NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "memberSessions_memberId_idx"
      ON "memberSessions" ("memberId");
  `);
  // DROP NOT NULL es idempotente en Postgres: sobre una columna que ya admite
  // NULL no hace nada.
  await db.execute(sql`ALTER TABLE "memberSessions" ALTER COLUMN "memberId" DROP NOT NULL;`);
  await db.execute(sql`
    ALTER TABLE "memberSessions"
      ADD COLUMN IF NOT EXISTS "ownerUserId" text REFERENCES "users"("id") ON DELETE CASCADE;
  `);

  console.log("page accounts: siteMembers, memberSessions y memberLoginTokens listos");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
