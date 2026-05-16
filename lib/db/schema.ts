import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { LandingPage } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle schema for auth.
//
// Four tables come from the Auth.js Drizzle adapter contract — users,
// accounts (OAuth links), sessions, verification_tokens. We add one
// password_reset_tokens table for the forgot/reset flow (Auth.js doesn't
// handle password reset natively).
//
// users.passwordHash is nullable because OAuth-first signups don't have a
// password until they explicitly set one.
// ─────────────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("passwordHash"),
  // Subscription tier. Stripe webhook (Phase 3) is what flips this to "pro";
  // for now everyone is "free". Free tier = 3 generations/month + 5/hour.
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
  ],
);

// One row per generated landing page. The full LandingPage artifact lives
// in the `data` JSONB column — html, css, images, intent, plan, copy, cost,
// witnessPath, etc. Letting the orchestrator keep producing rich nested
// data without us having to maintain a parallel relational schema.
export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    // Hero image URL pulled out of `data` for cheap thumbnail rendering
    // without having to deserialize the whole JSONB on listing pages.
    thumbnailUrl: text("thumbnailUrl"),
    data: jsonb("data").$type<LandingPage>().notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("projects_userId_idx").on(table.userId, table.updatedAt)],
);

// Generic rate-limit event log. Each row is "thing X happened at time Y for
// key K". Limit checks count rows in a sliding window. Keys are namespaced
// so the same table covers per-user quotas (`user:<id>:generate`), per-IP
// auth abuse limits (`ip:<addr>:register`), etc. Periodic cleanup deletes
// rows older than 31 days.
export const rateLimitEvents = pgTable(
  "rateLimitEvents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    key: text("key").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("rateLimitEvents_key_createdAt_idx").on(table.key, table.createdAt)],
);

// Password reset tokens — separate table so a leaked token only impacts
// password reset and not session/email-verification flows.
export const passwordResetTokens = pgTable("passwordResetTokens", {
  // The hashed token. We store hash, not raw — the raw value lives only in
  // the email we send to the user.
  tokenHash: text("tokenHash").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});
