import { sql as sqlOp } from "drizzle-orm";
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
  // Role for admin-gated endpoints (template upload/edit/delete). 'user' for
  // everyone by default; flip to 'admin' manually in DB or via seed script.
  role: text("role").notNull().default("user"),
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
    // Lifecycle state. 'draft' until the user explicitly publishes (which
    // creates a hosted page in Phase 4). 'archived' hides the project from
    // the default list view without deleting it.
    status: text("status").notNull().default("draft"),
    // Short labels surfaced on the list cards. Auto-populated from the
    // intent (industry + tone) when the project is created.
    tags: text("tags").array().notNull().default(sqlOp`'{}'::text[]`),
    // Set when the project gets published (Phase 4). Lets the list page
    // show "deployed at example.com" inline. Kept around alongside `subdomain`
    // for one release while the UI migrates — derive from subdomain in code.
    deployUrl: text("deployUrl"),
    // Hero image URL pulled out of `data` for cheap thumbnail rendering
    // without having to deserialize the whole JSONB on listing pages.
    thumbnailUrl: text("thumbnailUrl"),
    data: jsonb("data").$type<LandingPage>().notNull(),
    // Per-project AI context — user-controlled instructions that get
    // prepended to every Chat tab prompt sent to Kimi K2.6. Equivalent to
    // Claude.ai's "Project instructions" feature: persistent system-prompt-
    // level context that travels across regen turns. Distinct from the
    // immutable `brief` column above (which is the original orchestrator
    // brief / synthetic placeholder set at project creation).
    userBrief: text("userBrief"),
    // Session 11 — claimed subdomain (e.g. `acme` → acme.openlen.com).
    // UNIQUE constraint enforces global uniqueness; clearing it
    // (unpublish) frees it for immediate re-claim. The unique index
    // doubles as the lookup index for "does sub X exist".
    subdomain: text("subdomain").unique(),
    // Timestamp of the most-recent successful publish. Null = not
    // currently published. Republish overwrites this.
    publishedAt: timestamp("publishedAt", { mode: "date" }),
    // Snapshot of `data.html` at the moment it was published. Drift
    // detection in the UI compares this against current `data.html`
    // to surface an "unpublished changes" pill.
    publishedHtml: text("publishedHtml"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_userId_idx").on(table.userId, table.updatedAt),
    index("projects_userId_status_idx").on(table.userId, table.status),
  ],
);

// Per-project version history. Each row snapshots a moment in the project's
// HTML lifecycle — clone, chat-applied redesign, publish, paste. The Versions
// sidebar lists these (newest first) so users can restore to any point.
//
// Capped at 50 rows per project — the helper module evicts the oldest beyond
// that. Full HTML stored per row (50-100KB typical); 50 rows × 100KB = ~5MB
// per project worst-case, which Neon handles fine. If this becomes a cost
// problem, switch to diff-based storage later (no API change required).
export const projectVersions = pgTable(
  "projectVersions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // What triggered this snapshot — drives the source pill in the UI and
    // optionally filtering ("show me only chat versions"). Free-form string,
    // but the helper module narrows to: "initial" | "chat" | "publish" |
    // "restore" | "manual".
    source: text("source").notNull(),
    // Human-readable label (truncated chat prompt, "Published to X", etc.).
    label: text("label").notNull(),
    // Full HTML at this snapshot. text() not jsonb — html is opaque to us.
    html: text("html").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projectVersions_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
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

// Curated templates registry — replaces the static TEMPLATES array that
// previously lived in components/templates/_registry.ts. The HTML body for
// each template is stored in object storage (R2 in prod, filesystem
// fallback in dev) keyed by `storageKey`. `contentHash` is the first 12
// chars of sha256(html) and is embedded in storageKey for immutable cache
// busting — uploading a new version creates a new object, the old one
// stays as a no-cost orphan until a periodic GC runs.
//
// The 'id' is the human-readable slug (e.g. 'anchor'), used directly in
// URLs and as the primary key. Renames require a manual SQL update + a
// /api/projects/from-template that already cloned this id keeps working
// because the clone copies the HTML at clone time.
export const templates = pgTable(
  "templates",
  {
    id: text("id").primaryKey(), // slug — 'anchor', 'mirror', etc.
    name: text("name").notNull(),
    family: text("family").notNull(), // 'technical-minimal' | 'editorial' | 'commerce'
    accent: text("accent").notNull(), // hex color like '#5E6AD2'
    pitch: text("pitch").notNull(),
    description: text("description").notNull(),
    mode: text("mode").notNull(), // 'dark' | 'light' | 'cream'

    // Reference to the HTML body in object storage.
    storageKey: text("storageKey").notNull(),
    storageUrl: text("storageUrl").notNull(), // resolved public URL, cached
    contentHash: text("contentHash").notNull(), // sha256 first 12 chars
    size: integer("size").notNull(),

    // Lifecycle. 'published' shows in gallery; 'draft' is in-progress;
    // 'archived' is soft-deleted (R2 object still exists for rollback).
    status: text("status").notNull().default("published"),

    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
    publishedAt: timestamp("publishedAt", { mode: "date" }),
  },
  (table) => [
    index("templates_status_family_idx").on(table.status, table.family),
  ],
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
