import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import authConfig from "@/auth.config";

// ─────────────────────────────────────────────────────────────────────────────
// Auth.js v5 — full (Node-runtime) configuration.
//
// Shared, edge-safe bits (session strategy, pages, callbacks, trustHost) live
// in auth.config.ts so middleware.ts can verify JWTs at the edge without
// importing the DB driver. Here we add the Node-only pieces: the Drizzle
// adapter and the Credentials provider (bcrypt + DB lookup).
//
// Two providers:
//   1. Credentials (email + password)  — always enabled
//   2. Google OAuth                    — enabled iff GOOGLE_CLIENT_ID + SECRET
//
// Sessions are JWT (see auth.config.ts). The adapter persists users/accounts
// for OAuth linking; session reads don't hit the DB.
//
// Make sure NEXTAUTH_SECRET is set (used to sign session cookies).
// ─────────────────────────────────────────────────────────────────────────────

const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = typeof credentials?.email === "string" ? credentials.email.toLowerCase().trim() : "";
      const password = typeof credentials?.password === "string" ? credentials.password : "";
      if (!email || !password) return null;

      // 🔴 PROYECCION EXPLICITA, Y ES LOAD-BEARING. Esto era `.select()` a secas,
      // que pide TODAS las columnas declaradas en el esquema — asi que cualquier
      // columna añadida a `users` antes de que su migracion corra deja de ser un
      // rasgo a medias y pasa a tumbar el LOGIN de todo el mundo.
      //
      // MEDIDO el 2026-09-12, en vivo: con `users.agentEffort` en el esquema y
      // sin migrar, entrar daba `column "agentEffort" of relation "users" does
      // not exist` (42703) desde aqui mismo, y nadie podia autenticarse.
      //
      // Es exactamente el modo de fallo de `publishedHomeHash` que documenta la
      // cabecera de `scripts/build-migrations.mjs`, pero en la puerta de entrada.
      // El orden del despliegue (migraciones en el paso 6, codigo en el 7) lo
      // evita en produccion; esto lo evita TAMBIEN cuando el orden no se cumple
      // — en local, en una rama, o en un rollback del codigo sin rollback del
      // esquema.
      //
      // Se piden los CINCO campos que usa este bloque y ni uno mas: el hash para
      // comparar, y los cuatro que viajan al objeto de sesion.
      const rows = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
          image: schema.users.image,
          passwordHash: schema.users.passwordHash,
        })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      const user = rows[0];
      if (!user || !user.passwordHash) return null;

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      };
    },
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

export const config: NextAuthConfig = {
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers,
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

/**
 * Names of OAuth providers actually enabled at runtime. The login/register
 * pages read this to decide whether to render the Google button.
 */
export const enabledOauthProviders = {
  google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
};
