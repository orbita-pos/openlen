import type { NextAuthConfig } from "next-auth";

// ─────────────────────────────────────────────────────────────────────────────
// Edge-safe Auth.js config — NO database adapter, NO Node-only providers.
//
// middleware.ts builds its JWT-verifying `auth()` from THIS object, so the
// node-postgres driver (Node net/tls — not edge-runtime compatible) never gets
// pulled into the middleware's edge bundle. The full config (Drizzle adapter +
// Credentials/Google providers) is assembled in auth.ts for the Node runtime.
//
// This is the documented Auth.js v5 split-config pattern.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  providers: [],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (token?.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
