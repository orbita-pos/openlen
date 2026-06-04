// Default project logo — coral circle + initial letter, rendered as inline
// SVG. Used wherever a project has no `logoUrl` set: project list card
// badges, the TopBar icon, the favicon on published HTML, and the fallback
// og:image. Inline SVG avoids any storage round-trip and renders crisp at
// every size.

function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = trimmed.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(first) ? first : (trimmed.codePointAt(0) ? first : "?");
}

/** Polished SVG mark — a coral squircle with a soft gradient + inset ring and
 *  the white initial in Inter (app-icon look). Caller chooses the rendering
 *  context (inline, data URL, document inject). The gradient `id` is fixed but
 *  collision-safe: every instance is identical, and data-URL <img> uses isolate
 *  the SVG document anyway. */
export function defaultLogoSvg(name: string): string {
  const letter = escapeXml(initial(name));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${letter}">`,
    `<defs><linearGradient id="olmark" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="#FF7152"/><stop offset="1" stop-color="#F03E1A"/>`,
    `</linearGradient></defs>`,
    `<rect width="64" height="64" rx="15" fill="url(#olmark)"/>`,
    `<rect x="3" y="3" width="58" height="58" rx="12.5" fill="none" stroke="#ffffff" stroke-opacity="0.16"/>`,
    `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" `,
    `font-family="Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" `,
    `font-weight="700" font-size="32" fill="#ffffff">${letter}</text>`,
    `</svg>`,
  ].join("");
}

/** SVG-as-data-URL — safe to drop into <img src> or <link rel="icon" href>. */
export function defaultLogoDataUrl(name: string): string {
  const svg = defaultLogoSvg(name);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
