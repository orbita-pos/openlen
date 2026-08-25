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
import { applyOps, rejectDocumentWideOps, stripOpIds, tagWithOpIds, type Op, type OpType } from "@/lib/html-ops";
import { splitRuntimeOps } from "@/lib/ai-stream/model-runtime";
import { applyHeadOp, applyLangOp, applyStylesOp, splitDocumentOps, splitLangOp } from "@/lib/ai-stream/document-ops";
import { avisoHechosPerdidos, avisoMetaDesfasada, hechosPerdidos, metaDesfasada } from "@/lib/agent/facts-kept";
import { avisoReglasMuertas, type ReglaMuerta } from "@/lib/document/css-wiring";
import { parseBehaviorSpec, specRechazoAviso, type PasoSpec } from "@/lib/agent/behavior-spec";
import { AGENT_MEMORY_MAX, rememberAboutUser } from "@/lib/agent/user-memory";
import { fetchSheet, resolveSheetCsvUrl } from "@/lib/live/sheet-source";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import {
  activeHtml,
  columnaRuntime,
  paginaGuardaRuntime,
  persistPage,
  type RuntimeIntent,
} from "@/lib/page-engine/persist";
import { verifyCapsule, type ModelRuntimeCapsule } from "@/lib/projects/model-runtime";
import { preparePage } from "@/lib/page-engine/prepare";
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
import {
  AGENT_MODULES,
  MOTION_LOOKS,
  PAGE_MODULES,
  type AgentModule,
  type PageModule,
} from "@/lib/agent/catalog";
import { searchCuratedPhotos } from "@/lib/agent/photo-search";
import {
  applyThemeTokensToHtml,
  documentReadsToken,
  ensureFontLink,
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
    /** El brief con el que nació la página. Alimenta la etapa de IMÁGENES de
     *  `preparePage`, que sin él se salta entera. */
    brief?: string | null;
    /** La cápsula del JavaScript del modelo, para poder RE-ATARLA al documento
     *  que la edición deja guardado (`persistPage`). */
    generatedRuntime?: unknown;
  } | null>;
  saveProjectData(
    projectId: string,
    userId: string,
    data: ProjectData,
    runtime?: ModelRuntimeCapsule | null,
  ): Promise<void>;
  /** The business profile's contact.whatsapp for this project (linked profile,
   *  else the user's default) — the number fallback activar_modulo uses so
   *  whatsapp never enables silent-dark without a number to bake. */
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
  /** Memoria de la PERSONA, no del proyecto: sobrevive a cambiar de página y
   *  de proyecto. Ver lib/agent/user-memory.ts. */
  rememberAboutUser(
    userId: string,
    preferencia: string,
  ): Promise<{ ok: true; yaExistia: boolean } | { ok: false; reason: "llena" | "no_guardado" }>;
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
          brief: schema.projects.brief,
          generatedRuntime: schema.projects.generatedRuntime,
        })
        .from(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },
    // `runtime` re-ata el JavaScript del modelo al documento nuevo. Va en el
    // MISMO update: escribirlo aparte dejaría una ventana con el HTML ya
    // cambiado y la cápsula apuntando todavía al anterior.
    async saveProjectData(projectId, userId, data, runtime) {
      // `columnaRuntime`, no `runtime ? …`: `null` significa VACÍA la columna y
      // con la veracidad un borrado se perdía en silencio. La regla vive UNA
      // vez, compartida con el escritor del Chat.
      await db
        .update(schema.projects)
        .set({ data, updatedAt: new Date(), ...columnaRuntime(runtime) })
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
    async rememberAboutUser(userId, preferencia) {
      return rememberAboutUser(userId, preferencia);
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
  /** El brief del proyecto y su perfil de negocio. Van en la sesión porque los
   *  necesita `persistHtmlChange`, y enhebrarlos por los 6 llamadores sería
   *  ruido. Sin `brief`, `preparePage` se salta la etapa de imágenes y el
   *  modelo entrega cajas grises que nadie rellena. */
  brief?: string | null;
  profile?: BusinessProfileData | null;
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
  /** LA PRUEBA QUE EL MODELO DECLARÓ para su propio JavaScript, este turno.
   *
   *  Vive en la sesión —y no se persiste— porque describe la promesa de ESTE
   *  cambio: el turno que viene traerá otro código y otra promesa. Los ojos la
   *  leen al cerrar el turno; si no hay, pulsan a ciegas como antes.
   *
   *  La última gana: un turno con dos ediciones de comportamiento promete lo
   *  que dijo la última, igual que la cápsula guarda el último script. */
  behaviorSpec?: readonly PasoSpec[] | null;
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
  /** La herramienta ESCRIBIÓ en la base. No lo pone cada herramienta a mano:
   *  lo estampa `runAgentTool` contando las llamadas reales a
   *  `saveProjectData`, así que ninguna futura puede olvidarse.
   *
   *  Existe porque un turno que ya mutó de forma durable NO puede terminar
   *  como fallo puro: el bucle lo necesita para que el cliente cierre el turno
   *  «aplicado con aviso» —conservando Undo y transcripción— en vez de pintar
   *  un error rojo sobre una página que sí cambió. `updatedHtml` sólo cubre las
   *  que tocan el documento; los cambios de AJUSTES (módulos, tema, motion,
   *  música, 3D, datos vivos) son igual de durables y no emiten html. */
  mutoDurable?: boolean;
}

// AgentModule name -> the settings key it actually lives under. Identidad en
// todos: la excepción era "pedidos" (settings.orders), y ese módulo se retiró.
const MODULE_SETTINGS_KEY: Record<
  AgentModule,
  "collections" | "chat" | "whatsapp"
> = {
  collections: "collections",
  chat: "chat",
  whatsapp: "whatsapp",
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
  // `datos_vivos` faltaba: se podía CONECTAR una hoja y después ni el Agente ni
  // el usuario tenían forma de saber cuál era — «¿qué hoja tengo conectada?»
  // no tenía respuesta. (Quitarla SÍ tiene botón desde el 2026-08-22:
  // DELETE /api/projects/[id]/collections/source, en el banner del panel.)
  const sheetUrl = row.data.settings?.liveData?.sheetUrl;
  // La hoja de la COLECCIÓN es otra cosa, vive en otro sitio de `settings`, y
  // era invisible aquí — que es el peor de los dos casos: es la que deja la
  // colección de SOLO LECTURA, así que el Agente intentaba añadir un producto,
  // recibía un 409 y no tenía forma de saber por qué. Lo lee de `row.data`
  // igual que `getCollectionSource`, sin una consulta más.
  const hojaColeccion = liveDataEnabled()
    ? row.data.settings?.collections?.source?.sheet
    : undefined;
  return {
    titulo: row.title,
    publicado: row.publishedAt !== null,
    subdominio: row.subdomain,
    paginas: Object.keys(row.data.pages ?? {}),
    modulos,
    ...(sheetUrl ? { datos_vivos: { hoja: sheetUrl } } : {}),
    ...(hojaColeccion
      ? {
          coleccion_desde_hoja: {
            hoja: hojaColeccion,
            solo_lectura: true,
            nota: "El catálogo se sincroniza desde esta hoja, así que NO se puede editar ítem por ítem desde OpenLen (toda mutación devuelve 409). Para volver a editarlo a mano hay que desconectar la hoja con el botón del panel de Colecciones.",
          },
        }
      : {}),
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
    case "collections":
      return { collections: { enabled: encender } };
    case "chat":
      return { chat: { enabled: encender } };
    case "whatsapp":
      return encender
        ? { whatsapp: { enabled: true, ...(numero ? { number: numero } : {}) } }
        : { whatsapp: { enabled: false } };
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
/** ¿Es un módulo que `crear_pagina` sabe inyectar? Lee la MISMA lista que el
 *  esquema que ve el modelo, para que no puedan volver a separarse. */
function esModuloDePagina(v: unknown): v is PageModule {
  return typeof v === "string" && (PAGE_MODULES as readonly string[]).includes(v);
}

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

  // Loaded up-front (moved ahead of buildModulePatch) so the whatsapp case can
  // resolve its number-fallback chain from the existing row before the patch
  // is built — never a silent-dark { enabled: true } with no number to bake.
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  let numero: string | undefined;
  // WhatsApp: enabling without a number would bake nothing
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
  // UN VALOR QUE NO ENTENDEMOS SE RECHAZA, NO SE BORRA.
  //
  // Esto era `args.modulo === "collections" ? args.modulo : undefined`: un
  // `modulo="bookings"` (que el propio esquema anunciaba hasta hoy) se
  // convertía en `undefined` sin decir una palabra. El core respondía entonces
  // "se requiere slug, titulo o modulo" — un error de argumentos que no
  // menciona Reservas por ningún lado — así que el modelo reintentaba con slug
  // y título y creaba una página genérica EN BLANCO, dando la apariencia de
  // haber atendido la petición. El dueño pedía citas y recibía una página
  // vacía llamada "Reservas".
  if (args.modulo !== undefined && !esModuloDePagina(args.modulo)) {
    return {
      response: {
        ok: false,
        error:
          `no existe un módulo "${String(args.modulo).slice(0, 40)}" que pueda nacer con la página. ` +
          `El único que sí es: ${PAGE_MODULES.join(", ")}. ` +
          `Reservas, Pedidos, Comentarios, Cuentas y Broadcast SE RETIRARON de OpenLen: ` +
          `NO crees una página en blanco haciendo como que lo resolviste — dile al usuario ` +
          `con honestidad que ese módulo ya no existe y ofrécele el botón de WhatsApp.`,
      },
    };
  }
  const input: CreatePageInput = {
    slug: typeof args.slug === "string" ? args.slug : undefined,
    title: typeof args.titulo === "string" ? args.titulo : undefined,
    module: esModuloDePagina(args.modulo) ? args.modulo : undefined,
  };

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

  const outcome = createSitePage(row.data, input);
  if ("error" in outcome) {
    return { response: { ok: false, error: outcome.message } };
  }

  await deps.saveProjectData(session.projectId, session.userId, outcome.nextData);

  // CREAR UNA PÁGINA ES PONERSE A TRABAJAR EN ELLA.
  //
  // Antes esto devolvía el slug y nada más: `session.page` seguía en la Home y
  // `session.taggedHtml` con el documento de la Home. El modo de fallo no es
  // un error, es PEOR — el modelo llamaba a `editar_pagina` a continuación,
  // los op-ids que tenía eran los de la Home, y las ediciones entraban ahí.
  // El usuario pedía «créame /pricing con tres planes» y le salían tres planes
  // metidos en su portada, con la página nueva vacía al lado.
  //
  // Sólo se salvaba si el modelo encadenaba `trabajar_en_pagina` por su cuenta,
  // que es exactamente la clase de cosa que un modelo hace en un buen turno y
  // se salta en uno malo. Aquí el foco lo mueve el código, igual que lo mueve
  // `trabajar_en_pagina` — mismas dos líneas, mismo invariante.
  session.page = outcome.slug;
  const nuevaHtml = activeHtml(outcome.nextData, outcome.slug) ?? "";
  session.taggedHtml = tagWithOpIds(nuevaHtml).taggedHtml;

  return {
    response: {
      ok: true,
      slug: outcome.slug,
      titulo: outcome.title,
      // Se le DICE, además de hacerlo: si el modelo cree que sigue en la Home
      // describirá al usuario un cambio que no hizo ahí.
      pagina_activa: outcome.slug,
      nota: "ya estás trabajando en ESTA página — los data-op-id del turno anterior son de la Home y ya no valen; pide leer_estado con incluir_documento=true para los nuevos",
    },
    action: { tool: "crear_pagina", ok: true, summary: outcome.slug },
    // El lienzo del taller sigue al foco: crear una página y quedarse mirando
    // la Home es enseñarle al usuario algo distinto de lo que va a editarse.
    updatedHtml: nuevaHtml,
    page: session.page,
  };
}

interface RawEdit {
  op?: unknown;
  target?: unknown;
  new_html?: unknown;
}

type PersistResult =
  | {
      ok: true;
      finalHtml: string;
      aviso?: string;
      sinCambios?: boolean;
      /** Selectores que no pueden aplicar sobre el documento guardado. */
      reglasMuertas?: readonly ReglaMuerta[];
    }
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
  /** `runtimeIntent`: qué hacer con el JavaScript del modelo. `reemplazar`
   *  llega del REDISEÑO (documento entero) y de `editar_pagina` con un edit
   *  `target="runtime"`; `borrar`, de ese mismo edit con `op="delete"`. Sin
   *  intención, `persistPage` re-sella el que ya había en vez de tirarlo. */
  opts: { isBaseline?: boolean; runtimeIntent?: RuntimeIntent } = {},
): Promise<PersistResult> {
  // `data-op-id` es un marcador de MODO EDICIÓN: se estampa para que el modelo
  // pueda apuntar a un elemento y NUNCA debe persistirse. `applyOps` los quita
  // al aplicar, así que mientras el turno traía ops el documento salía limpio
  // por ACCIDENTE, no por contrato. Un turno de sólo comportamiento —o sólo
  // `styles`/`head`/`idioma`— no llama a `applyOps` y guardaba el documento
  // entero etiquetado.
  //
  // El daño era PERMANENTE, no cosmético: `tag_with_op_ids` salta sin contar el
  // elemento que ya lleva id (`tagger.rs`), así que al turno siguiente
  // `taggedCount` es 0 y la ruta responde 400 «no taggable elements» para
  // siempre. Medido en un proyecto real el 2026-08-23: 60 ids en `data.html` y
  // el proyecto imposible de editar.
  //
  // Va aquí, en el embudo por el que pasa TODA escritura, y no en la rama que
  // faltaba: es el único sitio donde la garantía no depende del camino tomado.
  const limpio = stripOpIds(candidateHtml);

  // Editor-mode marker guard first (specific message), then the broader
  // sanitize pass (defense in depth — mirrors ai-design route).
  if (detectSlotPath(limpio)) {
    return { ok: false, error: "el HTML contiene un marcador reservado (data-slot-path)" };
  }
  // Fail closed, through the one gate. `seal: false` — nothing is served from
  // here, publishToDir seals at publish time; `render: false` — an agent turn
  // cannot pay a twenty-second browser launch, publish verifies instead.
  //
  // `priorHtml`: una conducta rota que ya venía en la página no puede condenar
  // todas las ediciones futuras. Crear falla ABIERTO y entrega la página con el
  // defecto anotado; sin esta comparación, editar fallaba CERRADO y el Agente
  // rechazaba cualquier cambio hablando de un control que el usuario no tocó.
  const prepared = await preparePage(limpio, {
    mode: "edit",
    // No encarece el turno: `photographHtml` sale sin tocar la red cuando el
    // documento no trae huecos `data-ol-photo`, que es el caso corriente.
    ...(session.brief ? { brief: session.brief } : {}),
    ...(session.profile ? { profile: session.profile } : {}),
    // Un turno del Agente no puede pagar un arranque de Chrome; publicar
    // verifica. Los invariantes y la puerta corren igual.
    renderChecks: false,
    priorHtml: session.taggedHtml,
  });
  const gated = prepared.ok
    ? { ok: true as const, html: prepared.html, removed: prepared.report.removed, issues: prepared.report.behaviorIssues as never[], code: "", detail: "" }
    : { ok: false as const, html: "", removed: prepared.report.removed, issues: (prepared.report.behaviorIssues ?? []) as never[], code: prepared.code, detail: prepared.detail ?? "" };
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
  const aviso = gated.removed ? sanitizeAviso(gated.removed) : undefined;

  // El CSS que nunca aplica. El motor lo diagnostica desde hoy y el Agente es
  // la superficie que MEJOR puede actuar sobre él: tiene bucle, así que lo
  // arregla en este mismo turno en vez de entregar la página torcida.
  //
  // Se GUARDA igual y se AVISA — no se rechaza. Un selector que no casa no
  // rompe la página, la deja con el aspecto por defecto; bloquear la edición
  // por eso le costaría al usuario un cambio que sí quería.
  const reglasMuertas = prepared.ok ? [...(prepared.report.deadRules ?? [])] : [];

  // El guardado vive en lib/page-engine/persist: el Chat tenía una copia de
  // este mismo bloque —dos snapshots, el mismo spread por página— y el
  // comentario de arriba pedía justo que no derivaran.
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { ok: false, error: "proyecto no encontrado" };
  const moduleIntent = applyModuleIntent(row.data.settings, finalHtml);

  const saved = await persistPage(
    {
      projectId: session.projectId,
      userId: session.userId,
      page: session.page,
      html: finalHtml,
      label,
      ...(moduleIntent.enabled.length ? { settings: moduleIntent.settings } : {}),
      ...(opts.isBaseline !== undefined ? { isBaseline: opts.isBaseline } : {}),
      ...(opts.runtimeIntent ? { runtimeIntent: opts.runtimeIntent } : {}),
    },
    deps,
  );
  if (!saved.ok) return saved;

  // Ids change after every apply — re-tag so the next editar_pagina call
  // has fresh targets to address.
  session.taggedHtml = tagWithOpIds(finalHtml).taggedHtml;

  return {
    ok: true,
    finalHtml,
    ...(aviso ? { aviso } : {}),
    ...(saved.sinCambios ? { sinCambios: true } : {}),
    ...(reglasMuertas.length ? { reglasMuertas } : {}),
  };
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

  // El JavaScript que la página ya tiene. `current` viene saneado —sin
  // scripts—, así que sin esto el rediseño no ve la conducta que debe conservar
  // y la re-inventa. Sólo el documento raíz: la cápsula ata `data.html`.
  const runtime = (() => {
    if (session.page) return null;
    const check = verifyCapsule(row.generatedRuntime, {
      projectId: session.projectId,
      html: row.data?.html ?? "",
    });
    return check.ok ? check.code : null;
  })();

  const redesigned = await deps.redesignDocument(session.userId, {
    html: current,
    direccion,
    negocio,
    brief: row.userBrief,
    runtime,
  });
  if (!redesigned.ok) {
    return { response: { ok: false, error: redesigned.error } };
  }

  const persisted = await persistHtmlChange(
    session,
    deps,
    redesigned.html,
    `Rediseño: ${direccion.slice(0, 60)}`,
    // El JavaScript que el modelo escribió para ESTA página viaja con ella: la
    // cápsula se sella sobre el documento que se guarda.
    {
      isBaseline: true,
      ...(redesigned.modelRuntime
        ? { runtimeIntent: { kind: "reemplazar" as const, code: redesigned.modelRuntime } }
        : {}),
    },
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  session.redesignsThisTurn = (session.redesignsThisTurn ?? 0) + 1;

  // ¿SOBREVIVIERON LOS HECHOS DEL DUEÑO? La regla 2 del prompt del rediseño lo
  // ORDENA en mayúsculas, y MEDIDO (n=20): la URL de la foto real desaparece en
  // 8 de 20 turnos. Se compara sobre el documento que de verdad se guardó, no
  // sobre lo que el modelo dijo que haría.
  //
  // Se AVISA, no se rechaza: la página nueva es lo que el usuario pidió, y
  // tirarla entera por una foto sería peor que la pérdida. El modelo repone en
  // este mismo turno, igual que con las conductas mal cableadas.
  const perdidos = hechosPerdidos(current, persisted.finalHtml ?? redesigned.html);

  return {
    response: {
      ok: true,
      nota: "rediseño aplicado; los data-op-id cambiaron — usa leer_estado incluir_documento=true antes de editar encima",
      ...(persisted.aviso ? { aviso: persisted.aviso } : {}),
      ...(perdidos.length > 0 ? { hechos_perdidos: perdidos.length } : {}),
      ...(persisted.reglasMuertas?.length
        ? { css_sin_efecto: persisted.reglasMuertas.map((r) => r.selector) }
        : {}),
      // Acumulados, no pisados — misma razón que en `editar_pagina`: un
      // rediseño puede a la vez tirar la foto del dueño Y dejar CSS colgando.
      ...(() => {
        const c: string[] = [];
        if (perdidos.length > 0) c.push(avisoHechosPerdidos(perdidos));
        if (persisted.reglasMuertas?.length) c.push(avisoReglasMuertas(persisted.reglasMuertas));
        return c.length ? { aviso_critico: c.join(" · ") } : {};
      })(),
    },
    action: { tool: "redisenar_pagina", ok: true, summary: resumen },
    updatedHtml: persisted.finalHtml,
    page: session.page,
  };
}

/** ¿Esta edición añadió una CONDUCTA que antes no estaba?
 *
 *  Se compara con el documento previo a propósito: una página que ya tenía
 *  conductas y a la que sólo se le cambió un titular no debe pedir una prueba
 *  de comportamiento — el comportamiento no se tocó, y un aviso que sale
 *  siempre acaba ignorado. */
function tocaConducta(despues: string, antes: string): boolean {
  const cuenta = (h: string) => (h.match(/data-ol-(?:calc|behavior|countdown|filter|lightbox|copy|autoplay|sticky|theme)\b/g) ?? []).length;
  return cuenta(despues) > cuenta(antes);
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

  // El runtime no es un elemento: se aparta antes de que el aplicador vea la
  // tanda. Sin esto, el camino barato del Agente tampoco podía tocar el
  // comportamiento de la página — mismo agujero que el Chat, misma cura.
  const partido = splitRuntimeOps(ops);
  // El CSS y el <head> tampoco son elementos: `SKIP_TAGS` los deja sin
  // `data-op-id`. Sin esto, «cámbiame la tipografía» sólo tenía la salida cara
  // —reescribir la página entera— y cada reescritura puede perder algo.
  const documento = splitDocumentOps(partido.domOps);
  const idioma = splitLangOp(documento.domOps);
  if (partido.runtime.kind === "error") {
    return {
      response: {
        ok: false,
        error: `no pude aplicar el cambio de comportamiento (${partido.runtime.reason}). Manda el script COMPLETO y corregido en un solo edit con target="runtime".`,
      },
    };
  }
  if (documento.styles.kind === "error") {
    return {
      response: {
        ok: false,
        error: `no pude aplicar el cambio de estilo (${documento.styles.reason}). Manda UN solo edit con target="styles" y CSS dentro, sin etiquetas.`,
      },
    };
  }
  if (documento.head.kind === "error") {
    return {
      response: {
        ok: false,
        error: `no pude tocar la cabecera (${documento.head.reason}). Con target="head" sólo se puede AÑADIR un <link> de fuentes de Google.`,
      },
    };
  }
  const nuevoRuntime = partido.runtime.kind === "codigo" ? partido.runtime.code : null;
  // QUITARLE el JavaScript a la página. Hasta el 25/08 no existía: un `replace`
  // vacío se rechazaba y la ausencia de runtime RE-SELLA el código anterior, así
  // que «quita el carrito» era literalmente imposible de cumplir. Va aparte de
  // `nuevoRuntime` porque «no hay código nuevo» y «no debe quedar código» son
  // cosas distintas — confundirlas era el defecto.
  const borrarRuntime = partido.runtime.kind === "borrar";
  const tocaRuntime = nuevoRuntime !== null || borrarRuntime;
  // UNA SUBPÁGINA NO GUARDA JAVASCRIPT, y hasta hoy este límite no se enteraba.
  // `persistPage` fuerza `runtime = null` en cuanto la página activa no es la
  // Home; el script se tiraba en silencio y la respuesta de abajo seguía
  // diciendo `comportamiento_actualizado: true`. Len le contaba al dueño que le
  // había cableado el carrito, y el botón no hacía nada.
  //
  // Se rechaza AQUÍ, no se avisa después: así el modelo se entera en el mismo
  // turno y puede decir la verdad o llevar el cambio a la Home. Enterarse el
  // usuario al pulsar el botón es la degradación que este repo no acepta.
  //
  // Las ops de maquetación de este turno NO se pierden: quien manda un cambio
  // de comportamiento donde no cabe tiene que replantear el turno entero, y
  // aplicar la mitad dejaría el marcado de una interacción que nadie va a
  // cablear — botones nuevos, mudos, sin nada detrás.
  if (tocaRuntime && !paginaGuardaRuntime(session.page)) {
    return {
      response: {
        ok: false,
        error:
          `el JavaScript de la página sólo se guarda en la HOME, y ahora mismo estás trabajando en "${session.page}". ` +
          `NO le digas al usuario que cambiaste el comportamiento de esta página: no se guardó nada. ` +
          `Si la interacción va aquí, dile que por ahora sólo la Home puede llevarla; si va en la Home, ` +
          `usa trabajar_en_pagina para volver y manda allí el edit con target="runtime".`,
      },
    };
  }
  const tocaDocumento =
    documento.styles.kind === "css" || documento.head.kind === "nodos" || idioma.lang.kind === "idioma";

  // LA PRUEBA DE LO QUE ESTE TURNO PROMETIÓ.
  //
  // Se acepta venga con runtime o SIN él, y no es un detalle: MEDIDO el
  // 2026-08-22, la primera versión sólo la miraba cuando el turno traía
  // JavaScript nuevo, y con eso no corrió NUNCA. El Agente no escribe JS —su
  // prompt se lo prohíbe sin condiciones— y repara el comportamiento con
  // CONDUCTAS (`data-ol-calc` y las demás). El modelo mandó su prueba, bien
  // formada, y la puerta la tiró; luego cerró el turno diciéndole al usuario
  // «la prueba pasó sin errores» sobre una prueba que nunca se ejecutó.
  //
  // Una conducta necesita la comprobación TANTO como el JS libre: es una receta
  // cerrada que se cablea a mano en el HTML, y mal cableada nace muda —sin un
  // error en consola— que es justo el fallo invisible.
  //
  // Una prueba mal formada NO tumba la edición: se avisa y se sigue. Perder el
  // arreglo del usuario porque su comprobación venía torcida sería castigar lo
  // que se quiere fomentar.
  let avisoPrueba = "";
  const spec = parseBehaviorSpec(args.prueba);
  if (spec.kind === "spec") {
    session.behaviorSpec = spec.pasos;
  } else if (spec.kind === "error") {
    avisoPrueba = specRechazoAviso(spec.reason);
    // eslint-disable-next-line no-console
    console.warn(`[agente] prueba de comportamiento descartada: ${spec.reason}`);
  }

  // Un turno que sólo arregla comportamiento —o sólo el estilo— no lleva ops de
  // maquetación: el cuerpo del documento se queda igual y cambia lo de fuera.
  // UNA OP CONTRA EL <body> NO ES UNA EDICIÓN: ES UN DOCUMENTO NUEVO.
  //
  // El Chat lleva este guardián desde que se midió que el modelo, queriendo
  // tocar `:root`, apuntaba al <body> y lo reemplazaba por un <style>. El
  // Agente —que va ENCENDIDO por defecto— no lo tenía.
  //
  // MEDIDO el 2026-08-22 en el brazo de control del experimento: 8 de 40
  // peticiones de «cámbiame la tipografía» acabaron con el <body> reemplazado
  // por el <link> de la fuente. El documento guardado era
  // `<html><head>…</head><link …></html>`: sin titular, sin teléfono, sin
  // botón. El usuario pide una fuente y recibe una página en blanco.
  //
  // Los objetivos `styles`/`head` quitan el MOTIVO (el modelo ya tiene por
  // dónde), y en el brazo de tratamiento no pasó ni una vez. Esto quita la
  // POSIBILIDAD, que es lo que hace falta cuando lo que está en juego es la
  // página entera del usuario.
  const { ops: opsSeguras, rejected: opsRechazadas } = rejectDocumentWideOps(
    session.taggedHtml,
    idioma.domOps,
  );

  let htmlAplicado = session.taggedHtml;
  let aplicadas = 0;
  if (opsSeguras.length > 0) {
    const applied = applyOps(session.taggedHtml, opsSeguras);
    if (applied.html === null) {
      const reason = applied.errors[0]?.reason ?? "no se pudo aplicar la edición";
      return { response: { ok: false, error: reason } };
    }
    htmlAplicado = applied.html;
    aplicadas = applied.appliedCount;
  } else if (opsRechazadas.length > 0 && !tocaRuntime && !tocaDocumento) {
    // Todo lo que mandó era contra la raíz: no hay nada que salvar, y decírselo
    // con el camino correcto vale más que un "no se pudo".
    return {
      response: {
        ok: false,
        error: "op_contra_la_raiz",
        detalle: `${opsRechazadas.length} edit(s) apuntaban al <html> o al <body>, lo que habría reemplazado la página ENTERA. No se guardó nada.`,
        como_hacerlo:
          'Para CSS usa un edit con target="styles"; para una hoja de fuentes, target="head". Para cambiar el contenido, apunta al data-op-id del elemento concreto, nunca al del body.',
      },
    };
  } else if (!tocaRuntime && !tocaDocumento) {
    return { response: { ok: false, error: "ningún edit aplicable" } };
  }
  htmlAplicado = applyLangOp(
    applyHeadOp(applyStylesOp(htmlAplicado, documento.styles), documento.head),
    idioma.lang,
  );

  const persisted = await persistHtmlChange(
    session,
    deps,
    htmlAplicado,
    `Agente (${aplicadas} ops${nuevoRuntime ? " + comportamiento" : borrarRuntime ? " + comportamiento retirado" : ""}${tocaDocumento ? " + estilo" : ""}): ${resumen}`,
    nuevoRuntime
      ? { runtimeIntent: { kind: "reemplazar" as const, code: nuevoRuntime } }
      : borrarRuntime
        ? { runtimeIntent: { kind: "borrar" as const } }
        : {},
  );
  if (!persisted.ok) {
    return { response: { ok: false, error: persisted.error } };
  }

  // 🔴 LOS AVISOS SE ACUMULAN, NO SE PISAN.
  //
  // Esto eran CUATRO claves `aviso_critico` sueltas dentro del mismo objeto
  // literal, así que en JavaScript la última ganaba EN SILENCIO. Un turno que a
  // la vez dejaba la meta desfasada y cambiaba el comportamiento sin prueba
  // sólo contaba una de las dos cosas — y el comentario de `persistHtmlChange`
  // ya pedía justo lo contrario: *"el modelo sigue viendo TODAS las razones …
  // contarle sólo la que bloqueó lo devuelve con el mismo script condenado
  // pegado a un botón ya corregido"*. La intención estaba escrita y el código
  // decía otra cosa.
  const criticos: string[] = [];
  const extra: Record<string, unknown> = {};

  // La META se quedó atrás: el dato viejo sigue en el fragmento que enseña
  // Google. Se mira sobre el documento que de verdad se guardó.
  const viejos = metaDesfasada(persisted.finalHtml ?? htmlAplicado);
  if (viejos.length > 0) {
    extra.meta_desfasada = viejos;
    criticos.push(avisoMetaDesfasada(viejos));
  }

  // CSS que no puede aplicar nunca: el estilo existe, el elemento existe, y no
  // se tocan. Lo diagnostica el motor para las TRES superficies; el Agente es
  // la única que puede arreglarlo en el mismo turno.
  if (persisted.reglasMuertas?.length) {
    extra.css_sin_efecto = persisted.reglasMuertas.map((r) => r.selector);
    criticos.push(avisoReglasMuertas(persisted.reglasMuertas));
  }

  // Sin prueba, nadie sabrá si el comportamiento hace lo que promete — sólo si
  // explota. Se le dice, y se le dice por qué.
  if (
    !borrarRuntime &&
    (nuevoRuntime || tocaConducta(htmlAplicado, session.taggedHtml)) &&
    !session.behaviorSpec
  ) {
    criticos.push(
      avisoPrueba
        ? `${avisoPrueba} Vuelve a mandarla bien formada en tu siguiente edit.`
        : 'Cambiaste el COMPORTAMIENTO de la página SIN mandar `prueba`, así que nadie va a comprobar que haga lo que promete — sólo que no explote. Un botón cableado a una conducta mal puesta nace MUDO, sin un solo error en consola. Manda `prueba` describiendo qué debe pasar al pulsar.',
    );
  }

  // Guardar-y-AVISAR: perder una op en silencio es la degradación que este repo
  // prohíbe, y aquí lo perdido habría sido la página entera.
  if (opsRechazadas.length > 0) {
    extra.edits_descartados = opsRechazadas.length;
    criticos.push(
      `Descarte ${opsRechazadas.length} edit(s) que apuntaban al <html> o al <body>: habrian reemplazado la pagina ENTERA. El resto SI se aplico. Si querias cambiar CSS, usa target="styles"; para una hoja de fuentes, target="head".`,
    );
  }

  // El turno no cambió nada. Se le dice al MODELO para que no cierre diciéndole
  // al usuario que lo arregló: es el fallo medido el 22/08.
  if (persisted.sinCambios && !borrarRuntime) {
    extra.sin_cambios = true;
    criticos.push(
      'Este edit NO cambió NADA de la página. NO le digas al usuario que lo arreglaste. Si el problema es de comportamiento, el arreglo va en un edit con target="runtime" que lleve el script completo corregido.',
    );
  }

  return {
    response: {
      ok: true,
      edits_aplicados: aplicadas,
      ...(nuevoRuntime ? { comportamiento_actualizado: true } : {}),
      ...(borrarRuntime ? { comportamiento_retirado: true } : {}),
      ...(tocaDocumento ? { estilo_actualizado: true } : {}),
      ...extra,
      nota: "data-op-id regenerados; usa leer_estado incluir_documento=true para editar de nuevo",
      ...(persisted.aviso ? { aviso: persisted.aviso } : {}),
      ...(criticos.length ? { aviso_critico: criticos.join(" · ") } : {}),
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

  // ¿LA PÁGINA LEE ESTOS TOKENS? MEDIDO: 171 de 178 plantillas curadas no leen
  // ninguno. Sobre ellas esto escribía la declaración, devolvía `ok: true,
  // tokens_aplicados: 1` y la página se quedaba idéntica — un cambio reportado
  // que no ocurrió, que es justo lo que la doctrina de degradación prohíbe.
  //
  // No se convierte el CSS de la plantilla (eso es Canva-mode en miniatura, y
  // ya se rechazó): se dice la verdad y se señala el camino que SÍ funciona.
  // En el bucle del Agente, un `ok:false` con pista es el idioma normal — el
  // modelo encadena la op y el cambio ocurre de verdad.
  const pedidos = new Set<string>();
  if (accent !== undefined || modoArg !== undefined) pedidos.add("--ol-accent");
  if (fuente !== undefined) pedidos.add("--ol-font-display");
  if (radius !== undefined) pedidos.add("--ol-r-scale");
  const muertos = [...pedidos].filter((t) => !documentReadsToken(activeDoc, t));
  if (muertos.length === pedidos.size) {
    return {
      response: {
        ok: false,
        error: "sin_tokens",
        detalle: `Esta página no usa el sistema de tokens (su CSS no dice var(${muertos.join(") ni var(")})), así que escribirlos NO cambiaría nada de lo que se ve.`,
        como_hacerlo:
          'Cámbialo en el CSS de verdad con editar_pagina: un edit con target="styles" e insert_after. Dentro, DOS cosas: (1) las reglas que de verdad pintan, por ejemplo `body,h1,h2{font-family:\'Fraunces\',Georgia,serif}`; y (2) el token en `:root{--ol-font-display:\'Fraunces\',serif}` — los módulos que se añaden al publicar (reproductor de música, secciones de módulo) SÍ leen los tokens, así que definirlo los deja a juego. Si la fuente es de Google, añade su hoja con otro edit target="head" e insert_after.',
      },
    };
  }

  let candidateHtml = applyThemeTokensToHtml(activeDoc, tokens);
  // La fuente tiene que EXISTIR, no sólo estar nombrada: sin su hoja el
  // navegador cae al genérico y el usuario ve Times New Roman donde pidió una
  // editorial.
  const fontToken = tokens["--ol-font-display"];
  if (fontToken) candidateHtml = ensureFontLink(candidateHtml, fontToken);

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
    response: {
      ok: true,
      tokens_aplicados: Object.keys(tokens).length,
      // Parcial: unos rasgos entran y otros no. Callarlo sería la misma mentira
      // en pequeño.
      ...(muertos.length > 0
        ? {
            sin_efecto: muertos,
            aviso_critico: `La página no lee ${muertos.join(" ni ")}, así que ESA parte no cambió. Si el usuario la pidió, hazla con un edit target="styles".`,
          }
        : {}),
    },
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
  "El catálogo curado «Imágenes by OpenLen» es acotado y no tiene fotos de esto. NO sigas buscando variantes y NUNCA inventes una URL. "
  + "Deja el hueco con un degradado de la paleta usando editar_pagina — es exactamente lo que hace la generación cuando no encuentra pareja, "
  + "y una caja neutra es mejor que una foto que miente sobre el negocio del usuario. "
  + "Después SIGUE con el resto de lo que te pidió: quedarte sin una foto no cancela lo demás ni te obliga a pedir permiso para continuar. "
  + "En tu respuesta di qué foto no había y qué pusiste en su lugar.";

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

  // ALCANCE. Por defecto «siempre» — a la PERSONA, no al proyecto.
  //
  // No es un capricho: MEDIDO el 2026-08-22, el usuario dijo «una cosa
  // importante para TODAS mis páginas…» y el modelo confirmó «aplica a todas
  // tus páginas de aquí en adelante» mientras lo guardaba en una columna del
  // proyecto. La promesa que el modelo hace por su cuenta es la global, así
  // que el default debe ser la global.
  //
  // Los dos fallos no son simétricos: una preferencia global que debió ser
  // local el usuario la poda; una local que debió ser global es justo el bug
  // que esto cierra — la repite en cada proyecto nuevo y nunca se entera.
  const alcance = args.alcance === "esta_pagina" ? "esta_pagina" : "siempre";
  if (alcance === "siempre") {
    const res = await deps.rememberAboutUser(session.userId, preferencia);
    if (!res.ok) {
      return {
        response: {
          ok: false,
          error:
            res.reason === "llena"
              ? `tu memoria de preferencias está llena (máx ${AGENT_MEMORY_MAX} caracteres) — dile al usuario que ya guardaste varias y pregúntale cuál quitar antes de añadir otra`
              : "no se pudo guardar la preferencia",
        },
      };
    }
    if (res.yaExistia) return { response: { ok: true, ya_existia: true, alcance } };
    return {
      response: { ok: true, alcance, nota: "guardado para TODAS sus páginas, no sólo ésta" },
      action: { tool: "recordar_preferencia", ok: true, summary: preferencia.slice(0, 60) },
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
    // Si lo encendemos NOSOTROS en esta llamada, este turno es el dueño de ese
    // cambio y puede deshacerlo si el sync revienta después. Si ya venía
    // encendido, no se toca: no es nuestro.
    const activadoAqui = row.data.settings?.collections?.enabled !== true;
    if (activadoAqui) {
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
      // 🔴 LO QUE SE PUEDE DESHACER SE DESHACE; LO QUE NO, SE DICE.
      //
      // Esto decía «tu lista quedó como estaba» de forma incondicional, y era
      // mentira por tres sitios a la vez: (1) el módulo Colecciones se había
      // ENCENDIDO y se quedaba encendido; (2) `syncCollectionFromSheet` escribe
      // fila a fila y sin transacción —Neon HTTP no las tiene—, así que las
      // que ya pasaron siguen cambiadas; y (3) si el propio `clearCollectionSource`
      // fallaba, su `.catch(() => {})` se lo tragaba y la colección quedaba
      // ligada al Sheet, en solo-lectura, sin que nadie lo supiera.
      //
      // El módulo sí es reversible del todo, así que se revierte. Las filas no
      // lo son sin un snapshot — pero el sync es una RECONCILIACIÓN COMPLETA
      // (upsert por título + archiva lo ausente), no un delta: volver a
      // conectar el mismo Sheet converge al estado correcto. Eso convierte
      // «intenta de nuevo» en un consejo verdadero en vez de un parche.
      const restos: string[] = [];

      try {
        await deps.clearCollectionSource(session.projectId);
      } catch {
        restos.push(
          "tu colección quedó ligada al Sheet (solo lectura) — desconéctala desde el panel Colecciones",
        );
      }

      if (activadoAqui) {
        const fresco = await deps
          .loadProject(session.projectId, session.userId)
          .catch(() => null);
        const apagado = fresco
          ? await activateModulePatch(session, deps, fresco, {
              collections: { enabled: false },
            })
          : { ok: false as const, error: "no se pudo releer el proyecto" };
        if (!apagado.ok) {
          restos.push("el módulo Colecciones quedó ENCENDIDO — apágalo desde el panel Módulos");
        }
      }

      const causa = String((err as Error)?.message ?? err).slice(0, 100);
      const aviso = restos.length > 0 ? ` Ojo: ${restos.join("; ")}.` : "";
      return {
        response: {
          ok: false,
          error:
            `el Sheet se leyó pero la sincronización falló a medias (${causa}). ` +
            `Algunos elementos pueden haber cambiado YA con los datos del Sheet — ` +
            `NO le digas al usuario que su lista sigue igual que antes. Volver a ` +
            `conectar el MISMO Sheet la deja correcta.${aviso}`,
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
      // EL DOCUMENTO VA DENTRO, porque el contrato dice que va dentro.
      //
      // El esquema de esta herramienta le promete al modelo «usa los nuevos
      // [data-op-id] que trae la respuesta», y el system prompt le dice que
      // «la respuesta trae el documento fresco de esa página». No lo traía:
      // se devolvía ok, pagina_activa y una nota que decía «documento
      // cargado» — cargado en `session`, que el modelo NO VE (el bucle sólo
      // le pasa `outcome.response`). Así que tras el cambio de página el
      // modelo editaba con los op-ids de la anterior: o fallaba, o inventaba
      // targets, y para recuperarse necesitaba una llamada extra que el
      // contrato no le pedía.
      //
      // Mismo nombre de campo que `leer_estado`, y sale más barato que la
      // vuelta extra: es el mismo payload, sin repetir toda la conversación.
      documento: session.taggedHtml,
      nota: "los data-op-id de `documento` son de ESTA página; los de la anterior ya no valen",
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
  // ¿Escribió esta herramienta en la base? Se cuenta AQUÍ, envolviendo el único
  // camino de escritura, y no se le pide a cada herramienta que se acuerde de
  // declararlo. `persistPage` también escribe por este mismo `saveProjectData`,
  // así que el conteo cubre las que tocan el documento y las que sólo tocan
  // ajustes, hoy y las que vengan.
  let escrituras = 0;
  const vigilado: AgentDeps = {
    ...deps,
    async saveProjectData(projectId, userId, data, runtime) {
      escrituras += 1;
      await deps.saveProjectData(projectId, userId, data, runtime);
    },
  };
  const marcar = (out: ToolOutcome): ToolOutcome =>
    escrituras > 0 || out.updatedHtml ? { ...out, mutoDurable: true } : out;
  try {
    return marcar(await ejecutarHerramienta(session, vigilado, name, args));
  } catch (err) {
    // Aunque REVIENTE: si ya había escrito, la mutación es durable igual y el
    // turno no puede cerrarse como si no hubiera pasado nada.
    return marcar({ response: { ok: false, error: String(err) } });
  }
}

async function ejecutarHerramienta(
  session: AgentSession,
  deps: AgentDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  {
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
  }
}
