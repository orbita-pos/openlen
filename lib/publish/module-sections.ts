// Designed, brand-matched module SURFACES — the "create page / add section"
// bodies. Each is a clean band that uses the page's own accent token
// (var(--ol-accent)) so it matches the site color with NO recolor pass, and
// carries the module's publish placeholder (data-ol-<module>-section) as an
// INNER empty element so the existing bake wires the live widget while the
// band's heading/copy survive:
//   - collections bake REPLACES the whole placeholder element → marker on an
//     inner empty <div> means only that <div> is swapped for the grid.
//   - comments/bookings bake KEEP the element + replace its CONTENT → the same
//     inner empty <div> works (its empty content becomes the widget).
// WhatsApp is the exception: a STATIC CTA band (no widget) with a wa.me button.
//
// Pure string (no node imports) — usable server-side (the pages API) AND
// client-side (the home-section insert in the workspace).

import { BAND_ATTR } from "./tag-attrs";

// SÓLO CHAT. Aquí se declaraban cinco superficies y cuatro estaban muertas:
// `bookings` y `comments` se retiraron el 2026-08-21, la banda de `platforms`
// murió el 2026-08-29 (era un TECHO: le decía al modelo que las redes SON una
// banda) y `collections` el mismo día, sustituida por un almacén declarado en
// la propia página.
//
// No era documentación desactualizada: es la lista que decide QUÉ SE PUEDE
// INSERTAR, y ofrecía cuatro cosas que habrían metido un contenedor vacío para
// siempre — sin error y sin nada que mirar.
export type ModuleSurface = "chat";

export interface ModuleSectionOpts {
  /** Page language; Spanish copy when it starts with "es", else English. */
  lang?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COPY = {
  chat: {
    es: { eyebrow: "Chat privado", heading: "Habla directamente con nosotros", body: "Inicia sesión y envíanos un mensaje — te respondemos al momento." },
    en: { eyebrow: "Private chat", heading: "Talk directly with us", body: "Sign in and send us a message — we reply right away." },
  },
} as const;

const SECTION_MARKER: Record<ModuleSurface, string> = {
  chat: "data-ol-chat-section",
};


function band(
  maxWidth: number,
  c: { eyebrow: string; heading: string; body: string },
  inner: string,
): string {
  return (
    `<section ${BAND_ATTR} style="max-width:${maxWidth}px;margin:64px auto;padding:0 24px;box-sizing:border-box;">` +
    `<div style="text-align:center;max-width:620px;margin:0 auto 32px;">` +
    `<p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ol-accent,#FF5A36);">${esc(c.eyebrow)}</p>` +
    `<h2 style="margin:0 0 12px;font-size:clamp(26px,4vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.12;color:inherit;">${esc(c.heading)}</h2>` +
    `<p style="margin:0;font-size:16px;line-height:1.6;opacity:.68;">${esc(c.body)}</p>` +
    `</div>${inner}</section>`
  );
}

/** A designed, brand-matched section for `module`. Empty string when a whatsapp
 *  CTA has no usable number (the caller guards on that). */
export function buildModuleSection(
  module: ModuleSurface,
  opts: ModuleSectionOpts = {},
): string {
  const es = /^es/i.test(opts.lang ?? "");
  const lang = es ? "es" : "en";

  const c = COPY[module][lang];
  const inner = `<div ${SECTION_MARKER[module]}></div>`;
  return band(720, c, inner);
}
