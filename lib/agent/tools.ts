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
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { debitCredits } from "@/lib/credits";
import { detectSlotPath, sanitizeForPublish } from "@/lib/html-engine";
import { applyOps, tagWithOpIds, type Op, type OpType } from "@/lib/html-ops";
import { normalizeBornCanonical } from "@/lib/normalize";
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
} from "@/lib/projects/settings-patch";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion, type VersionSource } from "@/lib/projects/versions";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
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
  snapshotVersion(args: {
    projectId: string;
    html: string;
    label: string;
    source: string;
    page: string | null;
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
    async snapshotVersion(args) {
      // Best-effort, same as the ai-design route: a snapshot failure must
      // never break the tool call that produced real, saved output.
      await createVersion({
        projectId: args.projectId,
        html: args.html,
        label: args.label,
        source: args.source as VersionSource,
        page: args.page,
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
}

export interface ToolOutcome {
  /** functionResponse.response que vuelve al modelo. Siempre presente. */
  response: Record<string, unknown>;
  /** Tarjeta para el stream (ausente en leer_estado). */
  action?: { tool: string; ok: boolean; summary: string };
  /** HTML nuevo (sin op-ids) para refrescar el iframe. */
  updatedHtml?: string;
  /** El gate de publicación (publicar). Presente ⇒ el loop emite un evento
   *  `confirm` y le pasa al modelo un estado "esperando_confirmacion". La
   *  herramienta JAMÁS publica: el tap del usuario en la tarjeta es la única
   *  vía que llama al endpoint real (spec §4.4). */
  confirm?: { action: "publicar"; subdominio: string; idiomas: string[]; republicar: boolean };
}

export function summarizeProjectState(row: {
  data: ProjectData;
  title: string;
  subdomain: string | null;
  publishedAt: Date | null;
}): Record<string, unknown> {
  const modulos = {} as Record<AgentModule, boolean>;
  for (const m of AGENT_MODULES) {
    modulos[m] = row.data.settings?.[m]?.enabled === true;
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
  if (args.incluir_documento === true) {
    session.taggedHtml = tagWithOpIds(activeHtml(row.data, session.page) ?? "").taggedHtml;
    response.documento = session.taggedHtml;
  }
  return { response };
}

function buildModulePatch(modulo: AgentModule, encender: boolean): SettingsPatchBody {
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
      return { whatsapp: { enabled: encender } };
    case "comments":
      return { comments: { enabled: encender } };
  }
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

  const patchBody = buildModulePatch(modulo as AgentModule, encender);
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

  if (outcome.chatJustEnabled) {
    await deps.provisionOwnerChat(session.projectId, session.userId, {
      email: session.ownerEmail,
      displayName: row.title,
    });
  }
  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  return {
    response: {
      ok: true,
      modulo,
      encendido: encender,
      ...(outcome.createdPage ? { paginaCreada: outcome.createdPage.slug } : {}),
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
    action: { tool: "poner_musica", ok: true, summary: accion },
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
    action: { tool: "activar_3d", ok: true, summary: encender ? "encendida" : "apagada" },
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

type PersistResult = { ok: true; finalHtml: string } | { ok: false; error: string };

// F4 Task 2 — every read of "the document" must resolve through the
// session's active slot, not always data.html: page=null → home (data.html),
// page="<slug>" → that subpage's own document (data.pages[slug].html).
// This is the single choke point the W1 pin depends on for READS; writes go
// through the mirrored branch inside persistHtmlChange below.
function activeHtml(data: ProjectData, page: string | null): string | null {
  return page ? data.pages?.[page]?.html ?? null : data.html ?? null;
}

// Shared F1 persist pipeline — same block editar_pagina always ran:
// editor-mode marker guard -> sanitize -> ensurePageMeta(normalizeBornCanonical)
// -> module-intent -> snapshot pre/post -> save -> re-tag session.taggedHtml.
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
): Promise<PersistResult> {
  // Editor-mode marker guard first (specific message), then the broader
  // sanitize pass (defense in depth — mirrors ai-design route).
  if (detectSlotPath(candidateHtml)) {
    return { ok: false, error: "el HTML contiene un marcador reservado (data-slot-path)" };
  }
  const sanitized = sanitizeForPublish(candidateHtml);
  if (sanitized.html === null) {
    return { ok: false, error: "el HTML no pasó la sanitización" };
  }

  const finalHtml = ensurePageMeta(normalizeBornCanonical(sanitized.html));

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
  });

  // Ids change after every apply — re-tag so the next editar_pagina call
  // has fresh targets to address.
  session.taggedHtml = tagWithOpIds(finalHtml).taggedHtml;

  return { ok: true, finalHtml };
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
    },
    action: { tool: "editar_pagina", ok: true, summary: resumen },
    updatedHtml: persisted.finalHtml,
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
  };
}

async function toolElegirFoto(
  _session: AgentSession,
  deps: AgentDeps,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const busqueda = typeof args.busqueda === "string" ? args.busqueda : undefined;
  const estilo = typeof args.estilo === "string" ? args.estilo : undefined;

  const manifest = await deps.fetchImageManifest();
  const fotos = searchCuratedPhotos(manifest, { busqueda, estilo });

  if (fotos.length === 0) {
    return {
      response: {
        ok: true,
        fotos: [],
        nota: "sin resultados para esa búsqueda — prueba otro término, quita el filtro de estilo, o usa una palabra más general",
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
          "este proyecto no tiene subdominio todavía. Pregúntale al usuario qué subdominio quiere (p. ej. mi-negocio) y vuelve a llamar publicar con subdominio.",
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
      default:
        return { response: { ok: false, error: "herramienta desconocida" } };
    }
  } catch (err) {
    return { response: { ok: false, error: String(err) } };
  }
}
