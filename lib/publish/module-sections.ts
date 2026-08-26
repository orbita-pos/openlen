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

export type ModuleSurface = "bookings" | "collections" | "comments" | "chat" | "platforms";

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
  bookings: {
    es: { eyebrow: "Reservas", heading: "Agenda una cita", body: "Elige el día y la hora que mejor te queden — te confirmamos al instante." },
    en: { eyebrow: "Booking", heading: "Book an appointment", body: "Pick the day and time that work for you — instant confirmation." },
  },
  collections: {
    es: { eyebrow: "Catálogo", heading: "Lo que ofrecemos", body: "Explora nuestros productos y servicios." },
    en: { eyebrow: "Catalog", heading: "What we offer", body: "Browse our products and services." },
  },
  comments: {
    es: { eyebrow: "Comentarios", heading: "Lo que opina la gente", body: "Deja tu comentario y únete a la conversación." },
    en: { eyebrow: "Comments", heading: "What people are saying", body: "Leave a comment and join the conversation." },
  },
  chat: {
    es: { eyebrow: "Chat privado", heading: "Habla directamente con nosotros", body: "Inicia sesión y envíanos un mensaje — te respondemos al momento." },
    en: { eyebrow: "Private chat", heading: "Talk directly with us", body: "Sign in and send us a message — we reply right away." },
  },
  platforms: {
    es: { eyebrow: "Plataformas", heading: "Encuéntrame en", body: "Sígueme donde prefieras." },
    en: { eyebrow: "Platforms", heading: "Find me on", body: "Follow along wherever you like." },
  },
} as const;

const SECTION_MARKER: Record<ModuleSurface, string> = {
  bookings: "data-ol-bookings-section",
  collections: "data-ol-collection-section",
  comments: "data-ol-comments-section",
  chat: "data-ol-chat-section",
  platforms: "data-ol-platforms-section",
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
  return band(module === "collections" ? 1100 : module === "platforms" ? 900 : 720, c, inner);
}
