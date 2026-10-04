// lib/agent/librerias-que-no-cargan.ts — la librería que en el lienzo va y publicada no.
//
// Lo que vigila es el ORIGEN de las librerías, `libs.openlen.com`: con
// `integrity` o `crossorigin` en una de las nuestras el navegador la BLOQUEA (el
// origen no manda CORS, medido el 2026-09-04, `ORIGEN_MANDA_CORS`), una ruta que
// no está en el catálogo da 404, el script que usa `Chart` sin cargarla muere
// con «is not defined», y Swiper sin su hoja se apila. Como `enlaces-inventados`
// y `datos-inventados`, es un DETECTOR: la comprobación sin modelo que Claude
// Code recibe del linter, en el mismo `<new-diagnostics>`. Habla del FICHERO, y
// `diagnosticos-de-la-escritura` resta lo que ya venía.
//
// ⚰️ «script-ajeno» (29/09) decía que un `<script src>` de jsDelivr o unpkg se
// BORRA al publicar, y mandaba quitarlo. Era FALSO: lo comparaba con
// `sanitizeForPublish`, el saneador del HTML AJENO (lo pegado, un remix), y lo
// que escribe el modelo no pasa por él desde el 2026-08-26 —sólo por
// `gateReservedMarker`, en el motor y en `publishToDir`—. Medido el 2026-10-04:
// supabase-js de jsDelivr llega a la publicada. En 3.165 escrituras grabadas no
// había avisado nunca; con el backend de Supabase habría mandado quitar justo
// supabase-js. Se retiró, con `scriptSobreviveAlPublicar`, que sólo existía
// para él.

import { LIBRERIAS, ORIGEN_MANDA_CORS, esUrlDeLibreria, type Libreria } from "@/lib/librerias";
import { todoElJsDelDocumento } from "@/lib/page-engine/conservar-scripts";

export type ProblemaDeLibreria =
  /** Una de las nuestras con `integrity` o `crossorigin`: el navegador la bloquea. */
  | { readonly tipo: "con-integrity"; readonly url: string }
  /** Una ruta de `libs.openlen.com` que no está en el catálogo: casi seguro, 404. */
  | { readonly tipo: "fuera-del-catalogo"; readonly url: string }
  /** El script usa el global de una librería que la página no carga. */
  | { readonly tipo: "sin-cargar"; readonly global: string; readonly libreria: Libreria; readonly faltan: readonly string[] }
  /** Swiper sin su hoja: el carrusel se apila en vertical. */
  | { readonly tipo: "sin-hoja"; readonly libreria: Libreria; readonly css: string };


interface Etiqueta {
  readonly nombre: "script" | "link";
  readonly url: string;
  readonly cruda: string;
}

function etiquetasConUrl(html: string): Etiqueta[] {
  const out: Etiqueta[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    out.push({ nombre: "script", url: m[1]!.trim(), cruda: m[0] });
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1]?.trim();
    if (href) out.push({ nombre: "link", url: href, cruda: m[0] });
  }
  return out;
}

const URLS_DEL_CATALOGO = new Set(LIBRERIAS.flatMap((l) => [...l.scripts.map((s) => s.url), ...(l.css ? [l.css] : [])]));

/** La librería del catálogo que un `src` ajeno intentaba cargar, por su nombre. */
function libreriaQueIntenta(src: string): Libreria | null {
  const s = src.toLowerCase();
  return LIBRERIAS.find((l) => s.includes(l.id.replace(/\.js$/, "")) || s.includes(l.nombre.toLowerCase())) ?? null;
}

/**
 * Lo que el script de la página USA de cada librería, y qué etiquetas necesita:
 * `new Chart(`, `new Swiper(`, `new PhotoSwipeLightbox(` y el `pswpModule:
 * PhotoSwipe` del lightbox, que es el núcleo (el primero de sus dos scripts).
 */
const USOS: readonly { readonly global: string; readonly patron: RegExp; readonly id: string; readonly script: number }[] = [
  { global: "Chart", patron: /\bnew\s+Chart\s*\(/, id: "chart.js", script: 0 },
  { global: "Swiper", patron: /\bnew\s+Swiper\s*\(/, id: "swiper", script: 0 },
  { global: "PhotoSwipe", patron: /\bpswpModule\s*:\s*PhotoSwipe\b/, id: "photoswipe", script: 0 },
  { global: "PhotoSwipeLightbox", patron: /\bnew\s+PhotoSwipeLightbox\s*\(/, id: "photoswipe", script: 1 },
];

/**
 * Los problemas de librerías de un documento entero. Sin la línea base: eso lo
 * pone quien llama (`diagnosticos-de-la-escritura`, familia «del fichero»).
 */
export function libreriasQueNoCargan(html: string): ProblemaDeLibreria[] {
  const out: ProblemaDeLibreria[] = [];
  const etiquetas = etiquetasConUrl(html);
  const cargadas = new Set(etiquetas.map((e) => e.url));
  const deOtroCdn: Libreria[] = [];

  for (const e of etiquetas) {
    if (!esUrlDeLibreria(e.url)) {
      // Una de las conocidas cargada de otro CDN (jsDelivr, unpkg…) CARGA: lo
      // que escribe el modelo llega tal cual a la publicada. Se apunta para que
      // su `new Chart` no cuente como «sin cargar».
      if (e.nombre === "script") {
        const otra = libreriaQueIntenta(e.url);
        if (otra) deOtroCdn.push(otra);
      }
      continue;
    }
    if (!URLS_DEL_CATALOGO.has(e.url)) out.push({ tipo: "fuera-del-catalogo", url: e.url });
    if (!ORIGEN_MANDA_CORS && /\s(?:integrity|crossorigin)(?:\s*=|[\s>/])/i.test(e.cruda)) {
      out.push({ tipo: "con-integrity", url: e.url });
    }
  }

  const js = todoElJsDelDocumento(html);
  const avisadas = new Set<string>();
  for (const uso of USOS) {
    if (!uso.patron.test(js)) continue;
    const libreria = LIBRERIAS.find((l) => l.id === uso.id);
    // Cargada de otro CDN: no falta.
    if (!libreria || deOtroCdn.includes(libreria)) continue;
    const necesarias = libreria.scripts.slice(0, uso.script + 1).map((s) => s.url);
    const faltan = necesarias.filter((u) => !cargadas.has(u));
    if (faltan.length > 0 && !avisadas.has(libreria.id)) {
      avisadas.add(libreria.id);
      out.push({ tipo: "sin-cargar", global: uso.global, libreria, faltan });
    }
    if (libreria.id === "swiper" && libreria.css && !cargadas.has(libreria.css)) {
      out.push({ tipo: "sin-hoja", libreria, css: libreria.css });
    }
  }
  return out;
}

/** Las etiquetas exactas de una librería, como las da el prompt. */
export function etiquetasDe(l: Libreria, soloScripts?: readonly string[]): string {
  const scripts = l.scripts.filter((s) => !soloScripts || soloScripts.includes(s.url)).map((s) => `<script src="${s.url}"></script>`);
  const css = !soloScripts && l.css ? [`<link rel="stylesheet" href="${l.css}">`] : [];
  return [...scripts, ...css].join(" ");
}
