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

      const rows = await db
        .select()
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
