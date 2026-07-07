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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrCreateOwnerChatUser } from "@/lib/chat/store";
import { detectSlotPath, sanitizeForPublish } from "@/lib/html-engine";
import { applyOps, tagWithOpIds, type Op, type OpType } from "@/lib/html-ops";
import { normalizeBornCanonical } from "@/lib/normalize";
import { applyModuleIntent } from "@/lib/projects/module-intent";
import {
  applySettingsPatch,
  validateSettingsPatch,
  type SettingsPatchBody,
} from "@/lib/projects/settings-patch";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion, type VersionSource } from "@/lib/projects/versions";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { AGENT_MODULES, type AgentModule } from "@/lib/agent/catalog";

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
  provisionOwnerChat(projectId: string, userId: string, title: string): Promise<void>;
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
    async provisionOwnerChat(projectId, userId, title) {
      try {
        await getOrCreateOwnerChatUser(projectId, userId, { displayName: title });
      } catch (err) {
        console.warn("[agent] owner chat provisioning failed (will retry lazily)", err);
      }
    },
  };
}

export interface AgentSession {
  projectId: string;
  userId: string;
  /** Documento home actual, etiquetado — mutado por editar_pagina. */
  taggedHtml: string;
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
    await deps.provisionOwnerChat(session.projectId, session.userId, row.title);
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

interface RawEdit {
  op?: unknown;
  target?: unknown;
  new_html?: unknown;
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

  // Editor-mode marker guard first (specific message), then the broader
  // sanitize pass (defense in depth — mirrors ai-design route).
  if (detectSlotPath(applied.html)) {
    return { response: { ok: false, error: "el HTML contiene un marcador reservado (data-slot-path)" } };
  }
  const sanitized = sanitizeForPublish(applied.html);
  if (sanitized.html === null) {
    return { response: { ok: false, error: "el HTML no pasó la sanitización" } };
  }

  const finalHtml = ensurePageMeta(normalizeBornCanonical(sanitized.html));

  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { response: { ok: false, error: "proyecto no encontrado" } };

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
    label: `Agente (${applied.appliedCount} ops): ${resumen}`,
    source: "chat",
    page: null,
  });

  // Ids change after every apply — re-tag so the next editar_pagina call
  // has fresh targets to address.
  session.taggedHtml = tagWithOpIds(finalHtml).taggedHtml;

  return {
    response: {
      ok: true,
      edits_aplicados: applied.appliedCount,
      nota: "data-op-id regenerados; usa leer_estado incluir_documento=true para editar de nuevo",
    },
    action: { tool: "editar_pagina", ok: true, summary: resumen },
    updatedHtml: finalHtml,
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
      default:
        return { response: { ok: false, error: "herramienta desconocida" } };
    }
  } catch (err) {
    return { response: { ok: false, error: String(err) } };
  }
}
