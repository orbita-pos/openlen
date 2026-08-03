// La banda "Mis plataformas": una sección con tarjetas, hermana de la barra
// flotante. HTML + CSS inline puro (sin scripts, sin iframes) para sobrevivir
// el sanitizador y la CSP sellada. Una plataforma sin URL armable no se
// renderiza — nunca hay tarjeta rota, así que Born-100 se cumple solo.

import type { BusinessProfileData, BusinessProfileLink } from "./types";
import { PLATFORMS, PLATFORM_ICON_PATHS, platformHref, platformLabel } from "./platforms";

export const PLATFORMS_BAND_MARKER = "data-ol-platforms-section";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function icon(id: string): string {
  const paths = PLATFORM_ICON_PATHS[PLATFORMS[id]?.icon ?? "link"] ?? PLATFORM_ICON_PATHS.link;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export interface PlatformsBandOpts {
  /** Idioma del documento (`<html lang>`). Solo mueve los tres nombres
   *  GENÉRICOS del registry; las marcas salen igual en todos los locales. */
  lang?: string;
}

/** ¿Este enlace llega a ser tarjeta? ÚNICA definición de "esto pinta algo":
 *  la afordancia de inserción tiene que gatear con el mismo predicado que la
 *  rejilla, o el creador inserta una banda que el publish le borra en
 *  silencio (`micafe` como Sitio web pasa un `url.trim()` pero no arma href). */
export function platformLinkRenders(l: BusinessProfileLink): boolean {
  return !!l.url?.trim() && !!platformHref(l.type, l.url);
}

/** SOLO la rejilla de tarjetas, o "" si no hay nada que mostrar. El encabezado
 *  lo pone el envoltorio de buildModuleSection — emitirlo aquí lo duplicaría. */
export function renderPlatformsBand(
  data: BusinessProfileData,
  opts: PlatformsBandOpts = {},
): string {
  const cards: string[] = [];
  for (const l of data.links ?? []) {
    if (!platformLinkRenders(l)) continue;
    const href = platformHref(l.type, l.url)!;
    const label = platformLabel(l.type, opts.lang);
    cards.push(
      `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" ` +
        `style="display:flex;align-items:center;gap:12px;padding:16px 18px;border-radius:14px;` +
        `border:1px solid rgba(127,127,127,.18);background:rgba(127,127,127,.05);` +
        `color:inherit;text-decoration:none;font-size:15px;font-weight:600;">` +
        `<span style="display:flex;color:var(--ol-accent,#FF5A36);">${icon(l.type)}</span>` +
        `<span>${esc(label)}</span></a>`,
    );
  }
  if (cards.length === 0) return "";
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;">${cards.join("")}</div>`;
}
