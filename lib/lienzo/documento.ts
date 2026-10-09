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
import { moduloDeError, servirRutaDeLaApp, vendorPorRuta } from "@/lib/apps/servir";
import { BUNDLER_DID_NOT_ANSWER, bundleApp } from "@/lib/apps/bundler/bundle-app";

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
  /** UNA APP WEB (spec local 2026-10-07-apps): su entrada se sirve empaquetada
   *  (plan 02) y sus fuentes, compilados. Ausente = una página. */
  app?: AppDeProyecto | null;
  /** Lo que vale `import.meta.env` en la app: sólo valores públicos
   *  (`lib/apps/entorno.ts`). */
  entorno?: Readonly<Record<string, string>>;
  /** UNA APP: la pantalla que se abre (`#/ventas`), la que Len pidió mirar o
   *  usar. Ausente = el principio de la app. */
  pantalla?: string | null;
}

/** `ventas`, `/ventas` o `#/ventas` → `#/ventas`; vacío → `null`. */
export function pantallaDe(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpia = valor.trim().replace(/^#/, "").replace(/^\/?/, "/");
  if (limpia === "/" || /\s/.test(limpia) || limpia.length > 200) return null;
  return `#${limpia}`;
}

/**
 * LA CARPETA COMO LA SIRVE EL LIENZO: cada fuente compilado (`.jsx`, `.tsx`,
 * `.ts`, y en una app también `.js`), lo demás tal cual, y en una app las
 * dependencias de su catálogo en `/openlen/vendor/`. Es lo MISMO que contesta
 * `/api/lienzo/site` (los dos pasan por `servirRutaDeLaApp`), así que los ojos
 * de Len miden la app que el dueño ve. React va en su build de desarrollo, como
 * en el lienzo: sus mensajes de error enteros son lo que Len necesita leer.
 *
 * UNA APP SE SIRVE EMPAQUETADA (plan 02): su entrada ES el paquete de
 * desarrollo (`bundleApp`: sus fuentes con lo que usa del catálogo), el mismo
 * que contesta el lienzo, y su sourcemap va aparte, para traducir las trazas
 * (`traductorDeMapas`): al navegador no se le sirve. Si no compila, la entrada
 * es un módulo que lanza los errores del compilador, como antes cada fuente.
 * Al empaquetador va sólo lo publicable: ni /tests ni /supabase se importan.
 */
export async function carpetaServida(
  files: Readonly<Record<string, string>>,
  app: AppDeProyecto | null,
  entorno?: Readonly<Record<string, string>>,
): Promise<{ files: Record<string, string>; sourceMaps: Record<string, string> }> {
  const out: Record<string, string> = {};
  for (const [ruta, contenido] of Object.entries(files)) {
    const servido = servirRutaDeLaApp(ruta, files, { app, ...(entorno ? { entorno } : {}), modo: "desarrollo" });
    out[ruta] = servido ? servido.cuerpo : contenido;
  }
  const sourceMaps: Record<string, string> = {};
  if (app) {
    Object.assign(out, vendorPorRuta(app.catalogo, "desarrollo"));
    const publicable = Object.fromEntries(Object.entries(files).filter(([r]) => isPublishableFolderPath(r)));
    const paquete = await bundleApp({ carpeta: publicable, app, ...(entorno ? { entorno } : {}), modo: "desarrollo" });
    const e = app.entrada;
    if (!paquete) out[e] = moduloDeError(e, [{ ruta: e, linea: null, columna: null, mensaje: BUNDLER_DID_NOT_ANSWER }]);
    else if (!paquete.ok) out[e] = moduloDeError(e, paquete.errores);
    else {
      out[e] = paquete.js;
      if (paquete.map) sourceMaps[e] = paquete.map;
    }
  }
  return { files: out, sourceMaps };
}

/** Lo que el navegador que mide necesita de la carpeta, o `undefined` si la
 *  vista no trae ficheros: así quien mide una página sin carpeta llama igual
 *  que siempre. Una app trae siempre algo: las dependencias de su catálogo. */
export async function carpetaDeLaVista(
  vista: Pick<ContextoDeVista, "files" | "pagina" | "app" | "entorno" | "pantalla"> | null | undefined,
): Promise<
  | {
      files: Readonly<Record<string, string>>;
      /** UNA APP (plan 02): el mapa del paquete, para traducir las trazas. */
      sourceMaps?: Readonly<Record<string, string>>;
      pagina: string | null;
      hash?: string;
      esperarALaRed?: boolean;
    }
  | undefined
> {
  const app = vista?.app ?? null;
  const files = vista?.files ?? {};
  if (!vista || (!app && Object.keys(files).length === 0)) return undefined;
  const servida = await carpetaServida(files, app, vista.entorno);
  return {
    files: servida.files,
    ...(Object.keys(servida.sourceMaps).length > 0 ? { sourceMaps: servida.sourceMaps } : {}),
    pagina: vista.pagina,
    // UNA APP: la pantalla pedida, y esperar a que pida sus datos (H12).
    ...(app && vista.pantalla ? { hash: vista.pantalla } : {}),
    ...(app ? { esperarALaRed: true } : {}),
  };
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
  // Una app ya no lleva import map (plan 02): su entrada es el paquete, que
  // trae dentro lo que usa del catálogo.
  return sealRelease(out).html;
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
 * (⚰️ Los ojos al cerrar y `medirParaElModelo` se retiraron el 2026-10-06,
 * plans/crear-es-len; hoy lo llaman las herramientas con las que Len mira.)
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
 * herramienta (`view_page`, `use_page`) y la ruta del agente (los ojos y
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
    // Crudo. Una app arranca igual: su entrada es el paquete (plan 02).
    return html;
  }
}
