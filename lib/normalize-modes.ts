// Born-canonical light/dark mode.
//
// A page declares its OWN dark palette — the /api/generate prompt has the
// model emit a `:root.dark { --bg/--surface/--fg/--border/--accent: … }`
// block of *designed* dark values. The model knows which colors are text,
// so the whole page flips coherently — unlike a mechanical inversion, which
// was tried and verified broken (headings that weren't tokenized stayed
// dark-on-dark). This pass lifts that block onto :root[data-ol-mode="dark"]
// over the canonical --ol-* tokens and removes the model's own block; the
// inspector's light/dark toggle sets the attribute.
//
// No-op when the page ships no `:root.dark` palette — templates and
// pre-contract pages get no toggle (honest degradation, not a broken flip).

const ROLE_TOKENS: Array<{ src: string; ol: string }> = [
  { src: "bg", ol: "--ol-bg" },
  { src: "surface", ol: "--ol-surface" },
  { src: "fg", ol: "--ol-fg" },
  { src: "border", ol: "--ol-border" },
  { src: "accent", ol: "--ol-accent" },
];

/** `#rrggbb`/`#rgb` → the `r,g,b` triplet (for --ol-accent-r), else null. */
function hexTriplet(value: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/(.)/g, "$1$1") : m[1];
  return (
    parseInt(h.slice(0, 2), 16) +
    "," +
    parseInt(h.slice(2, 4), 16) +
    "," +
    parseInt(h.slice(4, 6), 16)
  );
}

/** Lift the page's `:root.dark` designed palette onto the canonical dark
 *  tokens. Idempotent; a no-op when the page ships no dark palette. */
export function normalizeColorModes(html: string): string {
  if (!html) return html;
  if (html.includes("data-ol-modes")) return html;

  const darkMatch = /:root\.dark\s*\{([^}]*)\}/i.exec(html);
  if (!darkMatch) return html;

  const body = darkMatch[1];
  let decls = "";
  for (const { src, ol } of ROLE_TOKENS) {
    const m = new RegExp("--" + src + "\\s*:\\s*([^;}]+)", "i").exec(body);
    if (!m) continue;
    const val = m[1].trim();
    decls += ol + ":" + val + ";";
    if (src === "accent") {
      const trip = hexTriplet(val);
      if (trip) decls += "--ol-accent-r:" + trip + ";";
    }
  }
  if (!decls) return html;

  // Drop the model's block — its values are now carried by --ol-* — and
  // inject the canonical dark palette before </head>.
  const out = html.replace(darkMatch[0], "");
  const style = `<style data-ol-modes>:root[data-ol-mode="dark"]{${decls}}</style>`;
  const idx = out.search(/<\/head>/i);
  return idx === -1
    ? out + style
    : out.slice(0, idx) + style + out.slice(idx);
}

/** The attribute the light/dark toggle sets on <html>. */
export const MODE_ATTR = "data-ol-mode";
