// ─────────────────────────────────────────────────────────────────────────────
// Temáticas — one-click full-page worlds (the guns.lol / Carrd fandom look).
//
// A temática is everything a Look isn't allowed to touch: a full-viewport
// backdrop image with a legibility scrim + optional texture, transparency on
// the page's background slabs so the world shows through, glass on cards and
// nav, re-inked text, and per-kit flourishes (button ornament, selection
// color, a display font). It composes WITH the Looks engine: applying a kit
// also applies its token bundle through the existing theme-bundle channel.
//
// Each kit ships several BACKDROP VARIANTS (the scenes generated per
// docs/tematica-art-prompts.md — one coherent world, four moods). The picker
// shows them when the kit is active; the chosen variant is stamped as
// data-ol-tematica-bg next to the kit id. Kit-level palette/scrim/glass stay
// fixed across variants — scenes within a kit are generated color-coherent.
//
// Persistence model = Looks, not Motion: the kit lands IN the document (a
// tagged <style data-ol-tematica> + <link> + the data-ol-tematica[-bg] attrs
// on <html>, applied by the element-inspect script) and saves through the
// normal html-changed funnel. The page is self-contained everywhere it
// renders — editor, thumbnails, published, exports — with zero publish-time
// work. sanitizeForPublish keeps styles/links; only scripts are stripped.
//
// Kits are DATA. v1 ships them in-repo (theme-presets.ts pattern); art lives
// on R2 under tematicas/ (originals archived locally in .tematicas-art/,
// processor: scripts/tematicas-art-process.ts). Promote to DB+R2 rows when
// the seasonal-drop cadence starts.
//
// Deliberate v1 tradeoffs (the honest list):
//   - Text re-ink is broad (headings/paragraphs/list text → --ol-fg with
//     !important, guarding bg-clip/text-transparent gradient text). Accent
//     spans survive (the rule never targets span); muted-vs-body hierarchy
//     flattens. The planned "✨ Acomodar con IA" pass is the per-template
//     refinement, not more deterministic CSS.
//   - Backdrop layer is html::before (position:fixed) — NOT
//     background-attachment:fixed, which iOS Safari doesn't honor.
//   - Specificity is tuned to beat the canonize-at-runtime force rules
//     (`html,body,[data-ol-bg-carrier]{background-color:var(--ol-bg)
//     !important}`) — transparency rules pair !important with an attribute
//     selector so they win on specificity, not order.
//
// Client-safe: no node imports.
// ─────────────────────────────────────────────────────────────────────────────

export type TematicaTexture = "halftone" | "grain" | "none";

export interface TematicaBackdrop {
  /** Scene id ("lace", "moon", …) — stamped as data-ol-tematica-bg. */
  id: string;
  desktop: string;
  /** Portrait variant served under 640px. Absent → desktop cover-crops. */
  mobile?: string;
  /** 800w thumb for the picker tiles. */
  thumb: string;
}

export interface TematicaPreset {
  id: string;
  /** Display name — brand-like, not translated. */
  name: string;
  /** One-line vibe, shown as the bead tooltip. */
  hint: string;
  /** Ink direction of the kit's content (drives token choices below). */
  mode: "light" | "dark";
  /** Looks-engine bundle (inline vars on <html>) applied alongside the CSS.
   *  Same shape as THEME_PRESETS tokens. */
  tokens: Record<string, string>;
  /** Backdrop variants — [0] is the default/hero scene. */
  backdrops: TematicaBackdrop[];
  /** CSS background layer(s) painted over the backdrop for legibility —
   *  any valid background value (gradients, usually). */
  scrim: string;
  texture: TematicaTexture;
  /** Glass treatment for cards/nav: surface opacity (0-100) + blur px. */
  glass: { surfacePct: number; blur: number };
  /** Google Fonts css2 stylesheet for the kit's display font. Injected as a
   *  tagged <link>; the publish font-bake self-hosts it. */
  fontHref?: string;
  /** Per-kit flourish CSS (button ornament, etc.). Already scoped by the
   *  builder's [data-ol-tematica="<id>"] prefix conventions — write full
   *  selectors here. */
  extraCss?: string;
}

/** CSS-safe url("…") — escape the few characters that can break out. */
function cssUrl(u: string): string {
  return `url("${u.replace(/[\\"\n\r()]/g, (c) => `\\${c}`)}")`;
}

function textureLayer(
  t: TematicaTexture,
  mode: "light" | "dark",
): { image: string; size: string } | null {
  if (t === "halftone") {
    // The guns.lol dot screen — a tiny tiling radial dot over the scrim.
    // Dark ink on light worlds, light ink on dark ones (or it vanishes).
    const ink = mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.14)";
    return {
      image: `radial-gradient(${ink} 1px, transparent 1.3px)`,
      size: "4px 4px",
    };
  }
  if (t === "grain") {
    // SVG turbulence tile — film grain without shipping an image.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>`;
    return {
      image: `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`,
      size: "160px 160px",
    };
  }
  return null;
}

/** Resolve a kit's backdrop variant by id; unknown/absent → the hero ([0]). */
export function resolveBackdrop(
  kit: TematicaPreset,
  backdropId?: string,
): TematicaBackdrop {
  return kit.backdrops.find((b) => b.id === backdropId) ?? kit.backdrops[0];
}

/** The kit's full tagged stylesheet — the inner text of
 *  `<style data-ol-tematica>` — for the chosen backdrop variant.
 *  Self-contained; safe to inline as-is. */
export function tematicaCss(kit: TematicaPreset, backdropId?: string): string {
  const A = `[data-ol-tematica="${kit.id}"]`;
  const backdrop = resolveBackdrop(kit, backdropId);
  const desktop = cssUrl(backdrop.desktop);
  const mobile = backdrop.mobile ? cssUrl(backdrop.mobile) : desktop;
  const tex = textureLayer(kit.texture, kit.mode);
  const overlayImage = tex ? `${kit.scrim}, ${tex.image}` : kit.scrim;
  const overlaySize = tex ? `auto, ${tex.size}` : "auto";
  const glassBg = `color-mix(in srgb, var(--ol-surface, #fff) ${kit.glass.surfacePct}%, transparent)`;

  return `
/* ── world ───────────────────────────────────────────────────────────── */
html${A}::before{content:"";position:fixed;inset:0;z-index:-1;
background-image:${desktop};background-size:cover;background-position:center;
background-repeat:no-repeat}
@media (max-width:640px){html${A}::before{background-image:${mobile}}}
html${A}::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
background-image:${overlayImage};background-size:${overlaySize}}
/* the page's own grounds go transparent so the world shows through — these
   must out-rank the canonize force rules (attribute selector + !important) */
${A} body,${A} [data-ol-bg-carrier]{background-color:transparent !important;background-image:none !important}
${A} :is(body,main,[data-ol-bg-carrier])>:is(section,header,footer,nav,article,div,aside){background-color:transparent !important;background-image:none !important}
/* ── ink ─────────────────────────────────────────────────────────────── */
${A} :is(h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,small):not([class*="bg-clip"]):not([class*="text-transparent"]){color:var(--ol-fg,#18181b) !important}
/* ── glass ───────────────────────────────────────────────────────────── */
${A} :is([class*="card"],form,pre,table){
background-color:${glassBg} !important;background-image:none !important;
-webkit-backdrop-filter:blur(${kit.glass.blur}px) saturate(1.35);
backdrop-filter:blur(${kit.glass.blur}px) saturate(1.35);
border-color:color-mix(in srgb, var(--ol-border, rgba(0,0,0,.15)) 55%, transparent)}
${A} nav{background-color:color-mix(in srgb, var(--ol-surface, #fff) ${Math.min(
    kit.glass.surfacePct + 10,
    92,
  )}%, transparent) !important;background-image:none !important;
-webkit-backdrop-filter:blur(${kit.glass.blur}px) saturate(1.35);
backdrop-filter:blur(${kit.glass.blur}px) saturate(1.35)}
/* ── delight ─────────────────────────────────────────────────────────── */
${A} ::selection{background:var(--ol-accent,#18181b);color:var(--ol-bg,#fff)}
${kit.extraCss ?? ""}`;
}

// Ornament SVGs for extraCss masks (currentColor via background-color).
const FLOWER_MASK =
  `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2c1.8 0 3.2 1.4 3.2 3.1 0 .4-.1.9-.3 1.3 2.1-.8 4.4.2 5.2 2 .7 1.7-.1 3.7-1.8 4.6 1.7.9 2.5 2.9 1.8 4.6-.8 1.8-3.1 2.8-5.2 2-.2.4-.3.8-.3 1.3C14.6 22.6 13.8 24 12 24s-3.2-1.4-3.2-3.1c0-.5.1-.9.3-1.3-2.1.8-4.4-.2-5.2-2-.7-1.7.1-3.7 1.8-4.6-1.7-.9-2.5-2.9-1.8-4.6.8-1.8 3.1-2.8 5.2-2-.2-.4-.3-.9-.3-1.3C8.8 3.4 10.2 2 12 2z'/%3E%3Ccircle cx='12' cy='12' r='3' fill='white'/%3E%3C/svg%3E")`;
const SPARKLE_MASK =
  `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 1l2.4 8.6L23 12l-8.6 2.4L12 23l-2.4-8.6L1 12l8.6-2.4z'/%3E%3C/svg%3E")`;

// Art lives on R2 under tematicas/ — uploaded by scripts/tematicas-art-process.ts.
const ART = "https://images.openlen.com/tematicas";
function bd(kit: string, scene: string, withMobile = false): TematicaBackdrop {
  return {
    id: scene,
    desktop: `${ART}/${kit}-${scene}-1920.webp`,
    ...(withMobile ? { mobile: `${ART}/${kit}-${scene}-p-1080.webp` } : {}),
    thumb: `${ART}/${kit}-${scene}-800.webp`,
  };
}

/** v1 kits — real generated art (docs/tematica-art-prompts.md), hero scene
 *  first. Wanderlust variants carry true portrait companions for mobile. */
export const TEMATICA_PRESETS: TematicaPreset[] = [
  {
    id: "coquette",
    name: "Coquette",
    hint: "Soft pink dreamscape — satin, bows, film grain",
    mode: "light",
    tokens: {
      "--ol-bg": "#fdf2f6",
      "--ol-surface": "#fff7fa",
      "--ol-fg": "#4a2436",
      "--ol-border": "#f3d3e0",
      "--ol-accent": "#d94f7d",
      "--ol-font-display": "'Playfair Display', serif",
      "--ol-r-scale": "1.6",
    },
    backdrops: [
      bd("coquette", "lace"),
      bd("coquette", "petals"),
      bd("coquette", "satin"),
      bd("coquette", "tulle"),
    ],
    scrim:
      "linear-gradient(180deg, rgba(255,247,250,0.55) 0%, rgba(255,247,250,0.35) 40%, rgba(255,247,250,0.6) 100%)",
    texture: "grain",
    glass: { surfacePct: 66, blur: 14 },
    fontHref:
      "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,700;1,500&display=swap",
    extraCss: `
[data-ol-tematica="coquette"] :is(a,button):is([class*="btn"],[class*="rounded-full"],[class*="cta"])::before{
content:"";display:inline-block;width:0.85em;height:0.85em;margin-right:0.45em;vertical-align:-0.08em;
background-color:currentColor;-webkit-mask:${FLOWER_MASK} center/contain no-repeat;mask:${FLOWER_MASK} center/contain no-repeat}`,
  },
  {
    id: "y2k",
    name: "Y2K Chrome",
    hint: "Liquid chrome, holographic iridescence",
    mode: "light",
    tokens: {
      "--ol-bg": "#eef1fb",
      "--ol-surface": "#f7f8ff",
      "--ol-fg": "#1d1b33",
      "--ol-border": "#cdd3f2",
      "--ol-accent": "#6457e8",
      "--ol-font-display": "'Space Grotesk', sans-serif",
      "--ol-r-scale": "1.8",
    },
    backdrops: [
      bd("y2k", "horizon"),
      bd("y2k", "waves"),
      bd("y2k", "blobs"),
      bd("y2k", "brushed"),
    ],
    scrim:
      "linear-gradient(180deg, rgba(247,248,255,0.5) 0%, rgba(247,248,255,0.3) 45%, rgba(247,248,255,0.55) 100%)",
    texture: "none",
    glass: { surfacePct: 58, blur: 18 },
    fontHref:
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap",
    extraCss: `
[data-ol-tematica="y2k"] :is(h1,h2):not([class*="bg-clip"]){letter-spacing:-0.01em}
[data-ol-tematica="y2k"] :is(a,button):is([class*="btn"],[class*="rounded-full"],[class*="cta"])::after{
content:"";display:inline-block;width:0.7em;height:0.7em;margin-left:0.45em;vertical-align:-0.02em;
background-color:currentColor;-webkit-mask:${SPARKLE_MASK} center/contain no-repeat;mask:${SPARKLE_MASK} center/contain no-repeat}`,
  },
  {
    id: "anime-dream",
    name: "Anime Dream",
    hint: "Pastel celestial — painted skies, moonlight, star glitter",
    mode: "light",
    tokens: {
      "--ol-bg": "#f5f3fb",
      "--ol-surface": "#fbfaff",
      "--ol-fg": "#3b3354",
      "--ol-border": "#e1dbf0",
      "--ol-accent": "#8b5cf6",
      "--ol-font-display": "'Fraunces', serif",
      "--ol-r-scale": "1.8",
    },
    backdrops: [
      bd("anime-dream", "moon"),
      bd("anime-dream", "sunset"),
      bd("anime-dream", "cloudsea"),
      bd("anime-dream", "girl"),
    ],
    scrim:
      "linear-gradient(180deg, rgba(250,248,255,0.5) 0%, rgba(250,248,255,0.3) 45%, rgba(250,248,255,0.55) 100%)",
    texture: "none",
    glass: { surfacePct: 62, blur: 16 },
    fontHref:
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700&display=swap",
    extraCss: `
[data-ol-tematica="anime-dream"] :is(a,button):is([class*="btn"],[class*="rounded-full"],[class*="cta"])::before{
content:"";display:inline-block;width:0.7em;height:0.7em;margin-right:0.45em;vertical-align:-0.04em;
background-color:currentColor;-webkit-mask:${SPARKLE_MASK} center/contain no-repeat;mask:${SPARKLE_MASK} center/contain no-repeat}`,
  },
  {
    id: "anime-noir",
    name: "Anime Noir",
    hint: "Tokyo night — neon, rain, cinematic haze",
    mode: "dark",
    tokens: {
      "--ol-bg": "#0b0e16",
      "--ol-surface": "#141927",
      "--ol-fg": "#eef0f8",
      "--ol-border": "#2a3149",
      "--ol-accent": "#e879f9",
      "--ol-font-display": "'Space Grotesk', sans-serif",
      "--ol-r-scale": "1.2",
    },
    backdrops: [
      bd("anime-noir", "rainglass"),
      bd("anime-noir", "alley"),
      bd("anime-noir", "rooftop"),
      bd("anime-noir", "vending"),
    ],
    scrim:
      "linear-gradient(180deg, rgba(11,14,22,0.62) 0%, rgba(11,14,22,0.45) 45%, rgba(11,14,22,0.68) 100%)",
    texture: "halftone",
    glass: { surfacePct: 55, blur: 16 },
    fontHref:
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap",
  },
  {
    id: "wanderlust",
    name: "Wanderlust",
    hint: "Golden-hour escape — infinity pool, sea air",
    mode: "light",
    tokens: {
      "--ol-bg": "#faf4ec",
      "--ol-surface": "#fffdf9",
      "--ol-fg": "#4a382c",
      "--ol-border": "#ecdfd0",
      "--ol-accent": "#c2703e",
      "--ol-font-display": "'Fraunces', serif",
      "--ol-r-scale": "1.4",
    },
    backdrops: [
      bd("wanderlust", "pool", true),
      bd("wanderlust", "water", true),
      bd("wanderlust", "suite", true),
      bd("wanderlust", "road", true),
    ],
    scrim:
      "linear-gradient(180deg, rgba(255,253,249,0.5) 0%, rgba(255,253,249,0.28) 45%, rgba(255,253,249,0.58) 100%)",
    texture: "none",
    glass: { surfacePct: 70, blur: 14 },
    fontHref:
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700&display=swap",
  },
];

export function getTematica(id: string): TematicaPreset | undefined {
  return TEMATICA_PRESETS.find((k) => k.id === id);
}

/** The active kit id stamped on a document, or "" when none. */
export function readTematicaId(html: string): string {
  const m = /<html\b[^>]*\bdata-ol-tematica="([^"]*)"/i.exec(html);
  return m?.[1] ?? "";
}

/** The active backdrop-variant id, or "" (→ the kit's hero scene). */
export function readTematicaBackdrop(html: string): string {
  const m = /<html\b[^>]*\bdata-ol-tematica-bg="([^"]*)"/i.exec(html);
  return m?.[1] ?? "";
}
