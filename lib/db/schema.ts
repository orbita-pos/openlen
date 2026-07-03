import { sql as sqlOp } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ProjectData } from "@/lib/projects/types";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

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
  // Subscription tier. The Polar billing webhook (app/api/billing/webhook)
  // flips this to "pro" on an active subscription and back to "free" on
  // revoke. Free-tier limits live in lib/limits.ts + lib/credits.ts.
  plan: text("plan").notNull().default("free"),
  // Role for admin-gated endpoints (template upload/edit/delete). 'user' for
  // everyone by default; flip to 'admin' manually in DB or via seed script.
  role: text("role").notNull().default("user"),
  // Credit balance for AI operations — debited by lib/credits.ts. A fresh
  // row (credits 0, creditsRefreshedAt null) gets its plan allotment granted
  // on the first balance read.
  credits: integer("credits").notNull().default(0),
  creditsRefreshedAt: timestamp("creditsRefreshedAt", { mode: "date" }),
  // Polar (Merchant-of-Record) billing linkage. Set by the billing webhook
  // from the subscription it receives; userId is passed to Polar as the
  // checkout's customer_external_id + metadata so the webhook maps back here.
  polarCustomerId: text("polarCustomerId"),
  polarSubscriptionId: text("polarSubscriptionId"),
  // Last subscription status Polar reported: 'active' | 'trialing' |
  // 'canceled' | 'past_due' | … . null = never subscribed.
  subscriptionStatus: text("subscriptionStatus"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  // Public creator identity (community/explore). Null until the user claims a
  // handle. Slug ^[a-z0-9_]{3,20}$, lowercase, globally unique.
  handle: text("handle").unique(),
  bio: text("bio"),
  avatarUrl: text("avatarUrl"),
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

// One row per project. The rendered HTML document lives in the `data` JSONB
// column ({ html }) — the same artifact whether the page came from AI
// generation, a template clone, or pasted HTML.
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
    // Community listing axis. 'private' (default) = not listed anywhere;
    // 'public' = shown in /explore + owner's /@handle; 'hidden' = pulled by an
    // admin (owner keeps the project, it just stops listing).
    visibility: text("visibility").notNull().default("private"),
    // Lineage when this project was created via Remix of a public page.
    remixedFromId: text("remixedFromId").references(
      (): AnyPgColumn => projects.id,
      { onDelete: "set null" },
    ),
    // How many times THIS project was remixed by others.
    remixCount: integer("remixCount").notNull().default(0),
    // When it entered the feed (feed "recent" ordering). Null = never public.
    listedAt: timestamp("listedAt", { mode: "date" }),
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
    // Per-project favicon / brand mark. Auto-extracted from the HTML's
    // <link rel="icon"> at first publish (data: URIs get uploaded to R2)
    // and overridable from the Inspector panel. Used as the favicon on
    // the published page, the badge in /projects cards, the 16x16 icon
    // beside the project name in the TopBar, and the fallback og:image.
    // Null = no logo set; UI surfaces fall back to a coral-circle SVG
    // with the project's initial letter (lib/branding/default-logo.ts).
    logoUrl: text("logoUrl"),
    // The saved business profile this page was seeded from (lib/business-
    // profiles). Nullable — a page can be made with no profile (the AI invents
    // copy), and a profile only SEEDS the page, so it can diverge freely.
    // ON DELETE SET NULL: deleting a profile just clears the link.
    profileId: text("profileId").references(() => businessProfiles.id, {
      onDelete: "set null",
    }),
    data: jsonb("data").$type<ProjectData>().notNull(),
    // Per-project AI context — user-controlled instructions that get
    // prepended to every Chat tab prompt sent to the chat model.
    // Equivalent to Claude.ai's "Project instructions" feature: persistent
    // system-prompt-level context that travels across regen turns.
    // Distinct from the immutable `brief` column above (which is the
    // original orchestrator brief / synthetic placeholder set at project
    // creation).
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
    // Fingerprint of data.pages at the moment of publish (hashSitePages in
    // lib/projects.ts; "" = published with zero pages). Lets the drift pill
    // light up on subpage edits without storing every page's html twice.
    // NULL = published before this column existed (or after a release
    // rollback, where the live pages are unknown) — pages are then skipped
    // by the comparison, so legacy rows never show a false "changed".
    publishedPagesHash: text("publishedPagesHash"),
    // First 12 chars of sha256(optimized published HTML). Points at the
    // on-disk release dir under /var/www/openlen/<sub>/releases/<sha>/.
    // The TopBar "Previous deploys" UI joins this against listReleases()
    // to identify which entry is currently live. Updated atomically with
    // publishedHtml.
    publishedReleaseSha: text("publishedReleaseSha"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projects_userId_idx").on(table.userId, table.updatedAt),
    index("projects_userId_status_idx").on(table.userId, table.status),
    index("projects_visibility_listedAt_idx").on(
      table.visibility,
      table.listedAt,
    ),
  ],
);

// Saved business profiles — the user's reusable identity ("Mi negocio").
// `data` is a BusinessProfileData (ExtractedBusinessData + contact + brand +
// photos), the same shape the fill engine consumes. A user may have several
// (one per business); `isDefault` marks the one a new page seeds from when none
// is explicitly picked. A profile only SEEDS — projects keep their own HTML and
// diverge freely (projects.profileId is ON DELETE SET NULL).
export const businessProfiles = pgTable(
  "businessProfiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    data: jsonb("data").$type<BusinessProfileData>().notNull(),
    isDefault: boolean("isDefault").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("businessProfiles_userId_idx").on(table.userId),
    // At most one default business per user (partial unique) — guards the
    // ensureDefaultProfile create-race at the DB level.
    uniqueIndex("businessProfiles_userId_default_uq")
      .on(table.userId)
      .where(sqlOp`"isDefault"`),
  ],
);

// Per-project version history. Each row snapshots a moment in the project's
// HTML lifecycle — clone, chat-applied redesign, publish, paste. The Versions
// sidebar lists these (newest first) so users can restore to any point.
//
// Capped at 50 unpinned rows per (project, page) scope — the helper module
// evicts the oldest beyond that; pinned rows are exempt (≤10 per project,
// enforced at pin time). Full HTML stored per row (50-100KB typical), which
// Neon handles fine. If this becomes a cost problem, switch to diff-based
// storage later (no API change required).
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
    // Multi-page: which document this snapshots. NULL = the home document
    // (data.html); a slug = data.pages[slug].html. Restore writes back into
    // the same slot, so a /pricing snapshot can never overwrite home.
    page: text("page"),
    // Pinned versions survive eviction (and show a pin in the timeline).
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projectVersions_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// Per-project Chat-tab transcript — an append-only log of design turns.
//
// One row per settled turn. Appending = INSERT, so two browser tabs editing
// the same project interleave instead of clobbering a shared blob (the v0 /
// claude.ai model: the server log is the source of truth, the client a view).
// Capped at 50 rows per project — the helper evicts the oldest. HTML
// revisions are NOT here — those live in projectVersions.
export const projectChatMessages = pgTable(
  "projectChatMessages",
  {
    // The turn id — generated client-side (crypto.randomUUID) so the
    // optimistic UI row and the DB row share one identity. PK ⇒ a retried
    // append of the same turn is an idempotent no-op.
    id: text("id").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userText: text("userText").notNull(),
    // The image the user attached to this turn, if any.
    attachedImage: jsonb("attachedImage").$type<{
      url: string;
      alt?: string;
    }>(),
    assistantReasoning: text("assistantReasoning").notNull(),
    // Multi-page: which document this turn edited. NULL = the home document
    // (data.html); a slug = data.pages[slug].html. Mirrors projectVersions.page.
    page: text("page"),
    // 'applied' on insert; flipped to 'reverted' by Undo. 'error' turns are
    // never persisted (transient — they changed nothing).
    status: text("status").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("projectChatMessages_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// Lead-capture submissions from published pages. A visitor submits any
// <form> on a published OpenLen page → POST /api/f/<sub> → one row here.
// `data` is the submitted fields as-is (honeypot stripped); `meta` carries
// IP / user-agent for spam triage. Cascade-deletes with the project.
export const formSubmissions = pgTable(
  "formSubmissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The submitted form fields — { [name]: value }.
    data: jsonb("data").$type<Record<string, string>>().notNull(),
    // IP + user-agent + referer, plus derived country / device / browser
    // (matching what the public form endpoint forwards to the notification
    // email). All optional — older rows predate the derived fields, newer
    // ones backfill from Cloudflare + UA parsing.
    meta: jsonb("meta").$type<{
      ip?: string;
      ua?: string;
      ref?: string;
      country?: string | null;
      device?: string | null;
      browser?: string | null;
      /** Site page the form lives on (null/absent = home) — lead triage
       *  for multi-page sites. */
      page?: string | null;
      /** Session visitor id (lib/analytics/cid.ts) — joins this lead back to
       *  its view in pageEvents for funnel + source attribution. Absent on a
       *  native no-JS POST (the hidden input is JS-populated) = "untracked". */
      cid?: string;
    }>(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("formSubmissions_projectId_createdAt_idx").on(
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

    // Extra pages for MULTI-PAGE templates (e.g. Home + Tienda + product fichas).
    // Each {slug, html}; cloned verbatim into project.data.pages by
    // /api/projects/from-template. Stored inline (read once at clone time) —
    // the home HTML still lives in object storage (storageKey/storageUrl).
    pages: jsonb("pages").$type<Array<{ slug: string; html: string }>>(),

    // Pre-rendered preview thumbnail for the gallery + homepage cards.
    // Generated by `npm run templates:thumbnails` (Puppeteer + sharp). Null
    // until the script has run for this template; the marketing TemplateCard
    // falls back to the live iframe when null. Filename pattern:
    // `thumbnails/<id>-<contentHash>.webp` — same bucket as HTML so it
    // shares the cache + CDN config.
    thumbnailUrl: text("thumbnailUrl"),

    // Small right-sized AVIF tile (~600px wide vs thumbnailUrl's 1280px) for
    // the gallery wall + workspace picker cards. Generated by
    // `npm run templates:tiles`. Null until that script has run; consumers
    // fall back to thumbnailUrl, then the live iframe. Filename pattern:
    // `tiles/<id>-<contentHash>.avif`.
    tileUrl: text("tileUrl"),

    // Full-page render of the template, used as a multimodal REFERENCE image
    // fed into the AI generation calls (Quality S2). Distinct from
    // thumbnailUrl: that's a viewport-clipped AVIF *card* (~1280×800,
    // above-the-fold); this is a full-page JPG capturing the whole aesthetic
    // (density, spacing, section rhythm) so Gemini can match the quality bar.
    // Generated by `npm run templates:capture-screenshots` (Puppeteer,
    // fullPage). Null until that script has run for this row. Filename
    // pattern: `screenshots/<id>-<contentHash>.jpg`. NEVER served to a
    // published page — it is reference-only input to the model.
    screenshotUrl: text("screenshotUrl"),

    // Marks "top-tier" templates that get a dedicated Featured section at
    // the top of the /templates gallery + an accent badge on their card.
    // Curated by hand — flip via `templates:add --featured` or directly in
    // the DB. The default is false, so unflagged templates render in their
    // normal family group with no visual elevation.
    featured: boolean("featured").notNull().default(false),

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

// Curated GLB model catalog — 3D assets served from R2 (defaults to the
// `openlen-images` bucket / images.openlen.com under a `models/` key prefix;
// override via R2_MODELS_BUCKET / R2_MODELS_PUBLIC_URL for a dedicated bucket).
// Mirrors the `templates` table structure: metadata here, binary body keyed as
// `models/<id>-<contentHash>.glb` in object storage.
//
// The 'id' is the human-readable slug (e.g. 'glass-sphere') used as the
// primary key and storage-key prefix. Renames require a manual SQL update.
export const models = pgTable(
  "models",
  {
    id: text("id").primaryKey(), // slug — 'glass-sphere', 'chrome-bolt', etc.
    name: text("name").notNull(),
    family: text("family").notNull(), // 'product' | 'decorative' | 'prop' | 'character' | 'mechanical'
    author: text("author").notNull().default("OpenLen"),
    pitch: text("pitch").notNull(),
    description: text("description").notNull(),

    // Reference to the GLB binary in object storage.
    storageKey: text("storageKey").notNull(),
    storageUrl: text("storageUrl").notNull(), // resolved public URL, cached
    contentHash: text("contentHash").notNull(), // sha256 first 12 chars
    size: integer("size").notNull(),

    // Optional Gemini-generated scene spec (lights, camera, env, material
    // overrides). Stored inline so the 3D runtime can load it in one DB row
    // without a second storage fetch.
    sceneSpec: jsonb("sceneSpec").$type<Record<string, unknown>>(),

    // Searchable tags (e.g. ['glass', 'sphere', 'transparent']).
    tags: text("tags").array().notNull().default(sqlOp`'{}'::text[]`),

    // SPDX license. 'cc0' = public domain; 'cc-by-4.0' = attribution.
    license: text("license").notNull().default("cc0"),

    // Pre-rendered preview images (same bucket as GLB). Null until the
    // thumbnailing script has run for this row.
    thumbnailUrl: text("thumbnailUrl"), // WebP viewport card
    tileUrl: text("tileUrl"),           // AVIF gallery tile (~600px)
    previewImageUrl: text("previewImageUrl"), // Full-size reference render

    // Marks top-tier models surfaced first in the picker. Flip via DB or CLI.
    featured: boolean("featured").notNull().default(false),

    // Lifecycle. 'published' shows in picker; 'draft' is in-progress;
    // 'archived' is soft-deleted (R2 object still exists for rollback).
    status: text("status").notNull().default("published"),

    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
    publishedAt: timestamp("publishedAt", { mode: "date" }),
  },
  (table) => [
    index("models_status_family_idx").on(table.status, table.family),
  ],
);

// Section library — curated, re-themeable HTML FRAGMENTS (a single
// <section>/<header>/<footer>) inserted into existing user pages. Mirrors the
// `templates` storage pattern (body in object storage under a `sections/`
// prefix, metadata here) but typed by section TYPE (hero/pricing/…) instead of
// design family, since a section's look is re-themed to the host on insert.
export const sections = pgTable(
  "sections",
  {
    id: text("id").primaryKey(), // slug — 'hero-01', 'pricing-03', …
    type: text("type").notNull(), // 'hero' | 'pricing' | 'features' | …
    name: text("name").notNull(), // display name, e.g. "Pricing — 3 Tiers"
    variantLabel: text("variantLabel").notNull(), // "3 Tiers", "Centrado", …
    rootTag: text("rootTag").notNull(), // 'section' | 'header' | 'footer' | …
    mode: text("mode").notNull().default("light"), // preview-backdrop hint

    // Scoped HTML fragment in object storage (same bucket as templates,
    // `sections/<id>-<hash>.html` key).
    storageKey: text("storageKey").notNull(),
    storageUrl: text("storageUrl").notNull(),
    contentHash: text("contentHash").notNull(), // sha256 first 12 chars
    size: integer("size").notNull(),

    // :root custom properties parsed at ingest (--accent / --font-display /
    // --radius …), so the re-theme path knows which tokens to remap.
    designTokens: jsonb("designTokens").$type<Record<string, string>>(),
    // Google-Fonts stylesheet hrefs to hoist into the host <head> on insert.
    fonts: jsonb("fonts").$type<string[]>(),

    // Content rendered by inline JS into empty containers (comparison / tab
    // variants) — insertion must preserve <script>; inline-edit is limited.
    needsJs: boolean("needsJs").notNull().default(false),
    // Ships decorative gradient placeholders that don't auto-retheme — prompt
    // the user to swap real assets on insert (gallery).
    hasPlaceholders: boolean("hasPlaceholders").notNull().default(false),

    // Pre-rendered gallery thumbnail. Null until a thumbnail pass has run.
    thumbnailUrl: text("thumbnailUrl"),

    status: text("status").notNull().default("published"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
    publishedAt: timestamp("publishedAt", { mode: "date" }),
  },
  (table) => [index("sections_status_type_idx").on(table.status, table.type)],
);

// Per-page analytics events — append-only log of pageviews + outbound clicks
// from published OpenLen pages. The tracker snippet injected at publish time
// fires a `sendBeacon` to POST /c/<projectId> on every view + every external
// link click. We store no IPs, no cookies, no raw UA — `country` is the
// 2-letter ISO from Cloudflare's CF-IPCountry header, `uaHash` is a salted
// sha-256 truncated to 12 chars (groups visits from the same device without
// identifying them). Privacy-first by design = no GDPR consent banner needed.
//
// Indexes are sized for the killer query (per-project top links over a
// range) + the time-bucketed visits-over-time aggregation. Raw rows beyond
// 90 days get rolled up into pageEventsDaily by the retention cron.
export const pageEvents = pgTable(
  "pageEvents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // 'view' (pageview beacon) or 'click' (outbound link beacon). Free-form
    // text in the column for forward-compatibility but the snippet only
    // emits those two values.
    type: text("type").notNull(),
    // For clicks: the absolute href the user navigated to. Null on views.
    // Capped to 2000 chars at insert (the snippet only sends up to 80 for
    // the label, but href can legitimately be longer).
    href: text("href"),
    // For clicks: textContent of the <a>, trimmed + truncated to 80 chars.
    // Lets the Insights tab render "Twitch · LIVE PB attempts" instead of
    // a bare URL. Null on views.
    linkLabel: text("linkLabel"),
    // document.referrer at view time (also forwarded on clicks for context).
    // Capped to 500 chars at insert.
    referrer: text("referrer"),
    // 2-letter ISO from CF-IPCountry. Null when CF isn't in front (dev) or
    // the request didn't originate behind it.
    country: text("country"),
    // 'mobile' | 'desktop' | 'tablet' — coarse, derived from the User-Agent
    // by lib/analytics/parse.ts. We never store the raw UA.
    device: text("device"),
    // 'chrome' | 'safari' | 'firefox' | 'edge' | 'other' — same derivation.
    browser: text("browser"),
    // sha-256(salt + ua + accept-language) truncated to 12 chars. Used only
    // to count 'uniques' over a range — collision rate is negligible at the
    // scales OpenLen sees, and there's no way to invert the hash.
    uaHash: text("uaHash"),
    // Site-page slug the event happened on; null = home (and every event
    // recorded before multipage). Baked into the snippet at publish time,
    // validated against the slug grammar at insert.
    page: text("page"),
    // Session visitor id (lib/analytics/cid.ts) — sessionStorage-scoped, NOT a
    // persistent cross-session identifier, so the privacy-first / no-consent
    // posture above still holds. Joins the funnel: a cid's view → click →
    // (formSubmissions.meta.cid) → (bookings.cid). Null on pre-cid rows and
    // when storage is blocked.
    cid: text("cid"),
    // First-touch acquisition source for the session, frozen client-side and
    // sent on the view beacon: { utmSource?, utmMedium?, utmCampaign?, ref? }
    // (ref = cross-origin referrer host). Null when nothing identifiable. See
    // EventSource in lib/analytics/cid.ts — kept inline here so the schema
    // (imported everywhere) carries no analytics dependency.
    source: jsonb("source").$type<{
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      ref?: string;
    }>(),
    ts: timestamp("ts", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("pageEvents_projectId_ts_idx").on(table.projectId, table.ts),
    index("pageEvents_projectId_type_ts_idx").on(
      table.projectId,
      table.type,
      table.ts,
    ),
    // Funnel join: distinct cids per stage + first-touch source per cid.
    index("pageEvents_projectId_cid_idx").on(table.projectId, table.cid),
  ],
);

// Daily rollup of pageEvents — written by the retention cron, queried by
// the Insights tab when the requested range is >30 days. Same grain as the
// raw table but pre-aggregated; the composite PK makes the daily upsert a
// natural ON CONFLICT DO UPDATE. `uniques` is the count-distinct of uaHash
// from the rolled-up day.
export const pageEventsDaily = pgTable(
  "pageEventsDaily",
  {
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    type: text("type").notNull(),
    // For clicks: the href (matches pageEvents.href). Empty string '' for
    // views (composite PK columns can't be null in Postgres).
    href: text("href").notNull().default(""),
    country: text("country").notNull().default(""),
    device: text("device").notNull().default(""),
    count: integer("count").notNull().default(0),
    uniques: integer("uniques").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projectId,
        table.day,
        table.type,
        table.href,
        table.country,
        table.device,
      ],
    }),
    index("pageEventsDaily_projectId_day_idx").on(table.projectId, table.day),
  ],
);

// Custom domains — user-owned hostnames (e.g. `landing.miempresa.com` or
// apex `miempresa.com`) pointed at an OpenLen project. One row per
// (project, hostname) pair; UNIQUE on `domain` enforces global one-claim.
//
// Lifecycle:
//   1. Claim — row inserted with verifiedAt null + a random verificationToken
//      shown to the user as the TXT record value they must add to DNS.
//   2. Verify — POST /api/projects/[id]/domains/[domain]/verify resolves
//      _openlen-challenge.<domain> via DNS, compares against the token, and
//      sets verifiedAt on match. Once verified, Caddy's on_demand_tls `ask`
//      endpoint (GET /api/domains/lookup) returns 200 for this host and
//      Caddy auto-issues a Let's Encrypt cert on the next TLS handshake.
//   3. Serve — incoming requests to the custom domain are rewritten by
//      Caddy to /_custom/<host>/<path> and the Next route resolves the
//      project + subdomain + serves the published HTML from disk.
//
// Cascade-deletes with the project. Releasing (DELETE) frees the domain
// for immediate re-claim by another project.
export const customDomains = pgTable(
  "customDomains",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Lowercase RFC 1123 hostname. Apex (`miempresa.com`) and subdomains
    // (`landing.miempresa.com`) are both valid. Validation lives in
    // lib/custom-domains.ts.
    domain: text("domain").notNull().unique(),
    // 24-byte random URL-safe string. The user adds it as the value of a
    // TXT record at `_openlen-challenge.<domain>` to prove ownership.
    // Regenerated on every fresh claim; not user-visible after verification.
    verificationToken: text("verificationToken").notNull(),
    // Set when the TXT check succeeds. Null until then. The Caddy ask
    // endpoint gates cert issuance on this column being non-null.
    verifiedAt: timestamp("verifiedAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("customDomains_projectId_idx").on(table.projectId),
    index("customDomains_verifiedAt_idx").on(table.verifiedAt),
  ],
);

// Webhook idempotency ledger — one row per processed Polar webhook delivery,
// keyed by the `webhook-id` header. The billing webhook INSERTs the id with
// ON CONFLICT DO NOTHING before processing; an empty RETURNING means the
// delivery is a duplicate (Polar retries), so the route short-circuits without
// re-applying the subscription state.
export const processedWebhooks = pgTable("processedWebhooks", {
  id: text("id").primaryKey(),
  receivedAt: timestamp("receivedAt", { mode: "date" }).notNull().defaultNow(),
});

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

// ─── Members module — per-site visitor accounts (magic-link login) ──────────
// A member belongs to ONE published site (projects row), never to the platform
// `users` table — visitor identity is site-scoped by design (a member of site A
// is a stranger on site B). Login is passwordless: memberLoginTokens mirrors
// passwordResetTokens (sha256 hash at rest, short TTL, single-use). Applied in
// prod via `npm run members:migrate` (scripts/members-migrate.ts).

export const siteMembers = pgTable(
  "siteMembers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // stored lowercase, normalized at the edges
    name: text("name"),
    // 'invited' rows (owner pre-approved an email) flip to 'active' on first login.
    status: text("status").$type<"active" | "invited">().notNull().default("active"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    lastLoginAt: timestamp("lastLoginAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("siteMembers_projectId_email_uq").on(table.projectId, table.email),
  ],
);

export const memberLoginTokens = pgTable("memberLoginTokens", {
  tokenHash: text("tokenHash").primaryKey(),
  projectId: text("projectId")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  // Gated page the visitor was trying to reach; the verify redirect is built
  // from THIS stored value (never from request input) — no open redirect.
  slug: text("slug"),
  expires: timestamp("expires", { mode: "date" }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

// Member sessions — server-side, opaque, revocable. The cookie carries a raw
// random token; only its sha256 lands here. Supabase-reference posture: their
// refresh tokens are single-use DB rows (revocation + theft containment live
// server-side); our per-member traffic is small enough to collapse that into
// one stateful session layer — no signed bearer tokens, so there is no
// signing key to rotate and deleting a row IS the revocation.
export const memberSessions = pgTable(
  "memberSessions",
  {
    tokenHash: text("tokenHash").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    memberId: text("memberId")
      .notNull()
      .references(() => siteMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    // Touched (throttled) on protected fetches — powers "last seen" later.
    lastSeenAt: timestamp("lastSeenAt", { mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  },
  (table) => [index("memberSessions_memberId_idx").on(table.memberId)],
);

// Auth audit trail (Supabase-reference). memberId carries NO foreign key on
// purpose — "removed" events must outlive the member row they describe.
export const memberAuthEvents = pgTable(
  "memberAuthEvents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    memberId: text("memberId"),
    email: text("email"),
    // link_requested | login | logout | invited | removed
    type: text("type").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("memberAuthEvents_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// ─── Private Chat module — a closed per-space @username messenger ────────────
// NOT the editor AI transcript (projectChatMessages) nor the Site Assistant.
// Visitor identities are @username + password, scoped to ONE project (a member
// of space A is a stranger in space B). Mirrors the members tables: sha256
// session tokens at rest, host-only cookie, delete-row = revocation. Applied in
// prod via `npm run privatechat:migrate` (the `chat:migrate` name is taken).

export const chatUsers = pgTable(
  "chatUsers",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    username: text("username").notNull(), // lowercase, no leading @, normalized at edges
    passwordHash: text("passwordHash"), // nullable: guests + member-linked users have no password
    email: text("email"), // optional — recovery + offline notifications
    // Links a member-auto-identified chat user to its siteMember. No FK by
    // design (mirrors memberAuthEvents.memberId): the /me bridge re-validates
    // via getMemberById + status before reuse, so a stale id is inert; this also
    // keeps test/guest inserts free of a hard member dependency.
    memberId: text("memberId"),
    displayName: text("displayName"),
    role: text("role").$type<"member" | "agent" | "owner">().notNull().default("member"),
    status: text("status").$type<"active" | "blocked">().notNull().default("active"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("lastSeenAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("chatUsers_projectId_username_uq").on(table.projectId, table.username),
    uniqueIndex("chatUsers_projectId_memberId_uq").on(table.projectId, table.memberId),
  ],
);

export const chatSessions = pgTable(
  "chatSessions",
  {
    tokenHash: text("tokenHash").primaryKey(),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chatUserId: text("chatUserId")
      .notNull()
      .references(() => chatUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("lastSeenAt", { mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  },
  (table) => [index("chatSessions_chatUserId_idx").on(table.chatUserId)],
);

export const chatConversations = pgTable(
  "chatConversations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    aUserId: text("aUserId").notNull(), // normalized pair: aUserId <= bUserId (string compare)
    bUserId: text("bUserId").notNull(),
    lastMessageAt: timestamp("lastMessageAt", { mode: "date" }),
    // Per-conversation last-read timestamps (read receipts). Set to NOW() when
    // the corresponding participant opens the thread (messages GET). Null until
    // first read. aReadAt belongs to aUserId, bReadAt to bUserId.
    aReadAt: timestamp("aReadAt", { mode: "date" }),
    bReadAt: timestamp("bReadAt", { mode: "date" }),
    // Platform user (users.id) currently handling this conversation. Claim =
    // set to self; release = set to null; reassign = owner-only.
    assignedUserId: text("assignedUserId").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assignedAt", { mode: "date" }),
    // How the conversation started. null = normal visitor-initiated chat;
    // "ai_handoff" = escalated from the site assistant. Lets Desk badge it.
    origin: text("origin"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chatConversations_pair_uq").on(table.projectId, table.aUserId, table.bUserId),
    index("chatConversations_a_idx").on(table.aUserId),
    index("chatConversations_b_idx").on(table.bUserId),
  ],
);

export const chatMessages = pgTable(
  "chatMessages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text("conversationId")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    authorId: text("authorId").notNull(), // snapshot, no FK (author may be deleted)
    body: text("body").notNull(), // plaintext; rendered as text, never innerHTML
    createdAt: timestamp("createdAt", { mode: "date", precision: 3 }).notNull().defaultNow(),
    readAt: timestamp("readAt", { mode: "date" }),
  },
  (table) => [
    index("chatMessages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);

export const chatEvents = pgTable(
  "chatEvents",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chatUserId: text("chatUserId"), // snapshot, no FK
    type: text("type").notNull(), // register | login | logout | blocked | message
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("chatEvents_projectId_createdAt_idx").on(table.projectId, table.createdAt)],
);

// Platform users granted Desk access to a project as agents. An agent replies
// AS the business (ownerChatUserId) — the conversation stays 2-participant.
// v1: invite existing OpenLen users only (userId always set on insert).
// uniqueIndex on (projectId, invitedEmail) makes inviteAgent idempotent.
export const chatAgents = pgTable(
  "chatAgents",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("userId").references(() => users.id, { onDelete: "cascade" }), // nullable until accepted (v1: always set)
    invitedEmail: text("invitedEmail").notNull(), // stored lowercase
    status: text("status").$type<"invited" | "active">().notNull().default("invited"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    acceptedAt: timestamp("acceptedAt", { mode: "date" }),
  },
  (t) => [
    uniqueIndex("chatAgents_projectId_email_uq").on(t.projectId, t.invitedEmail),
    index("chatAgents_userId_idx").on(t.userId),
  ],
);

// Magic-link invite tokens for chatAgents (non-registered email invites).
// Same security posture as memberLoginTokens: raw token goes in the email,
// only its sha256 is stored here; single-use; 7-day TTL (invitee may need
// to sign up first). Applied via `npm run privatechat:migrate`.
export const chatAgentInviteTokens = pgTable("chatAgentInviteTokens", {
  tokenHash: text("tokenHash").primaryKey(),
  projectId: text("projectId")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(), // stored lowercase
  expires: timestamp("expires", { mode: "date" }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

// ─── Broadcast module — email your audience (members-only, v1) ──────────────
// Applied in prod via `npm run broadcast:migrate`. Shares the members monthly
// email budget (lib/broadcast/limits.ts). The recipient snapshot is taken at
// SEND time so deleting a member later never erases who actually received a
// past send (GDPR data-subject + audit). Unsubscribe needs NO token table —
// it's a stateless HMAC of (projectId, memberId), durable + derivable (the
// opposite of the single-use random login tokens).

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(), // markdown source
    status: text("status")
      .$type<"draft" | "sending" | "sent" | "failed">()
      .notNull()
      .default("draft"),
    audienceCount: integer("audienceCount"), // resolved at send start
    sentCount: integer("sentCount"), // accepted by Resend
    failedCount: integer("failedCount"),
    failureReason: text("failureReason"),
    sentAt: timestamp("sentAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("broadcasts_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

// Snapshot of who a sent broadcast targeted. memberId carries NO FK on
// purpose (must survive member deletion, like memberAuthEvents.memberId).
export const broadcastRecipients = pgTable(
  "broadcastRecipients",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    broadcastId: text("broadcastId")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    memberId: text("memberId"), // snapshot, no FK
    email: text("email").notNull(), // normalized lowercase
    status: text("status").$type<"accepted" | "failed">().notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("broadcastRecipients_broadcastId_idx").on(table.broadcastId),
  ],
);

// Per-project suppression list. v1: reason 'unsubscribed' only; phase 2 adds
// 'bounced'/'complained' from a Resend webhook (the enum already fits, so no
// later migration). Enforced at audience-resolution time.
export const emailSuppressions = pgTable(
  "emailSuppressions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // normalized lowercase
    reason: text("reason")
      .$type<"unsubscribed" | "bounced" | "complained">()
      .notNull()
      .default("unsubscribed"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("emailSuppressions_projectId_email_uq").on(
      table.projectId,
      table.email,
    ),
  ],
);

// ─── Comments module — members-only commenting on published pages ───────────
// Applied via `npm run comments:migrate`. memberId/authorName/authorEmail are
// SNAPSHOTS (no FK, like broadcastRecipients) so a comment survives member
// deletion for audit, while ban-member (deleting the siteMembers row) still
// stops future posts. body is plain text — escaped on render, NEVER HTML.
// parentId (1-level replies) ships now but is UI-deferred (no later migration).
export const siteComments = pgTable(
  "siteComments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Site page the comment lives on. null = home. Same slug shape as SitePage.
    page: text("page"),
    memberId: text("memberId"), // snapshot, no FK
    authorName: text("authorName"),
    authorEmail: text("authorEmail"), // normalized; never rendered publicly
    body: text("body").notNull(),
    parentId: text("parentId"), // 1-level replies, UI-deferred
    status: text("status")
      .$type<"visible" | "hidden">()
      .notNull()
      .default("hidden"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("siteComments_projectId_page_createdAt_idx").on(
      table.projectId,
      table.page,
      table.createdAt,
    ),
    index("siteComments_projectId_status_idx").on(table.projectId, table.status),
  ],
);

// ─── Bookings module — appointment scheduling on published pages ────────────
// Applied via `npm run bookings:migrate`. Two-table core + an audit log.
//
// bookableServices holds the per-service rules AND its weekly availability +
// date exceptions as JSONB on the row (read as a unit by the availability
// engine — no relational split). weeklyHours: Record<"0".."6", DayRange[]>,
// exceptions: BookingException[] (see lib/bookings/availability.ts).
//
// PAYMENTS ARE OUT OF SCOPE: priceDisplay is an informational STRING only —
// OpenLen never charges for a booking (see BookingsSettings).
export const bookableServices = pgTable(
  "bookableServices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("durationMin").notNull(),
    slotIncrementMin: integer("slotIncrementMin").notNull().default(0), // 0 → use duration
    bufferBeforeMin: integer("bufferBeforeMin").notNull().default(0),
    bufferAfterMin: integer("bufferAfterMin").notNull().default(0),
    minLeadTimeMin: integer("minLeadTimeMin").notNull().default(0),
    maxDaysAhead: integer("maxDaysAhead").notNull().default(30),
    creatorTz: text("creatorTz").notNull(),
    weeklyHours: jsonb("weeklyHours").notNull().default({}),
    exceptions: jsonb("exceptions").notNull().default([]),
    // Seats per slot. v1 is ALWAYS 1 (not a writable input). Seat allocation is
    // NOT built: a real capacity-N must derive a unique seatNo per booking and
    // count overlapping live rows against capacity — NEVER count-then-insert,
    // which reintroduces the soft-cap TOCTOU the slot guard exists to prevent.
    capacity: integer("capacity").notNull().default(1),
    priceDisplay: text("priceDisplay"), // informational TEXT only — never charged
    locationText: text("locationText"), // address / video-call note shown to the visitor
    status: text("status")
      .$type<"active" | "archived">()
      .notNull()
      .default("active"),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("bookableServices_projectId_idx").on(table.projectId, table.status),
  ],
);

// One appointment. id is CLIENT-GENERATED (idempotency key = .ics UID stem),
// so a retried POST can't double-book. memberId/guest* are SNAPSHOTS (no FK)
// so the booking survives member deletion. creatorTz/visitorTz are snapshots
// of the zones at booking time (rules can change later). The no-double-booking
// guard is the partial unique index below — see lib/bookings/store.ts.
export const bookings = pgTable(
  "bookings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    serviceId: text("serviceId")
      .notNull()
      .references(() => bookableServices.id, { onDelete: "cascade" }),
    startUtc: timestamp("startUtc", { mode: "date", withTimezone: true }).notNull(),
    endUtc: timestamp("endUtc", { mode: "date", withTimezone: true }).notNull(),
    seatNo: integer("seatNo").notNull().default(0),
    status: text("status")
      .$type<"pending" | "confirmed" | "cancelled" | "completed" | "no_show">()
      .notNull()
      .default("pending"),
    memberId: text("memberId"), // snapshot, no FK
    guestName: text("guestName"),
    guestEmail: text("guestEmail"), // normalized
    note: text("note"), // visitor's message to the creator
    creatorTz: text("creatorTz").notNull(), // snapshot
    visitorTz: text("visitorTz"), // snapshot of the visitor's zone
    rescheduledFromId: text("rescheduledFromId"),
    rescheduledToId: text("rescheduledToId"),
    reminderStage: integer("reminderStage").notNull().default(0), // high-water: 0 none,1 sent
    icsSequence: integer("icsSequence").notNull().default(0), // ++ on reschedule/cancel
    cancelledAt: timestamp("cancelledAt", { mode: "date", withTimezone: true }),
    // Session visitor id (lib/analytics/cid.ts) — joins this booking back to its
    // view for the Insights funnel's "booked" stage. Null when JS/storage was
    // unavailable at booking time.
    cid: text("cid"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // THE GUARD (exact-instant): at most one live booking per (service, instant,
    // seat). cancelled / completed / no_show rows drop out → the slot frees.
    // A SECOND, overlap-aware guard lives only in bookings-migrate.ts (Drizzle
    // can't express it): a GiST EXCLUDE constraint `bookings_slot_excl` over
    // tstzrange(startUtc,endUtc) per (serviceId,seatNo) WHERE status live —
    // forbids overlapping ranges when slotIncrementMin < durationMin. Both are
    // swallowed by claimBookingSlot's onConflictDoNothing (no target) → slot_taken.
    uniqueIndex("bookings_slot_uq")
      .on(table.serviceId, table.startUtc, table.seatNo)
      .where(sqlOp`status in ('confirmed','pending')`),
    index("bookings_projectId_startUtc_idx").on(table.projectId, table.startUtc),
    index("bookings_serviceId_startUtc_idx").on(table.serviceId, table.startUtc),
    // Reminder/retention sweeps scan live bookings by start time.
    index("bookings_status_startUtc_idx").on(table.status, table.startUtc),
  ],
);

// Append-only audit of everything that happened to a booking. bookingId is a
// snapshot (no FK) so the trail survives a retention sweep of the booking row.
export const bookingEvents = pgTable(
  "bookingEvents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    bookingId: text("bookingId").notNull(), // snapshot, no FK
    type: text("type").notNull(), // created|confirmed|cancelled|rescheduled|reminded|completed|no_show
    actor: text("actor").notNull(), // visitor|owner|system
    detail: jsonb("detail"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("bookingEvents_bookingId_idx").on(table.bookingId, table.createdAt),
  ],
);

// ─── Collections module — owner-managed item lists rendered on the page ─────
// Applied via `npm run collections:migrate`. A "collection" is ONE list (a
// product catalog / menu / listings / events / team / portfolio); collection_items
// are its entries. The published page bakes the items into STATIC HTML at publish
// time (no runtime API, fully edge-cacheable) — this is creator content, not
// per-visitor data, so it re-bakes on publish, never on view.
//
// PAYMENTS ARE OUT OF SCOPE: priceDisplay is an informational STRING only —
// OpenLen never charges (mirrors bookableServices.priceDisplay). The per-item
// CTA links OUT (WhatsApp / external / on-page anchor); there is no checkout.
//
// The collection ROW is the single source of truth for the list config
// (name/preset/layout); project.data.settings.collections holds only `enabled`.
export const collections = pgTable(
  "collections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Relabel-only lens (products|menu|listings|events|team|portfolio). Plain
    // text, no enum, no migration — follows the templates `family`-column convention.
    preset: text("preset").notNull().default("products"),
    layout: text("layout").$type<"grid" | "list">().notNull().default("grid"),
    status: text("status")
      .$type<"active" | "archived">()
      .notNull()
      .default("active"),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("collections_projectId_idx").on(table.projectId, table.status),
    // v1 is single-collection: at most ONE active collection per project. The
    // partial unique index makes getOrCreateDefaultCollection's race converge
    // (mirrors businessProfiles_userId_default_uq).
    uniqueIndex("collections_project_active_uq")
      .on(table.projectId)
      .where(sqlOp`status = 'active'`),
  ],
);

// One item in a collection. projectId is denormalized (mirrors bookings) so
// every query scopes by owner without a join. tags/attrs cover the long tail
// with no per-vertical schema; attrs is hidden from the v1 authoring UI.
export const collectionItems = pgTable(
  "collection_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    collectionId: text("collectionId")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subtitle: text("subtitle"), // relabeled per preset (role / date / location)
    description: text("description"),
    imageUrl: text("imageUrl"), // single hero image, via the asset picker
    priceDisplay: text("priceDisplay"), // informational TEXT only — never charged
    badge: text("badge"), // small pill ("New", "Sold out", "Featured")
    ctaLabel: text("ctaLabel"),
    ctaUrl: text("ctaUrl"), // link-out: WhatsApp / external / on-page anchor
    tags: text("tags").array().notNull().default(sqlOp`'{}'::text[]`),
    attrs: jsonb("attrs").$type<Record<string, string>>().notNull().default({}),
    status: text("status")
      .$type<"published" | "archived">()
      .notNull()
      .default("published"),
    sortOrder: integer("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("collection_items_collectionId_idx").on(table.collectionId, table.sortOrder),
    index("collection_items_projectId_idx").on(table.projectId, table.status),
  ],
);

// External-deploy OAuth connections — one row per (user, provider). The token
// is an ACCOUNT-level credential (connect once, deploy any project), so it
// lives at user grain, not per-project. Powers the Deploy-dropdown "Deploy to
// Vercel" / "Push to GitHub" export targets. The deploy RESULT (which repo /
// project, the live URL) is per-project — see `projectDeployments` below.
//
// accessToken is stored ENCRYPTED (aes-256-gcm via lib/integrations/crypto.ts).
// Both providers issue long-lived tokens (GitHub OAuth-App tokens don't expire;
// Vercel connectable-integration tokens are long-lived), so `refreshToken` is
// reserved for a future token-rotating flow but unused today.
export const userConnections = pgTable(
  "userConnections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'vercel' | 'github'
    // Encrypted at rest. Never returned to the client.
    accessToken: text("accessToken").notNull(),
    refreshToken: text("refreshToken"), // reserved; unused (long-lived tokens)
    // Display label for the connected account: GitHub login, or Vercel
    // user/team name. Surfaced as "Connected as …" in the deploy modal.
    accountLabel: text("accountLabel"),
    // Vercel team id when the integration was installed on a team (null =
    // personal account). Passed as ?teamId= on deploy. Always null for GitHub.
    teamId: text("teamId"),
    scope: text("scope"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("userConnections_userId_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

// Per-project external-deploy result — one row per (project, provider). Tracks
// where this project was last pushed (repo / Vercel project name), its live
// URL, and a content hash for drift detection ("Re-deploy" vs "up to date").
// Mirrors the projects.publishedReleaseSha drift mechanism for openlen.com.
export const projectDeployments = pgTable(
  "projectDeployments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'vercel' | 'github'
    // User-editable target name: the GitHub repo name or the Vercel project
    // name. Appears in the public URL (owner.github.io/<remoteName>,
    // <remoteName>-*.vercel.app). Re-deploying with the same name updates it.
    remoteName: text("remoteName").notNull(),
    liveUrl: text("liveUrl"),
    lastDeployedAt: timestamp("lastDeployedAt", { mode: "date" }),
    // First 12 chars of sha256(optimized export HTML) at last deploy — drift
    // detection vs the project's current optimized HTML.
    lastDeploySha: text("lastDeploySha"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("projectDeployments_projectId_provider_idx").on(
      table.projectId,
      table.provider,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Per-project translation cache (Speak Every Language).
//
// One row per (project, locale): a per-string cache keyed by sha1-16 of the
// SOURCE text, so a republish only sends strings that actually changed to
// Gemini. Rewritten on every publish with exactly the current page's
// strings — stale entries prune themselves. Apply DDL via
// `npm run localize:migrate`.
// ─────────────────────────────────────────────────────────────────────────────

export const projectTranslations = pgTable(
  "projectTranslations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    /** sha1-16(source text) → translated text. */
    entries: jsonb("entries").$type<Record<string, string>>().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("projectTranslations_projectId_locale_idx").on(
      table.projectId,
      table.locale,
    ),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Flight reports — post-publish Lighthouse lab measurements (Born-100 F4).
//
// One row per (project, release sha), written fire-and-forget by
// lib/publish/flight-check.ts after the symlink flip. Scores are 0-100
// category scores; metric columns are the raw Lighthouse numericValues
// (ms / unitless CLS / bytes). Nullable because a category or audit can
// individually error without sinking the whole report. Apply DDL via
// `npm run flight:migrate` (db:push is blocked by unrelated drift).
// ─────────────────────────────────────────────────────────────────────────────

export const flightReports = pgTable(
  "flightReports",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    subdomain: text("subdomain").notNull(),
    releaseSha: text("releaseSha").notNull(),
    perfScore: integer("perfScore"),
    a11yScore: integer("a11yScore"),
    bpScore: integer("bpScore"),
    seoScore: integer("seoScore"),
    lcpMs: integer("lcpMs"),
    cls: real("cls"),
    tbtMs: integer("tbtMs"),
    fcpMs: integer("fcpMs"),
    speedIndexMs: integer("speedIndexMs"),
    totalBytes: integer("totalBytes"),
    requestCount: integer("requestCount"),
    // Top Lighthouse opportunities, pre-digested for future fix-it UI.
    details: jsonb("details").$type<{
      opportunities: Array<{ id: string; title: string; savingsMs: number | null }>;
    }>(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("flightReports_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
    uniqueIndex("flightReports_projectId_releaseSha_idx").on(
      table.projectId,
      table.releaseSha,
    ),
  ],
);

// ─── Web Push notifications — subscriptions, preferences, deliveries, jobs ───
// Applied via `npm run notifications:migrate`. Four tables:
//   pushSubscriptions    — one row per browser endpoint per user
//   notificationPreferences — per-user channel opt-ins + quiet hours
//   notificationDeliveries  — append-only audit of every send attempt
//   notificationJobs     — lightweight poll queue (no pg-boss/Redis)
// The partial unique index on notificationJobs is load-bearing for dedup:
// only one pending job per dedupeKey can exist at a time.

export const pushSubscriptions = pgTable("pushSubscriptions", {
  endpoint: text("endpoint").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  lastUsedAt: timestamp("lastUsedAt", { mode: "date" }),
}, (t) => [index("pushSubscriptions_userId_idx").on(t.userId)]);

export const notificationPreferences = pgTable("notificationPreferences", {
  userId: text("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  webPushEnabled: boolean("webPushEnabled").notNull().default(true),
  emailEnabled: boolean("emailEnabled").notNull().default(true),
  quietFrom: text("quietFrom"), quietUntil: text("quietUntil"),
  timezone: text("timezone").notNull().default("America/Lima"),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
});

export const notificationDeliveries = pgTable("notificationDeliveries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull(),
  channel: text("channel").notNull(),
  status: text("status").$type<"sent" | "failed" | "skipped" | "dlq">().notNull(),
  eventType: text("eventType").notNull(),
  conversationId: text("conversationId"),
  detail: text("detail"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [index("notificationDeliveries_userId_createdAt_idx").on(t.userId, t.createdAt)]);

export const notificationJobs = pgTable("notificationJobs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  dedupeKey: text("dedupeKey"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"pending" | "done" | "dead">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  runAfter: timestamp("runAfter", { mode: "date" }).notNull().defaultNow(),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
}, (t) => [index("notificationJobs_status_runAfter_idx").on(t.status, t.runAfter)]);

// Reactive moderation for the community feed. A visitor reports a public page →
// one row here → admin reviews at /admin/reports and may set the project's
// visibility to 'hidden'. Privacy-first: no raw IP, only a salted UA hash
// (same posture as pageEvents).
export const pageReports = pgTable(
  "pageReports",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    projectId: text("projectId")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(), // 'spam' | 'adult' | 'phishing' | 'other'
    note: text("note"),
    reporterUaHash: text("reporterUaHash"),
    status: text("status").notNull().default("open"), // 'open'|'actioned'|'dismissed'
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("pageReports_status_createdAt_idx").on(t.status, t.createdAt)],
);
