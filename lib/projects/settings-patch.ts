import {
  formConfigKey,
  validatePageSlug,
} from "@/lib/projects/site-pages";
import { POST_REGISTER } from "@/lib/marketing/post-templates/admin-schemas";
import type {
  FormConfig,
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
  /** Identidad estable del `<form>` (`data-ol-form-id`), leída del elemento que
   *  el usuario pulsó. Gana sobre `formIndex` — ver form-identity.ts. */
  formId?: string;
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
  /** Collections module switch. Merged into settings.collections. */
  collections?: { enabled?: boolean; theme?: "light" | "dark" };
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
  if (
    !hasFormPatch &&
    !hasAnalyticsToggle &&
    !hasCollections &&
    !hasChat &&
    !hasMarketing
  ) {
    return {
      ok: false,
      message:
        "expected formIndex+patch OR analyticsDisabled OR collections OR chat OR marketing",
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
  const hasCollections = "collections" in body;
  const hasChat = "chat" in body;
  const hasMarketing = "marketing" in body;

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
    // La IDENTIDAD del formulario manda sobre su posición. El inspector la lee
    // del `data-ol-form-id` del elemento que el usuario acaba de pulsar, así
    // que el ajuste queda atado a ESE formulario y sobrevive a que una edición
    // posterior lo mueva de sitio. Sin identificador —página anterior al
    // estampado, o lectura fallida— se cae a la clave por índice de siempre,
    // que es lo que había antes y sigue funcionando.
    const formId = typeof body.formId === "string" ? body.formId.trim() : "";
    const key = /^f[0-9a-f]{4,32}$/.test(formId)
      ? formId
      : formConfigKey(page, formIndex);
    formKey = key;
    // Migración en el sitio: si este formulario ya tenía ajustes bajo su clave
    // por índice, se MUEVEN a la identidad. Sin esto el dueño tendría que
    // reconfigurar su correo para que el arreglo le sirviera de algo.
    if (key === formId) {
      const heredada = formConfigKey(page, formIndex);
      const vieja = forms[heredada];
      if (vieja && !forms[key]) {
        forms[key] = vieja;
        delete forms[heredada];
      }
    }
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
  if (hasCollections && body.collections) {
    nextSettings.collections = {
      ...(data.settings?.collections ?? {}),
      ...("enabled" in body.collections ? { enabled: body.collections.enabled } : {}),
      ...("theme" in body.collections ? { theme: body.collections.theme } : {}),
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
  if (hasMarketing && body.marketing) {
    nextSettings.marketing = {
      ...(data.settings?.marketing ?? {}),
      ...("register" in body.marketing ? { register: body.marketing.register } : {}),
      ...("match" in body.marketing ? { match: body.marketing.match } : {}),
    };
  }

  const chatJustEnabled =
    hasChat && body.chat?.enabled === true && data.settings?.chat?.enabled !== true;

  // Aquí vivía `reconcileModuleSettings`: el invariante entre módulos, que con
  // Members apagado cascadeaba Comentarios/Broadcast y neutralizaba el
  // "require login" de Reservas. Los cuatro módulos se retiraron el 2026-08-21
  // y el invariante se quedó sin nada que vigilar.
  const reconciledSettings = nextSettings;

  const nextData: ProjectData = {
    ...data,
    settings: reconciledSettings,
  };

  return {
    nextData,
    settings: reconciledSettings,
    formKey,
    chatJustEnabled,
  };
}
