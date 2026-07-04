// "Combinar con mi página" — derive a CONTRAST-SAFE post palette + display font
// from the user's page, so a post is born matched to their brand AND beautiful.
//
// The naive first attempt (slam the raw brand accent onto a fixed dark design)
// looked like mud: a low-luminance brand color on a fixed background has no
// contrast. The fix is to treat the post as a SYSTEM — derive bg + ink + accent
// together, each guaranteed to read — and keep the brand HUE while adjusting
// brightness. Pure, no I/O, no AI.

// ── color helpers ───────────────────────────────────────────────────────────
type RGB = [number, number, number];

function hex2rgb(h: string): RGB {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb2hex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function chan(c: number): number {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** WCAG relative luminance (0 black … 1 white). */
export function relLuminance(hex: string): number {
  const [r, g, b] = hex2rgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}
const tint = (h: number, s: number, l: number) => rgb2hex(...hsl2rgb(h, s, l));

/** A valid #hex (3/6/8-digit) or null. */
export function normHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.trim().match(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  return m ? v.trim().slice(0, 7) : null;
}

// ── accent: keep the brand hue, fix its brightness so it POPS on `bg` ─────────
export function matchAccent(brand: string, bg: string): string {
  const dark = relLuminance(bg) < 0.18;
  let [h, s] = rgb2hsl(...hex2rgb(brand));
  s = Math.max(s, 0.6); // a muddy/greyish brand still needs to read as a color
  const target = dark ? 0.48 : 0.14; // bright on dark, deep on light
  let lo = dark ? 0.5 : 0.05, hi = dark ? 0.95 : 0.5, l = (lo + hi) / 2;
  for (let i = 0; i < 20; i++) {
    l = (lo + hi) / 2;
    if (relLuminance(rgb2hex(...hsl2rgb(h, s, l))) < target) lo = l;
    else hi = l;
  }
  return rgb2hex(...hsl2rgb(h, s, (lo + hi) / 2));
}

export interface Palette { bg: string; ink: string; accent: string; }

/**
 * Derive bg + ink + accent for a post from the brand accent and the page's
 * light/dark mode. bg carries the brand HUE at a poster-extreme lightness for
 * the mode; ink is a near-white / near-black with a faint brand tint; accent is
 * the contrast-safe brand accent. Everything reads by construction.
 */
export function derivePalette(brandAccent: string, pageBg: string | null): Palette {
  const dark = pageBg ? relLuminance(pageBg) < 0.35 : true;
  const [h] = rgb2hsl(...hex2rgb(brandAccent));
  const bg = dark ? tint(h, 0.35, 0.07) : tint(h, 0.26, 0.965);
  const ink = dark ? tint(h, 0.14, 0.95) : tint(h, 0.28, 0.13);
  return { bg, ink, accent: matchAccent(brandAccent, bg) };
}

// ── typography: the page's display font, with a guardrail ─────────────────────

// Poster headlines need weight + presence. Script / handwriting / mono /
// pixel-decorative families look flat or wrong at 74px — for those we keep the
// design's curated font. (Case-insensitive family-name match.)
const FONT_BLOCKLIST = new Set(
  [
    "caveat", "dancing script", "pacifico", "lobster", "satisfy", "sacramento",
    "great vibes", "kaushan script", "shadows into light", "permanent marker",
    "amatic sc", "indie flower", "courgette", "cookie", "allura", "parisienne",
    "courier", "courier new", "jetbrains mono", "ibm plex mono", "space mono",
    "roboto mono", "fira code", "source code pro", "inconsolata",
    "bungee", "monoton", "press start 2p", "rye", "creepster", "faster one",
  ].map((s) => s.toLowerCase()),
);

export interface PageFont { family: string; href: string; }

/** Parse `'Poppins', sans-serif` → `Poppins`. */
function firstFamily(decl: string): string | null {
  const m = decl.match(/['"]([^'"]+)['"]/) ?? decl.match(/:\s*([A-Za-z][A-Za-z0-9 ]+)/);
  return m ? m[1].trim() : null;
}

/**
 * The page's DISPLAY font as a swappable {family, href}, or null (→ keep the
 * design's curated font). Reads the page's `--display` token first, else its
 * first Google-Fonts family. Returns null for blocklisted (poster-unsuitable)
 * families so the swap never makes a headline look flat.
 */
export function extractPageFont(html: string): PageFont | null {
  let family: string | null = null;
  const disp = html.match(/--display\s*:\s*([^;}]+)/);
  if (disp) family = firstFamily(disp[1]);
  if (!family) {
    const link = html.match(/fonts\.googleapis\.com\/css2?\?family=([^:&"'>]+)/);
    if (link) family = decodeURIComponent(link[1].replace(/\+/g, " ")).trim();
  }
  if (!family) return null;
  if (FONT_BLOCKLIST.has(family.toLowerCase())) return null;
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;600;700;800;900&display=swap`;
  return { family, href };
}
