export const COMPOSITION_MOBILE_SAFETY_VERSION = "mobile/1.0" as const;

const MARKER = `data-openlen-composition-safety="${COMPOSITION_MOBILE_SAFETY_VERSION}"`;
const OWNED_STYLE = `<style ${MARKER}>`
  + "[data-openlen-role] *{min-width:0}"
  + "[data-openlen-role] :is(h1,h2,h3,h4,h5,h6,p,li,a,button,span){overflow-wrap:anywhere}"
  + "</style>";

export function ensureCompositionMobileSafety(html: string): string {
  if (html.includes(MARKER)) return html;
  const headEnd = html.search(/<\/head\s*>/i);
  return headEnd >= 0
    ? `${html.slice(0, headEnd)}${OWNED_STYLE}${html.slice(headEnd)}`
    : `${OWNED_STYLE}${html}`;
}
