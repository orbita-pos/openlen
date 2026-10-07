// EL DOCUMENTO QUE SE VE, antes de publicar.
//
// Es la mitad «documento» de docs/superpowers/specs/2026-09-15-un-solo-camino-
// de-renderizado-design.md, y la copia de lo que hace Claude Code: su vista
// previa sale del MISMO constructor que publica, en modo de vista previa.
//
// El subconjunto PURO de `bakeDocument` (lib/publish/filesystem.ts), en su
// mismo orden: logo → asistente y chat → sello. Queda fuera, a propósito:
//   · formularios (`wirePublishedForms`): cada envío sería un lead real;
//   · analítica y tira de rastreo: contarían al dueño;
//   · fuentes e imágenes a disco, idiomas: tocan red o disco.
// Esas diferencias las enumera la spec, y el lienzo avisa de las que se notan.
//
// ⚠️ NO SE PUEDE IMPORTAR EN EL CLIENTE: `sealRelease` e `injectLogoIntoHtml`
// son el binding nativo de Rust.

import { injectLogoIntoHtml } from "@/lib/branding/inject-logo";
import { sealRelease } from "@/lib/html-engine";
import type { AppDeProyecto, ProjectData } from "@/lib/projects/types";
import { bakeModulesForPreviewHtml } from "@/lib/publish/preview-bake";
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import { conImportMap } from "@/lib/apps/documento";
import { servirRutaDeLaApp, vendorPorRuta } from "@/lib/apps/servir";

export interface ContextoDeVista {
  projectId: string;
  title: string | null;
  sub: string | null;
  pagina: string | null;
  settings: ProjectData["settings"] | undefined;
  logoUrl: string | null;
  /** LA CARPETA (pieza 9 de Len 2.5): los ficheros del proyecto, `/js/app.js`
   *  → contenido. No entran en el documento: viajan con él hasta el navegador
   *  que lo mide, que los contesta cuando la página los pide. */
  files?: Readonly<Record<string, string>>;
  /** UNA APP WEB (spec local 2026-10-07-apps): su documento lleva el import map
   *  del catálogo y sus fuentes se sirven compilados. Ausente = una página. */
  app?: AppDeProyecto | null;
  /** Lo que vale `import.meta.env` en la app: sólo valores públicos
   *  (`lib/apps/entorno.ts`). */
  entorno?: Readonly<Record<string, string>>;
}

/**
 * LA CARPETA COMO LA SIRVE EL LIENZO: cada fuente compilado (`.jsx`, `.tsx`,
 * `.ts`, y en una app también `.js`), lo demás tal cual, y en una app las
 * dependencias de su catálogo en `/openlen/vendor/`. Es lo MISMO que contesta
 * `/api/lienzo/site` (los dos pasan por `servirRutaDeLaApp`), así que los ojos
 * de Len miden la app que el dueño ve. React va en su build de desarrollo, como
 * en el lienzo: sus mensajes de error enteros son lo que Len necesita leer.
 */
export function carpetaServida(
  files: Readonly<Record<string, string>>,
  app: AppDeProyecto | null,
  entorno?: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ruta, contenido] of Object.entries(files)) {
    const servido = servirRutaDeLaApp(ruta, files, { app, ...(entorno ? { entorno } : {}), modo: "desarrollo" });
    out[ruta] = servido ? servido.cuerpo : contenido;
  }
  if (app) Object.assign(out, vendorPorRuta(app.catalogo, "desarrollo"));
  return out;
}

/** Lo que el navegador que mide necesita de la carpeta, o `undefined` si la
 *  vista no trae ficheros: así quien mide una página sin carpeta llama igual
 *  que siempre. Una app trae siempre algo: las dependencias de su catálogo. */
export function carpetaDeLaVista(
  vista: Pick<ContextoDeVista, "files" | "pagina" | "app" | "entorno"> | null | undefined,
): { files: Readonly<Record<string, string>>; pagina: string | null } | undefined {
  const app = vista?.app ?? null;
  const files = vista?.files ?? {};
  if (!vista || (!app && Object.keys(files).length === 0)) return undefined;
  return { files: carpetaServida(files, app, vista.entorno), pagina: vista.pagina };
}

export function documentoDeVista(html: string, ctx: ContextoDeVista): string {
  let out = html;
  if (ctx.logoUrl) out = injectLogoIntoHtml({ html: out, logoUrl: ctx.logoUrl });
  out = bakeModulesForPreviewHtml(out, {
    projectId: ctx.projectId,
    title: ctx.title,
    sub: ctx.sub,
    page: ctx.pagina,
    settings: ctx.settings,
    // Lo correcto de declarar —el lienzo remoto lleva allow-same-origin en su
    // propio origen, así que los reproductores de terceros sí montan, como en
    // la publicada— pero ⚠️ HOY NO HACE NADA: `bakeModulesForPreviewHtml`
    // acepta el campo y no lo lee desde que se retiró el lightbox de vídeo. Se
    // deja puesto para que el día que vuelva a leerse diga la verdad, y dicho
    // aquí para que nadie deduzca un efecto que no ocurre.
    sandboxed: false,
  });
  const sellado = sealRelease(out).html;
  // El import map de la app va lo ÚLTIMO, con el documento ya sellado: ningún
  // pase posterior puede moverlo de delante de los módulos. La publicación lo
  // pone en el mismo punto (`publishToDir`).
  return ctx.app ? conImportMap(sellado, ctx.app.catalogo) : sellado;
}

/** Lo que hace falta de la fila del proyecto para armar la vista. Se escribe
 *  estructural y no como el tipo de la tabla: los cuatro llamadores seleccionan
 *  columnas distintas, y exigir la fila entera obligaría a tocar cada `select`
 *  y cada doble de prueba por campos que esto no lee. */
export interface FilaDeProyecto {
  title?: string | null;
  subdomain?: string | null;
  data?: { settings?: ProjectData["settings"]; app?: AppDeProyecto | null } | null;
}

/**
 * EL CONTEXTO DE VISTA PARA QUIEN MIDE, armado en un solo sitio.
 *
 * Lo llaman los ojos de Len, la medida que vuelve al modelo a mitad de turno y
 * el arnés de evals. Escrito tres veces se queda viejo dos: es literalmente el
 * fallo que ya se documentó con `medirParaElModelo` —el arnés midiendo un turno
 * que producción no manda— y que hoy vigila `aviso-medido.test.ts`.
 *
 * 🔴 `logoUrl` VA SIEMPRE A null, y no es un olvido. `inject_logo` sólo toca el
 * `<head>`: un `<link rel="icon">` y, si falta, un `og:image`
 * (`crates/html-engine/src/publish/logo.rs`). No pinta un píxel de la captura,
 * así que medirlo con o sin él da lo mismo — y traerlo exigiría una columna más
 * en `AgentDeps.loadProject` y en todos sus dobles. La diferencia queda
 * DECLARADA en `lib/publish/bake-surfaces.ts`, que es donde este repo pone las
 * diferencias entre superficies para que no vuelvan a ser accidentes.
 */
export function vistaParaMedir(
  projectId: string,
  fila: FilaDeProyecto,
  pagina: string | null,
): ContextoDeVista {
  return {
    projectId,
    title: fila.title ?? null,
    sub: fila.subdomain ?? null,
    pagina,
    settings: fila.data?.settings,
    logoUrl: null,
    app: fila.data?.app ?? null,
  };
}

/**
 * LA VISTA CON SU CARPETA (pieza 9 de Len 2.5). Los ficheros que se publican
 * viajan con la vista hasta el navegador que mide, que los contesta cuando la
 * página los pide (`<script src="/js/app.js">`). Sin ficheros publicables —o
 * si la carpeta no se puede leer— la vista es la de siempre: medir sin carpeta
 * ya es útil, y no poder leerla no puede dejar ciego a Len.
 *
 * `deps` es estructural (el `projectFiles` de `AgentDeps`): lo llaman la
 * herramienta (`mirar_pagina`, `usar_pagina`) y la ruta del agente (los ojos y
 * la medida que vuelve al modelo).
 *
 * En una APP trae además su `import.meta.env` (`entornoDeLaApp`): sin él, una
 * app que habla con su backend se mediría sin la URL de ese backend.
 */
export async function vistaConCarpeta(
  vista: ContextoDeVista,
  deps: {
    projectFiles?(projectId: string): Promise<Readonly<Record<string, string>>>;
    entornoDeLaApp?(projectId: string): Promise<Readonly<Record<string, string>>>;
  },
  projectId: string,
): Promise<ContextoDeVista> {
  let todos: Readonly<Record<string, string>> | null | undefined;
  try {
    todos = await deps.projectFiles?.(projectId);
  } catch {
    todos = null;
  }
  let conEntorno = vista;
  if (vista.app && deps.entornoDeLaApp) {
    const entorno = await deps.entornoDeLaApp(projectId).catch(() => null);
    if (entorno) conEntorno = { ...vista, entorno };
  }
  if (!todos) return conEntorno;
  const files = Object.fromEntries(Object.entries(todos).filter(([ruta]) => isPublishableFolderPath(ruta)));
  return Object.keys(files).length > 0 ? { ...conEntorno, files } : conEntorno;
}

/**
 * `documentoDeVista` para las superficies que MIDEN: falla blando.
 *
 * La ruta del lienzo quiere el error —si no puede hornear, no hay página que
 * enseñar—. El medidor no: aquí el peor resultado no es medir el documento sin
 * hornear (que es lo que se mide HOY, y ya es útil), es dejar ciego al Agente
 * porque el binding nativo no cargó. Mismo contrato que el resto de
 * `visual-quality-renderer.ts`: no medir no es medir mal.
 *
 * `hornear` se inyecta sólo para poder probar esa rama; en producción nadie lo
 * pasa.
 */
export function documentoMedible(
  html: string,
  vista: ContextoDeVista | null,
  hornear: (html: string, ctx: ContextoDeVista) => string = documentoDeVista,
): string {
  if (!vista) return html;
  try {
    return hornear(html, vista);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[lienzo] no se pudo hornear el documento a medir, se mide crudo: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    // Crudo, pero una app CON su import map: sin él no arranca, y lo que se
    // mediría sería una pantalla en blanco que la app no tiene.
    return vista.app ? conImportMap(html, vista.app.catalogo) : html;
  }
}
