"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader } from "./icons";

export interface AgentAction {
  tool: string;
  status: "running" | "done" | "error";
  summary: string;
}

// Tools the catalog exposes — only these have an i18n label (wsPage
// agent.tool.*, all 10 locales). Anything else (shouldn't happen) falls back
// to the raw tool name so a stray card never throws a missing-key at render.
// Keep in sync with lib/agent/catalog.ts buildFunctionDeclarations().
const KNOWN_TOOLS = new Set([
  "leer_estado",
  "editar_pagina",
  "activar_modulo",
  "cambiar_motion",
  "poner_musica",
  "activar_3d",
  "cambiar_tema",
  "aplicar_tematica",
  "preparar_marketing",
  "crear_pagina",
  "elegir_foto",
  "editar_imagen",
  "publicar",
]);

export function AgentActionCard({ action }: { action: AgentAction }) {
  const t = useTranslations("wsPage");
  const label = KNOWN_TOOLS.has(action.tool)
    ? t(`agent.tool.${action.tool}`)
    : action.tool;
  return (
    <div className="flex items-center gap-2 rounded-lg border bd bg-app px-2.5 py-1.5 text-[11px]">
      {action.status === "running" ? (
        <Loader size={13} className="shrink-0 animate-spin text-[var(--accent)]" />
      ) : action.status === "done" ? (
        <Check size={13} className="shrink-0 text-[var(--accent)]" />
      ) : (
        <AlertTriangle size={13} className="shrink-0 text-red-600 dark:text-red-400" />
      )}
      <span className="font-medium fg shrink-0">{label}</span>
      {action.summary ? (
        <span className="fg-faint truncate min-w-0">{action.summary}</span>
      ) : null}
      {action.status === "error" ? (
        <span className="fg-faint shrink-0">{t("agent.failed")}</span>
      ) : null}
    </div>
  );
}
