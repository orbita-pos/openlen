// EL DOCUMENTO QUE SE VE, antes de publicar.
//
// Es la mitad «documento» de docs/superpowers/specs/2026-09-15-un-solo-camino-
// de-renderizado-design.md, y la copia de lo que hace Claude Code: su vista
// previa llama al MISMO constructor que publica, con `previewOnly: true`.
//
// El subconjunto PURO de `bakeDocument` (lib/publish/filesystem.ts), en su
// mismo orden: logo → asistente y chat → sello. Queda fuera, a propósito:
//   · formularios (`wirePublishedForms`): cada envío sería un lead real;
//   · analítica y tira de rastreo: contarían al dueño;
//   · fuentes e imágenes a disco, datos vivos, idiomas: tocan red o disco.
// Esas diferencias las enumera la spec, y el lienzo avisa de las que se notan.
//
// ⚠️ NO SE PUEDE IMPORTAR EN EL CLIENTE: `sealRelease` e `injectLogoIntoHtml`
// son el binding nativo de Rust.

import { injectLogoIntoHtml } from "@/lib/branding/inject-logo";
import { sealRelease } from "@/lib/html-engine";
import type { ProjectData } from "@/lib/projects/types";
import { bakeModulesForPreviewHtml } from "@/lib/publish/preview-bake";

export interface ContextoDeVista {
  projectId: string;
  title: string | null;
  sub: string | null;
  pagina: string | null;
  settings: ProjectData["settings"] | undefined;
  logoUrl: string | null;
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
  return sealRelease(out).html;
}

/** Lo que hace falta de la fila del proyecto para armar la vista. Se escribe
 *  estructural y no como el tipo de la tabla: los cuatro llamadores seleccionan
 *  columnas distintas, y exigir la fila entera obligaría a tocar cada `select`
 *  y cada doble de prueba por campos que esto no lee. */
export interface FilaDeProyecto {
  title?: string | null;
  subdomain?: string | null;
  data?: { settings?: ProjectData["settings"] } | null;
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
  };
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
    return html;
  }
}
