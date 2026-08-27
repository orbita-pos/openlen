// LAS FOTOS DEL DUEÑO, DENTRO DEL DOCUMENTO QUE SE VA A MIRAR.
//
// EL PROBLEMA. Cuando algo nuestro renderiza la página del usuario para
// juzgarla —los ojos del Agente, la imagen de referencia del Chat— instala un
// guardia SSRF que corta cualquier petición a loopback o a redes internas. Hace
// bien: la página la escribió un modelo y podría apuntar un `<img>` a la app del
// propio servidor.
//
// Pero en desarrollo no hay almacenamiento en la nube, así que NUESTRO propio
// subidor devuelve `http://localhost:3000/api/projects/<id>/assets/<f>`. El
// guardia la corta, la captura sale con un hueco, y quien mira no puede
// distinguir ese hueco de una imagen rota de verdad. El 2026-08-27 eso acabó con
// el Agente BORRÁNDOLE a Jesús una foto que él mismo había adjuntado.
//
// LA SALIDA: que no haya petición que cortar. Los bytes están en nuestro propio
// almacenamiento — se leen de ahí y viajan DENTRO del documento como `data:`.
// El guardia no ve nada, no queda hueco, y los ojos juzgan la página que el
// dueño ve.
//
// Es mecanismo en vez de prompt. La alternativa —pedirle al modelo que ignore
// los huecos que hicimos nosotros— existe y está puesta (`<blocked-by-us>` en
// verify.ts), pero un prompt convence casi siempre y esto no falla nunca.
//
// EN PRODUCCIÓN NO CAMBIA NADA: allí las subidas salen por
// `images.openlen.com`, que es público, no se bloquean, y no entran aquí.

import { RUTA_ASSET_PROPIO } from "@/lib/publish/image-bake";

/** Por imagen. El mismo techo que usa el horneado al publicar: una foto que no
 *  cabe ahí tampoco cabe en un `setContent`. */
const MAX_POR_IMAGEN = 20 * 1024 * 1024;
/**
 * Y un techo TOTAL, que es el que de verdad protege.
 *
 * Sin él, una galería de diez fotos convierte el documento en decenas de MB de
 * base64 que hay que pasar por `page.setContent` — el render se arrastra o se
 * cae, y el síntoma sería «la verificación va lenta», nunca «esto lo hizo el
 * inlineador». Alcanzado el techo, lo que queda se deja tal cual: el guardia lo
 * cortará como antes, que es exactamente el estado previo a este fichero.
 */
const MAX_TOTAL = 40 * 1024 * 1024;

/** `src="…"` y `src='…'` de un `<img>`, y las `url(…)` de CSS en línea. Se lee
 *  con expresión regular a propósito: es una lectura para RENDERIZAR, no una
 *  transformación que se guarde, y meter el documento en un DOM para volver a
 *  serializarlo lo normalizaría entero. */
const URLS_EN_HTML =
  /(?:\bsrc\s*=\s*"([^"]+)")|(?:\bsrc\s*=\s*'([^']+)')|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi;

/**
 * Sustituye las subidas del propio dueño por `data:` URI, leyendo los bytes del
 * almacenamiento.
 *
 * FAIL-SOFT EN TODO: lo que no se pueda leer se deja exactamente como estaba.
 * Este paso sólo puede mejorar un render — jamás impedirlo. Si el
 * almacenamiento no responde, la página se mira como se miraba ayer.
 *
 * Devuelve el HTML tal cual cuando no hay ninguna subida propia, que es el caso
 * normal en producción y en cualquier página nacida del catálogo.
 */
export async function inlineOwnAssets(html: string): Promise<string> {
  if (!html) return html;

  // Primero se RECOGEN las que hay que traer, y luego se sustituye. Hacerlo a
  // la vez obligaría a un `replace` asíncrono, que no existe.
  const porUrl = new Map<string, { projectId: string; filename: string }>();
  URLS_EN_HTML.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URLS_EN_HTML.exec(html)) !== null) {
    const url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!url || url.startsWith("data:")) continue;
    if (porUrl.has(url)) continue;
    const propia = urlPropia(url);
    if (propia) porUrl.set(url, propia);
  }
  if (porUrl.size === 0) return html;

  let storage: Awaited<ReturnType<typeof cargarStorage>>;
  try {
    // Import PEREZOSO: `lib/projects/assets` es `server-only` y este módulo lo
    // pueden importar sitios que no lo son.
    storage = await cargarStorage();
  } catch {
    return html;
  }

  const dataPorUrl = new Map<string, string>();
  let total = 0;
  for (const [url, { projectId, filename }] of porUrl) {
    if (total >= MAX_TOTAL) break;
    try {
      const encontrado = await storage.get(projectId, filename);
      if (!encontrado) continue;
      const bytes = encontrado.contents;
      if (bytes.length === 0 || bytes.length > MAX_POR_IMAGEN) continue;
      if (total + bytes.length > MAX_TOTAL) continue;
      total += bytes.length;
      const mime = encontrado.contentType || "application/octet-stream";
      dataPorUrl.set(url, `data:${mime};base64,${bytes.toString("base64")}`);
    } catch {
      // Esta imagen se queda como estaba; las demás siguen.
    }
  }
  if (dataPorUrl.size === 0) return html;

  URLS_EN_HTML.lastIndex = 0;
  return html.replace(URLS_EN_HTML, (entero, dobles, simples, css) => {
    const url = (dobles ?? simples ?? css ?? "").trim();
    const datos = dataPorUrl.get(url);
    if (!datos) return entero;
    // Se sustituye la URL DENTRO de la coincidencia, no la coincidencia entera:
    // así se conserva su forma exacta (comillas, `url(`, espacios) y no se toca
    // nada más del atributo.
    return entero.replace(url, datos);
  });
}

async function cargarStorage() {
  const { getAssetStorage } = await import("@/lib/projects/assets");
  return getAssetStorage();
}

/**
 * ¿Es esta URL una subida nuestra? El `projectId` y el fichero salen de la
 * propia ruta.
 *
 * Se reconoce por la RUTA y no por el host —usando el MISMO reconocedor que el
 * horneado al publicar— porque el host cambia con el entorno: `localhost` en
 * desarrollo, el dominio propio en una instalación autoalojada. Dos definiciones
 * de «esto es nuestro» es como se acaba con una que reconoce lo que la otra no.
 */
function urlPropia(url: string): { projectId: string; filename: string } | null {
  // Absoluta o relativa: las dos formas existen según quién escribiera el src.
  let ruta: string;
  if (/^https?:\/\//i.test(url)) {
    try {
      ruta = new URL(url).pathname;
    } catch {
      return null;
    }
  } else if (url.startsWith("/")) {
    ruta = url.split(/[?#]/)[0]!;
  } else {
    return null;
  }
  const m = RUTA_ASSET_PROPIO.exec(ruta);
  return m ? { projectId: m[1]!, filename: m[2]! } : null;
}
