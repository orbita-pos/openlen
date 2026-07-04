// The shape of a project's `data` JSONB column.
//
// A project's `data` holds the page as a self-contained HTML string. There
// is no orchestrator envelope: generation is free-form HTML.

/** Per-<form> configuration set in the inspector's Form section (Phase 2).
 *  Stored outside the HTML — the notify email must never ship to the
 *  published page source. */
export interface FormConfig {
  /** Address that gets the lead email. Empty/absent → the account email. */
  notifyEmail?: string;
  /** Message shown after a successful submit. Empty/absent → the default. */
  successMessage?: string;
  /** URL to send the visitor to after submit, instead of the message. */
  redirectUrl?: string;
}

/** Page music — the floating tap-to-play player baked at publish time.
 *  `src` (and optional `cover`) point at this project's uploaded assets
 *  (LocalFs API path or S3 public URL); the audio file itself never lives
 *  in the HTML. */
export interface MusicSettings {
  /** Audio file URL (project asset upload). */
  src: string;
  /** Track title shown in the player. Absent → a generic label. */
  title?: string;
  /** Cover image URL (project asset upload). Absent → a music-note glyph. */
  cover?: string;
}

/** Site assistant — the visitor-facing AI chat on the published page. The
 *  brain (`facts`) never ships in the page source; the widget calls
 *  /api/assistant/[sub] which reads it server-side. */
export interface AssistantSettings {
  /** Master switch. Absent/false → no widget injected, endpoint refuses. */
  enabled?: boolean;
  /** Owner-written business facts (hours, prices, shipping, policies, FAQ)
   *  that the page itself doesn't spell out. */
  facts?: string;
  /** Optional tone steer ("cálido", "formal", …). Absent → default. */
  tone?: string;
}

/** Private chat module — a closed per-space @username messenger. Only the per-site switches live here; chat users/messages live in the chat* tables. */
export interface ChatSettings {
  /** Master switch. Absent/false → chat widget not baked + API routes refuse. */
  enabled?: boolean;
  /** true (default) → any visitor can register a chat username.
   *  false → owner must invite (future). */
  selfServeJoin?: boolean;
  /** Where the widget mounts on the published page. Default "both". */
  mount?: "fab" | "section" | "both";
  /** How non-members identify. "guest" (default) = name + optional email, no password
   *  (= lead capture). "account" = @username + password. Members are auto-identified
   *  regardless (the member bridge). */
  identityMode?: "guest" | "account";
  /** Greeting bubble shown at the top of the "message the business" thread. */
  welcome?: string;
  /** FAQ chips answered client-side on tap (never hits the inbox). */
  quickReplies?: { q: string; a: string }[];
  /** Widget appearance. Default "light". The brand accent is unchanged either way. */
  theme?: "light" | "dark";
}

/** Members module — visitor accounts on the published site (siteMembers). */
export interface MembersSettings {
  /** Master switch. Absent/false → no gating: membersOnly pages publish
   *  public and /api/m/* refuses to issue logins. */
  enabled?: boolean;
  /** "open" → any visitor can sign up via magic link (default).
   *  "invite" → only emails the owner pre-approved can log in. */
  mode?: "open" | "invite";
}

/** Broadcast module — email your members. Rows live in the broadcasts table;
 *  this only holds the per-site master switch (gates the workspace tab). */
export interface BroadcastSettings {
  /** Master switch. Absent/false → the Broadcast tab stays hidden and the
   *  send route refuses. Enabled from a card in the Módulos panel. */
  enabled?: boolean;
}

/** Comments module — members-only commenting on published pages. Requires the
 *  members module. Rows live in siteComments; this holds the per-site switches. */
export interface CommentsSettings {
  /** Master switch. Requires members.enabled. Drives the publish-time widget
   *  inject + the same-host post API. */
  enabled?: boolean;
  /** "moderated" (default) → comments are hidden until the owner approves.
   *  "all" → visible immediately, owner hides/deletes after. */
  moderation?: "all" | "moderated";
}

/** Bookings module — appointment scheduling on the published site. Services +
 *  their wall-clock availability live in the bookableServices table; bookings
 *  in the bookings table. This holds only the per-site switches.
 *
 *  PAYMENTS ARE OUT OF SCOPE BY PRINCIPLE: OpenLen never charges for a booking.
 *  A service may show an informational `priceDisplay` string, but the creator
 *  collects by their own means — OpenLen is not a payment facilitator. */
export interface BookingsSettings {
  /** Master switch. Absent/false → the Reservas tab stays hidden, the widget
   *  is not baked, and /api/bk/* refuses. Enabled from the Módulos panel. */
  enabled?: boolean;
  /** Default IANA zone for new services' wall-clock hours (e.g.
   *  "America/Mexico_City"). Each service snapshots its own creatorTz. */
  creatorTz?: string;
  /** true → only logged-in members (lib/members) can book. false (default) →
   *  guests book with name + email; a logged-in member is linked + prefilled. */
  requireLogin?: boolean;
  /** true (default) → a booking is 'confirmed' on submit. false → it lands
   *  'pending' and the owner approves it from the Reservas panel. */
  autoConfirm?: boolean;
  /** true (default) → the reminder timer emails the visitor before the slot. */
  sendReminders?: boolean;
  /** GDPR retention: a past booking older than this many days is swept by the
   *  reminder timer's housekeeping pass. Default 365; 0 → never. */
  retentionDays?: number;
}

/** Collections module — owner-managed item lists (products / menu / listings /
 *  events / team / portfolio) rendered on the published page. Items live in the
 *  collections + collection_items tables and bake into STATIC HTML at publish
 *  time; this holds only the per-site master switch. The list config
 *  (name / preset / layout) lives on the collection ROW, not here.
 *
 *  PUBLIC + payment-free: a per-item priceDisplay is shown but never charged;
 *  the per-item CTA links out (OpenLen is not a payment facilitator). */
export interface CollectionsSettings {
  /** Master switch. Absent/false → the Collections tab stays hidden and the
   *  grid is not baked. Enabled from a card in the Módulos panel. */
  enabled?: boolean;
}

/** 3D scene module — a gesture-gated WebGL scene baked at publish time.
 *  The AVIF poster is the LCP image; the Three.js runtime loads ONLY on a
 *  "Ver en 3D" tap and only when capability gates pass (WebGL, memory, motion
 *  prefs, data-saver). Stored loosely here; coerced to SceneSpec at bake time. */
export interface Scene3dSettings {
  /** Master switch. Absent/false → nothing baked. */
  enabled?: boolean;
  /** A SceneSpec object. Stored loosely, coerced via coerceSceneSpec() at bake time. */
  spec?: unknown;
}

/** WhatsApp button module — a floating tap-to-chat FAB baked on the published
 *  page. Distinct from the business-profile contact widget (which seeds a full
 *  contact stack at create time from "Mi negocio"): this is a per-page,
 *  publish-time toggle that needs no profile. When the page already carries the
 *  profile contact widget, this is suppressed at bake so there's no double FAB. */
export interface WhatsAppSettings {
  /** Master switch. Absent/false → nothing baked. */
  enabled?: boolean;
  /** Phone number (any format; non-digits stripped). A 10-digit number is
   *  assumed Mexico → +52. Absent/empty → nothing baked even if enabled. */
  number?: string;
  /** Optional prefilled message (wa.me `?text=`). */
  message?: string;
  /** Corner the FAB sits in. Default "right". */
  side?: "left" | "right";
}

/** Project-level settings that aren't part of the HTML document. */
export interface ProjectSettings {
  /** Per-form config, keyed by the form's index — its position among all
   *  <form> elements in document order, so the workspace inspector and the
   *  publish-time wiring agree on which form is which. */
  forms?: Record<string, FormConfig>;
  /** Opt-out for the per-page analytics snippet injected at publish time
   *  (lib/analytics/snippet.ts). Default behaviour is enabled — a true value
   *  here causes publishToDir to skip the inject, leaving the published HTML
   *  with no tracker. The Insights tab still works for whatever rows were
   *  captured before the toggle flipped. */
  analyticsDisabled?: boolean;
  /** Speak Every Language: locale codes the page is also published in
   *  (/<code>/index.html variants, translated at publish time). Validated
   *  against PUBLISH_LOCALES; the page's own language is skipped. */
  languages?: string[];
  /** Motion Looks: scroll-choreography preset baked at publish time
   *  ("calm" | "editorial" | "dramatic"). Absent = no motion. */
  motion?: string;
  /** Page music: the floating player baked at publish time. Absent = none. */
  music?: MusicSettings;
  /** Site assistant: visitor-facing AI chat. Absent = off. */
  assistant?: AssistantSettings;
  /** Private chat module: per-project visitor chat. Absent = off. */
  chat?: ChatSettings;
  /** Members module: visitor login + members-only pages. Absent = off. */
  members?: MembersSettings;
  /** Broadcast module: email your members. Absent = off. */
  broadcast?: BroadcastSettings;
  /** Comments module: members-only comments on published pages. Absent = off. */
  comments?: CommentsSettings;
  /** Bookings module: appointment scheduling on the published site. Absent = off. */
  bookings?: BookingsSettings;
  /** Collections module: owner-managed item lists rendered on the page. Absent = off. */
  collections?: CollectionsSettings;
  /** WhatsApp button: a floating tap-to-chat FAB baked at publish. Absent = off. */
  whatsapp?: WhatsAppSettings;
  /** 3D scene: gesture-gated WebGL scene with AVIF poster baked at publish. Absent = off. */
  scene3d?: Scene3dSettings;
  /** Marketing Kit tab state (register = user-picked giro). */
  marketing?: { register?: string; match?: boolean };
}

/** One additional page of a multi-page site. The home page stays at
 *  ProjectData.html; extra pages live under their URL slug ("menu" →
 *  <sub>.openlen.com/menu). Same HTML contract as the home document. */
export interface SitePage {
  /** Publish-ready static HTML for this page. */
  html: string;
  /** Display name in the site-pages panel. Absent → derived from the slug. */
  title?: string;
  /** Members-only: when the members module is enabled, this page publishes
   *  as a login stub and its real document is served only to a logged-in
   *  member (lib/members). Only subpages can carry this — home never gates. */
  membersOnly?: boolean;
}

/** Shareable draft-preview link. Present once the owner enables "Share a
 *  preview" in the workspace; `token` gates the public GET /p/<id>?t=… handler
 *  that serves the CURRENT draft HTML to anyone holding it — no login, before
 *  the page is ever published to a subdomain. Deleting this revokes every
 *  outstanding link. Never baked into published HTML (it's config, like
 *  settings). */
export interface PreviewSettings {
  token: string;
  /** ISO timestamp; the link 404s once passed. Absent = never expires. */
  expiresAt?: string;
  /** HMAC of the viewer passcode (lib/projects/preview.hashPasscode) — never
   *  the plaintext. Absent = no passcode (anyone with the link gets in). */
  passcodeHash?: string;
}

export interface ProjectData {
  /** Publish-ready static HTML — the source of truth for the project. */
  html: string;
  /** Non-HTML project settings (form config, …). Absent on older rows. */
  settings?: ProjectSettings;
  /** Multi-page: extra pages keyed by slug. Absent/empty = classic
   *  single-page project (every pre-existing row). Home is `html` above. */
  pages?: Record<string, SitePage>;
  /** Shareable draft-preview link. Absent = no preview link issued. */
  preview?: PreviewSettings;
}

// One persisted Chat-tab turn. The Chat panel's live turn type carries HTML
// snapshots for in-session Undo; this is the transcript-only form written to
// `projects.chatHistory` so a page reload — or a sidebar tab switch, which
// unmounts the panel — restores the conversation instead of an empty
// composer. HTML revisions are NOT stored here — those live in
// `projectVersions`.
export interface StoredChatTurn {
  id: string;
  userText: string;
  /** Image the user attached to this turn — shown in the restored bubble. */
  attachedImage?: { url: string; alt?: string };
  assistantReasoning: string;
  /** Settled status only — a turn is persisted once it stops streaming. */
  status: "applied" | "error" | "reverted";
  errorText?: string;
  /** ms-epoch the turn was applied — drives the "Applied · 3h ago" label. */
  appliedAt?: number;
  /** Site page this turn edited. null/undefined = home (data.html); a slug =
   *  data.pages[slug].html. Pre-multipage rows are NULL → home. */
  page?: string | null;
}
