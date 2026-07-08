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
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { detectSlotPath, sanitizeForPublish } from "@/lib/html-engine";
import { applyOps, tagWithOpIds, type Op, type OpType } from "@/lib/html-ops";
import { normalizeBornCanonical } from "@/lib/normalize";
import { getAssetStorage } from "@/lib/projects/assets";
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
  };
}

export interface AgentSession {
  projectId: string;
  userId: string;
  /** Documento home actual, etiquetado — mutado por editar_pagina. */
  taggedHtml: string;
  /** Session email (session.user.email), threaded from the route so an
   *  agent-provisioned owner chat_user is created WITH an email — mirrors
   *  what the settings route passes to getOrCreateOwnerChatUser. */
  ownerEmail: string | null;
}

export interface ToolOutcome {
  /** functionResponse.response que vuelve al modelo. Siempre presente. */
  response: Record<string, unknown>;
  /** Tarjeta para el stream (ausente en leer_estado). */
  action?: { tool: string; ok: boolean; summary: string };
  /** HTML nuevo (sin op-ids) para refrescar el iframe. */
  updatedHtml?: string;
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
  if (args.incluir_documento === true) {
    session.taggedHtml = tagWithOpIds(row.data.html).taggedHtml;
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
      const disponibles = assets.length
        ? `Disponibles: ${assets.map((a) => a.name).join(", ")}`
        : "No hay pistas subidas — pide al usuario que suba una en el panel Música.";
      return {
        response: {
          ok: false,
          error: `asset_url debe ser una de las pistas YA SUBIDAS de este proyecto. ${disponibles}`,
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

// Shared F1 persist pipeline — same block editar_pagina always ran:
// editor-mode marker guard -> sanitize -> ensurePageMeta(normalizeBornCanonical)
// -> module-intent -> snapshot pre/post -> save -> re-tag session.taggedHtml.
// Any tool that hands the model a mutated document (editar_pagina,
// cambiar_tema, …) funnels its candidate HTML through this so persistence
// semantics never drift between tools.
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
  const nextData: ProjectData = {
    ...row.data,
    html: finalHtml,
    ...(moduleIntent.enabled.length ? { settings: moduleIntent.settings } : {}),
  };

  const preEditHtml = row.data.html;
  if (preEditHtml && preEditHtml !== finalHtml) {
    await deps.snapshotVersion({
      projectId: session.projectId,
      html: preEditHtml,
      label: "Before AI edit",
      source: "manual",
      page: null,
    });
  }

  await deps.saveProjectData(session.projectId, session.userId, nextData);

  await deps.snapshotVersion({
    projectId: session.projectId,
    html: finalHtml,
    label,
    source: "chat",
    page: null,
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

  // Colors re-derive whenever there's an accent to derive FROM: an explicit
  // hex, or (standalone modo — the button's dark/light toggle) the page's
  // current --ol-accent. Mirrors applyLookForMode: every bundle apply also
  // stamps the mode attr (empty = light default, removes it). No modo given =
  // the page's CURRENT mode (the button reads modeRef, never forces light).
  const modo = modoArg ?? readThemeModeFromHtml(row.data.html);
  const accentSeed = accent ?? (modoArg ? readThemeTokenFromHtml(row.data.html, "--ol-accent") : null);
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

  const candidateHtml = applyThemeTokensToHtml(row.data.html, tokens);

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

  let candidateHtml: string;
  if (tematica === "quitar") {
    candidateHtml = removeTematicaFromHtml(row.data.html);
  } else {
    const applied = applyTematicaToHtml(row.data.html, tematica, fondo);
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
      default:
        return { response: { ok: false, error: "herramienta desconocida" } };
    }
  } catch (err) {
    return { response: { ok: false, error: String(err) } };
  }
}
