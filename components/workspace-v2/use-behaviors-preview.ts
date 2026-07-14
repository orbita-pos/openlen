// Paridad editor↔publicado POR CONSTRUCCIÓN: el preview y el bake de
// publicación invocan LA MISMA función. No hay una segunda copia del runtime
// que pueda divergir. Es la deuda que dejó carousel.ts, cuyo comentario ruega
// "KEEP IN SYNC with the inline preview copy in the cinema templates" — una
// súplica escrita en un comentario, que ya se incumplió.
//
// El runtime se inyecta SIEMPRE (nunca condicionalmente: esa vía se abandonó en
// preview-area.tsx:196 por parpadeo y recarga de fuentes). Es el propio runtime
// el que se auto-silencia mientras body[data-openlen-edit-mode] esté puesto —
// ver EDIT_GUARD_JS en lib/behaviors/build.ts.
//
// reg/order son inyectables SOLO para tests (ver use-behaviors-preview.test.ts,
// que prueba paridad byte-a-byte contra bakeBehaviors con un registro falso —
// el real, lib/behaviors/registry.ts, tiene las 7 conductas desde el Task 13).
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
import { bakeBehaviors } from "@/lib/behaviors/build";
import { BEHAVIORS } from "@/lib/behaviors/registry";
import type { Behavior, BehaviorName } from "@/lib/behaviors/types";
import { CAROUSEL_JS, MARKER as CAROUSEL_MARKER } from "@/lib/publish/carousel";

export function injectBehaviorsPreview(
  html: string,
  reg?: Partial<Record<BehaviorName, Behavior>>,
  order?: BehaviorName[],
): string {
  return injectCarouselPreview(bakeBehaviors(html, reg, order));
}

/** Mismo patrón idempotente que bakeCarousels: comprobar marcador, comprobar
 *  disparador, envolver, insertar antes de `</body>`. Nunca reimplementa el
 *  RUNTIME (CAROUSEL_JS es importado) — solo repite el envoltorio, porque
 *  bakeCarousels en sí está congelado (desplegado en producción). */
function injectCarouselPreview(html: string): string {
  if (html.includes(CAROUSEL_MARKER)) return html;
  if (!html.includes("data-ol-scroll=")) return html;
  const script = `<script ${CAROUSEL_MARKER}>${CAROUSEL_JS}</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx === -1 ? html + script : html.slice(0, idx) + script + html.slice(idx);
}

// Preview-only stash attributes — read + consumed by
// stripEditorInstrumentation.ts on save. Exported so that file never
// duplicates these names as magic strings (single source of truth, same
// reasoning as BEHAVIORS_MARKER in lib/behaviors/build.ts).
export const PREVIEW_HTML_CLASS_STASH = "data-openlen-html-class";
export const PREVIEW_CD_TEXT_STASH = "data-openlen-cd-text";
export const PREVIEW_CD_STYLE_STASH = "data-openlen-cd-style";

/** Preview-only pristine-state snapshot for the two behaviors whose runtime
 *  mutation is otherwise indistinguishable, once the live DOM is captured,
 *  from a value the creator or the AI actually authored — theme's
 *  `<html class="dark">` toggle, and countdown's frozen digits (plus the
 *  `style="display:none"` it can bake onto its own root, and clear on
 *  `[data-ol-cd-ended]`, once expired).
 *
 *  Unlike motion's `data-ol-orig` (written by the PUBLISHED runtime itself —
 *  see lib/publish/motion-presets.ts, which needs it for its own reset
 *  logic), these three attributes must add ZERO bytes to production: this
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
  const needsTheme = !!themeMarker && html.includes(themeMarker);
  const needsCountdown = !!cdMarker && html.includes(cdMarker);
  if (!needsTheme && !needsCountdown) return html;
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
      // (lib/behaviors/recipes/countdown.ts) — only its ROOT marker
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
      // touches exactly one CSS property on these two elements
      // (`r.style.display='none'` on its own root once expired,
      // `e.style.display=''` on [data-ol-cd-ended] to reveal it) and nothing
      // else, ever — so `display` is the only thing that ever needs undoing.
      // The FULL style attribute, in contrast, can carry properties written
      // by the creator or the AI — including AFTER this stash runs: the
      // inspector's own style editor (use-element-inspect.ts's applyStyle,
      // e.g. padding/background on the countdown box) and Temáticas' re-ink
      // pass (olReinkScoped, which walks every text-bearing element and can
      // recolor [data-ol-cd-ended]) both write to `style` post-stash.
      // Restoring the whole attribute would silently discard those on save —
      // the mirror image of the bug this stash/strip machinery exists to
      // prevent. See the matching restore in strip-editor-instrumentation.ts.
      doc.querySelectorAll(`[${cdMarker}],[data-ol-cd-ended]`).forEach((n) => {
        if (n.hasAttribute(PREVIEW_CD_STYLE_STASH)) return;
        n.setAttribute(PREVIEW_CD_STYLE_STASH, (n as HTMLElement).style.display);
        changed = true;
      });
    }

    if (!changed) return html;
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}
