// Paridad editor↔publicado POR CONSTRUCCIÓN: el preview y el bake de
// publicación invocan LA MISMA función. No hay una segunda copia del runtime
// que pueda divergir. Es la deuda que dejó carousel.ts, cuyo comentario ruega
// "KEEP IN SYNC with the inline preview copy in the cinema templates" — una
// súplica escrita en un comentario, que ya se incumplió.
//
// El runtime se inyecta SIEMPRE (nunca condicionalmente: esa vía se abandonó en
// preview-area.tsx:196 por parpadeo y recarga de fuentes). Es el propio runtime
// el que se auto-silencia mientras body[data-openlen-edit-mode] esté puesto —
// ver EDIT_GUARD_JS en lib/conductas-heredadas/build.ts.
//
// reg/order son inyectables SOLO para tests (ver use-behaviors-preview.test.ts,
// que prueba paridad byte-a-byte contra bakeBehaviors con un registro falso —
// el real, lib/conductas-heredadas/registry.ts, tiene las 7 conductas desde el Task 13).
// El único call site real (preview-area.tsx) llama con solo `html`, heredando
// los defaults de bakeBehaviors (BEHAVIORS/BEHAVIOR_ORDER).
//
// Task 14b — el carrusel (lib/publish/carousel.ts) es EXACTAMENTE la misma
// deuda que el párrafo de arriba describe, ya vencida una vez: el preview no
// inyectaba su runtime en absoluto (flechas muertas mientras editas, vivas al
// publicar). bakeCarousels ya está desplegado y esta tarea no le toca ni una
// línea, así que en vez de una segunda función aquí, este módulo importa su
// MISMO runtime (CAROUSEL_JS) y su MISMO marcador (MARKER) — nunca una copia —
// y repite únicamente el envoltorio idempotente que bakeCarousels ya usa.
import { bakeBehaviors } from "@/lib/conductas-heredadas/build";
import { BEHAVIORS } from "@/lib/conductas-heredadas/registry";
import type { Behavior, BehaviorName } from "@/lib/conductas-heredadas/types";
import { CAROUSEL_JS, MARKER as CAROUSEL_MARKER } from "@/lib/publish/carousel";

/** Flags de kill-switch (hallazgo Fable, 2026-07-13): el preview obedece la
 *  MISMA palanca que el bake de publish — servida por /api/flags, cuyo
 *  predicado (lib/publish/kill-switches.ts) es el mismo que consume
 *  filesystem.ts. Ausente = ambos encendidos (default ON, igual que el env
 *  ausente en el servidor): así ningún test ni call site viejo cambia de
 *  comportamiento, y el fail-open del fetch (use-kill-switches.ts) coincide
 *  con el default del servidor. */
export interface BehaviorsPreviewFlags {
  behaviors: boolean;
  carousel: boolean;
}

export function injectBehaviorsPreview(
  html: string,
  reg?: Partial<Record<BehaviorName, Behavior>>,
  order?: BehaviorName[],
  flags?: BehaviorsPreviewFlags,
): string {
  const out = flags?.behaviors === false ? html : bakeBehaviors(html, reg, order);
  return flags?.carousel === false ? out : injectCarouselPreview(out);
}

/** Mismo patrón idempotente que bakeCarousels: comprobar marcador, comprobar
 *  disparador, envolver, insertar antes de `</body>`. Nunca reimplementa el
 *  RUNTIME (CAROUSEL_JS es importado) — solo repite el envoltorio, porque
 *  bakeCarousels en sí está congelado (desplegado en producción). */
function injectCarouselPreview(html: string): string {
  // Mismo fix (IMPORTANT, revisión final de rama) que bakeBehaviors
  // (lib/conductas-heredadas/build.ts): el guard mira el TAG real, no el marcador como
  // substring suelto sobre TODO el documento — ese substring también es
  // `true` sin ningún <script> real detrás (un <style> residual, un
  // comentario HTML, texto visible, una regla CSS del autor), y en los 4
  // casos apagaría este runtime para siempre, en silencio.
  if (html.includes(`<script ${CAROUSEL_MARKER}>`)) return html;
  if (!html.includes("data-ol-scroll=")) return html;
  const script = `<script ${CAROUSEL_MARKER}>${CAROUSEL_JS}</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + script : html.slice(0, idx) + script + html.slice(idx);
}

// Preview-only stash attributes — read + consumed by
// stripEditorInstrumentation.ts on save. Exported so that file never
// duplicates these names as magic strings (single source of truth, same
// reasoning as BEHAVIORS_MARKER in lib/conductas-heredadas/build.ts).
export const PREVIEW_HTML_CLASS_STASH = "data-openlen-html-class";
export const PREVIEW_CD_TEXT_STASH = "data-openlen-cd-text";
export const PREVIEW_CD_STYLE_STASH = "data-openlen-cd-style";
export const PREVIEW_FILTER_PRESSED_STASH = "data-openlen-filter-pressed";
export const PREVIEW_COPY_TEXT_STASH = "data-openlen-copy-text";
export const PREVIEW_TABS_SELECTED_STASH = "data-openlen-tab-selected";
export const PREVIEW_CALC_TEXT_STASH = "data-openlen-calc-text";

/** Preview-only pristine-state snapshot for the behaviors whose runtime
 *  mutation is otherwise indistinguishable, once the live DOM is captured,
 *  from a value the creator or the AI actually authored — theme's
 *  `<html class="dark">` toggle, countdown's frozen digits (plus the
 *  `display` it clears on `[data-ol-cd-ended]` once expired — never the
 *  root's, since the revisión Fable fix), and filter's `aria-pressed` (Arreglo
 *  1, revisión final de rama: rewritten on EVERY chip in the group on each
 *  click — see lib/conductas-heredadas/recipes/filter.ts — so a creator trying the
 *  filter in preview leaves that click's value on the live DOM, otherwise
 *  indistinguishable from what the AI authored).
 *
 *  Estos tres atributos deben añadir CERO bytes a producción: esta
 *  function is called ONLY from preview-area.tsx's `derive()`, never from
 *  `bakeBehaviors` (the publish path). stripEditorInstrumentation reads +
 *  removes them on save (see its "ambiguous runtime state" section).
 *
 *  Deliberately a SEPARATE step from injectBehaviorsPreview, not folded into
 *  it — injectBehaviorsPreview must stay byte-identical to bakeBehaviors
 *  (see the "garantía de fuente única" test in use-behaviors-preview.test.ts);
 *  stamping preview-only attributes inside it would break that guarantee.
 *
 *  Must run before the browser ever executes the injected runtime — at that
 *  point `html` is still exactly the authored string, so whatever it
 *  contains right now IS the pristine value, by construction. Idempotent:
 *  skips anything that already carries its stash attribute, so calling this
 *  twice (e.g. derive() re-running on its own prior output) never overwrites
 *  a stash with an already-mutated live value. */
export function stashBehaviorsPristineState(
  html: string,
  reg: Partial<Record<BehaviorName, Behavior>> = BEHAVIORS,
): string {
  const themeMarker = reg.theme?.marker;
  const cdMarker = reg.countdown?.marker;
  const filterMarker = reg.filter?.marker;
  const copyMarker = reg.copy?.marker;
  const tabsMarker = reg.tabs?.marker;
  const calcMarker = reg.calc?.marker;
  const needsTheme = !!themeMarker && html.includes(themeMarker);
  const needsCountdown = !!cdMarker && html.includes(cdMarker);
  const needsFilter = !!filterMarker && html.includes(filterMarker);
  const needsCopy = !!copyMarker && html.includes(copyMarker);
  const needsTabs = !!tabsMarker && html.includes(tabsMarker);
  const needsCalc = !!calcMarker && html.includes(calcMarker);
  if (!needsTheme && !needsCountdown && !needsFilter && !needsCopy && !needsTabs && !needsCalc)
    return html;
  if (typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let changed = false;

    if (needsTheme && !doc.documentElement.hasAttribute(PREVIEW_HTML_CLASS_STASH)) {
      doc.documentElement.setAttribute(
        PREVIEW_HTML_CLASS_STASH,
        doc.documentElement.getAttribute("class") ?? "",
      );
      changed = true;
    }

    if (needsCountdown) {
      // data-ol-cd / data-ol-cd-ended are countdown's own CHILD selectors
      // (lib/conductas-heredadas/recipes/countdown.ts) — only its ROOT marker
      // (data-ol-countdown) is exposed on the Behavior contract, so these two
      // literals have to be kept in sync BY HAND if that recipe ever renames
      // them. The audit-canary test in strip-editor-instrumentation.test.ts
      // would go red if countdown (or any future recipe) started leaving some
      // OTHER data-ol-* mutation behind that neither this file nor the strip
      // knows about.
      doc.querySelectorAll("[data-ol-cd]").forEach((n) => {
        if (n.hasAttribute(PREVIEW_CD_TEXT_STASH)) return;
        n.setAttribute(PREVIEW_CD_TEXT_STASH, n.textContent ?? "");
        changed = true;
      });
      // Stash ONLY the pristine `display` value — never the whole `style`
      // attribute (this was Arreglo 1 of the final branch review: the strip
      // used to restore the FULL attribute, which clobbered any OTHER style
      // property written after this stash ran). countdown.ts's runtime
      // touches exactly one CSS property on exactly one element
      // (`e.style.display=''` on [data-ol-cd-ended] to reveal it once
      // expired — since the revisión Fable fix it NEVER touches the root's
      // display) — so that one `display` is the only thing needing undoing.
      // The FULL style attribute, in contrast, can carry properties written
      // by the creator or the AI — including AFTER this stash runs: the
      // inspector's own style editor (use-element-inspect.ts's applyStyle,
      // e.g. padding/background on the countdown box) and Temáticas' re-ink
      // pass (olReinkScoped, which walks every text-bearing element and can
      // recolor [data-ol-cd-ended]) both write to `style` post-stash.
      // Restoring the whole attribute would silently discard those on save —
      // the mirror image of the bug this stash/strip machinery exists to
      // prevent. See the matching restore in strip-editor-instrumentation.ts.
      doc.querySelectorAll("[data-ol-cd-ended]").forEach((n) => {
        if (n.hasAttribute(PREVIEW_CD_STYLE_STASH)) return;
        n.setAttribute(PREVIEW_CD_STYLE_STASH, (n as HTMLElement).style.display);
        changed = true;
      });
    }

    if (needsFilter) {
      // Same stash-before/restore-after pattern as countdown's text above —
      // see the matching restore in strip-editor-instrumentation.ts.
      doc.querySelectorAll(`[${filterMarker}]`).forEach((n) => {
        if (n.hasAttribute(PREVIEW_FILTER_PRESSED_STASH)) return;
        n.setAttribute(PREVIEW_FILTER_PRESSED_STASH, n.getAttribute("aria-pressed") ?? "");
        changed = true;
      });
    }

    if (needsCopy) {
      // copy's runtime swaps the BUTTON's textContent to its data-ol-copied
      // value for 2s on each click (recipes/copy.ts::k). A save captured
      // inside that window used to ship "¡Copiado!" as the button's permanent
      // label (revisión Fable, 2026-07-13 — the audit canary was bent around
      // it with an advanceTimersByTime). Stash the pristine label; the strip's
      // restore is CONDITIONAL (only when the live text equals data-ol-copied,
      // the one string the runtime can ever write) so a label the creator
      // deliberately edited post-stash is never reverted — see the matching
      // restore in strip-editor-instrumentation.ts.
      doc.querySelectorAll(`[${copyMarker}]`).forEach((n) => {
        if (n.hasAttribute(PREVIEW_COPY_TEXT_STASH)) return;
        n.setAttribute(PREVIEW_COPY_TEXT_STASH, n.textContent ?? "");
        changed = true;
      });
    }

    if (needsTabs) {
      // Mismo patrón que el aria-pressed de filter: el runtime de tabs
      // reescribe aria-selected en cada init/click; se snapshotea el valor
      // autorado para restaurarlo al guardar. (data-ol-tab-ready/-active son
      // estado puro y los borra el strip sin stash — categoría A.)
      doc.querySelectorAll(`[${tabsMarker}]`).forEach((n) => {
        if (n.hasAttribute(PREVIEW_TABS_SELECTED_STASH)) return;
        n.setAttribute(PREVIEW_TABS_SELECTED_STASH, n.getAttribute("aria-selected") ?? "");
        changed = true;
      });
    }

    if (needsCalc) {
      // El runtime de calc reescribe el texto de cada [data-ol-out] en cuanto
      // el creador toca un campo del preview. Sin stash, ese número se
      // persiste como el valor de NACIMIENTO de la página — y por una vía que
      // el motor no revisa: app/api/projects/[id]/html/route.ts sólo sanea,
      // no vuelve a pasar por preparePage, así que el gemelo compilado
      // tampoco se regeneraría. Mismo patrón que el texto de countdown.
      doc.querySelectorAll("[data-ol-out]").forEach((n) => {
        if (n.hasAttribute(PREVIEW_CALC_TEXT_STASH)) return;
        n.setAttribute(PREVIEW_CALC_TEXT_STASH, n.textContent ?? "");
        changed = true;
      });
    }

    if (!changed) return html;
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}
