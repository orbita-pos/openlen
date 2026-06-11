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
}

/** One additional page of a multi-page site. The home page stays at
 *  ProjectData.html; extra pages live under their URL slug ("menu" →
 *  <sub>.openlen.com/menu). Same HTML contract as the home document. */
export interface SitePage {
  /** Publish-ready static HTML for this page. */
  html: string;
  /** Display name in the site-pages panel. Absent → derived from the slug. */
  title?: string;
}

export interface ProjectData {
  /** Publish-ready static HTML — the source of truth for the project. */
  html: string;
  /** Non-HTML project settings (form config, …). Absent on older rows. */
  settings?: ProjectSettings;
  /** Multi-page: extra pages keyed by slug. Absent/empty = classic
   *  single-page project (every pre-existing row). Home is `html` above. */
  pages?: Record<string, SitePage>;
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
}
