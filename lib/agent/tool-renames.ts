/**
 * LOS NOMBRES DE ANTES — lo GUARDADO (historial, transcripción, tarjetas,
 * grabaciones) con los nombres y la forma de hoy, para que el modelo nunca lea
 * una llamada a una herramienta que no tiene. Generaliza lo que la pieza 3 de
 * Len 2.5 hizo con `preguntar` → `ask_user_question`.
 *
 * Las 11 en español pasaron al inglés el 2026-10-06, como las de DeepSeek
 * (plans/crear-es-len/plan-herramientas.md). Sólo se traduce al LEER: la base
 * no se migra.
 *
 * Puro: lo importan la transcripción, el saneado del historial y el chat (cliente).
 */
import { ASK_USER_QUESTION, LEGACY_QUESTION_TOOL } from "./ask-user-question";

export const TOOL_RENAMES: Readonly<Record<string, string>> = {
  [LEGACY_QUESTION_TOOL]: ASK_USER_QUESTION,
  activar_modulo: "toggle_module",
  mirar_pagina: "view_page",
  usar_pagina: "use_page",
  elegir_foto: "find_photo",
  editar_imagen: "edit_image",
  publicar: "publish",
  revertir_ultimo_cambio: "undo_last_change",
  ver_visitas: "get_visits",
  ver_formularios: "list_form_submissions",
  ver_mensajes: "list_messages",
  preparar_respuesta: "draft_reply",
};

/** Para el cliente: los nombres viejos que una tarjeta guardada puede traer. */
export const LEGACY_TOOL_NAMES_FOR_CARDS: readonly string[] = Object.keys(TOOL_RENAMES);

const KEYS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  // `null` = se quita: `numero` se declaraba y nunca se leía.
  activar_modulo: { modulo: "module", encender: "on", numero: null },
  mirar_pagina: { tipo: "mode", pregunta: "question", zona: "area" },
  usar_pagina: { pasos: "steps" },
  elegir_foto: { busqueda: "query", estilo: "style" },
  editar_imagen: { imagen_url: "image_url", instruccion: "instruction" },
  publicar: { subdominio: "subdomain", idiomas: "languages" },
  ver_visitas: { desde: "from", hasta: "to" },
  ver_formularios: { cuales: "which", desde: "from", hasta: "to" },
  ver_mensajes: { cuales: "which", desde: "from", hasta: "to" },
  preparar_respuesta: { para: "channel", texto: "text" },
};

const VALUES: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  mirar_pagina: { tipo: { medir: "measure", describir: "describe" } },
  ver_formularios: { cuales: { nuevos: "new", fecha: "by_date", uno: "one" } },
  ver_mensajes: { cuales: { sin_leer: "unread", fecha: "by_date", una: "one" } },
  preparar_respuesta: { para: { formulario: "form" } },
};

const STEP_KEYS: Readonly<Record<string, string>> = {
  pulsa: "click",
  escribe: "type",
  en: "into",
  elige: "choose",
  dentro_de: "within",
  recarga: "reload",
  lee: "read",
};

/** El nombre de hoy de una herramienta que pudo guardarse con el de antes. */
export function currentToolName(name: string): string {
  return Object.hasOwn(TOOL_RENAMES, name) ? TOOL_RENAMES[name]! : name;
}

const renameKeys = (o: Record<string, unknown>, map: Readonly<Record<string, string | null>>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (Object.hasOwn(map, k)) {
      const nuevo = map[k];
      if (nuevo !== null && nuevo !== undefined) out[nuevo] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
};

/** Una llamada guardada, con el nombre y la forma de hoy: `preguntar({ texto })`
 *  pasa a `ask_user_question({ questions: [{ id: "q1", question: texto }] })`,
 *  y `mirar_pagina({ tipo: "medir" })` a `view_page({ mode: "measure" })`. */
export function currentToolCall(call: { name: string; args?: Record<string, unknown> }): { name: string; args: Record<string, unknown> } {
  const args = call.args ?? {};
  if (call.name === LEGACY_QUESTION_TOOL) {
    const texto = typeof args.texto === "string" ? args.texto : "";
    return { name: ASK_USER_QUESTION, args: { questions: [{ id: "q1", question: texto }] } };
  }
  if (!Object.hasOwn(TOOL_RENAMES, call.name)) return { name: call.name, args };
  const values = VALUES[call.name] ?? {};
  const conValores: Record<string, unknown> = { ...args };
  for (const [clave, mapa] of Object.entries(values)) {
    const v = conValores[clave];
    if (typeof v === "string" && Object.hasOwn(mapa, v)) conValores[clave] = mapa[v];
  }
  const renamed = renameKeys(conValores, KEYS[call.name] ?? {});
  if (call.name === "usar_pagina" && Array.isArray(renamed.steps)) {
    renamed.steps = renamed.steps.map((p) =>
      p && typeof p === "object" && !Array.isArray(p) ? renameKeys(p as Record<string, unknown>, STEP_KEYS) : p,
    );
  }
  return { name: TOOL_RENAMES[call.name]!, args: renamed };
}
