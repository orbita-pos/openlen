import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";
import type { Behavior, BehaviorName } from "./types";

export const BEHAVIORS_MARKER = "data-ol-behaviors";

/** Techo real del script COMPUESTO (guard + inyector de estilos + wrappers +
 *  las 7 recetas), en bytes UTF-8. Fuente única para dos consumidores que
 *  antes podían divergir (Arreglo 6, revisión final de rama): el test
 *  unitario en jsdom (lib/behaviors/conformance.test.ts) y el gate end-to-end
 *  que lo mide sobre una página PUBLICADA de verdad
 *  (scripts/qa/behaviors-born100-gate.mjs) — este último solo IMPRIMÍA el
 *  peso antes de este fix, nunca lo afirmaba. Ver conformance.test.ts para el
 *  razonamiento completo de por qué 6144 y no otro número. */
export const BEHAVIORS_SCRIPT_BUDGET_BYTES = 6144;

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
  // Marcado con BEHAVIORS_MARKER (mismo atributo que el <script> compuesto,
  // sobre un tag distinto) para que stripEditorInstrumentation.ts pueda
  // distinguir y borrar ESTE <style> — creado en VIVO por el propio runtime
  // cada vez que corre, nunca escrito por el HTML autorado — de cualquier
  // <style> que sí pertenezca al documento. Sin marcador (Arreglo 2, revisión
  // final de rama), un save que capturase el DOM del preview a media edición
  // (mismo principio que use-inline-edit.ts::captureClean) dejaría este
  // <style> en project.data.html para siempre, y cada ciclo derive→guardar
  // añadiría uno más encima: crecimiento monótono y silencioso que además
  // llega a la página publicada.
  const styleInject = css
    ? `var s=document.createElement('style');s.setAttribute(${JSON.stringify(BEHAVIORS_MARKER)},'');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);`
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

/** Idempotencia del guard de arriba: matchea el tag real, en CUALQUIERA de
 *  sus dos serializaciones válidas — `<script data-ol-behaviors>` (como lo
 *  escribe esta misma función, abajo) y `<script data-ol-behaviors="">` (la
 *  forma en que ESE MISMO tag vuelve tras un round-trip por `DOMParser` +
 *  `outerHTML`: un atributo sin valor se parsea como `""`, y el serializador
 *  SIEMPRE escribe `nombre=""`, nunca el nombre pelado). Un `.includes` de
 *  substring exacto (IMPORTANT, revisión final de rama — Arreglo 3) no
 *  matchea la segunda forma → doble inyección. No alcanzable HOY (se trazaron
 *  todas las rutas), pero `stashBehaviorsPristineState`
 *  (components/workspace-v2/use-behaviors-preview.ts) hace exactamente ese
 *  round-trip una línea después de invocar el inyector del preview, dentro de
 *  `derive()` (components/workspace-v2/preview-area.tsx) — un refactor que
 *  reordene o reutilice ese HTML ya horneado alcanzaría el bug. Ver el test
 *  de round-trip en build.test.ts. */
const BAKED_TAG_RE = new RegExp(`<script\\s+${BEHAVIORS_MARKER}(?:="")?>`);

/** Inyecta el runtime antes de </body> (y el pre-paint antes de </head>).
 *  Idempotente — mismo patrón que injectTrackingStrip, pero el guard mira el
 *  TAG real (`<script data-ol-behaviors>`), no BEHAVIORS_MARKER como
 *  substring suelto sobre TODO el documento.
 *
 *  IMPORTANT (revisión final de rama): un `html.includes(BEHAVIORS_MARKER)`
 *  también da `true` sin que exista ningún <script> real — probado con el
 *  sanitizer real, los 4 sobreviven: (A) un <style data-ol-behaviors>
 *  residual, (B) la cadena dentro de un comentario HTML, (C) la cadena en
 *  TEXTO VISIBLE (una página que hable del propio marcador), (D) una regla
 *  CSS del autor `[data-ol-behaviors]{}`. En los 4 casos el guard viejo hacía
 *  bail-out PARA SIEMPRE: el runtime nunca se inyecta, en silencio, y
 *  usedBehaviors() (que sí mira el marcador de CADA receta, no este) seguía
 *  reportando la conducta como "usada" — la telemetría mentía. Ver el test
 *  de los 4 vectores en build.test.ts. Sigue siendo idempotente sobre un
 *  documento YA horneado de verdad: ese SÍ contiene el tag literal, en
 *  cualquiera de sus dos serializaciones — ver BAKED_TAG_RE arriba. */
export function bakeBehaviors(
  html: string,
  reg: Reg = BEHAVIORS,
  order: BehaviorName[] = BEHAVIOR_ORDER,
): string {
  if (BAKED_TAG_RE.test(html)) return html;
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
