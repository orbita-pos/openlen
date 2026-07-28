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
  "recordar_preferencia",
  "publicar",
  "trabajar_en_pagina",
  "verificar_diseno",
]);

// F4-T8 i18n sweep: `summary` is otherwise an opaque identifier (a module
// id, slug, hex color, font/radius preset — none of those need translation,
// same as a filename). Three tools are the exception — they send a stable
// English CODE specifically so it CAN be localized (see the matching
// comments in lib/agent/tools.ts): activar_3d/poner_musica send "on"/"off",
// trabajar_en_pagina sends "" for the home switch. Everything else falls
// through unchanged.
const SUMMARY_CODE_TOOLS = new Set(["activar_3d", "poner_musica"]);

// Exported for unit testing (agent-action-card.test.ts): the collision guard
// that cambiar_motion's legitimate free-text "off" is NOT localized — only
// activar_3d/poner_musica's coded "off" is — has no other test seam.
export function summaryLabel(action: AgentAction, t: ReturnType<typeof useTranslations<"wsPage">>): string {
  if (SUMMARY_CODE_TOOLS.has(action.tool) && (action.summary === "on" || action.summary === "off")) {
    return t(`agent.action.${action.summary}`);
  }
  if (action.tool === "trabajar_en_pagina" && action.summary === "") {
    return t("agent.action.home");
  }
  // F5 — verificación visual: el loop manda códigos estables ("" mientras
  // corre, "ok"/"issues" al cerrar) para que la card se localice, nunca texto.
  if (action.tool === "verificar_diseno") {
    if (action.summary === "ok") return t("agent.action.visualOk");
    if (action.summary === "issues") return t("agent.action.visualIssues");
    return "";
  }
  return action.summary;
}

export function AgentActionCard({ action }: { action: AgentAction }) {
  const t = useTranslations("wsPage");
  const label = KNOWN_TOOLS.has(action.tool)
    ? t(`agent.tool.${action.tool}`)
    : action.tool;
  const summary = summaryLabel(action, t);
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
      {summary ? (
        <span className="fg-faint truncate min-w-0">{summary}</span>
      ) : null}
      {action.status === "error" ? (
        <span className="fg-faint shrink-0">{t("agent.failed")}</span>
      ) : null}
    </div>
  );
}
