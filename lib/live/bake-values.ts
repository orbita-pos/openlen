import "server-only";

// Bake de valores vivos individuales (spec 2026-07-14, mitad B): sustituye el
// TEXTO de cada <span data-ol-live="clave">fallback</span> por el valor del
// Sheet para esa clave. El valor del Sheet es texto NO CONFIABLE — lo escribe
// el dueño de la página en una celda de Google Sheets que cualquiera con el
// link de edición puede tocar — así que se inserta SIEMPRE escapado como
// texto, jamás como innerHTML: un valor como "<img onerror=...>" debe quedar
// inerte (texto visible), no convertirse en un elemento que ejecuta.
//
// El Sheet es una mejora, no una dependencia: una clave sin valor conserva el
// fallback estático que el AI escribió en el HTML — la página nunca queda en
// blanco por un Sheet mal llenado o inalcanzable.
import { parse } from "node-html-parser";

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// & primero (si no, doble-escaparía los "&amp;" producidos por las demás
// reglas): un solo regex con una clase de caracteres evita ese orden a mano.
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

export function bakeLiveValues(
  html: string,
  values: Map<string, string>,
): { html: string; baked: number } {
  // Fast-path: si la cadena ni aparece, ni parseamos (mismo razonamiento que
  // bake.ts — el round-trip parse→toString NO es identidad: node-html-parser
  // pierde comentarios y normaliza `/>`).
  if (!html.includes("data-ol-live")) {
    return { html, baked: 0 };
  }

  const dom = parse(html);
  let baked = 0;
  for (const el of dom.querySelectorAll("[data-ol-live]")) {
    const key = el.getAttribute("data-ol-live") ?? "";
    if (!values.has(key)) continue;
    // set_content trata el string como HTML — por eso el valor SIEMPRE pasa
    // por escapeHtml antes. Nunca innerHTML crudo con el dato del Sheet.
    el.set_content(escapeHtml(values.get(key) ?? ""));
    baked++;
  }

  // baked === 0 → devuelve el ORIGINAL byte a byte, jamás dom.toString(). El
  // substring de arriba puede dar falso positivo ("data-ol-live" como texto
  // incidental, o un [data-ol-live] real cuya clave no está en el Map): en
  // ambos casos no horneamos nada, así que la página debe salir idéntica —
  // no degradada por el round-trip del parser.
  if (baked === 0) return { html, baked: 0 };

  return { html: dom.toString(), baked };
}
