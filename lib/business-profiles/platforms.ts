// Registry de plataformas del creador — fuente ÚNICA para la UI de Mi negocio,
// el widget flotante de contacto y la banda de la página. Añadir una plataforma
// = una entrada aquí + un icono + una clave i18n.
//
// `shape` describe cómo se arma la URL desde lo que el creador escribe:
//   path      → https://<host>/<prefix><handle>     (twitch.tv/kira)
//   subdomain → https://<handle>.<host>             (kira.bandcamp.com)
//   url       → no hay handle adivinable; exige URL  (Spotify, Apple Music)

export interface Platform {
  id: string;
  /** No se traduce: "Twitch" es "Twitch" en los 10 locales. */
  label: string;
  /** Clave en PLATFORM_ICON_PATHS. */
  icon: string;
  placeholder: string;
  shape: "path" | "subdomain" | "url";
  host: string;
  prefix?: string;
}

const P = (
  id: string,
  label: string,
  host: string,
  placeholder: string,
  extra: Partial<Platform> = {},
): Platform => ({ id, label, icon: id, placeholder, shape: "path", host, ...extra });

export const PLATFORMS: Record<string, Platform> = {
  // Stream / video
  youtube: P("youtube", "YouTube", "youtube.com", "@tucanal", { prefix: "@" }),
  twitch: P("twitch", "Twitch", "twitch.tv", "tucanal"),
  kick: P("kick", "Kick", "kick.com", "tucanal"),
  tiktok: P("tiktok", "TikTok", "tiktok.com", "@tuusuario", { prefix: "@" }),
  // Comunidad
  discord: P("discord", "Discord", "discord.gg", "tu-invitación"),
  telegram: P("telegram", "Telegram", "t.me", "tuusuario"),
  x: P("x", "X", "x.com", "tuusuario"),
  instagram: P("instagram", "Instagram", "instagram.com", "tuusuario"),
  // Música
  spotify: P("spotify", "Spotify", "open.spotify.com", "pega tu link de Spotify", { shape: "url" }),
  soundcloud: P("soundcloud", "SoundCloud", "soundcloud.com", "tuusuario"),
  bandcamp: P("bandcamp", "Bandcamp", "bandcamp.com", "tuusuario", { shape: "subdomain" }),
  applemusic: P("applemusic", "Apple Music", "music.apple.com", "pega tu link de Apple Music", { shape: "url" }),
  // Apoyo / venta
  kofi: P("kofi", "Ko-fi", "ko-fi.com", "tuusuario"),
  patreon: P("patreon", "Patreon", "patreon.com", "tuusuario"),
  gumroad: P("gumroad", "Gumroad", "gumroad.com", "tuusuario", { shape: "subdomain" }),
  // Heredados (ya existían como TIPOS_ENLACE)
  website: P("website", "Sitio web", "", "tunegocio.mx", { shape: "url", icon: "globe" }),
  menu: P("menu", "Menú / Linktree", "", "linktr.ee/tunegocio", { shape: "url", icon: "link" }),
  otro: P("otro", "Otro enlace", "", "pega-tu-link.com", { shape: "url", icon: "link" }),
};

export const PLATFORM_ORDER: string[] = [
  "youtube", "twitch", "kick", "tiktok",
  "discord", "telegram", "x", "instagram",
  "spotify", "soundcloud", "bandcamp", "applemusic",
  "kofi", "patreon", "gumroad",
  "website", "menu", "otro",
];

/** Solo http(s). Corta javascript:, data:, vbscript: antes de llegar a un href. */
function safeUrl(v: string): string | null {
  return /^https?:\/\//i.test(v) ? v : null;
}

/** ¿Parece dominio o ruta (tiene punto o barra) en vez de un handle pelado? */
function looksLikeUrl(v: string): boolean {
  return v.includes(".") || v.includes("/");
}

/** Lo que el creador escriba → URL canónica, o null si no se puede armar. */
export function platformHref(type: string, raw: string): string | null {
  const p = PLATFORMS[type] ?? PLATFORMS.otro;
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return null;

  // Ya es una URL absoluta: se respeta tal cual (con su querystring).
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return safeUrl(v);

  // Dominio o ruta sin protocolo → solo le falta el https.
  if (looksLikeUrl(v)) return `https://${v.replace(/^\/+/, "")}`;

  // Handle pelado. Sin host no hay forma de adivinar la URL.
  const handle = v.replace(/^@+/, "");
  if (!handle || p.shape === "url" || !p.host) return null;

  return p.shape === "subdomain"
    ? `https://${handle}.${p.host}`
    : `https://${p.host}/${p.prefix ?? ""}${handle}`;
}

/** Interior de un <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">.
 *  Mismo estilo trazo-simplificado que los iconos que ya existen. */
export const PLATFORM_ICON_PATHS: Record<string, string> = {
  youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
  twitch: '<path d="M21 2H3v16h5v4l4-4h4l5-5V2z"/><line x1="11" x2="11" y1="7" y2="12"/><line x1="16" x2="16" y1="7" y2="12"/>',
  kick: '<path d="M4 3v18"/><path d="M4 12h5l6-9h5l-7 9 7 9h-5l-6-9"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  discord: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M7.5 7.2A16 16 0 0 1 12 6.5a16 16 0 0 1 4.5.7"/><path d="M7 18.5c-2-1-3.5-3-3.5-6.5C3.5 8 5 5.5 7.5 4.5L8.5 6"/><path d="M17 18.5c2-1 3.5-3 3.5-6.5C20.5 8 19 5.5 16.5 4.5L15.5 6"/><path d="M8.5 18.5 9.5 20a12 12 0 0 0 5 0l1-1.5"/>',
  telegram: '<path d="M21 4 3 11l5 2 2 6 3-4 5 4z"/><path d="m8 13 9-6"/>',
  x: '<path d="M3 3l18 18"/><path d="M21 3 3 21"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  spotify: '<circle cx="12" cy="12" r="10"/><path d="M7 9.5a12 12 0 0 1 10 1.5"/><path d="M7.5 13a9 9 0 0 1 8 1.2"/><path d="M8 16.2a6 6 0 0 1 6 .8"/>',
  soundcloud: '<path d="M3 16v-4"/><path d="M6.5 17v-6"/><path d="M10 17V9"/><path d="M13.5 17V7a4.5 4.5 0 0 1 8.2 2.6A3.5 3.5 0 0 1 20 17z"/>',
  bandcamp: '<circle cx="12" cy="12" r="10"/><path d="m9 16 4-8h3l-4 8z"/>',
  applemusic: '<path d="M9 18V6l9-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="16" r="2"/>',
  kofi: '<path d="M3 8h13v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M16 9h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M6 5V3"/><path d="M10 5V3"/>',
  patreon: '<circle cx="15" cy="9.5" r="6.5"/><rect width="3.5" height="18" x="3" y="3" rx="1"/>',
  gumroad: '<circle cx="12" cy="12" r="10"/><path d="M15 9.5a3.5 3.5 0 1 0 0 5h.5V12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
};
