// lib/apps/documento.ts — el `index.html` de una app web, tal como lo recibe el
// navegador: con el import map de su catálogo y, al publicar, la precarga de
// sus módulos.
//
// Lo escribe LA PLATAFORMA, no Len (spec local 2026-10-07-apps, §5.1): así una
// versión o una URL equivocadas no pueden romper una app, y el catálogo se
// sube en un solo sitio. Lo usan el constructor de la vista
// (`lib/lienzo/documento.ts`) y la publicación (`publishToDir`), con la MISMA
// función: el import map del lienzo y el de la publicada son idénticos; lo
// único que cambia entre los dos son los bytes que sirve `/openlen/vendor/`
// (React de desarrollo en la vista, de producción en la publicada).
//
// Puro: cadenas dentro, cadena fuera. Lo prueba vitest.

import { catalogo as catalogoDe, dependenciaDe, importMapDe, rutaDeVendor } from "./dependencias";

const MARCA_IMPORT_MAP = "data-openlen-importmap";
const MARCA_PRECARGA = "data-openlen-precarga";

const IMPORT_MAP_RE = /<script\b[^>]*\btype\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
const PRECARGA_RE = new RegExp(`<link\\b[^>]*\\b${MARCA_PRECARGA}\\b[^>]*>\\s*`, "gi");

/** Dentro de un `<script>`, `</` cortaría la etiqueta: se escapa. */
function jsonEnScript(valor: unknown): string {
  return JSON.stringify(valor).replace(/<\//g, "<\\/");
}

/** Mete `fragmento` justo al abrir el `<head>` (o el `<html>`, o al principio):
 *  el import map tiene que ir ANTES de cualquier módulo y de su precarga. */
function alAbrirElHead(html: string, fragmento: string): string {
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + fragmento + html.slice(m.index + m[0].length);
  }
  return fragmento + html;
}

interface ImportMap {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

/**
 * EL IMPORT MAP DEL CATÁLOGO, el primero del `<head>`.
 *
 * SI EL DOCUMENTO YA TRAE OTRO (lo escribió Len o el dueño), NO SE BORRA NI SE
 * DUPLICA: se FUSIONA en uno solo. Dos import maps en la misma página fallan en
 * los navegadores que aún no los combinan, y tirar el del dueño sería perder su
 * trabajo en silencio. En un choque de nombres gana el catálogo: es lo único
 * que esta plataforma sirve. Uno que no es JSON válido se deja como está —el
 * navegador lo dirá en la consola— y el nuestro va delante.
 *
 * Idempotente: aplicarlo dos veces da lo mismo.
 */
export function conImportMap(html: string, catalogo: string): string {
  const nuestro = importMapDe(catalogo);
  const fusionado: ImportMap = { imports: {} };
  let sinMapas = html;
  for (const m of html.matchAll(IMPORT_MAP_RE)) {
    const esNuestro = m[0].includes(MARCA_IMPORT_MAP);
    let suyo: ImportMap | null = null;
    try {
      const leido = JSON.parse(m[1] ?? "") as unknown;
      if (leido && typeof leido === "object") suyo = leido as ImportMap;
    } catch {
      suyo = null;
    }
    if (!esNuestro && suyo === null) continue; // inválido y ajeno: se queda
    if (!esNuestro && suyo) {
      Object.assign(fusionado.imports!, suyo.imports ?? {});
      if (suyo.scopes) fusionado.scopes = { ...(fusionado.scopes ?? {}), ...suyo.scopes };
    }
    sinMapas = sinMapas.replace(m[0], "");
  }
  Object.assign(fusionado.imports!, nuestro.imports);
  const etiqueta = `<script type="importmap" ${MARCA_IMPORT_MAP}>${jsonEnScript(fusionado)}</script>`;
  return alAbrirElHead(sinMapas, etiqueta);
}

/**
 * Lo que la publicada precarga (H13 de la spec): los módulos del grafo y los
 * ficheros del catálogo que ese grafo importa —las fachadas y el bundle
 * compartido de React—. Sin esto la cadena de imports es una cascada de
 * peticiones, una vuelta por cada nivel; con esto el navegador las pide todas
 * a la vez.
 */
export function rutasDePrecarga(catalogo: string, grafo: readonly string[], paquetes: readonly string[]): string[] {
  const c = catalogoDe(catalogo);
  if (!c) return [...grafo];
  const vendor = paquetes
    .map((p) => dependenciaDe(catalogo, p))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => rutaDeVendor(catalogo, d.fichero));
  // Las fachadas de React importan el bundle compartido.
  const usaReact = paquetes.some((p) => p === "react" || p.startsWith("react/") || p.startsWith("react-dom"));
  // Los trozos compartidos de un catálogo por partes (`chunk-*`) NO: cada paquete
  // importa sólo los suyos, y precargarlos todos bajaría Radix entero para un clsx.
  const internos = usaReact ? c.internos.filter((f) => !f.startsWith("chunk-")).map((f) => rutaDeVendor(catalogo, f)) : [];
  return [...new Set([...vendor, ...internos, ...grafo])];
}

/** Las `<link rel="modulepreload">` justo detrás del import map. Idempotente:
 *  las de una pasada anterior se quitan antes. */
export function conPrecarga(html: string, rutas: readonly string[]): string {
  const limpio = html.replace(PRECARGA_RE, "");
  if (rutas.length === 0) return limpio;
  const enlaces = rutas.map((r) => `<link rel="modulepreload" href="${r.replace(/"/g, "&quot;")}" ${MARCA_PRECARGA}>`).join("");
  const mapa = new RegExp(`<script\\b[^>]*\\b${MARCA_IMPORT_MAP}\\b[^>]*>[\\s\\S]*?</script\\s*>`, "i").exec(limpio);
  if (mapa) return limpio.slice(0, mapa.index + mapa[0].length) + enlaces + limpio.slice(mapa.index + mapa[0].length);
  return alAbrirElHead(limpio, enlaces);
}
