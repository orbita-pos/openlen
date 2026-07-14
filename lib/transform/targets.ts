import "server-only";

// Detección PURA de objetivos de bake (spec 2026-07-14, mitad A). La lógica
// es la de la sonda de daño (scratch/sanitize-damage-probe-full.mts, la que
// midió 45 plantillas/58 contenedores en el catálogo vivo), convertida a
// producción: un contenedor VACÍO EN EL FUENTE que un script inline (que el
// sanitizer borrará) llena vía un sink de DOM es un objetivo; un <path>/
// <polyline>/<polygon> sin d=/points= es geometría muerta.
//
// El pre-etiquetado (data-ol-bake-c="n" / data-ol-bake-g="n") es TEMPORAL:
// run-page.ts lo usa para capturar en Chrome y bake.ts lo elimina SIEMPRE —
// jamás llega al HTML guardado (bake.test.ts lo afirma). Índices en orden de
// documento → captura e inserción se emparejan sin ambigüedad de ids
// duplicados o con caracteres raros.
import { parse } from "node-html-parser";

export interface BakeTargets {
  taggedHtml: string;
  containers: number;
  geoms: number;
}

// Mismas regex que la sonda — un sink que ESCRIBE markup en un nodo, y el
// binding que resuelve el ident de ese sink a un id del documento. Solo
// scripts INLINE (sin src): un script externo también se borra al sanitizar,
// pero su cuerpo no está aquí para leerle los sinks — y el runner de Chrome
// corre SIN RED, así que tampoco podría ejecutarlo.
const CONTENT_GEN_RE =
  /([A-Za-z_$][\w$.]*)\s*\.\s*(?:innerHTML|outerHTML)\s*=(?!=)|([A-Za-z_$][\w$.]*)\s*\.\s*insertAdjacentHTML\s*\(|([A-Za-z_$][\w$.]*)\s*\.\s*(?:appendChild|append|prepend|replaceChildren|insertBefore)\s*\(/g;
const BINDING_RE =
  /([A-Za-z_$][\w$]*)\s*=\s*document\.(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector\(\s*['"]#([^'"]+)['"]\s*\))/g;
// Sink DIRECTO encadenado, sin variable intermedia — invisible para el par
// binding+sink de arriba (hueco cazado por el test de la trampa de bake,
// 2026-07-14): document.getElementById("x").innerHTML = …
const DIRECT_SINK_RE =
  /document\.(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector\(\s*['"]#([^'"]+)['"]\s*\))\s*\.\s*(?:innerHTML|outerHTML)\s*=(?!=)|document\.(?:getElementById\(\s*['"]([^'"]+)['"]\s*\)|querySelector\(\s*['"]#([^'"]+)['"]\s*\))\s*\.\s*(?:insertAdjacentHTML|appendChild|append|prepend|replaceChildren|insertBefore)\s*\(/g;
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;

export function findBakeTargets(html: string): BakeTargets {
  // Ids que algún script inline llena: binding ident→id + sink sobre el ident.
  const filledIds = new Set<string>();
  for (const sm of html.matchAll(INLINE_SCRIPT_RE)) {
    const body = sm[1];
    const bindings = new Map<string, string>();
    for (const bm of body.matchAll(BINDING_RE)) bindings.set(bm[1], bm[2] ?? bm[3]);
    for (const cm of body.matchAll(CONTENT_GEN_RE)) {
      const ident = (cm[1] ?? cm[2] ?? cm[3] ?? "").split(".")[0];
      const id = bindings.get(ident);
      if (id) filledIds.add(id);
    }
    for (const dm of body.matchAll(DIRECT_SINK_RE)) {
      const id = dm[1] ?? dm[2] ?? dm[3] ?? dm[4];
      if (id) filledIds.add(id);
    }
  }

  const dom = parse(html);

  const isEmpty = (el: { childNodes: unknown[]; text: string }) =>
    el.childNodes.length === 0 || el.text.trim() === "";

  let c = 0;
  if (filledIds.size > 0) {
    for (const el of dom.querySelectorAll("[id]")) {
      const id = el.getAttribute("id");
      if (!id || !filledIds.has(id)) continue;
      // Vacío DE VERDAD en el fuente: sin hijos elemento y sin texto propio.
      if (el.querySelectorAll("*").length > 0 || el.text.trim() !== "") continue;
      el.setAttribute("data-ol-bake-c", String(c++));
    }
  }

  let g = 0;
  for (const el of dom.querySelectorAll("path,polyline,polygon")) {
    const tag = el.rawTagName?.toLowerCase();
    const attr = tag === "path" ? "d" : "points";
    if (el.getAttribute(attr) !== undefined) continue;
    el.setAttribute("data-ol-bake-g", String(g++));
  }

  // Cero objetivos → el string ORIGINAL, byte a byte (nunca re-serializar de
  // gratis: el round-trip del parser no es identidad).
  if (c === 0 && g === 0) return { taggedHtml: html, containers: 0, geoms: 0 };
  return { taggedHtml: dom.toString(), containers: c, geoms: g };
}
