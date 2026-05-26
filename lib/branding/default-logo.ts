// Default project logo — coral circle + initial letter, rendered as inline
// SVG. Used wherever a project has no `logoUrl` set: project list card
// badges, the TopBar icon, the favicon on published HTML, and the fallback
// og:image. Inline SVG avoids any storage round-trip and renders crisp at
// every size.

const CORAL = "#FF5A36";

function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = trimmed.charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(first) ? first : (trimmed.codePointAt(0) ? first : "?");
}

/** Plain SVG markup — coral disc + white initial in Inter. Caller chooses
 *  the rendering context (inline, data URL, document inject). */
export function defaultLogoSvg(name: string): string {
  const letter = escapeXml(initial(name));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${letter}">`,
    `<circle cx="32" cy="32" r="32" fill="${CORAL}"/>`,
    `<text x="32" y="32" text-anchor="middle" dominant-baseline="central" `,
    `font-family="Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" `,
    `font-weight="700" font-size="34" fill="#ffffff">${letter}</text>`,
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
