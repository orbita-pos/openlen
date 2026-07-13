import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";
import type { Behavior, BehaviorName } from "./types";

export const BEHAVIORS_MARKER = "data-ol-behaviors";

// El guard de modo edición. En el preview el tab Contenido pone
// contentEditable sobre el documento; un contador que reescribe su texto cada
// segundo pelearía con el cursor del creador (saltos, texto corrupto). Los
// inyectores NO se aplican condicionalmente — esa vía se abandonó en
// preview-area.tsx:196 porque causaba parpadeo y recarga de fuentes —, así que
// el runtime se auto-silencia consultando el atributo que el padre conmuta por
// postMessage. En la página PUBLICADA estos atributos no existen jamás: el
// guard cuesta un hasAttribute y siempre devuelve false.
export const EDIT_GUARD_JS =
  `var olEditing=function(){var b=document.body;return !!b&&(b.hasAttribute('data-openlen-edit-mode')||b.hasAttribute('data-openlen-select-mode'))};`;

type Reg = Partial<Record<BehaviorName, Behavior>>;

function present(html: string, reg: Reg, order: BehaviorName[]): Behavior[] {
  // Orden del REGISTRO, no de aparición: mantiene estable el hash del script
  // inline y con él la idempotencia del sello CSP.
  return order
    .map((n) => reg[n])
    .filter((b): b is Behavior => !!b && b.status !== "deprecated" && html.includes(b.marker));
}

/** El runtime compuesto (sin la etiqueta <script>), o null si la página no usa
 *  ninguna conducta — en cuyo caso no se inyecta ni un byte. */
export function buildBehaviorsScript(
  html: string,
  reg: Reg = BEHAVIORS,
  order: BehaviorName[] = BEHAVIOR_ORDER,
): string | null {
  const hits = present(html, reg, order);
  if (hits.length === 0) return null;
  const css = hits.map((b) => b.css).filter(Boolean).join("");
  const styleInject = css
    ? `var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);`
    : "";
  // Cada receta en SU PROPIA IIFE: todas comparten una sola IIFE exterior, así
  // que un `var x` a nivel superior de una receta pisaría silenciosamente el
  // de otra (mismo scope de función). Envolver aísla cada receta por
  // construcción — olEditing sigue visible dentro por closure (lo define
  // EDIT_GUARD_JS en el scope exterior), así que nada se rompe.
  const body = hits.map((b) => `(function(){${b.js}})();`).join("");
  return `(function(){${EDIT_GUARD_JS}${styleInject}${body}})();`;
}

/** El pre-paint del <head> (solo `theme` lo necesita), o null. */
export function buildBehaviorsHead(
  html: string,
  reg: Reg = BEHAVIORS,
  order: BehaviorName[] = BEHAVIOR_ORDER,
): string | null {
  const js = present(html, reg, order).map((b) => b.headJs).filter(Boolean).join("");
  return js ? `(function(){${js}})();` : null;
}

// Sin `</head>` NUNCA se antepone el script al documento: un token que no sea
// whitespace ANTES del <!DOCTYPE> mete al navegador en quirks mode, y eso le
// cambia el box model a la página entera. Se inserta tras el doctype — el
// parser eleva ese <script> al <head> implícito — y solo si no hay doctype es
// seguro anteponer.
function injectIntoHead(html: string, tag: string): string {
  const hIdx = html.indexOf("</head>");
  if (hIdx !== -1) return html.slice(0, hIdx) + tag + html.slice(hIdx);
  const dt = /<!doctype[^>]*>/i.exec(html);
  if (dt) {
    const at = dt.index + dt[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
}

/** Inyecta el runtime antes de </body> (y el pre-paint antes de </head>).
 *  Idempotente vía BEHAVIORS_MARKER — mismo patrón que injectTrackingStrip. */
export function bakeBehaviors(
  html: string,
  reg: Reg = BEHAVIORS,
  order: BehaviorName[] = BEHAVIOR_ORDER,
): string {
  if (html.includes(BEHAVIORS_MARKER)) return html;
  const body = buildBehaviorsScript(html, reg, order);
  if (!body) return html;

  let out = html;
  const head = buildBehaviorsHead(html, reg, order);
  if (head) {
    out = injectIntoHead(out, `<script ${BEHAVIORS_MARKER}-head>${head}</script>`);
  }
  const tag = `<script ${BEHAVIORS_MARKER}>${body}</script>`;
  const idx = out.lastIndexOf("</body>");
  return idx === -1 ? out + tag : out.slice(0, idx) + tag + out.slice(idx);
}

/** Qué conductas usa REALMENTE esta página. Alimenta la telemetría de publish:
 *  junto con los issues del canal `aviso` (lo que piden y no existe), da la
 *  lista ordenada por demanda real de qué construir después. */
export function usedBehaviors(
  html: string,
  reg: Reg = BEHAVIORS,
  order: BehaviorName[] = BEHAVIOR_ORDER,
): BehaviorName[] {
  return present(html, reg, order).map((b) => b.name);
}
