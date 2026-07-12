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
  return `(function(){${EDIT_GUARD_JS}${styleInject}${hits.map((b) => b.js).join("")}})();`;
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
    const hIdx = out.indexOf("</head>");
    const headTag = `<script ${BEHAVIORS_MARKER}-head>${head}</script>`;
    out = hIdx === -1 ? headTag + out : out.slice(0, hIdx) + headTag + out.slice(hIdx);
  }
  const tag = `<script ${BEHAVIORS_MARKER}>${body}</script>`;
  const idx = out.lastIndexOf("</body>");
  return idx === -1 ? out + tag : out.slice(0, idx) + tag + out.slice(idx);
}
