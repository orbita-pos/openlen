// F1 agent tool runtime — the three tool bodies the model can call
// (leer_estado, editar_pagina, activar_modulo), all built on existing
// cores (settings-patch, html-ops, module-intent, versions, chat/store).
// No new persistence logic here — this wires the model's function calls
// to the same read-modify-write paths the UI buttons already use.
//
// Deps are injected (AgentDeps) so the tool bodies are unit-testable with
// zero DB — realDeps() is the thin drizzle-backed implementation used at
// runtime, and is deliberately NOT unit-tested (the fakes are).
//
// Every tool error is DATA, not a thrown exception: the model gets
// {ok:false, error} back in its functionResponse and decides what to do
// next (retry, ask leer_estado, give up). runAgentTool wraps the whole
// dispatch in try/catch so a bug in one tool can never crash the agent
// loop mid-conversation.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  editImageWithGemini,
  realImageEditTransport,
  type ImageEditInput,
  type ImageEditResult,
} from "@/lib/ai/image-edit-core";
import { describeBehaviorIssues } from "@/lib/behaviors/validate";
import { BEHAVIOR_NAMES } from "@/lib/behaviors/doc";
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { getOrCreateDefaultCollection, setCollectionSource } from "@/lib/collections/store";
import { syncCollectionFromSheet } from "@/lib/collections/sheet-sync";
import { debitCredits } from "@/lib/credits";
import { detectSlotPath, sanitizeForPublish } from "@/lib/html-engine";
import { applyOps, tagWithOpIds, type Op, type OpType } from "@/lib/html-ops";
import { fetchSheet, resolveSheetCsvUrl } from "@/lib/live/sheet-source";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { setProjectUserBrief, USER_BRIEF_MAX } from "@/lib/projects";
import { extForMime, getAssetStorage } from "@/lib/projects/assets";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";
import { validateSubdomain } from "@/lib/subdomain/validate";
import { createSitePage, type CreatePageInput } from "@/lib/projects/create-page";
import { applyModuleIntent } from "@/lib/projects/module-intent";
import {
  applySettingsPatch,
  validateSettingsPatch,
  type SettingsPatchBody,
  type SettingsPatchOutcome,
} from "@/lib/projects/settings-patch";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion, type VersionSource } from "@/lib/projects/versions";
import { projectBusinessProfile, projectWhatsappDefault } from "@/lib/business-profiles/whatsapp-default";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { summarizeBusinessForAgent } from "@/lib/agent/business";
import { redesignWithGemini, type RedesignInput, type RedesignOutcome } from "@/lib/agent/redesign";
import { resolveAIProvider } from "@/lib/ai-provider";
import { liveDataEnabled } from "@/lib/publish/kill-switches";
import { isPublishLocale } from "@/lib/publish/publish-locales";
import { AGENT_MODULES, MOTION_LOOKS, type AgentModule } from "@/lib/agent/catalog";
import { searchCuratedPhotos } from "@/lib/agent/photo-search";
import {
  applyThemeTokensToHtml,
  readThemeModeFromHtml,
  readThemeTokenFromHtml,
} from "@/lib/agent/theme-apply";
import { lookFromAccent, type LookBase } from "@/lib/palette-gen";
import { applyTematicaToHtml, removeTematicaFromHtml } from "@/lib/tematicas/apply-server";
import { deriveContractColors, type BaseColors } from "@/lib/theme-derive";
import { THEME_PRESETS } from "@/lib/theme-presets";

const MAX_EDITS_PER_CALL = 8;
const OP_TYPES: readonly OpType[] = ["replace", "insert_before", "insert_after", "delete"];

// editar_imagen: the source image must decode as one of the formats Gemini's
// image edit accepts, and stays under the same 6MB cap the ai-edit-image route
// enforces on its decoded source.
const IMAGE_EDIT_ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const FETCH_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

/** Bytes of an on-page image, fetched SSRF-guarded, as base64. */
export type FetchedImage =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; error: string };

export interface AgentDeps {
  loadProject(projectId: string, userId: string): Promise<{
    data: ProjectData;
    title: string;
    subdomain: string | null;
    publishedAt: Date | null;
    userBrief: string | null;
  } | null>;
  saveProjectData(projectId: string, userId: string, data: ProjectData): Promise<void>;
  /** The business profile's contact.whatsapp for this project (linked profile,
   *  else the user's default) — the number fallback activar_modulo uses so
   *  whatsapp/pedidos never enable silent-dark without a number to bake. */
  profileWhatsappNumber(projectId: string, userId: string): Promise<string | null>;
  /** P2 — the project's FULL effective business profile (same resolution as
   *  profileWhatsappNumber: linked profile, else user default). Feeds the
   *  ESTADO `negocio` block so the agent knows the owner's real name / rubro /
   *  contact / links instead of asking or inventing. Null when no profile. */
  loadBusinessProfile(projectId: string, userId: string): Promise<BusinessProfileData | null>;
  /** P4 — full-document redesign (one big Gemini call, charged by measured
   *  tokens like editImage). Injected so tools.test.ts fakes it without the
   *  network; realDeps wires redesignWithGemini. */
  redesignDocument(userId: string, input: RedesignInput): Promise<RedesignOutcome>;
  snapshotVersion(args: {
    projectId: string;
    html: string;
    label: string;
    source: string;
    page: string | null;
    isBaseline?: boolean;
  }): Promise<void>;
  provisionOwnerChat(
    projectId: string,
    userId: string,
    opts: { email: string | null; displayName: string },
  ): Promise<void>;
  /** This project's uploaded audio assets — the only tracks poner_musica
   *  may point the page music player at (never external URLs). */
  listAudioAssets(projectId: string): Promise<{ url: string; name: string }[]>;
  /** The "Imágenes by OpenLen" curated-photo catalog manifest, raw and
   *  unvalidated — elegir_foto runs it through searchCuratedPhotos. */
  fetchImageManifest(): Promise<unknown>;
  /** Download an on-page image as base64 — SSRF-guarded (validateUrl, same as
   *  the proxy-image route) + capped + MIME-allowlisted. editar_imagen only
   *  ever passes a URL it already found verbatim in the current document. */
  fetchImage(url: string): Promise<FetchedImage>;
  /** Store edited bytes as a project asset; returns the new asset URL to swap
   *  into the page. Reuses the same storage core as the assets upload route. */
  uploadAsset(
    projectId: string,
    bytes: Buffer,
    mime: string,
    name: string,
  ): Promise<{ url: string }>;
  /** Run the Nano Banana instruction edit — the extracted image-edit core,
   *  bound to the given userId for the debit-on-success charge. */
  editImage(userId: string, input: ImageEditInput): Promise<ImageEditResult>;
  /** Persist the project's userBrief verbatim (recordar_preferencia's only
   *  write path) — realDeps wires this to setProjectUserBrief. Returns false
   *  when the project isn't the caller's (mirrors that function's contract). */
  setUserBrief(projectId: string, userId: string, value: string): Promise<boolean>;
  /** conectar_datos_vivos — reads a Google Sheet's rows from its
   *  ALREADY-RESOLVED export CSV URL (resolveSheetCsvUrl's output). The tool
   *  calls resolveSheetCsvUrl itself FIRST and only ever passes this dep the
   *  resolved URL — never the raw user-supplied one — so the SSRF allowlist
   *  (docs.google.com only) can't be bypassed by an injected fake in tests.
   *  realDeps wires this to fetchSheet(csvUrl).then(d => d.rows). */
  fetchSheetRows(csvUrl: string): Promise<Record<string, string>[]>;
  /** conectar_datos_vivos intent="lista" — get-or-create the project's
   *  default Collection and point its source at this Sheet, which makes the
   *  collection read-only from then on (lib/collections/store.ts's
   *  SheetBackedReadOnlyError). Returns the collection id for the
   *  syncCollection call that follows. */
  setCollectionSheetSource(projectId: string, sheetUrl: string): Promise<string>;
  /** conectar_datos_vivos intent="lista" — initial fill of the collection
   *  from the fetched rows. realDeps wires this to syncCollectionFromSheet. */
  syncCollection(
    projectId: string,
    collectionId: string,
    rows: Record<string, string>[],
  ): Promise<{ upserted: number; archived: number }>;
  /** Rollback del candado si el sync inicial falla tras fijar la fuente —
   *  la colección vuelve a ser editable (source null). Solo se usa en ese
   *  camino de error. */
  clearCollectionSource(projectId: string): Promise<void>;
}

// public/openlen-images/manifest.json is a build-committed static file (see
// scripts/openlen-images/process.ts) — its src.* URLs already point at R2
// (images.openlen.com), only the manifest JSON itself ships locally. deploy.ps1
// copies public/ into .next/standalone/public/ for the self-hosted runtime
// (infra/scripts/deploy.ps1 step 3), so process.cwd()-relative disk read
// resolves correctly in both dev and prod without an app base-URL env var —
// same pattern as app/api/three3d/runtime/route.ts. A network self-fetch would
// need one more moving part (the app's own origin) for zero benefit, since the
// file never changes per-request. Cached in-process for 10 min so a burst of
// elegir_foto calls in one chat turn doesn't re-read+re-parse the JSON.
const IMAGE_MANIFEST_TTL_MS = 10 * 60 * 1000;
let imageManifestCache: { data: unknown; expiresAt: number } | null = null;

async function readImageManifest(): Promise<unknown> {
  const now = Date.now();
  if (imageManifestCache && imageManifestCache.expiresAt > now) {
    return imageManifestCache.data;
  }
  const raw = await readFile(
    join(process.cwd(), "public", "openlen-images", "manifest.json"),
    "utf8",
  );
  const data = JSON.parse(raw) as unknown;
  imageManifestCache = { data, expiresAt: now + IMAGE_MANIFEST_TTL_MS };
  return data;
}

export function realDeps(): AgentDeps {
  return {
    async loadProject(projectId, userId) {
      const rows = await db
        .select({
          data: schema.projects.data,
          title: schema.projects.title,
          subdomain: schema.projects.subdomain,
          publishedAt: schema.projects.publishedAt,
          userBrief: schema.projects.userBrief,
        })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },
    async saveProjectData(projectId, userId, data) {
      await db
        .update(schema.projects)
        .set({ data, updatedAt: new Date() })
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
    },
    async profileWhatsappNumber(projectId, userId) {
      return projectWhatsappDefault(projectId, userId);
    },
    async loadBusinessProfile(projectId, userId) {
      return projectBusinessProfile(projectId, userId);
    },
    async redesignDocument(userId, input) {
      const p = resolveAIProvider("gemini-flash");
      if (!p.key) return { ok: false, error: "GEMINI_API_KEY no configurada" };
      return redesignWithGemini(input, p.model, p.key, {
        debit: (cost) => debitCredits(userId, cost),
      });
    },
    async snapshotVersion(args) {
      // Best-effort, same as the ai-design route: a snapshot failure must
      // never break the tool call that produced real, saved output.
      await createVersion({
        projectId: args.projectId,
        html: args.html,
        label: args.label,
        source: args.source as VersionSource,
        page: args.page,
        isBaseline: args.isBaseline,
      }).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[agent] snapshot failed", err);
      });
    },
    async provisionOwnerChat(projectId, userId, opts) {
      try {
        // Thread the email through so an agent-created owner chat_user carries
        // it — getOrCreateOwnerChatUser short-circuits on an existing row, so a
        // null here would strand the owner without an email forever.
        await getOrCreateOwnerChatUser(projectId, userId, {
          email: opts.email,
          displayName: opts.displayName,
        });
      } catch (err) {
        console.warn("[agent] owner chat provisioning failed (will retry lazily)", err);
      }
    },
    async listAudioAssets(projectId) {
      const assets = await getAssetStorage().listAudio(projectId);
      return assets.map((a) => ({ url: a.url, name: a.filename }));
    },
    async fetchImageManifest() {
      return readImageManifest();
    },
    async fetchImage(url) {
      // Same SSRF guard as GET /api/projects/[id]/proxy-image: validateUrl
      // blocks loopback/RFC-1918/link-local + non-http(s) schemes, and a manual
      // redirect is refused (following one would bypass the validated host).
      const valid = await validateUrl(url);
      if (!valid.ok) return { ok: false, error: "url_blocked" };
      let res: Response;
      try {
        res = await fetch(valid.value.url, {
          redirect: "manual",
          headers: { accept: "image/*" },
        });
      } catch {
        return { ok: false, error: "fetch_failed" };
      }
      if (!res.ok) return { ok: false, error: "upstream_error" };
      const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_EDIT_ALLOWED_MIME.has(mime)) return { ok: false, error: "unsupported_type" };
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared && declared > FETCH_IMAGE_MAX_BYTES) return { ok: false, error: "too_large" };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > FETCH_IMAGE_MAX_BYTES) return { ok: false, error: "too_large" };
      return { ok: true, base64: Buffer.from(buf).toString("base64"), mimeType: mime };
    },
    async uploadAsset(projectId, bytes, mime, _name) {
      // Same storage core as POST /api/projects/[id]/assets — hash-named, so
      // the filename is derived from the bytes (the display name is unused).
      const ext = extForMime(mime) ?? "png";
      const meta = await getAssetStorage().put(projectId, bytes, ext, mime);
      return { url: meta.url };
    },
    async editImage(userId, input) {
      return editImageWithGemini(input, {
        callGemini: realImageEditTransport(),
        debit: (cost) => debitCredits(userId, cost),
      });
    },
    async setUserBrief(projectId, userId, value) {
      return setProjectUserBrief(projectId, userId, value);
    },
    async fetchSheetRows(csvUrl) {
      const data = await fetchSheet(csvUrl);
      return data.rows;
    },
    async setCollectionSheetSource(projectId, sheetUrl) {
      const col = await getOrCreateDefaultCollection(projectId);
      await setCollectionSource(projectId, { sheet: sheetUrl });
      return col.id;
    },
    async syncCollection(projectId, collectionId, rows) {
      return syncCollectionFromSheet(projectId, collectionId, rows);
    },
    async clearCollectionSource(projectId) {
      await setCollectionSource(projectId, null);
    },
  };
}

export interface AgentSession {
  projectId: string;
  userId: string;
  /** Documento ACTIVO actual, etiquetado — mutado por editar_pagina. Home o
   *  subpágina según `page`; F4 Task 2 makes every tool read/write through
   *  this session's active slot instead of always data.html. */
  taggedHtml: string;
  /** F4 Task 1 — the slug of the page this turn is active on (route-validated
   *  against data.pages), or null for the home document (data.html). Threaded
   *  from the route's own validation, cloned from ai-design's page handling.
   *  Read-only in T1 — T2 makes tool writes respect it (the W1 pin). */
  page: string | null;
  /** Session email (session.user.email), threaded from the route so an
   *  agent-provisioned owner chat_user is created WITH an email — mirrors
   *  what the settings route passes to getOrCreateOwnerChatUser. */
  ownerEmail: string | null;
  /** Successful editar_imagen calls so far this request. The route inits it to
   *  0; the tool caps it at 1 per turn (each edit is a paid Gemini image op). */
  imageEditsThisTurn: number;
  /** P4 — successful redisenar_pagina calls this request. Optional so existing
   *  session constructors keep working; the tool treats absent as 0 and caps
   *  at 1 (a redesign is one big paid call AND a whole-document rewrite —
   *  two in one turn means the model is flailing, not designing). */
  redesignsThisTurn?: number;
  /** elegir_foto calls so far this request. Read-only + exempt from the action
   *  budget, but the curated catalog is finite: after the 2nd empty result the
   *  tool tells the model to pivot instead of retrying variants, and a hard
   *  per-turn ceiling refuses further searches — so a hunt for a genre the
   *  catalog lacks (e.g. terror/gore) can't loop until the turn cap. Route
   *  inits it to 0. */
  photoSearchesThisTurn: number;
}

export interface ToolOutcome {
  /** functionResponse.response que vuelve al modelo. Siempre presente. */
  response: Record<string, unknown>;
  /** Tarjeta para el stream (ausente en leer_estado). */
  action?: { tool: string; ok: boolean; summary: string };
  /** HTML nuevo (sin op-ids) para refrescar el iframe. */
  updatedHtml?: string;
  /** F4 Task 4 — which slot `updatedHtml` belongs to (session.page at the
   *  moment of the write), null for home. Required whenever `updatedHtml` is
   *  set: `trabajar_en_pagina` can move `session.page` mid-turn, so the html
   *  the loop is about to emit may target a DIFFERENT page than the one the
   *  turn started on — the panel needs this to paint the right canvas slot. */
  page?: string | null;
  /** El gate de publicación (publicar). Presente ⇒ el loop emite un evento
   *  `confirm` y le pasa al modelo un estado "esperando_confirmacion". La
   *  herramienta JAMÁS publica: el tap del usuario en la tarjeta es la única
   *  vía que llama al endpoint real (spec §4.4). */
  confirm?: { action: "publicar"; subdominio: string; idiomas: string[]; republicar: boolean };
}

// AgentModule name -> the settings key it actually lives under. Identity for
// every module except "pedidos", whose settings live at settings.orders (the
// activar_modulo enum value stays "pedidos" — user-facing Spanish — while the
// persisted patch/read key matches the OrdersSettings field name).
const MODULE_SETTINGS_KEY: Record<
  AgentModule,
  "members" | "bookings" | "collections" | "chat" | "whatsapp" | "comments" | "orders"
> = {
  members: "members",
  bookings: "bookings",
  collections: "collections",
  chat: "chat",
  whatsapp: "whatsapp",
  comments: "comments",
  pedidos: "orders",
};

export function summarizeProjectState(row: {
  data: ProjectData;
  title: string;
  subdomain: string | null;
  publishedAt: Date | null;
}): Record<string, unknown> {
  const modulos = {} as Record<AgentModule, boolean>;
  for (const m of AGENT_MODULES) {
    modulos[m] = row.data.settings?.[MODULE_SETTINGS_KEY[m]]?.enabled === true;
  }
  return {
    titulo: row.title,
    publicado: row.publishedAt !== null,
    subdominio: row.subdomain,
    paginas: Object.keys(row.data.pages ?? {}),
    modulos,
  };
}

async function toolLeerEstado(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const response = summarizeProjectState(row);
  // F4 Task 2 — explicit home signal (the T1 reviewer's flagged gap): home
  // reads "principal" here rather than being silently absent, unlike the
  // ESTADO block's context string (which omits it to hold F3 byte-identity).
  response.pagina_activa = session.page ?? "principal";
  // P2 — the owner's real business data rides every state read, same as the
  // initial ESTADO block. Absent (not null) when there's no filled profile.
  const negocio = summarizeBusinessForAgent(
    await deps.loadBusinessProfile(session.projectId, session.userId),
  );
  if (negocio) response.negocio = negocio;
  if (args.incluir_documento === true) {
    session.taggedHtml = tagWithOpIds(activeHtml(row.data, session.page) ?? "").taggedHtml;
    response.documento = session.taggedHtml;
  }
  return { response };
}

function buildModulePatch(modulo: AgentModule, encender: boolean, numero?: string): SettingsPatchBody {
  switch (modulo) {
    case "members":
      return encender
        ? { members: { enabled: true, passwordLogin: true, accountArea: true } }
        : { members: { enabled: false } };
    case "bookings":
      return { bookings: { enabled: encender } };
    case "collections":
      return { collections: { enabled: encender } };
    case "chat":
      return { chat: { enabled: encender } };
    case "whatsapp":
      return encender
        ? { whatsapp: { enabled: true, ...(numero ? { number: numero } : {}) } }
        : { whatsapp: { enabled: false } };
    case "comments":
      return { comments: { enabled: encender } };
    case "pedidos":
      return encender ? { orders: { enabled: true, number: numero } } : { orders: { enabled: false } };
  }
}

// Shared by activar_modulo and conectar_datos_vivos (intent="lista", which
// must silently ensure the Collections module is on before a Sheet connect —
// cero-fricción means the owner never has to know "activar módulo" is a
// separate step). validate -> apply -> chat-provision-if-needed -> save, the
// SAME pipeline the button/route path uses (applySettingsPatch may do more
// than flip a boolean — e.g. members' auto-page birth, reconcileModuleSettings'
// cross-module cascade — so every settings write funnels through here rather
// than each caller re-deriving nextData by hand).
async function activateModulePatch(
  session: AgentSession,
  deps: AgentDeps,
  row: { data: ProjectData; title: string },
  patchBody: SettingsPatchBody,
): Promise<{ ok: true; outcome: SettingsPatchOutcome } | { ok: false; error: string }> {
  const validation = validateSettingsPatch(patchBody, session.projectId);
  if (!validation.ok) {
    return { ok: false, error: validation.message ?? "patch inválido" };
  }

  const outcome = applySettingsPatch(row.data, validation.body);
  if ("error" in outcome) {
    return { ok: false, error: outcome.error };
  }

  if (outcome.chatJustEnabled) {
    await deps.provisionOwnerChat(session.projectId, session.userId, {
      email: session.ownerEmail,
      displayName: row.title,
    });
  }
  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return { ok: true, outcome };
}

async function toolActivarModulo(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const modulo = args.modulo;
  if (typeof modulo !== "string" || !(AGENT_MODULES as readonly string[]).includes(modulo)) {
    return { response: { ok: false, error: "módulo desconocido" } };
  }
  const encender = args.encender !== false;

  // Loaded up-front (moved ahead of buildModulePatch) so the "pedidos" case can
  // resolve its number-fallback chain from the existing row before the patch
  // is built — never a silent-dark { enabled: true } with no number to bake.
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  let numero: string | undefined;
  if (modulo === "pedidos" && encender) {
    const resuelto =
      (typeof args.numero === "string" && args.numero.trim()) ||
      row.data.settings?.orders?.number ||
      row.data.settings?.whatsapp?.number ||
      (await deps.profileWhatsappNumber(session.projectId, session.userId)) ||
      null;
    if (!resuelto) {
      return {
        response: {
          ok: false,
          error:
            'pedidos necesita el número de WhatsApp del negocio y no hay ninguno guardado — pregúntale al usuario su número (10 dígitos MX) y vuelve a llamar activar_modulo con modulo="pedidos" y numero',
        },
      };
    }
    numero = resuelto;
  }
  // WhatsApp mirrors pedidos: enabling without a number would bake nothing
  // (silent-dark FAB). Chain: explicit arg > the module's saved number > the
  // business profile's contact.whatsapp; none → ask the user for it.
  if (modulo === "whatsapp" && encender) {
    const resuelto =
      (typeof args.numero === "string" && args.numero.trim()) ||
      row.data.settings?.whatsapp?.number ||
      (await deps.profileWhatsappNumber(session.projectId, session.userId)) ||
      null;
    if (!resuelto) {
      return {
        response: {
          ok: false,
          error:
            'whatsapp necesita el número del negocio y no hay ninguno guardado (ni en el módulo ni en «Mi negocio») — pregúntale al usuario su número (10 dígitos MX) y vuelve a llamar activar_modulo con modulo="whatsapp" y numero',
        },
      };
    }
    numero = resuelto;
  }

  const patchBody = buildModulePatch(modulo as AgentModule, encender, numero);
  const activated = await activateModulePatch(session, deps, row, patchBody);
  if (!activated.ok) {
    return { response: { ok: false, error: activated.error } };
  }

  return {
    response: {
      ok: true,
      modulo,
      encendido: encender,
      ...(activated.outcome.createdPage ? { paginaCreada: activated.outcome.createdPage.slug } : {}),
    },
    action: { tool: "activar_modulo", ok: true, summary: modulo },
  };
}

async function toolCambiarMotion(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const look = args.look;
  if (typeof look !== "string" || !(MOTION_LOOKS as readonly string[]).includes(look)) {
    return { response: { ok: false, error: "look desconocido" } };
  }
  const patchBody: SettingsPatchBody = { motion: look === "off" ? null : look };
  const validation = validateSettingsPatch(patchBody, session.projectId);
  if (!validation.ok) {
    return { response: { ok: false, error: validation.message ?? "patch inválido" } };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const outcome = applySettingsPatch(row.data, validation.body);
  if ("error" in outcome) {
    return { response: { ok: false, error: outcome.error } };
  }
  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return {
    response: { ok: true, motion: look === "off" ? null : look },
    action: { tool: "cambiar_motion", ok: true, summary: look },
  };
}

async function toolPonerMusica(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const accion = args.accion;
  if (accion !== "poner" && accion !== "quitar") {
    return { response: { ok: false, error: "acción desconocida (usa poner|quitar)" } };
  }

  let patchBody: SettingsPatchBody;
  if (accion === "quitar") {
    patchBody = { music: null };
  } else {
    const assetUrl = typeof args.asset_url === "string" ? args.asset_url : "";
    const assets = await deps.listAudioAssets(session.projectId);
    const match = assetUrl ? assets.find((a) => a.url === assetUrl) : undefined;
    if (!match) {
      // Asset URLs are content-hash-named — the model can't guess one. Hand it
      // the real {nombre, url} pairs so a bare `{accion:"poner"}` (or a wrong
      // asset_url) becomes a picker, not a dead-end retry loop.
      const pistas = assets.map((a) => ({ nombre: a.name, url: a.url }));
      const disponibles = assets.length
        ? `Disponibles: ${assets.map((a) => a.name).join(", ")}. Elige un url de "pistas" y vuelve a llamar.`
        : "No hay pistas subidas — pide al usuario que suba una en el panel Música.";
      return {
        response: {
          ok: false,
          error: `asset_url debe ser una de las pistas YA SUBIDAS de este proyecto. ${disponibles}`,
          pistas,
        },
      };
    }
    patchBody = { music: { src: match.url, title: match.name } };
  }

  const validation = validateSettingsPatch(patchBody, session.projectId);
  if (!validation.ok) {
    return { response: { ok: false, error: validation.message ?? "patch inválido" } };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const outcome = applySettingsPatch(row.data, validation.body);
  if ("error" in outcome) {
    return { response: { ok: false, error: outcome.error } };
  }
  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return {
    response: { ok: true, accion },
    // F4-T8 i18n sweep: `accion` ("poner"/"quitar") is a fixed Spanish enum
    // value from the tool schema — fine for the model (response.accion,
    // unchanged), but the action card renders `summary` directly with no
    // i18n. Send a stable English code instead; agent-action-card.tsx maps
    // it to a localized "On"/"Off" label (×10).
    action: { tool: "poner_musica", ok: true, summary: accion === "poner" ? "on" : "off" },
  };
}

async function toolActivar3d(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (typeof args.encender !== "boolean") {
    return { response: { ok: false, error: "encender debe ser boolean" } };
  }
  const encender = args.encender;

  const patchBody: SettingsPatchBody = { scene3d: encender ? { enabled: true } : null };
  const validation = validateSettingsPatch(patchBody, session.projectId);
  if (!validation.ok) {
    return { response: { ok: false, error: validation.message ?? "patch inválido" } };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const outcome = applySettingsPatch(row.data, validation.body);
  if ("error" in outcome) {
    return { response: { ok: false, error: outcome.error } };
  }
  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return {
    response: { ok: true, encendido: encender },
    // F4-T8 i18n sweep: "encendida"/"apagada" was a bare Spanish literal with
    // no i18n path — the action card renders `summary` verbatim. Send a
    // stable English code; agent-action-card.tsx maps it to a localized
    // "On"/"Off" label (×10), same convention as poner_musica above.
    action: { tool: "activar_3d", ok: true, summary: encender ? "on" : "off" },
  };
}

async function toolPrepararMarketing(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const registro = args.registro;
  if (typeof registro !== "string" || registro.length === 0) {
    return { response: { ok: false, error: "registro es requerido" } };
  }
  const combinar = args.combinar === true;

  const patchBody: SettingsPatchBody = { marketing: { register: registro, match: combinar } };
  const validation = validateSettingsPatch(patchBody, session.projectId);
  if (!validation.ok) {
    return { response: { ok: false, error: validation.message ?? "patch inválido" } };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const outcome = applySettingsPatch(row.data, validation.body);
  if ("error" in outcome) {
    return { response: { ok: false, error: outcome.error } };
  }
  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return {
    response: { ok: true, registro, combinar, pestana: "marketing" },
    action: { tool: "preparar_marketing", ok: true, summary: registro },
  };
}

async function toolCrearPagina(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const input: CreatePageInput = {
    slug: typeof args.slug === "string" ? args.slug : undefined,
    title: typeof args.titulo === "string" ? args.titulo : undefined,
    module:
      args.modulo === "bookings" || args.modulo === "collections"
        ? args.modulo
        : undefined,
  };

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const outcome = createSitePage(row.data, input);
  if ("error" in outcome) {
    return { response: { ok: false, error: outcome.message } };
  }

  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return {
    response: { ok: true, slug: outcome.slug, titulo: outcome.title },
    action: { tool: "crear_pagina", ok: true, summary: outcome.slug },
  };
}

interface RawEdit {
  op?: unknown;
  target?: unknown;
  new_html?: unknown;
}

type PersistResult =
  | { ok: true; finalHtml: string; aviso?: string }
  | { ok: false; error: string };

// The sanitizer silently deletes <script>, on* handlers and <iframe> from any
// HTML the model writes. Silently, to the MODEL too — which is how the agent
// ends a turn saying "listo, ya te puse el mapa" over a document where the
// iframe no longer exists. That's not a bad edit, it's a false claim, and the
// honesty rule can't fire on a signal the model never receives. So: turn the
// removal into a fact the model must answer for, phrased as what it now has to
// DO. NB the napi surface is camelCase (eventHandlers, not event_handlers) — a
// snake_case key reads undefined and this whole guard silently never fires.
//
// `names` is injectable (defaults to the real BEHAVIOR_NAMES, derived from
// BEHAVIOR_ORDER — see lib/behaviors/doc.ts) SOLO para el test de conformidad
// que blinda esto: prueba que esta función interpola lo que se le pase (nunca
// una lista propia hardcodeada) y que la llamada real más abajo usa la
// constante compartida — ver lib/agent/tools.test.ts, "Arreglo 1". El único
// call site de producción nunca pasa un segundo argumento.
export function sanitizeAviso(
  removed: {
    scripts: number;
    eventHandlers: number;
    iframes: number;
  },
  names: string = BEHAVIOR_NAMES,
): string | undefined {
  const parts: string[] = [];
  if (removed.scripts > 0 || removed.eventHandlers > 0) {
    parts.push(
      `Se BORRÓ el JavaScript que escribiste (${removed.scripts} <script>, ${removed.eventHandlers} atributos on*): OpenLen nunca ejecuta JS de la página. Si eso cableaba algo (un contador, un filtro, una caja de luz, un botón de copiar, tabs, un acordeón, un menú móvil), ese control quedó MUERTO. Arréglalo en este orden: (1) ¿hay una CONDUCTA para esto? — ${names}: emite SOLO su marcador data-ol-* y OpenLen hornea el runtime real; (2) si ninguna aplica, ¿lo resuelve CSS puro? (<details>/<summary>, checkbox + peer-checked, :target); (3) si tampoco, dile al usuario con honestidad que no se puede.`,
    );
  }
  if (removed.iframes > 0) {
    parts.push(
      `Se BORRARON ${removed.iframes} <iframe>: no se pueden embeber (ni mapas, ni Spotify, ni Calendly). Si era un video de YouTube/Vimeo, NO necesitas iframe: pon un <a href> normal al video y al publicar se convierte solo en reproductor. Si era otra cosa, no existe — dilo con honestidad.`,
    );
  }
  if (parts.length === 0) return undefined;
  return `${parts.join(" ")} DÍSELO al usuario en tu respuesta; jamás afirmes que pusiste lo que fue removido.`;
}

// F4 Task 2 — every read of "the document" must resolve through the
// session's active slot, not always data.html: page=null → home (data.html),
// page="<slug>" → that subpage's own document (data.pages[slug].html).
// This is the single choke point the W1 pin depends on for READS; writes go
// through the mirrored branch inside persistHtmlChange below.
function activeHtml(data: ProjectData, page: string | null): string | null {
  return page ? data.pages?.[page]?.html ?? null : data.html ?? null;
}

// Shared F1 persist pipeline — same block editar_pagina always ran:
// editor-mode marker guard -> passHtmlGate (sanitize, normalize, meta,
// behaviours — fail closed) -> module-intent -> snapshot pre/post -> save ->
// re-tag session.taggedHtml.
// Any tool that hands the model a mutated document (editar_pagina,
// cambiar_tema, …) funnels its candidate HTML through this so persistence
// semantics never drift between tools.
//
// F4 Task 2 — THE W1 PIN: which slot gets written is keyed off
// session.page, cloned from ai-design's own page-branch (route.ts, the
// `nextData = pageSlug ? {...pages spread...} : {...home...}` shape) — an
// immutable spread so writing a subpage NEVER touches data.html or any
// sibling page, and writing home NEVER touches data.pages.
async function persistHtmlChange(
  session: AgentSession,
  deps: AgentDeps,
  candidateHtml: string,
  label: string,
  opts: { isBaseline?: boolean } = {},
): Promise<PersistResult> {
  // Editor-mode marker guard first (specific message), then the broader
  // sanitize pass (defense in depth — mirrors ai-design route).
  if (detectSlotPath(candidateHtml)) {
    return { ok: false, error: "el HTML contiene un marcador reservado (data-slot-path)" };
  }
  // Fail closed, through the one gate. `seal: false` — nothing is served from
  // here, publishToDir seals at publish time; `render: false` — an agent turn
  // cannot pay a twenty-second browser launch, publish verifies instead.
  const gated = await passHtmlGate(
    candidateHtml,
    { sanitize: sanitizeForPublish },
    { render: false, seal: false, behaviors: "block" },
  );
  if (!gated.ok) {
    // Task 16's rule, now enforced instead of advised: un data-ol-* mal
    // cableado ya no llega al documento guardado — se rechaza y la página que
    // el usuario ya tenía queda byte-intacta. El modelo sigue viendo TODAS
    // las razones: un turno puede a la vez perder un <script> Y traer una
    // conducta mal cableada, y tiene que arreglar las dos en este mismo
    // turno; contarle solo la que bloqueó lo devuelve con el mismo script
    // condenado pegado a un botón ya corregido.
    const strippedMsg = gated.removed ? sanitizeAviso(gated.removed) : undefined;
    const behaviorList = describeBehaviorIssues([...(gated.issues ?? [])]);
    const whyMsg = behaviorList
      ? `Hay conductas mal cableadas que nacerían MUERTAS en la página: ${behaviorList}. NO se guardó nada — arréglalas y vuelve a mandar el documento en este mismo turno.`
      : gated.code === "reserved_marker"
        ? "el HTML contiene un marcador reservado (data-slot-path)"
        : `el HTML no pasó la puerta de publicación (${gated.code}${gated.detail ? `: ${gated.detail}` : ""})`;
    return {
      ok: false,
      error: [strippedMsg, whyMsg].filter((m): m is string => Boolean(m)).join(" "),
    };
  }

  const finalHtml = gated.html;
  // Behaviours are the gate's call now, so the only thing left to warn about
  // is what the sanitizer removed from a document that DID pass.
  const aviso = sanitizeAviso(gated.removed);

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { ok: false, error: "proyecto no encontrado" };

  const moduleIntent = applyModuleIntent(row.data.settings, finalHtml);
  const withSettings = moduleIntent.enabled.length ? { settings: moduleIntent.settings } : {};
  const nextData: ProjectData = session.page
    ? {
        ...row.data,
        ...withSettings,
        pages: {
          ...row.data.pages,
          [session.page]: { ...row.data.pages?.[session.page], html: finalHtml },
        },
      }
    : { ...row.data, html: finalHtml, ...withSettings };

  const preEditHtml = activeHtml(row.data, session.page);
  if (preEditHtml && preEditHtml !== finalHtml) {
    await deps.snapshotVersion({
      projectId: session.projectId,
      html: preEditHtml,
      label: "Before AI edit",
      source: "manual",
      page: session.page,
    });
  }

  await deps.saveProjectData(session.projectId, session.userId, nextData);

  await deps.snapshotVersion({
    projectId: session.projectId,
    html: finalHtml,
    label,
    source: "chat",
    page: session.page,
    isBaseline: opts.isBaseline,
  });

  // Ids change after every apply — re-tag so the next editar_pagina call
  // has fresh targets to address.
  session.taggedHtml = tagWithOpIds(finalHtml).taggedHtml;

  return { ok: true, finalHtml, ...(aviso ? { aviso } : {}) };
}

// P4 — rediseño total del documento activo. Una llamada grande de modelo
// (deps.redesignDocument) + el MISMO embudo de persistencia de toda edición:
// persistHtmlChange da el guard de marcadores, sanitize, normalize,
// ensurePageMeta, los DOS snapshots (el "Before AI edit" es el Undo del
// usuario) y el aviso de conductas. Los ojos (verifyTurn) juzgan el resultado
// al cierre del turno como con cualquier mutación.
async function toolRedisenarPagina(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const direccion = typeof args.direccion === "string" ? args.direccion.trim() : "";
  const resumen = typeof args.resumen === "string" ? args.resumen : direccion.slice(0, 60);
  if (!direccion) {
    return { response: { ok: false, error: "falta direccion — describe el rediseño que pidió el usuario" } };
  }
  if ((session.redesignsThisTurn ?? 0) >= 1) {
    return {
      response: {
        ok: false,
        error:
          "ya rediseñaste la página este turno. Ajusta lo que falte con editar_pagina (leer_estado incluir_documento=true para ids frescos), o dile al usuario que pida otro rediseño en un mensaje nuevo.",
      },
    };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };
  const current = activeHtml(row.data, session.page);
  if (!current) return { response: { ok: false, error: "el documento activo está vacío" } };

  const negocio = summarizeBusinessForAgent(
    await deps.loadBusinessProfile(session.projectId, session.userId),
  );

  const redesigned = await deps.redesignDocument(session.userId, {
    html: current,
    direccion,
    negocio,
    brief: row.userBrief,
  });
  if (!redesigned.ok) {
    return { response: { ok: false, error: redesigned.error } };
  }

  const persisted = await persistHtmlChange(
    session,
    deps,
    redesigned.html,
    `Rediseño: ${direccion.slice(0, 60)}`,
    { isBaseline: true },
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  session.redesignsThisTurn = (session.redesignsThisTurn ?? 0) + 1;
  return {
    response: {
      ok: true,
      nota: "rediseño aplicado; los data-op-id cambiaron — usa leer_estado incluir_documento=true antes de editar encima",
      ...(persisted.aviso ? { aviso: persisted.aviso } : {}),
    },
    action: { tool: "redisenar_pagina", ok: true, summary: resumen },
    updatedHtml: persisted.finalHtml,
    page: session.page,
  };
}

async function toolEditarPagina(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const rawEdits = Array.isArray(args.edits) ? (args.edits as RawEdit[]) : [];
  const resumen = typeof args.resumen === "string" ? args.resumen : "";

  if (rawEdits.length === 0) {
    return { response: { ok: false, error: "no se recibió ninguna edición" } };
  }
  if (rawEdits.length > MAX_EDITS_PER_CALL) {
    return { response: { ok: false, error: `máximo ${MAX_EDITS_PER_CALL} ediciones por llamada` } };
  }

  const ops: Op[] = [];
  for (const raw of rawEdits) {
    if (typeof raw?.op !== "string" || typeof raw?.target !== "string") {
      return { response: { ok: false, error: "cada edit necesita op + target" } };
    }
    if (!OP_TYPES.includes(raw.op as OpType)) {
      return { response: { ok: false, error: `tipo de operación desconocido: ${raw.op}` } };
    }
    ops.push({
      type: raw.op as OpType,
      target: raw.target,
      ...(typeof raw.new_html === "string" ? { newHtml: raw.new_html } : {}),
    });
  }

  const applied = applyOps(session.taggedHtml, ops);
  if (applied.html === null) {
    const reason = applied.errors[0]?.reason ?? "no se pudo aplicar la edición";
    return { response: { ok: false, error: reason } };
  }

  const persisted = await persistHtmlChange(
    session,
    deps,
    applied.html,
    `Agente (${applied.appliedCount} ops): ${resumen}`,
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  return {
    response: {
      ok: true,
      edits_aplicados: applied.appliedCount,
      nota: "data-op-id regenerados; usa leer_estado incluir_documento=true para editar de nuevo",
      ...(persisted.aviso ? { aviso: persisted.aviso } : {}),
    },
    action: { tool: "editar_pagina", ok: true, summary: resumen },
    updatedHtml: persisted.finalHtml,
    page: session.page,
  };
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** LookBase keys are already --ol-*-prefixed (palette-gen's own naming);
 *  deriveContractColors wants the plain BaseColors shape — strip the prefix
 *  to bridge the two. */
function toBaseColors(look: LookBase): BaseColors {
  return {
    bg: look["--ol-bg"],
    surface: look["--ol-surface"],
    fg: look["--ol-fg"],
    border: look["--ol-border"],
    accent: look["--ol-accent"],
  };
}

/** The accent branch of cambiar_tema: derive the full 10-token contract
 *  bundle (5 base + 5 derived) from one hex seed, same composition
 *  applyLookForMode drives client-side (page.tsx:2096) — lookFromAccent for
 *  the light/dark base palette (its WCAG-walked accent included: the button
 *  path is the authority, zero parallel logic), deriveContractColors for the
 *  relationship tokens (surface-2, fg-muted/faint, border-strong, accent-ink). */
function accentBundleTokens(accentHex: string, modo: "light" | "dark"): Record<string, string> {
  const base = toBaseColors(lookFromAccent(accentHex)[modo]);
  const contract = deriveContractColors(base);
  return {
    "--ol-bg": contract.bg,
    "--ol-surface": contract.surface,
    "--ol-surface-2": contract["surface-2"],
    "--ol-fg": contract.fg,
    "--ol-fg-muted": contract["fg-muted"],
    "--ol-fg-faint": contract["fg-faint"],
    "--ol-border": contract.border,
    "--ol-border-strong": contract["border-strong"],
    "--ol-accent": contract.accent,
    "--ol-accent-ink": contract["accent-ink"],
  };
}

async function toolCambiarTema(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const accent = typeof args.accent === "string" ? args.accent : undefined;
  const fuente = typeof args.fuente === "string" ? args.fuente : undefined;
  const radius = typeof args.radius === "string" ? args.radius : undefined;
  const modoArg = args.modo === "dark" || args.modo === "light" ? args.modo : undefined;

  if (!accent && !fuente && !radius && !modoArg) {
    return { response: { ok: false, error: "especifica accent, fuente, radius y/o modo" } };
  }
  if (accent !== undefined && !HEX_COLOR_RE.test(accent)) {
    return { response: { ok: false, error: `accent debe ser un color hex (#rgb o #rrggbb): ${accent}` } };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const tokens: Record<string, string> = {};

  // F4 Task 2: seed from the ACTIVE document — a subpage's own accent/mode,
  // never home's, when session.page is set (the W1 pin's read side).
  const activeDoc = activeHtml(row.data, session.page) ?? "";

  // Colors re-derive whenever there's an accent to derive FROM: an explicit
  // hex, or (standalone modo — the button's dark/light toggle) the page's
  // current --ol-accent. Mirrors applyLookForMode: every bundle apply also
  // stamps the mode attr (empty = light default, removes it). No modo given =
  // the page's CURRENT mode (the button reads modeRef, never forces light).
  const modo = modoArg ?? readThemeModeFromHtml(activeDoc);
  const accentSeed = accent ?? (modoArg ? readThemeTokenFromHtml(activeDoc, "--ol-accent") : null);
  if (accent !== undefined || modoArg !== undefined) {
    if (!accentSeed) {
      return {
        response: {
          ok: false,
          error: "la página no tiene --ol-accent definido; pasa accent junto con modo",
        },
      };
    }
    Object.assign(tokens, accentBundleTokens(accentSeed, modo));
    tokens["data-ol-mode"] = modo === "dark" ? "dark" : "";
  }

  if (fuente !== undefined) {
    const preset = THEME_PRESETS.find((p) => p.id === fuente);
    if (!preset) {
      return { response: { ok: false, error: `preset de fuente desconocido: ${fuente}` } };
    }
    const fontToken = preset.tokens["--ol-font-display"];
    if (fontToken) tokens["--ol-font-display"] = fontToken;
  }

  if (radius !== undefined) {
    const preset = THEME_PRESETS.find((p) => p.id === radius);
    if (!preset) {
      return { response: { ok: false, error: `preset de radius desconocido: ${radius}` } };
    }
    const radiusToken = preset.tokens["--ol-r-scale"];
    if (radiusToken) tokens["--ol-r-scale"] = radiusToken;
  }

  const candidateHtml = applyThemeTokensToHtml(activeDoc, tokens);

  const persisted = await persistHtmlChange(
    session,
    deps,
    candidateHtml,
    `Agente: cambio de tema (${Object.keys(tokens).join(", ")})`,
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  return {
    response: { ok: true, tokens_aplicados: Object.keys(tokens).length },
    action: { tool: "cambiar_tema", ok: true, summary: accent ?? fuente ?? radius ?? modoArg ?? "" },
    updatedHtml: persisted.finalHtml,
    page: session.page,
  };
}

async function toolAplicarTematica(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const tematica = args.tematica;
  if (typeof tematica !== "string" || tematica.length === 0) {
    return { response: { ok: false, error: "tematica es requerida" } };
  }
  const fondo = typeof args.fondo === "string" && args.fondo.length > 0 ? args.fondo : undefined;

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const activeDoc = activeHtml(row.data, session.page) ?? "";
  let candidateHtml: string;
  if (tematica === "quitar") {
    candidateHtml = removeTematicaFromHtml(activeDoc);
  } else {
    const applied = applyTematicaToHtml(activeDoc, tematica, fondo);
    if ("error" in applied) {
      return { response: { ok: false, error: applied.error } };
    }
    candidateHtml = applied.html;
  }

  const persisted = await persistHtmlChange(
    session,
    deps,
    candidateHtml,
    `Agente: temática (${tematica})`,
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  return {
    response: { ok: true, tematica },
    action: { tool: "aplicar_tematica", ok: true, summary: tematica },
    updatedHtml: persisted.finalHtml,
    page: session.page,
  };
}

// Runaway backstop for a read-only tool: the loop exempts elegir_foto from the
// action budget AND (now) from the turn cap, so the ONLY thing bounding a
// search-only chain is ABSOLUTE_MAX_TOOL_CALLS — which surfaces a red error.
// This ceiling stops the tool returning fresh results well before that, so the
// model hits a wall (and pivots) instead of a crash.
const MAX_PHOTO_SEARCHES_PER_TURN = 6;

// Steer the model off a dead-end photo hunt (the terror-hero bug): once the
// curated catalog clearly doesn't carry a genre, stop retrying variants and
// change approach. Named tools so the model has a concrete next move.
const PHOTO_PIVOT_NOTE =
  "El catálogo curado «Imágenes by OpenLen» es acotado y no tiene fotos de esto. NO sigas buscando variantes. Cambia de enfoque: usa cambiar_tema o aplicar_tematica para dar el ambiente pedido (p. ej. una paleta oscura y envolvente), reescribe el hero con editar_pagina, o dile al usuario con honestidad que el catálogo no tiene ese tipo de imagen y ofrécele esas alternativas.";

async function toolElegirFoto(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  session.photoSearchesThisTurn += 1;

  // Past the ceiling: stop handing back results (even for a matching query) so
  // a stubborn model can't spin toward the loop's absolute cap. Read-only, so
  // still no action card / no updatedHtml.
  if (session.photoSearchesThisTurn > MAX_PHOTO_SEARCHES_PER_TURN) {
    return {
      response: {
        ok: true,
        fotos: [],
        nota: `Ya hiciste demasiadas búsquedas de fotos en este turno. Deja de buscar: usa las que ya encontraste o pivotea. ${PHOTO_PIVOT_NOTE}`,
      },
    };
  }

  const busqueda = typeof args.busqueda === "string" ? args.busqueda : undefined;
  const estilo = typeof args.estilo === "string" ? args.estilo : undefined;

  const manifest = await deps.fetchImageManifest();
  const fotos = searchCuratedPhotos(manifest, { busqueda, estilo });

  if (fotos.length === 0) {
    // First empty search: fine to try one more term. Second+ empty: the
    // catalog genuinely lacks it — pivot rather than burn turns hunting a
    // genre the curated set doesn't carry.
    const pivot = session.photoSearchesThisTurn >= 2;
    return {
      response: {
        ok: true,
        fotos: [],
        nota: pivot
          ? PHOTO_PIVOT_NOTE
          : "sin resultados para esa búsqueda — prueba UNA vez más con otro término o quita el filtro de estilo. Si tampoco hay, no insistas: el catálogo es curado y acotado.",
      },
    };
  }

  // Read-only: no action card (nothing changed on the page) and no
  // updatedHtml — the model still has to call editar_pagina to actually use
  // one of these URLs as an <img src>.
  return {
    response: {
      ok: true,
      fotos: fotos.map((f) => ({ url: f.url, alt: f.alt, estilo: f.style })),
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True iff `url` appears as the VALUE of an image-bearing attribute (src /
 *  content=og:image / href=preload), inside a CSS `url(...)`, or as a full
 *  candidate in a `srcset` — never merely as substring text nor as a prefix of
 *  a longer URL. editar_imagen's anti-injection gate uses this so a
 *  prompt-injected bare URL sitting in page copy can't be fetched+edited. */
export function urlIsPageImage(html: string, url: string): boolean {
  if (!url) return false;
  const u = escapeRegExp(url);
  // Quoted attribute value, exact — the closing quote must sit right after the
  // URL, so a prefix of a longer value can't match.
  if (new RegExp(`(?:src|content|href)\\s*=\\s*(["'])${u}\\1`, "i").test(html)) {
    return true;
  }
  // CSS url(...) in a style attribute/block — quotes optional but balanced.
  if (new RegExp(`url\\(\\s*(["']?)${u}\\1\\s*\\)`, "i").test(html)) {
    return true;
  }
  // srcset: split each candidate off its descriptor and compare exactly, so a
  // prefix of a longer candidate is rejected.
  const srcsetRe = /srcset\s*=\s*["']([^"']*)["']/gi;
  let sm: RegExpExecArray | null;
  while ((sm = srcsetRe.exec(html)) !== null) {
    for (const cand of sm[1].split(",")) {
      if (cand.trim().split(/\s+/)[0] === url) return true;
    }
  }
  return false;
}

async function toolEditarImagen(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const imagenUrl = typeof args.imagen_url === "string" ? args.imagen_url : "";
  const instruccion = typeof args.instruccion === "string" ? args.instruccion.trim() : "";
  if (!imagenUrl) return { response: { ok: false, error: "imagen_url es requerida" } };
  if (!instruccion) return { response: { ok: false, error: "instruccion es requerida" } };

  // Per-turn cap FIRST — a paid Gemini image op is expensive, so a second call
  // is refused before any fetch/edit/upload. Only successful edits count (a
  // failed one below leaves the counter untouched so the model can retry).
  if (session.imageEditsThisTurn >= 1) {
    return { response: { ok: false, error: "límite de una edición de imagen por turno" } };
  }

  // Anti prompt-injection SSRF: only edit an image ALREADY on the page. The URL
  // must appear as an image-bearing attribute value in the current tagged
  // document — a bare URL sitting in body copy is NOT enough, so an
  // attacker-supplied URL can't reach fetchImage this way. session.taggedHtml
  // is always the ACTIVE document (home or the active subpage) — set at
  // session init from session.page and kept in sync by persistHtmlChange /
  // leer_estado's re-tag, so this check is a W1 read-side guard for free: a
  // URL that only lives on home can never pass membership while page="menu".
  if (!urlIsPageImage(session.taggedHtml, imagenUrl)) {
    return {
      response: {
        ok: false,
        error: "imagen_url debe ser la URL exacta de una imagen que YA está en la página (no una URL externa ni inventada)",
      },
    };
  }

  const fetched = await deps.fetchImage(imagenUrl);
  if (!fetched.ok) {
    return { response: { ok: false, error: `no se pudo descargar la imagen: ${fetched.error}` } };
  }

  const edited = await deps.editImage(session.userId, {
    imageBase64: fetched.base64,
    mimeType: fetched.mimeType,
    prompt: instruccion,
  });
  if ("error" in edited) {
    return { response: { ok: false, error: `la edición de imagen falló: ${edited.error}` } };
  }

  // Gemini returned an image and the credit was already charged inside the
  // core — consume the turn's single allowance now, so a later upload/persist
  // failure can't be retried into a second charge.
  session.imageEditsThisTurn += 1;

  const bytes = Buffer.from(edited.imageBase64, "base64");
  const uploaded = await deps.uploadAsset(
    session.projectId,
    bytes,
    edited.mimeType,
    `edit-${Date.now()}`,
  );
  const nuevaUrl = uploaded.url;

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  // Swap every occurrence of the exact source URL for the new asset URL over
  // the current (clean) ACTIVE document — home or the active subpage, per
  // session.page — then run the shared persist pipeline.
  const swapped = (activeHtml(row.data, session.page) ?? "").split(imagenUrl).join(nuevaUrl);
  const persisted = await persistHtmlChange(
    session,
    deps,
    swapped,
    `Imagen editada: ${instruccion.slice(0, 60)}`,
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  return {
    response: { ok: true, nueva_url: nuevaUrl },
    action: { tool: "editar_imagen", ok: true, summary: instruccion.slice(0, 60) },
    updatedHtml: persisted.finalHtml,
    page: session.page,
  };
}

const MAX_PUBLISH_LOCALES = 9;

// publicar — the publish GATE. This tool NEVER calls publishProject; it only
// resolves which subdomain + languages a publish WOULD use and hands that back
// as a `confirm` payload. The panel turns that into a card whose button hits
// the real endpoint — the user's tap is the only thing that publishes.
async function toolPublicar(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const current = row.subdomain; // string | null — the project's active claim
  const raw = typeof args.subdominio === "string" ? args.subdominio.trim().toLowerCase() : "";

  // Resolve the target subdomain. Final authority is always the endpoint (regex
  // / reserved / cap re-checked there); here we only decide republish vs claim.
  // A shape-invalid name (accents, spaces, punctuation…) is pre-validated with
  // the SAME rule the endpoint uses — same regex, so nothing can ride to the
  // confirm card that would only fail later at check-time with a generic
  // message. Invalid → ok:false as data, before any confirm is built.
  let subdominio: string;
  let republicar: boolean;
  if (raw) {
    const check = validateSubdomain(raw);
    if (!check.ok) {
      return {
        response: {
          ok: false,
          error:
            check.reason === "reserved"
              ? `el subdominio "${raw}" está reservado — pide al usuario otro nombre`
              : `el subdominio "${raw}" no es válido: la regla es solo minúsculas, números y guiones, 1-63 caracteres, sin espacios ni acentos. Explícasela al usuario y sugiérele una versión corregida (p. ej. quitando espacios/acentos y usando guiones).`,
        },
      };
    }
    subdominio = check.value;
    republicar = current === check.value;
  } else if (current) {
    subdominio = current;
    republicar = true;
  } else {
    return {
      response: {
        ok: false,
        error:
          // Sin ejemplo con forma de valor, y sin «vuelve a llamar»: este texto
          // entra al modelo como resultado de herramienta, y un modelo que lo
          // lee literalmente re-llamaba publicar con el ejemplo de muestra
          // —medido: DeepSeek reclamaba "mi-negocio" 3 de 3 veces— y le mostraba
          // al usuario una tarjeta de confirmación para una dirección que nunca
          // pidió. Lo que toca aquí es CERRAR el turno preguntando.
          "este proyecto no tiene subdominio todavía, y el subdominio no lo eliges tú. NO vuelvas a llamar a publicar en este turno. Termina tu turno preguntándole al usuario qué dirección quiere para su página; cuando él la escriba, entonces sí llama a publicar con ese valor.",
      },
    };
  }

  // idiomas: keep only real PUBLISH_LOCALES codes, cap at the endpoint's max
  // of 9. Everything dropped — invalid codes AND valid-but-over-cap overflow —
  // is noted back to the model, never silently vanished.
  const rawIdiomas = Array.isArray(args.idiomas) ? args.idiomas : [];
  const strIdiomas = rawIdiomas.filter((c): c is string => typeof c === "string");
  const validos = strIdiomas.filter((c) => isPublishLocale(c));
  const idiomas = validos.slice(0, MAX_PUBLISH_LOCALES);
  const ignorados = [
    ...strIdiomas.filter((c) => !isPublishLocale(c)),
    ...validos.slice(MAX_PUBLISH_LOCALES),
  ];

  return {
    response: {
      ok: true,
      estado: "esperando_confirmacion_del_usuario",
      subdominio,
      idiomas,
      republicar,
      ...(ignorados.length ? { idiomas_ignorados: ignorados } : {}),
    },
    action: { tool: "publicar", ok: true, summary: subdominio },
    confirm: { action: "publicar", subdominio, idiomas, republicar },
  };
}

const PREFERENCIA_MIN = 5;
const PREFERENCIA_MAX = 200;
// The block always lives at the END of the brief (spec) — the em-dash line is
// the stable anchor: search/insert against it, never against leading/trailing
// whitespace, so re-formatting elsewhere in the brief can't break detection.
const PREFERENCIA_MARKER_LINE = "— Preferencias guardadas por el agente —";

function normalizePreferencia(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// recordar_preferencia — the ONLY tool that writes to the project's userBrief
// (never to data.html). Spec rule (catalog knowledge, not enforced here):
// only DURABLE user preferences ("always speak informally", "never use
// yellow") belong here, never a one-off ask for this turn — the model is
// trusted to make that call; this tool only owns storage mechanics: marker
// placement, dedup, and the USER_BRIEF_MAX cap.
async function toolRecordarPreferencia(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  // Collapse embedded newlines — the block is line-based, so a "\n• " inside
  // the text would inject pseudo-bullets that later dedup/parse as real ones.
  const preferencia =
    typeof args.preferencia === "string"
      ? args.preferencia.trim().replace(/\s*\n+\s*/g, " ")
      : "";
  if (preferencia.length < PREFERENCIA_MIN || preferencia.length > PREFERENCIA_MAX) {
    return {
      response: {
        ok: false,
        error: `preferencia debe tener entre ${PREFERENCIA_MIN} y ${PREFERENCIA_MAX} caracteres`,
      },
    };
  }

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const currentBrief = row.userBrief ?? "";
  const markerIdx = currentBrief.indexOf(PREFERENCIA_MARKER_LINE);
  const existingBlock = markerIdx >= 0 ? currentBrief.slice(markerIdx) : "";

  // Dedup, case/whitespace-insensitive, one direction only (spec: an EXISTING
  // line "ya contiene el texto" nuevo). Never the reverse — a longer refinement
  // of an existing bullet ("Sé formal, excepto con proveedores VIP" over
  // "Sé formal") must still be saved, not silently dropped as a duplicate.
  const normalizedNew = normalizePreferencia(preferencia);
  const yaExistia = existingBlock
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("• "))
    .some((line) => normalizePreferencia(line.slice(2)).includes(normalizedNew));
  if (yaExistia) {
    return { response: { ok: true, ya_existia: true } };
  }

  const trimmedBase = currentBrief.replace(/\s+$/, "");
  const nextBrief =
    markerIdx >= 0
      ? `${trimmedBase}\n• ${preferencia}`
      : trimmedBase.length > 0
        ? `${trimmedBase}\n\n${PREFERENCIA_MARKER_LINE}\n• ${preferencia}`
        : `${PREFERENCIA_MARKER_LINE}\n• ${preferencia}`;

  if (nextBrief.length > USER_BRIEF_MAX) {
    return {
      response: {
        ok: false,
        error:
          `el brief del proyecto ya está lleno (máx ${USER_BRIEF_MAX} caracteres) — pide al usuario que pode algo en la pestaña Brief antes de guardar otra preferencia`,
      },
    };
  }

  const saved = await deps.setUserBrief(session.projectId, session.userId, nextBrief);
  if (!saved) return { response: { ok: false, error: "no se pudo guardar la preferencia" } };

  return {
    response: { ok: true },
    action: { tool: "recordar_preferencia", ok: true, summary: preferencia.slice(0, 60) },
  };
}

// conectar_datos_vivos — Task 17, the owner-facing volante for "datos vivos":
// this is the ONLY way a non-technical owner turns the feature on. Everything
// else (bake, cron, cache, read-only Collection guard) is already built and
// dormant without this tool.
//
// SECURITY (non-negotiable): resolveSheetCsvUrl runs FIRST, before touching
// any dep. It is the sole SSRF allowlist (docs.google.com only, see
// lib/live/sheet-source.ts) — a null result means the tool does ZERO fetch
// and ZERO mutation, always, regardless of intent. deps.fetchSheetRows is
// only ever called with the ALREADY-RESOLVED csvUrl, never the raw
// sheet_url the model/user supplied.
async function toolConectarDatosVivos(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const sheetUrl = typeof args.sheet_url === "string" ? args.sheet_url.trim() : "";
  const intent = args.intent;
  if (!sheetUrl) {
    return { response: { ok: false, error: "sheet_url es requerida" } };
  }
  if (intent !== "lista" && intent !== "valores") {
    return { response: { ok: false, error: 'intent debe ser "lista" o "valores"' } };
  }

  // SSRF gate FIRST — see the function's header comment. A hostile host
  // (loopback, metadata, a lookalike subdomain) never produces a csvUrl, so
  // it can never reach fetchSheetRows below.
  const csvUrl = resolveSheetCsvUrl(sheetUrl);
  if (!csvUrl) {
    return {
      response: {
        ok: false,
        error:
          'Ese enlace no es un Google Sheet público — compártelo como "cualquiera con el link" y pásame la URL.',
      },
    };
  }

  if (!liveDataEnabled()) {
    return {
      response: {
        ok: false,
        error: "Datos vivos está apagado en este momento — no puedo conectar un Sheet ahora mismo.",
      },
    };
  }

  let rows: Record<string, string>[];
  try {
    rows = await deps.fetchSheetRows(csvUrl);
  } catch (err) {
    return { response: { ok: false, error: `no se pudo leer el Sheet: ${String(err)}` } };
  }

  if (intent === "lista") {
    // Cero-fricción: the published grid is gated on settings.collections.enabled
    // (lib/publish/filesystem.ts) — an owner who only ever ran this tool must
    // not end up with a synced-but-invisible collection, so the module gets
    // turned on here as part of the connect, through the SAME activation
    // pipeline activar_modulo uses (never a blind boolean flip). Skipped when
    // already on, so a re-connect never double-activates or re-fires
    // chat-provisioning side effects.
    const row = await deps.loadProject(session.projectId, session.userId);
    if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };
    if (row.data.settings?.collections?.enabled !== true) {
      const activated = await activateModulePatch(session, deps, row, { collections: { enabled: true } });
      if (!activated.ok) {
        return {
          response: {
            ok: false,
            error: `no se pudo activar el módulo Colecciones para publicar la lista: ${activated.error}`,
          },
        };
      }
    }

    const collectionId = await deps.setCollectionSheetSource(session.projectId, sheetUrl);
    let result: { upserted: number; archived: number };
    try {
      result = await deps.syncCollection(session.projectId, collectionId, rows);
    } catch (err) {
      // Rollback del candado (Minor de la revisión Task 17): si el sync inicial
      // truena DESPUÉS de fijar la fuente, la colección quedaría solo-lectura
      // y vacía — bloqueada sin contenido. Soltamos la fuente para que el
      // dueño conserve su colección editable y pueda reintentar.
      await deps.clearCollectionSource(session.projectId).catch(() => {});
      return {
        response: {
          ok: false,
          error: `el Sheet se leyó pero la sincronización falló (${String((err as Error)?.message ?? err).slice(0, 100)}); tu lista quedó como estaba — intenta de nuevo`,
        },
      };
    }
    const archivadoNota = result.archived > 0 ? ` (${result.archived} archivado(s), ya no están en el Sheet)` : "";
    return {
      response: {
        ok: true,
        elementos_sincronizados: result.upserted,
        archivados: result.archived,
        nota:
          `Conecté tu Sheet: ${result.upserted} elemento(s) sincronizado(s)${archivadoNota}; edítalos en tu Sheet y tu página se actualiza sola cada hora.`,
      },
      action: { tool: "conectar_datos_vivos", ok: true, summary: `lista: ${result.upserted}` },
    };
  }

  // intent === "valores": persist settings.liveData.sheetUrl directly — the
  // publish baker (applyLiveData) hydrates every data-ol-live marker from it
  // on the next publish/republish. MVP scope (spec Task 17): this tool does
  // NOT insert the markers into the HTML itself — that's editar_pagina,
  // chained by the model in the same turn once it knows the detected keys.
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  // The "clave" a data-ol-live marker addresses is column A of a 2-column
  // Sheet (see lib/live/sheet-source.ts's `values` Map + bake-values.ts) —
  // i.e. the FIRST value of each mapped row, not the header names.
  const claves = Array.from(
    new Set(
      rows
        .map((r) => Object.values(r)[0])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0),
    ),
  );

  const nextData: ProjectData = {
    ...row.data,
    settings: { ...(row.data.settings ?? {}), liveData: { sheetUrl } },
  };
  await deps.saveProjectData(session.projectId, session.userId, nextData);

  return {
    response: {
      ok: true,
      claves_detectadas: claves,
      nota:
        claves.length > 0
          ? `Conecté tu Sheet de valores. Detecté estas claves: ${claves.join(", ")}. Ahora dime en qué parte de la página va cada una y cablea cada una con editar_pagina usando <span data-ol-live="clave">texto de respaldo</span> — la clave debe coincidir EXACTO con la columna A del Sheet.`
          : 'Conecté tu Sheet, pero no detecté ninguna clave — revisa que la primera columna tenga el nombre de cada dato (p. ej. "precio_taco") y la segunda su valor.',
    },
    action: { tool: "conectar_datos_vivos", ok: true, summary: "valores" },
  };
}

const PAGINA_HOME_ALIASES = new Set(["", "principal", "home"]);

// F4 Task 3 — trabajar_en_pagina: words-as-selector. This is the ONLY tool
// that moves session.page mid-conversation; it never writes to the project
// (no saveProjectData/snapshotVersion call), it only re-points the session at
// a different document and re-tags it fresh. Re-loads via deps.loadProject
// rather than trusting any stale row an earlier tool call in this same turn
// may have read, so a page created moments ago (crear_pagina) is reachable
// immediately, and validation reflects the REAL current data.pages, not a
// cached view — same reasoning as leer_estado's re-tag.
async function toolTrabajarEnPagina(
  session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const raw = typeof args.pagina === "string" ? args.pagina.trim() : "";
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  // Resolution order — a REAL page slug wins over the home alias: a creator
  // may legally name a subpage "principal" (it isn't reserved), so match
  // data.pages FIRST (case-sensitive, same convention as the route's
  // pageSlugRaw) before falling back to "home"/"principal"/"" → home. Only
  // when no such page exists does "principal" mean the home document.
  let resolved: string | null;
  if (row.data.pages?.[raw]) {
    resolved = raw;
  } else if (PAGINA_HOME_ALIASES.has(raw.toLowerCase())) {
    resolved = null;
  } else {
    const disponibles = ["principal", ...Object.keys(row.data.pages ?? {})];
    return {
      response: {
        ok: false,
        error: `la página "${raw}" no existe. Páginas disponibles: ${disponibles.join(", ")}.`,
      },
    };
  }

  session.page = resolved;
  session.taggedHtml = tagWithOpIds(activeHtml(row.data, resolved) ?? "").taggedHtml;
  const paginaActiva = resolved ?? "principal";

  return {
    response: {
      ok: true,
      pagina_activa: paginaActiva,
      nota: "documento cargado — los data-op-id son de ESTA página",
    },
    // F4-T8 i18n sweep: `paginaActiva` (response.pagina_activa, above) is
    // model-facing text and correctly stays "principal" — the model reads
    // it, not the user. But the action card's `summary` IS user-visible and
    // rendered verbatim with no i18n, so a bare "principal" leaked untranslated
    // Spanish for a "home" switch. Use "" as an unambiguous home sentinel
    // (page slugs are always non-empty — see the not-found branch above) so
    // agent-action-card.tsx can render a localized "Home" label (×10); any
    // real slug (including one literally named "principal", the shadowing
    // case pinned in tools.test.ts) still shows verbatim, same as before.
    action: { tool: "trabajar_en_pagina", ok: true, summary: resolved ?? "" },
  };
}

export async function runAgentTool(
  session: AgentSession,
  deps: AgentDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "leer_estado":
        return await toolLeerEstado(session, deps, args);
      case "activar_modulo":
        return await toolActivarModulo(session, deps, args);
      case "editar_pagina":
        return await toolEditarPagina(session, deps, args);
      case "redisenar_pagina":
        return await toolRedisenarPagina(session, deps, args);
      case "cambiar_tema":
        return await toolCambiarTema(session, deps, args);
      case "aplicar_tematica":
        return await toolAplicarTematica(session, deps, args);
      case "cambiar_motion":
        return await toolCambiarMotion(session, deps, args);
      case "poner_musica":
        return await toolPonerMusica(session, deps, args);
      case "activar_3d":
        return await toolActivar3d(session, deps, args);
      case "preparar_marketing":
        return await toolPrepararMarketing(session, deps, args);
      case "crear_pagina":
        return await toolCrearPagina(session, deps, args);
      case "elegir_foto":
        return await toolElegirFoto(session, deps, args);
      case "editar_imagen":
        return await toolEditarImagen(session, deps, args);
      case "publicar":
        return await toolPublicar(session, deps, args);
      case "recordar_preferencia":
        return await toolRecordarPreferencia(session, deps, args);
      case "trabajar_en_pagina":
        return await toolTrabajarEnPagina(session, deps, args);
      case "conectar_datos_vivos":
        return await toolConectarDatosVivos(session, deps, args);
      default:
        return { response: { ok: false, error: "herramienta desconocida" } };
    }
  } catch (err) {
    return { response: { ok: false, error: String(err) } };
  }
}
