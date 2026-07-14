// Publish-time horizontal-carousel arrows.
//
// SECURITY MODEL (same as bakeVideoEmbeds): this runs AFTER sanitize / BEFORE
// seal, so the inline runtime we inject survives the script-strip and its
// sha256 is hashed into script-src by the seal. The runtime is fully static
// (per-row behavior is read from the DOM at click time) so its hash is stable
// across publishes — the seal stays idempotent. It touches no creator strings.
//
// Contract (set by the template): each row is `<div data-ol-row>` (a NON-scrolling
// position:relative wrapper) holding the arrows `<button data-ol-scroll="prev|next">`
// and an inner scroller `<… data-ol-scroller>` (the overflow-x:auto track). The
// arrows must live OUTSIDE the scroller so they pin to the visible edge instead
// of the scrollable content. Anchors are deliberately NOT used — `:target`
// navigation scrolls the whole document vertically (the page-jump bug). The
// buttons only enhance: native swipe/wheel still scrolls with JS off.

// Exported (Task 14b) so the editor preview injector
// (components/workspace-v2/use-behaviors-preview.ts) can import this EXACT
// marker/runtime pair instead of carrying a second copy. bakeCarousels below
// is deployed and untouched by that task — these two consts are the only
// change here.
export const MARKER = "data-ol-carousel";

// Static runtime — now imported byte-for-byte by the editor preview instead
// of hand-copied, closing the "KEEP IN SYNC with the inline preview copy in
// the cinema templates" plea this comment used to make (a plea already
// broken once — the preview had no carousel runtime at all until Task 14b).
// Delegated click on [data-ol-scroll] → find its row ([data-ol-row]) and
// scroll that row's [data-ol-scroller] by ~80% of its visible width
// (min 240px), smoothly.
export const CAROUSEL_JS = `(function(){var amt=function(s){return Math.max(240,Math.round(s.clientWidth*0.8))};document.addEventListener("click",function(e){var t=e.target;if(!t||!t.closest)return;var b=t.closest("[data-ol-scroll]");if(!b)return;var row=b.closest("[data-ol-row]");var s=row?row.querySelector("[data-ol-scroller]"):null;if(!s)return;e.preventDefault();s.scrollBy({left:(b.getAttribute("data-ol-scroll")==="next"?1:-1)*amt(s),behavior:"smooth"})});})();`;

/** Inject the carousel-arrow runtime when the page has [data-ol-scroll] buttons.
 *  No-op when there are none, or when already processed (idempotent). */
export function bakeCarousels(html: string): string {
  // Mismo fix (IMPORTANT, revisión final de rama) que bakeBehaviors
  // (lib/behaviors/build.ts): el guard mira el TAG real
  // (`<script data-ol-carousel>`), no el marcador como substring suelto sobre
  // TODO el documento — ese substring también es `true` sin ningún <script>
  // real detrás (un <style> residual, un comentario HTML, texto visible, una
  // regla CSS del autor), y en los 4 casos apagaría este runtime para
  // siempre, en silencio.
  if (html.includes(`<script ${MARKER}>`)) return html;
  if (!html.includes("data-ol-scroll=")) return html;

  const script = `<script ${MARKER}>${CAROUSEL_JS}</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + script : html.slice(0, idx) + script + html.slice(idx);
}
