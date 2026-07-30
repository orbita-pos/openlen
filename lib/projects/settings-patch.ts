import { isKnownTimeZone } from "@/lib/bookings/tz";
import {
  buildAutoMembersPage,
  formConfigKey,
  validatePageSlug,
} from "@/lib/projects/site-pages";
import { reconcileModuleSettings } from "@/lib/projects/module-settings";
import { POST_REGISTER } from "@/lib/marketing/post-templates/admin-schemas";
import type {
  FormConfig,
  MusicSettings,
  ProjectData,
  ProjectSettings,
} from "@/lib/projects/types";

// ─────────────────────────────────────────────────────────────────────────────
// Settings-patch core — shared by the PATCH /api/projects/[id]/settings route
// (button path) and the agent (tool-call path). Extracted so both callers
// validate + merge identically instead of diverging.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_EMAIL = 200;
const MAX_MESSAGE = 300;
const MAX_URL = 2000;

interface PatchBody {
  /** Index of the <form> being configured (document order). */
  formIndex?: number;
  /** Multi-page: site page the form lives on (absent = home). The config
   *  persists under "<slug>:<index>" so home's form at the same index keeps
   *  its own config. */
  page?: string;
  /** Fields to merge into that form's config. */
  patch?: {
    notifyEmail?: string;
    successMessage?: string;
    redirectUrl?: string;
  };
  /** Opt-out for the analytics snippet injected at publish time. The
   *  toggle does not retroactively affect already-published HTML — it
   *  only takes effect on the next publish. */
  analyticsDisabled?: boolean;
  /** Motion Looks preset, or null/"" to turn motion off. Takes effect on
   *  the next publish. */
  motion?: string | null;
  /** Page music: the floating player's track, or null to remove it. Takes
   *  effect on the next publish (previews live in the editor). */
  music?: { src?: string; title?: string; cover?: string } | null;
  /** Members module switches. Merged into settings.members; gating takes
   *  effect on the next publish. */
  members?: {
    enabled?: boolean;
    mode?: "open" | "invite";
    passwordLogin?: boolean;
    accountArea?: boolean;
  };
  /** Broadcast module switch. Merged into settings.broadcast. */
  broadcast?: { enabled?: boolean };
  /** Comments module switches. Merged into settings.comments. */
  comments?: { enabled?: boolean; moderation?: "all" | "moderated"; theme?: "light" | "dark" };
  /** Bookings module switches. Merged into settings.bookings. */
  bookings?: {
    enabled?: boolean;
    creatorTz?: string;
    requireLogin?: boolean;
    autoConfirm?: boolean;
    sendReminders?: boolean;
    retentionDays?: number;
    theme?: "light" | "dark";
  };
  /** Collections module switch. Merged into settings.collections. */
  collections?: { enabled?: boolean; theme?: "light" | "dark" };
  /** WhatsApp button. Merged into settings.whatsapp. Takes effect next publish. */
  whatsapp?: {
    enabled?: boolean;
    number?: string;
    message?: string;
    side?: "left" | "right";
  };
  /** Pedidos por WhatsApp. Merged into settings.orders. Takes effect next publish. */
  orders?: { enabled?: boolean; number?: string };
  /** Private chat module. Merged into settings.chat. Takes effect next publish. */
  chat?: {
    enabled?: boolean;
    selfServeJoin?: boolean;
    mount?: "fab" | "section" | "both";
    identityMode?: "guest" | "account";
    welcome?: string;
    quickReplies?: { q: string; a: string }[];
    theme?: "light" | "dark";
  };
  /** 3D scene module. Merged into settings.scene3d, or null to remove it. Takes effect next publish. */
  scene3d?: { enabled?: boolean; spec?: unknown } | null;
  /** Marketing Kit tab state. Merged into settings.marketing. */
  marketing?: { register?: string; match?: boolean };
}

export type SettingsPatchBody = PatchBody;

export type PatchValidation =
  | { ok: true; body: SettingsPatchBody }
  /** `message` absent only for the null/non-object body case — the route
   *  has always answered that one with a bare `{error:"invalid_body"}`. */
  | { ok: false; message?: string };

export interface SettingsPatchOutcome {
  nextData: ProjectData;
  settings: ProjectSettings;
  createdPage: { slug: string; title: string; html: string } | null;
  formKey: string | null;
  chatJustEnabled: boolean;
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Asset URLs in music settings must point at THIS project's uploads —
 *  the relative LocalFs API path or the absolute (LocalFs-with-base / S3)
 *  form, both of which carry `/<projectId>/` in the path. Keeps a page from
 *  pulling audio/covers off arbitrary third-party hosts. */
function isOwnAssetUrl(url: string, projectId: string): boolean {
  return (
    url.includes(`/api/projects/${projectId}/assets/`) ||
    (/^https:\/\//i.test(url) && url.includes(`/${projectId}/`))
  );
}

export function validateSettingsPatch(
  raw: unknown,
  projectId: string,
): PatchValidation {
  const body = raw as PatchBody | null;
  if (!body || typeof body !== "object") {
    return { ok: false };
  }
  const hasFormPatch =
    typeof body.formIndex === "number" && body.patch && typeof body.patch === "object";
  const hasAnalyticsToggle = typeof body.analyticsDisabled === "boolean";
  const hasMotion = "motion" in body;
  if (hasMotion) {
    const m = body.motion;
    if (m !== null && !["calm", "editorial", "dramatic", ""].includes(m as string)) {
      return { ok: false, message: "motion must be calm|editorial|dramatic or null" };
    }
  }
  const hasMusic = "music" in body;
  if (hasMusic && body.music !== null) {
    const m = body.music;
    if (!m || typeof m !== "object") {
      return { ok: false, message: "music must be an object or null" };
    }
    const src = clean(m.src, MAX_URL);
    if (!src || !isOwnAssetUrl(src, projectId)) {
      return { ok: false, message: "music.src must be one of this project's uploaded assets" };
    }
    const cover = clean(m.cover, MAX_URL);
    if (cover && !isOwnAssetUrl(cover, projectId)) {
      return { ok: false, message: "music.cover must be one of this project's uploaded assets" };
    }
  }
  const hasMembers = "members" in body;
  if (hasMembers) {
    const m = body.members;
    if (!m || typeof m !== "object") {
      return { ok: false, message: "members must be an object" };
    }
    if ("enabled" in m && typeof m.enabled !== "boolean") {
      return { ok: false, message: "members.enabled must be boolean" };
    }
    if ("mode" in m && m.mode !== "open" && m.mode !== "invite") {
      return { ok: false, message: "members.mode must be open|invite" };
    }
    if ("passwordLogin" in m && typeof m.passwordLogin !== "boolean") {
      return { ok: false, message: "members.passwordLogin must be boolean" };
    }
    if ("accountArea" in m && typeof m.accountArea !== "boolean") {
      return { ok: false, message: "members.accountArea must be boolean" };
    }
  }
  const hasBroadcast = "broadcast" in body;
  if (hasBroadcast) {
    const b = body.broadcast;
    if (!b || typeof b !== "object") {
      return { ok: false, message: "broadcast must be an object" };
    }
    if ("enabled" in b && typeof b.enabled !== "boolean") {
      return { ok: false, message: "broadcast.enabled must be boolean" };
    }
  }
  const hasComments = "comments" in body;
  if (hasComments) {
    const c = body.comments;
    if (!c || typeof c !== "object") {
      return { ok: false, message: "comments must be an object" };
    }
    if ("enabled" in c && typeof c.enabled !== "boolean") {
      return { ok: false, message: "comments.enabled must be boolean" };
    }
    if ("moderation" in c && c.moderation !== "all" && c.moderation !== "moderated") {
      return { ok: false, message: "comments.moderation must be all|moderated" };
    }
    if ("theme" in c && c.theme !== undefined && c.theme !== "light" && c.theme !== "dark") {
      return { ok: false, message: "comments.theme must be light|dark" };
    }
  }
  const hasBookings = "bookings" in body;
  if (hasBookings) {
    const b = body.bookings;
    if (!b || typeof b !== "object") {
      return { ok: false, message: "bookings must be an object" };
    }
    for (const k of ["enabled", "requireLogin", "autoConfirm", "sendReminders"] as const) {
      if (k in b && typeof b[k] !== "boolean") {
        return { ok: false, message: `bookings.${k} must be boolean` };
      }
    }
    if ("creatorTz" in b && b.creatorTz !== undefined) {
      if (typeof b.creatorTz !== "string" || !isKnownTimeZone(b.creatorTz)) {
        return { ok: false, message: "bookings.creatorTz must be a valid IANA time zone" };
      }
    }
    if ("retentionDays" in b && b.retentionDays !== undefined) {
      const r = b.retentionDays;
      if (typeof r !== "number" || !Number.isInteger(r) || r < 0 || r > 3650) {
        return { ok: false, message: "bookings.retentionDays must be an integer 0-3650" };
      }
    }
    if ("theme" in b && b.theme !== undefined && b.theme !== "light" && b.theme !== "dark") {
      return { ok: false, message: "bookings.theme must be light|dark" };
    }
  }
  const hasCollections = "collections" in body;
  if (hasCollections) {
    const c = body.collections;
    if (!c || typeof c !== "object") {
      return { ok: false, message: "collections must be an object" };
    }
    if ("enabled" in c && typeof c.enabled !== "boolean") {
      return { ok: false, message: "collections.enabled must be boolean" };
    }
    if ("theme" in c && c.theme !== undefined && c.theme !== "light" && c.theme !== "dark") {
      return { ok: false, message: "collections.theme must be light|dark" };
    }
  }
  const hasWhatsapp = "whatsapp" in body;
  if (hasWhatsapp) {
    const w = body.whatsapp;
    if (!w || typeof w !== "object") {
      return { ok: false, message: "whatsapp must be an object" };
    }
    if ("enabled" in w && typeof w.enabled !== "boolean") {
      return { ok: false, message: "whatsapp.enabled must be boolean" };
    }
    if ("number" in w && w.number !== undefined && (typeof w.number !== "string" || w.number.length > 32)) {
      return { ok: false, message: "whatsapp.number must be a string ≤32 chars" };
    }
    if ("message" in w && w.message !== undefined && (typeof w.message !== "string" || w.message.length > 300)) {
      return { ok: false, message: "whatsapp.message must be a string ≤300 chars" };
    }
    if ("side" in w && w.side !== undefined && w.side !== "left" && w.side !== "right") {
      return { ok: false, message: "whatsapp.side must be left|right" };
    }
  }
  const hasOrders = "orders" in body;
  if (hasOrders) {
    const o = body.orders;
    if (!o || typeof o !== "object") {
      return { ok: false, message: "orders must be an object" };
    }
    if ("enabled" in o && typeof o.enabled !== "boolean") {
      return { ok: false, message: "orders.enabled must be boolean" };
    }
    if ("number" in o && !(typeof o.number === "string" && o.number.length <= 32)) {
      return { ok: false, message: "orders.number must be a string ≤32 chars" };
    }
  }
  const hasScene3d = "scene3d" in body;
  const hasChat = "chat" in body;
  if (hasChat) {
    const c = body.chat;
    if (!c || typeof c !== "object") {
      return { ok: false, message: "chat must be an object" };
    }
    if ("enabled" in c && typeof c.enabled !== "boolean") {
      return { ok: false, message: "chat.enabled must be boolean" };
    }
    if ("selfServeJoin" in c && typeof c.selfServeJoin !== "boolean") {
      return { ok: false, message: "chat.selfServeJoin must be boolean" };
    }
    if ("mount" in c && c.mount !== undefined && c.mount !== "fab" && c.mount !== "section" && c.mount !== "both") {
      return { ok: false, message: "chat.mount must be fab|section|both" };
    }
    if ("identityMode" in c && c.identityMode !== undefined && c.identityMode !== "guest" && c.identityMode !== "account") {
      return { ok: false, message: "chat.identityMode must be guest|account" };
    }
    if ("welcome" in c && c.welcome !== undefined && typeof c.welcome !== "string") {
      return { ok: false, message: "chat.welcome must be a string" };
    }
    if ("theme" in c && c.theme !== undefined && c.theme !== "light" && c.theme !== "dark") {
      return { ok: false, message: "chat.theme must be light|dark" };
    }
    if ("quickReplies" in c && c.quickReplies !== undefined) {
      if (!Array.isArray(c.quickReplies) || c.quickReplies.length > 6) {
        return { ok: false, message: "chat.quickReplies must be an array of ≤6" };
      }
      for (const qr of c.quickReplies) {
        if (!qr || typeof qr.q !== "string" || typeof qr.a !== "string") {
          return { ok: false, message: "each quickReply needs string q + a" };
        }
      }
    }
  }
  const hasMarketing = "marketing" in body;
  if (hasMarketing) {
    const m = body.marketing;
    if (!m || typeof m !== "object") {
      return { ok: false, message: "marketing must be an object" };
    }
    if ("register" in m && m.register !== undefined && !POST_REGISTER.safeParse(m.register).success) {
      return { ok: false, message: "marketing.register must be a known register" };
    }
    if ("match" in m && m.match !== undefined && typeof m.match !== "boolean") {
      return { ok: false, message: "marketing.match must be a boolean" };
    }
  }
  if (hasScene3d) {
    const s = body.scene3d;
    if (s !== null) {
      if (!s || typeof s !== "object") {
        return { ok: false, message: "scene3d must be an object or null" };
      }
      if ("enabled" in s && typeof s.enabled !== "boolean") {
        return { ok: false, message: "scene3d.enabled must be boolean" };
      }
      if ("spec" in s && s.spec !== undefined) {
        if (JSON.stringify(s.spec).includes("data-slot-path=")) {
          return { ok: false, message: "scene3d.spec contains reserved marker" };
        }
        // SSRF guard: modelUrl must be relative OR same origin as models host
        if (s.spec && typeof s.spec === 'object' && 'modelUrl' in (s.spec as object)) {
          const modelUrl = (s.spec as any).modelUrl;
          if (typeof modelUrl === 'string' && modelUrl !== '') {
            // Default matches the models storage default (Option B: reuse the
            // curated-images bucket/domain). MUST stay in sync with lib/storage/models.ts.
            const modelsHostEnv = process.env.R2_MODELS_PUBLIC_URL ?? process.env.MODELS_PUBLIC_URL ?? 'https://images.openlen.com';
            let allowedOrigin: string | null = null;
            try { allowedOrigin = new URL(modelsHostEnv).origin; } catch { /* relative base — only relative modelUrls allowed */ }
            // NOT startsWith('//'): protocol-relative URLs are absolute, not relative.
            const isRelative = modelUrl.startsWith('/') && !modelUrl.startsWith('//');
            if (!isRelative) {
              // No absolute origin configured (relative/dev env) — reject any
              // absolute URL; only relative modelUrls are allowed in that case.
              if (allowedOrigin === null) {
                return { ok: false, message: 'scene3d.spec.modelUrl host not allowed' };
              }
              try {
                const parsed = new URL(modelUrl);
                if (parsed.protocol !== 'https:' || parsed.origin !== allowedOrigin) {
                  return { ok: false, message: 'scene3d.spec.modelUrl host not allowed' };
                }
              } catch {
                return { ok: false, message: 'scene3d.spec.modelUrl host not allowed' };
              }
            }
          }
        }
      }
    }
  }
  if (
    !hasFormPatch &&
    !hasAnalyticsToggle &&
    !hasMotion &&
    !hasMusic &&
    !hasMembers &&
    !hasBroadcast &&
    !hasComments &&
    !hasBookings &&
    !hasCollections &&
    !hasWhatsapp &&
    !hasOrders &&
    !hasChat &&
    !hasScene3d &&
    !hasMarketing
  ) {
    return {
      ok: false,
      message:
        "expected formIndex+patch OR analyticsDisabled OR motion OR music OR members OR broadcast OR comments OR bookings OR collections OR whatsapp OR orders OR chat OR scene3d OR marketing",
    };
  }
  if (hasFormPatch) {
    const fi = body.formIndex as number;
    if (!Number.isInteger(fi) || fi < 0 || fi > 99) {
      return { ok: false, message: "formIndex must be 0-99" };
    }
  }

  return { ok: true, body };
}

/**
 * Merge a validated settings patch into the project data.
 *
 * Callers MUST run `validateSettingsPatch` first and pass its `body` here —
 * `applySettingsPatch` assumes validated input and does NOT re-check it. In
 * particular the music own-asset guard (a page may only reference its own
 * uploaded audio/cover) lives in validate, so an unvalidated body would let a
 * third-party asset URL through.
 */
export function applySettingsPatch(
  data: ProjectData,
  body: SettingsPatchBody,
): SettingsPatchOutcome | { error: string } {
  const forms: Record<string, FormConfig> = {
    ...(data.settings?.forms ?? {}),
  };

  const hasFormPatch =
    typeof body.formIndex === "number" && body.patch && typeof body.patch === "object";
  const hasAnalyticsToggle = typeof body.analyticsDisabled === "boolean";
  const hasMotion = "motion" in body;
  const hasMusic = "music" in body;
  const hasMembers = "members" in body;
  const hasBroadcast = "broadcast" in body;
  const hasComments = "comments" in body;
  const hasBookings = "bookings" in body;
  const hasCollections = "collections" in body;
  const hasWhatsapp = "whatsapp" in body;
  const hasOrders = "orders" in body;
  const hasScene3d = "scene3d" in body;
  const hasChat = "chat" in body;
  const hasMarketing = "marketing" in body;

  let musicValue: MusicSettings | null = null;
  if (hasMusic && body.music !== null) {
    const m = body.music as NonNullable<PatchBody["music"]>;
    const src = clean(m.src, MAX_URL);
    const cover = clean(m.cover, MAX_URL);
    const title = clean(m.title, 120);
    musicValue = {
      src,
      ...(title ? { title } : {}),
      ...(cover ? { cover } : {}),
    };
  }

  let formKey: string | null = null;
  if (hasFormPatch) {
    const formIndex = body.formIndex as number;
    const patch = body.patch as NonNullable<PatchBody["patch"]>;
    // Multi-page: a form on a site page persists under its scoped key so
    // home's form at the same index keeps its own config.
    let page: string | null = null;
    if (typeof body.page === "string" && body.page.length > 0) {
      const check = validatePageSlug(body.page);
      if (!check.ok) {
        return { error: "bad page slug" };
      }
      page = check.slug;
    }
    const key = formConfigKey(page, formIndex);
    formKey = key;
    const next: FormConfig = { ...(forms[key] ?? {}) };

    if ("notifyEmail" in patch) {
      const e = clean(patch.notifyEmail, MAX_EMAIL);
      // Basic shape check — a malformed address would just bounce the lead
      // email silently, so reject it here instead of storing it.
      if (e && e.includes("@")) next.notifyEmail = e;
      else delete next.notifyEmail;
    }
    if ("successMessage" in patch) {
      const m = clean(patch.successMessage, MAX_MESSAGE);
      if (m) next.successMessage = m;
      else delete next.successMessage;
    }
    if ("redirectUrl" in patch) {
      const u = clean(patch.redirectUrl, MAX_URL);
      if (u) next.redirectUrl = u;
      else delete next.redirectUrl;
    }

    if (Object.keys(next).length > 0) forms[key] = next;
    else delete forms[key];
  }

  const nextSettings = { ...data.settings, forms };
  if (hasAnalyticsToggle) {
    nextSettings.analyticsDisabled = body.analyticsDisabled === true;
  }
  if (hasMotion) {
    const m = body.motion;
    if (m && m !== "") nextSettings.motion = m;
    else delete nextSettings.motion;
  }
  if (hasMusic) {
    if (musicValue) nextSettings.music = musicValue;
    else delete nextSettings.music;
  }
  let createdPage: { slug: string; title: string; html: string } | null = null;
  if (hasMembers && body.members) {
    nextSettings.members = {
      ...(data.settings?.members ?? {}),
      ...("enabled" in body.members ? { enabled: body.members.enabled } : {}),
      ...("mode" in body.members ? { mode: body.members.mode } : {}),
      ...("passwordLogin" in body.members
        ? { passwordLogin: body.members.passwordLogin }
        : {}),
      ...("accountArea" in body.members
        ? { accountArea: body.members.accountArea }
        : {}),
    };
    // ONE member surface, never two. Turning the module on materializes the
    // door at /cuenta (memberDoorPlan defaults accountArea to on — it's an
    // opt-out since 2026-07-22), so the gated /miembros landing is only born
    // for the opt-out case, where the site would otherwise have no member
    // surface at all. buildAutoMembersPage null = nothing to create.
    const turningOn =
      body.members.enabled === true && data.settings?.members?.enabled !== true;
    if (turningOn && nextSettings.members?.accountArea === false) {
      createdPage = buildAutoMembersPage(data);
    }
  }
  if (hasBroadcast && body.broadcast) {
    nextSettings.broadcast = {
      ...(data.settings?.broadcast ?? {}),
      ...("enabled" in body.broadcast ? { enabled: body.broadcast.enabled } : {}),
    };
  }
  if (hasComments && body.comments) {
    // Comments require the members module (that's the whole anti-spam basis).
    // Honor a members-enable arriving in the SAME PATCH, else the prior state.
    const willHaveMembers =
      (hasMembers && body.members?.enabled === true) ||
      (data.settings?.members?.enabled === true && body.members?.enabled !== false);
    if (body.comments.enabled === true && !willHaveMembers) {
      return { error: "comments require the members module" };
    }
    const firstEnable =
      body.comments.enabled === true && data.settings?.comments?.enabled !== true;
    nextSettings.comments = {
      ...(data.settings?.comments ?? {}),
      ...("enabled" in body.comments ? { enabled: body.comments.enabled } : {}),
      ...("moderation" in body.comments ? { moderation: body.comments.moderation } : {}),
      ...("theme" in body.comments ? { theme: body.comments.theme } : {}),
      // Make the write self-documenting: default to the safe posture on first
      // enable when no moderation is set (don't lean on the read-path default).
      ...(firstEnable &&
      !("moderation" in body.comments) &&
      !data.settings?.comments?.moderation
        ? { moderation: "moderated" as const }
        : {}),
    };
  }
  if (hasBookings && body.bookings) {
    const b = body.bookings;
    nextSettings.bookings = {
      ...(data.settings?.bookings ?? {}),
      ...("enabled" in b ? { enabled: b.enabled } : {}),
      ...("creatorTz" in b && b.creatorTz !== undefined ? { creatorTz: b.creatorTz } : {}),
      ...("requireLogin" in b ? { requireLogin: b.requireLogin } : {}),
      ...("autoConfirm" in b ? { autoConfirm: b.autoConfirm } : {}),
      ...("sendReminders" in b ? { sendReminders: b.sendReminders } : {}),
      ...("retentionDays" in b && b.retentionDays !== undefined
        ? { retentionDays: b.retentionDays }
        : {}),
      ...("theme" in b ? { theme: b.theme } : {}),
    };
  }
  if (hasCollections && body.collections) {
    nextSettings.collections = {
      ...(data.settings?.collections ?? {}),
      ...("enabled" in body.collections ? { enabled: body.collections.enabled } : {}),
      ...("theme" in body.collections ? { theme: body.collections.theme } : {}),
    };
  }
  if (hasWhatsapp && body.whatsapp) {
    const w = body.whatsapp;
    nextSettings.whatsapp = {
      ...(data.settings?.whatsapp ?? {}),
      ...("enabled" in w ? { enabled: w.enabled } : {}),
      ...("number" in w ? { number: (w.number ?? "").trim() } : {}),
      ...("message" in w ? { message: (w.message ?? "").trim() } : {}),
      ...("side" in w ? { side: w.side } : {}),
    };
  }
  if (hasOrders && body.orders) {
    const o = body.orders;
    nextSettings.orders = {
      ...(data.settings?.orders ?? {}),
      ...("enabled" in o ? { enabled: o.enabled } : {}),
      ...("number" in o ? { number: clean(o.number, 32) } : {}),
    };
  }
  if (hasChat && body.chat) {
    const c = body.chat;
    nextSettings.chat = {
      ...(data.settings?.chat ?? {}),
      ...("enabled" in c ? { enabled: c.enabled } : {}),
      ...("selfServeJoin" in c ? { selfServeJoin: c.selfServeJoin } : {}),
      ...("mount" in c ? { mount: c.mount } : {}),
      ...("identityMode" in c ? { identityMode: c.identityMode } : {}),
      ...("welcome" in c ? { welcome: (c.welcome ?? "").trim().slice(0, 200) } : {}),
      ...("theme" in c ? { theme: c.theme } : {}),
      ...("quickReplies" in c ? {
        quickReplies: (c.quickReplies ?? [])
          .map((qr) => ({ q: String(qr.q).trim().slice(0, 40), a: String(qr.a).trim().slice(0, 500) }))
          .filter((qr) => qr.q.length > 0 && qr.a.length > 0)
          .slice(0, 6),
      } : {}),
    };
  }
  if (hasScene3d) {
    if (body.scene3d === null) {
      delete nextSettings.scene3d;
    } else if (body.scene3d) {
      nextSettings.scene3d = {
        ...(data.settings?.scene3d ?? {}),
        ...body.scene3d,
      };
    }
  }
  if (hasMarketing && body.marketing) {
    nextSettings.marketing = {
      ...(data.settings?.marketing ?? {}),
      ...("register" in body.marketing ? { register: body.marketing.register } : {}),
      ...("match" in body.marketing ? { match: body.marketing.match } : {}),
    };
  }

  const chatJustEnabled =
    hasChat && body.chat?.enabled === true && data.settings?.chat?.enabled !== true;

  // Enforce the Members-dependency invariant in one place: disabling Members
  // cascades comments/broadcast OFF and neutralizes bookings.requireLogin, so a
  // stale flag can never bake a dead widget or strand a booking flow.
  const reconciledSettings = reconcileModuleSettings(nextSettings);

  const nextData: ProjectData = {
    ...data,
    settings: reconciledSettings,
    ...(createdPage
      ? {
          pages: {
            ...data.pages,
            [createdPage.slug]: {
              html: createdPage.html,
              title: createdPage.title,
              membersOnly: true,
            },
          },
        }
      : {}),
  };

  return {
    nextData,
    settings: reconciledSettings,
    createdPage,
    formKey,
    chatJustEnabled,
  };
}
