import { sql as sqlOp } from "drizzle-orm";
import {
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
    ts: timestamp("ts", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("pageEvents_projectId_ts_idx").on(table.projectId, table.ts),
    index("pageEvents_projectId_type_ts_idx").on(
      table.projectId,
      table.type,
      table.ts,
    ),
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
