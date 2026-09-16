// EL DOCUMENTO QUE SE VE, antes de publicar.
//
// Es la mitad «documento» de docs/superpowers/specs/2026-09-15-un-solo-camino-
// de-renderizado-design.md, y la copia de lo que hace Claude Code: su vista
// previa llama al MISMO constructor que publica, con `…`.
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
    // El lienzo remoto lleva allow-same-origin en su propio origen: los
    // reproductores de terceros sí montan, como en la publicada.
    sandboxed: false,
  });
  return sealRelease(out).html;
}
