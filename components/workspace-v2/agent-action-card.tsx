"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Loader } from "./icons";

import type { OpDescrita } from "@/lib/agent/ops-descritas";

export interface AgentAction {
  tool: string;
  status: "running" | "done" | "error";
  summary: string;
  /** Cuántas ediciones aplicó esta llamada. */
  edits?: number;
  /**
   * QUÉ cambió esta llamada, resuelto por el servidor mientras los
   * `data-op-id` todavía valían — ver `lib/agent/ops-descritas.ts`.
   *
   * 🔴 VIVEN EN LA ACCIÓN Y NO EN EL TURNO, y no es orden: `actions` es una
   * columna JSON de `projectChatMessages`, mientras que el turno se guarda en
   * COLUMNAS EXPLÍCITAS (`appendChatMessage`). Un campo nuevo a nivel de turno
   * no tiene dónde caer sin una migración — se pintaba en vivo y desaparecía al
   * recargar. Y de paso es donde corresponde: las ops son de la llamada que las
   * ejecutó.
   */
  ops?: OpDescrita[];
}

// Tools the catalog exposes — only these have an i18n label (wsPage
// agent.tool.*, all 10 locales). Anything else (shouldn't happen) falls back
// to the raw tool name so a stray card never throws a missing-key at render.
// No se sincroniza a mano: `agent-action-card.test.ts` compara este conjunto
// contra el catálogo Y contra los mensajes. `conectar_datos_vivos` faltaba
// aquí desde que existe —su tarjeta enseñaba el nombre crudo de la función—
// y nadie lo vio, porque una lista escrita a mano no avisa de lo que falta.
export const KNOWN_TOOLS = new Set([
  "leer_estado",
  "editar_pagina",
  "activar_modulo",
  "cambiar_tema",
  "aplicar_tematica",
  "preparar_marketing",
  "crear_pagina",
  "elegir_foto",
  // 2026-09-02 — el derecho a preguntar qué hay en la página. Sin esta línea la
  // tarjeta enseñaría «mirar_pagina» crudo, que es justo el defecto que este
  // conjunto y su prueba vinieron a cazar.
  "mirar_pagina",
  "editar_imagen",
  "recordar_preferencia",
  "conectar_datos_vivos",
  "publicar",
  "trabajar_en_pagina",
  "buscar_en_pagina",
  "leer_de_internet",
  "declarar_tareas",
  "preguntar",
  "revertir_ultimo_cambio",
  "verificar_diseno",
  "redisenar_pagina",
  // Los almacenes de datos (2026-08-29). Sin estar AQUÍ, la tarjeta enseña el
  // nombre crudo de la herramienta —«guardar_dato»— en vez de la frase.
  "guardar_dato",
  "editar_dato",
  "quitar_dato",
]);

// F4-T8 i18n sweep: `summary` is otherwise an opaque identifier (a module
// id, slug, hex color, font/radius preset — none of those need translation,
// same as a filename). The exceptions send a stable English CODE precisely so
// it CAN be localized: trabajar_en_pagina sends "" for the home switch, and
// verificar_diseno sends ""/"ok"/"issues"/"no-mirado". Everything else falls through
// unchanged.
//
// Hubo un tercer caso —`activar_3d`/`poner_musica` mandaban "on"/"off"— y con
// él un guardia de colisión: `cambiar_motion` mandaba un "off" que era un
// valor REAL (un Motion Look llamado así), y traducirlo habría enseñado
// «Apagado» donde el usuario eligió un preset. Las tres herramientas se
// retiraron el 2026-08-26 con sus módulos, y la colisión se fue con ellas.
//
// Exported for unit testing (agent-action-card.test.ts).
export function summaryLabel(action: AgentAction, t: ReturnType<typeof useTranslations<"wsPage">>): string {
  if (action.tool === "trabajar_en_pagina" && action.summary === "") {
    return t("agent.action.home");
  }
  // F5 — verificación visual: el loop manda códigos estables ("" mientras
  // corre, "ok"/"issues" al cerrar) para que la card se localice, nunca texto.
  if (action.tool === "verificar_diseno") {
    if (action.summary === "ok") return t("agent.action.visualOk");
    if (action.summary === "issues") return t("agent.action.visualIssues");
    // NADIE MIRÓ. Los ojos fallan abiertos (Chrome caído, sin key, timeout), y
    // hasta hoy eso enseñaba el mismo visto bueno que una verificación de
    // verdad. La tarjeta es el único sitio donde el usuario puede enterarse.
    if (action.summary === "no-mirado") return t("agent.action.visualNoLook");
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
      {/* `max-w-full break-words` y NO quitar el `shrink-0`: el orden importa.
          El `shrink-0` es lo que hace que el `summary` —que sí trunca, abajo—
          ceda primero; quitarlo invertiría la prioridad y se recortaría el
          nombre de la herramienta en vez de su detalle. Lo que faltaba era el
          TECHO: `shrink-0` con `flex-basis:auto` fija el ítem a su `max-content`
          (una línea) y le prohíbe encogerse, así que una etiqueta larga
          desborda la tarjeta y saca barra horizontal en TODO el hilo.

          MEDIDO sobre los wsPage.json de los 10 idiomas (2026-08-30 — el glob
          va escrito así porque un asterisco-barra cierra este comentario a
          media frase, y me lo cerró): la tarjeta da ~143px
          y en alemán 7 de 20 etiquetas pasan de 26 caracteres — «Notiz zum
          Unternehmen wird gespeichert» mide ~209px. En francés e italiano, 6 de
          20. O sea que no dependía de lo que escribiera el modelo: desbordaba
          SIEMPRE que se llamara a esa herramienta, y sólo en esos idiomas. */}
      <span className="font-medium fg shrink-0 max-w-full break-words">{label}</span>
      {summary ? (
        <span className="fg-faint truncate min-w-0">{summary}</span>
      ) : null}
      {action.status === "error" ? (
        <span className="fg-faint shrink-0">{t("agent.failed")}</span>
      ) : null}
    </div>
  );
}
