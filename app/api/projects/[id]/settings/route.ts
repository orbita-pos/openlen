import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { isKnownTimeZone } from "@/lib/bookings/tz";
import { db, schema } from "@/lib/db";
import {
  buildAutoMembersPage,
  formConfigKey,
  validatePageSlug,
} from "@/lib/projects/site-pages";
import { reconcileModuleSettings } from "@/lib/projects/module-settings";
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import type {
  FormConfig,
  MusicSettings,
  ProjectData,
} from "@/lib/projects/types";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/projects/[id]/settings — update non-HTML project settings.
//
// Phase 2: per-form config (notify email, success message, redirect). The
// body patches one form (by document-order index); emptied fields are
// dropped so the JSONB doesn't accumulate "" noise.
//
// Read-modify-writes the whole `data` JSONB (last-write-wins, same model as
// PATCH /html). Settings changes never touch `data.html`, so they don't
// snapshot a version — there's nothing new to snapshot.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

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
  members?: { enabled?: boolean; mode?: "open" | "invite" };
  /** Broadcast module switch. Merged into settings.broadcast. */
  broadcast?: { enabled?: boolean };
  /** Comments module switches. Merged into settings.comments. */
  comments?: { enabled?: boolean; moderation?: "all" | "moderated" };
  /** Bookings module switches. Merged into settings.bookings. */
  bookings?: {
    enabled?: boolean;
    creatorTz?: string;
    requireLogin?: boolean;
    autoConfirm?: boolean;
    sendReminders?: boolean;
    retentionDays?: number;
  };
  /** Collections module switch. Merged into settings.collections. */
  collections?: { enabled?: boolean };
  /** WhatsApp button. Merged into settings.whatsapp. Takes effect next publish. */
  whatsapp?: {
    enabled?: boolean;
    number?: string;
    message?: string;
    side?: "left" | "right";
  };
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body || typeof body !== "object") {
    return json({ error: "invalid_body" }, 400);
  }
  const hasFormPatch =
    typeof body.formIndex === "number" && body.patch && typeof body.patch === "object";
  const hasAnalyticsToggle = typeof body.analyticsDisabled === "boolean";
  const hasMotion = "motion" in body;
  if (hasMotion) {
    const m = body.motion;
    if (m !== null && !["calm", "editorial", "dramatic", ""].includes(m as string)) {
      return json(
        { error: "invalid_body", message: "motion must be calm|editorial|dramatic or null" },
        400,
      );
    }
  }
  const hasMusic = "music" in body;
  let musicValue: MusicSettings | null = null;
  if (hasMusic && body.music !== null) {
    const m = body.music;
    if (!m || typeof m !== "object") {
      return json(
        { error: "invalid_body", message: "music must be an object or null" },
        400,
      );
    }
    const src = clean(m.src, MAX_URL);
    if (!src || !isOwnAssetUrl(src, id)) {
      return json(
        { error: "invalid_body", message: "music.src must be one of this project's uploaded assets" },
        400,
      );
    }
    const cover = clean(m.cover, MAX_URL);
    if (cover && !isOwnAssetUrl(cover, id)) {
      return json(
        { error: "invalid_body", message: "music.cover must be one of this project's uploaded assets" },
        400,
      );
    }
    const title = clean(m.title, 120);
    musicValue = {
      src,
      ...(title ? { title } : {}),
      ...(cover ? { cover } : {}),
    };
  }
  const hasMembers = "members" in body;
  if (hasMembers) {
    const m = body.members;
    if (!m || typeof m !== "object") {
      return json(
        { error: "invalid_body", message: "members must be an object" },
        400,
      );
    }
    if ("enabled" in m && typeof m.enabled !== "boolean") {
      return json(
        { error: "invalid_body", message: "members.enabled must be boolean" },
        400,
      );
    }
    if ("mode" in m && m.mode !== "open" && m.mode !== "invite") {
      return json(
        { error: "invalid_body", message: "members.mode must be open|invite" },
        400,
      );
    }
  }
  const hasBroadcast = "broadcast" in body;
  if (hasBroadcast) {
    const b = body.broadcast;
    if (!b || typeof b !== "object") {
      return json({ error: "invalid_body", message: "broadcast must be an object" }, 400);
    }
    if ("enabled" in b && typeof b.enabled !== "boolean") {
      return json(
        { error: "invalid_body", message: "broadcast.enabled must be boolean" },
        400,
      );
    }
  }
  const hasComments = "comments" in body;
  if (hasComments) {
    const c = body.comments;
    if (!c || typeof c !== "object") {
      return json({ error: "invalid_body", message: "comments must be an object" }, 400);
    }
    if ("enabled" in c && typeof c.enabled !== "boolean") {
      return json({ error: "invalid_body", message: "comments.enabled must be boolean" }, 400);
    }
    if ("moderation" in c && c.moderation !== "all" && c.moderation !== "moderated") {
      return json({ error: "invalid_body", message: "comments.moderation must be all|moderated" }, 400);
    }
  }
  const hasBookings = "bookings" in body;
  if (hasBookings) {
    const b = body.bookings;
    if (!b || typeof b !== "object") {
      return json({ error: "invalid_body", message: "bookings must be an object" }, 400);
    }
    for (const k of ["enabled", "requireLogin", "autoConfirm", "sendReminders"] as const) {
      if (k in b && typeof b[k] !== "boolean") {
        return json({ error: "invalid_body", message: `bookings.${k} must be boolean` }, 400);
      }
    }
    if ("creatorTz" in b && b.creatorTz !== undefined) {
      if (typeof b.creatorTz !== "string" || !isKnownTimeZone(b.creatorTz)) {
        return json(
          { error: "invalid_body", message: "bookings.creatorTz must be a valid IANA time zone" },
          400,
        );
      }
    }
    if ("retentionDays" in b && b.retentionDays !== undefined) {
      const r = b.retentionDays;
      if (typeof r !== "number" || !Number.isInteger(r) || r < 0 || r > 3650) {
        return json(
          { error: "invalid_body", message: "bookings.retentionDays must be an integer 0-3650" },
          400,
        );
      }
    }
  }
  const hasCollections = "collections" in body;
  if (hasCollections) {
    const c = body.collections;
    if (!c || typeof c !== "object") {
      return json({ error: "invalid_body", message: "collections must be an object" }, 400);
    }
    if ("enabled" in c && typeof c.enabled !== "boolean") {
      return json({ error: "invalid_body", message: "collections.enabled must be boolean" }, 400);
    }
  }
  const hasWhatsapp = "whatsapp" in body;
  if (hasWhatsapp) {
    const w = body.whatsapp;
    if (!w || typeof w !== "object") {
      return json({ error: "invalid_body", message: "whatsapp must be an object" }, 400);
    }
    if ("enabled" in w && typeof w.enabled !== "boolean") {
      return json({ error: "invalid_body", message: "whatsapp.enabled must be boolean" }, 400);
    }
    if ("number" in w && w.number !== undefined && (typeof w.number !== "string" || w.number.length > 32)) {
      return json({ error: "invalid_body", message: "whatsapp.number must be a string ≤32 chars" }, 400);
    }
    if ("message" in w && w.message !== undefined && (typeof w.message !== "string" || w.message.length > 300)) {
      return json({ error: "invalid_body", message: "whatsapp.message must be a string ≤300 chars" }, 400);
    }
    if ("side" in w && w.side !== undefined && w.side !== "left" && w.side !== "right") {
      return json({ error: "invalid_body", message: "whatsapp.side must be left|right" }, 400);
    }
  }
  const hasScene3d = "scene3d" in body;
  const hasChat = "chat" in body;
  if (hasChat) {
    const c = body.chat;
    if (!c || typeof c !== "object") {
      return json({ error: "invalid_body", message: "chat must be an object" }, 400);
    }
    if ("enabled" in c && typeof c.enabled !== "boolean") {
      return json({ error: "invalid_body", message: "chat.enabled must be boolean" }, 400);
    }
    if ("selfServeJoin" in c && typeof c.selfServeJoin !== "boolean") {
      return json({ error: "invalid_body", message: "chat.selfServeJoin must be boolean" }, 400);
    }
    if ("mount" in c && c.mount !== undefined && c.mount !== "fab" && c.mount !== "section" && c.mount !== "both") {
      return json({ error: "invalid_body", message: "chat.mount must be fab|section|both" }, 400);
    }
    if ("identityMode" in c && c.identityMode !== undefined && c.identityMode !== "guest" && c.identityMode !== "account") {
      return json({ error: "invalid_body", message: "chat.identityMode must be guest|account" }, 400);
    }
    if ("welcome" in c && c.welcome !== undefined && typeof c.welcome !== "string") {
      return json({ error: "invalid_body", message: "chat.welcome must be a string" }, 400);
    }
    if ("theme" in c && c.theme !== undefined && c.theme !== "light" && c.theme !== "dark") {
      return json({ error: "invalid_body", message: "chat.theme must be light|dark" }, 400);
    }
    if ("quickReplies" in c && c.quickReplies !== undefined) {
      if (!Array.isArray(c.quickReplies) || c.quickReplies.length > 6) {
        return json({ error: "invalid_body", message: "chat.quickReplies must be an array of ≤6" }, 400);
      }
      for (const qr of c.quickReplies) {
        if (!qr || typeof qr.q !== "string" || typeof qr.a !== "string") {
          return json({ error: "invalid_body", message: "each quickReply needs string q + a" }, 400);
        }
      }
    }
  }
  if (hasScene3d) {
    const s = body.scene3d;
    if (s !== null) {
      if (!s || typeof s !== "object") {
        return json({ error: "invalid_body", message: "scene3d must be an object or null" }, 400);
      }
      if ("enabled" in s && typeof s.enabled !== "boolean") {
        return json({ error: "invalid_body", message: "scene3d.enabled must be boolean" }, 400);
      }
      if ("spec" in s && s.spec !== undefined) {
        if (JSON.stringify(s.spec).includes("data-slot-path=")) {
          return json({ error: "invalid_body", message: "scene3d.spec contains reserved marker" }, 400);
        }
        // SSRF guard: modelUrl must be relative OR same origin as models host
        if (s.spec && typeof s.spec === 'object' && 'modelUrl' in (s.spec as object)) {
          const modelUrl = (s.spec as any).modelUrl;
          if (typeof modelUrl === 'string' && modelUrl !== '') {
            const modelsHostEnv = process.env.R2_MODELS_PUBLIC_URL ?? process.env.MODELS_PUBLIC_URL ?? 'https://models.openlen.com';
            let allowedOrigin: string | null = null;
            try { allowedOrigin = new URL(modelsHostEnv).origin; } catch { /* relative base — only relative modelUrls allowed */ }
            const isRelative = modelUrl.startsWith('/');
            if (!isRelative) {
              // No absolute origin configured (relative/dev env) — reject any
              // absolute URL; only relative modelUrls are allowed in that case.
              if (allowedOrigin === null) {
                return json({ error: 'invalid_body', message: 'scene3d.spec.modelUrl host not allowed' }, 400);
              }
              try {
                const parsed = new URL(modelUrl);
                if (parsed.protocol !== 'https:' || parsed.origin !== allowedOrigin) {
                  return json({ error: 'invalid_body', message: 'scene3d.spec.modelUrl host not allowed' }, 400);
                }
              } catch {
                return json({ error: 'invalid_body', message: 'scene3d.spec.modelUrl host not allowed' }, 400);
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
    !hasChat &&
    !hasScene3d
  ) {
    return json(
      {
        error: "invalid_body",
        message:
          "expected formIndex+patch OR analyticsDisabled OR motion OR music OR members OR broadcast OR comments OR bookings OR collections OR whatsapp OR chat OR scene3d",
      },
      400,
    );
  }
  if (hasFormPatch) {
    const fi = body.formIndex as number;
    if (!Number.isInteger(fi) || fi < 0 || fi > 99) {
      return json(
        { error: "invalid_body", message: "formIndex must be 0-99" },
        400,
      );
    }
  }

  const rows = await db
    .select({ data: schema.projects.data, title: schema.projects.title })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return json({ error: "not_found" }, 404);

  const data: ProjectData = existing.data;
  const forms: Record<string, FormConfig> = {
    ...(data.settings?.forms ?? {}),
  };

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
        return json({ error: "invalid_body", message: "bad page slug" }, 400);
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
    };
    // One-click promise: turning the module ON with no gated page yet also
    // births the members page (home shell + lock + logout link), atomically
    // in the same write. buildAutoMembersPage null = nothing to create.
    const turningOn =
      body.members.enabled === true && data.settings?.members?.enabled !== true;
    if (turningOn) {
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
      return json(
        { error: "invalid_body", message: "comments require the members module" },
        400,
      );
    }
    const firstEnable =
      body.comments.enabled === true && data.settings?.comments?.enabled !== true;
    nextSettings.comments = {
      ...(data.settings?.comments ?? {}),
      ...("enabled" in body.comments ? { enabled: body.comments.enabled } : {}),
      ...("moderation" in body.comments ? { moderation: body.comments.moderation } : {}),
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
    };
  }
  if (hasCollections && body.collections) {
    nextSettings.collections = {
      ...(data.settings?.collections ?? {}),
      ...("enabled" in body.collections ? { enabled: body.collections.enabled } : {}),
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
  if (hasChat && body.chat?.enabled === true && data.settings?.chat?.enabled !== true) {
    // Auto-provision the owner chat_user so visitors can "message the business".
    // Idempotent; awaited so a follow-up read sees it.
    try {
      await getOrCreateOwnerChatUser(id, session.user.id, {
        email: session.user.email ?? null,
        displayName: existing.title,
      });
    } catch (err) {
      console.warn("[settings] owner chat provisioning failed (will retry lazily)", err);
    }
  }

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

  try {
    await db
      .update(schema.projects)
      .set({ data: nextData, updatedAt: new Date() })
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.userId, session.user.id),
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[projects/settings] db update failed", err);
    return json({ error: "db_update_failed" }, 500);
  }

  // `config` is the per-form config the form-patch flow reads back to
  // update its local mirror; absent on analytics-only updates. `settings`
  // is the full merged settings blob so callers can sync more than the
  // form they just touched. `createdPage` (members auto-page) carries its
  // html so the workspace can mirror data.pages without a refetch.
  const config = formKey !== null ? (forms[formKey] ?? null) : null;
  return json(
    {
      ok: true,
      config,
      settings: reconciledSettings,
      ...(createdPage ? { createdPage } : {}),
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
