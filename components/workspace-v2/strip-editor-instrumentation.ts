// Strip every OpenLen editor-mode marker from an HTML document string.
//
// The Content/Edit surface injects FIVE editor scripts into the preview iframe
// at once (inline-edit, section-reorder, image-replace, element-inspect,
// section-insert). Each script's own "post clean HTML" step only removes ITS
// OWN markers, so the HTML any one of them posts back still carries the other
// scripts' markers. This is the single funnel every `openlen:html-changed`
// passes through (app/new/page.tsx), so it must produce the clean,
// as-a-visitor-sees-it document that gets PATCHed + eventually published.
//
// Editor V5 note: inline-edit no longer puts `contenteditable` on page
// elements — it tags text with `data-openlen-editable`, hides the in-edit
// element/run with `data-openlen-edit-hidden`, floats a `data-openlen-edit-
// overlay` div, and wraps an edited run in a `data-openlen-edit-wrap` span.
// inline-edit's OWN captureClean cleans all of these, but a SIBLING surface
// (e.g. a Properties-panel edit, a reorder, an image swap) can capture the
// shared live DOM while those markers are present — so this backstop must
// remove/unwrap them too, or they reach the published static page.
//
import { BEHAVIORS_MARKER } from "@/lib/conductas-heredadas/build";
import { EDITOR_NODE_ATTRS } from "./edit-path";
import { MARKER as CAROUSEL_MARKER } from "@/lib/publish/carousel";

// Fast path skips the parse when there's nothing to strip.
export function stripEditorInstrumentation(html: string): string {
  if (!html) return html;
  if (
    !html.includes("data-openlen-") &&
    !html.includes("contenteditable") &&
    !html.includes("data-ol-motion") &&
    !html.includes("data-ol-counted") &&
    !html.includes("data-ol-filtered") &&
    !html.includes("data-ol-stuck") &&
    !html.includes("data-ol-tab-ready") &&
    !html.includes("data-ol-calc-off") &&
    !html.includes("data-ol-tab-active") &&
    !html.includes("data-ol-lb-modal") &&
    !html.includes(BEHAVIORS_MARKER) &&
    !html.includes(CAROUSEL_MARKER)
  ) {
    return html;
  }
  if (typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Injected <style>/<script> + the UI nodes they create (drag handles,
    // replace buttons, drop indicator, copy chip) + the inline-edit overlay +
    // the motion/music preview artifacts (injector scripts, preview styles,
    // the preview player host) all carry a marker — removing the marked
    // elements clears the surface.
    // El selector sale de EDITOR_NODE_ATTRS (edit-path.ts), que es la misma
    // lista con la que el iframe decide qué hijos NO cuentan para la firma de
    // una edición. Eran dos listas y tenían que decir lo mismo; ahora es una.
    // (Las de motion/música/3D se fueron con sus módulos el 2026-08-26.)
    doc
      .querySelectorAll(
        EDITOR_NODE_ATTRS.map((a) => `[${a}]`).join(",") +
          ",#ol-motion-preview-style,#ol-music-preview-style",
      )
      .forEach((n) => n.remove());
    // The behaviors preview injector (use-behaviors-preview.ts) bakes the same
    // <script data-ol-behaviors[-head]> that publish does, and — when any
    // recipe in play declares `css` (filter/lightbox today) — the composed
    // script ALSO creates a <style data-ol-behaviors> live, in document.head,
    // every time it runs (build.ts's styleInject). bakeBehaviors guards on
    // BEHAVIORS_MARKER's mere presence in the string — so if a save ever
    // persisted the script OR that style tag, that guard would permanently
    // no-op the preview injector on this document (stuck on whatever
    // runtime/CSS got baked in). Worse for the style tag specifically
    // (Arreglo 2, final branch review): a persisted one wouldn't just sit
    // there — the NEXT derive→save cycle would inject and persist ANOTHER
    // one on top of it, unbounded growth of project.data.html that also
    // reaches the published page. Strip the body script, the head script,
    // AND the style tag on every save so neither the guard nor the growth
    // can happen. Same reasoning for the carousel script (Task 14b): its
    // preview injector (also use-behaviors-preview.ts) guards on
    // CAROUSEL_MARKER the same way.
    doc
      .querySelectorAll(
        `script[${BEHAVIORS_MARKER}],script[${BEHAVIORS_MARKER}-head],style[${BEHAVIORS_MARKER}],script[${CAROUSEL_MARKER}]`,
      )
      .forEach((n) => n.remove());
    // inline-edit run-wrappers: UNWRAP (replace with children) — never delete,
    // or the run's text would be lost. Mirrors use-inline-edit captureClean.
    doc.querySelectorAll("[data-openlen-edit-wrap]").forEach((n) => {
      const parent = n.parentNode;
      if (!parent) return;
      while (n.firstChild) parent.insertBefore(n.firstChild, n);
      parent.removeChild(n);
    });
    // Editing-only attributes left on real content elements — strip the
    // attribute, keep the element.
    doc
      .querySelectorAll("[contenteditable]")
      .forEach((n) => n.removeAttribute("contenteditable"));
    for (const attr of [
      "data-openlen-reorder-index",
      "data-openlen-hovering",
      "data-openlen-dragging",
      "data-openlen-drag-bg-applied",
      "data-openlen-replace-target",
      "data-openlen-select-hover",
      "data-openlen-inspect-hover",
      "data-openlen-inspect-selected",
      "data-openlen-editable",
      "data-openlen-edit-hidden",
      "data-openlen-edit-noedit",
      "data-openlen-drop-target",
      "data-openlen-block-hover",
      // calc: estado PURO de su runtime (categoría A) — sólo lo escribe el
      // intérprete al evaluar un data-ol-if, nadie más en el repo lo usa (lo
      // afirma el test de colisión de namespace en conformance.test.ts).
      "data-ol-calc-off",
    ]) {
      doc.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
    }
    // section-insert's transient highlight: drop the marker AND its inline
    // outline (the script's own postClean does the same; this is the backstop
    // for a sibling capture mid-highlight).
    doc.querySelectorAll("[data-openlen-just-inserted]").forEach((n) => {
      n.removeAttribute("data-openlen-just-inserted");
      (n as HTMLElement).style.outline = "";
      (n as HTMLElement).style.outlineOffset = "";
      if (!n.getAttribute("style")) n.removeAttribute("style");
    });
    if (doc.body) {
      for (const attr of [
        "data-openlen-drag-active",
        "data-openlen-replace-mode",
        "data-openlen-over-image",
        "data-openlen-select-mode",
        "data-openlen-inspect-mode",
        "data-openlen-edit-mode",
        "data-openlen-drop-active",
      ]) {
        doc.body.removeAttribute(attr);
      }
    }
    // Motion-preview runtime state. The preview applies the REAL motion
    // runtime to the live DOM, so a save captured mid-preview carries its
    // mutations: the <html> marker/classes, per-element reveal classes, and
    // stat counters frozen mid-count (data-ol-counted + the original text
    // stashed in data-ol-orig). Restore the originals — motion reaches the
    // published page solely through the publish-time bake, which needs a
    // clean (marker-free) document to fire.
    const root = doc.documentElement;
    root.removeAttribute("data-ol-motion");
    root.classList.remove("ol-motion-native", "ol-motion-js");
    if (!root.getAttribute("class")) root.removeAttribute("class");
    doc.querySelectorAll(".ol-in").forEach((n) => {
      n.classList.remove("ol-in");
      if (!n.getAttribute("class")) n.removeAttribute("class");
    });
    doc.querySelectorAll("[data-ol-counted]").forEach((n) => {
      const orig = n.getAttribute("data-ol-orig");
      if (orig != null) n.textContent = orig;
      n.removeAttribute("data-ol-counted");
      n.removeAttribute("data-ol-orig");
    });

    // Behaviors runtime (lib/conductas-heredadas/recipes/*.ts) — injected live into the
    // editor preview for editor↔published parity (use-behaviors-preview.ts),
    // it mutates the SAME live DOM this function is cleaning. Two kinds of
    // leftover, two treatments:
    //
    // (A) Runtime-OWNED markers — attributes that ONLY one recipe's own live
    // runtime writes, while the creator pokes at their own page in the
    // preview (click a filter chip, scroll past the sticky threshold).
    // Unconditional removal is correct ONLY as long as that "only" actually
    // holds — this is NOT "no author or the AI ever writes these" (that
    // premise used to live here, and it was FALSE: it's what caused the bug
    // below). If any OTHER subsystem in the product also writes the exact
    // same attribute name for its own legitimate, PERSISTED purpose, this
    // loop destroys that subsystem's work on every save — silently, because
    // nothing here can tell "runtime side-effect" apart from "deliberate
    // creator state" by looking at the attribute alone.
    //
    // THIS ALREADY HAPPENED (CRITICAL, revisión final de rama): filter.ts
    // used to claim `data-ol-hidden` for the item it hides on click — but
    // that name was ALREADY owned by use-element-inspect.ts's applyHide(),
    // the inspector's "Ocultar elemento" toggle (a deliberate, PERSISTED
    // creator action — see its own ensureHiddenStyle() there, and
    // properties-panel.tsx's Hide toggle that drives it). This loop stripped
    // it unconditionally on every save, silently un-hiding every element any
    // creator had ever hidden — with or without the filter recipe anywhere on
    // the page. filter.ts's runtime attribute is now `data-ol-filtered`;
    // `data-ol-hidden` must NEVER be added back to this list.
    //
    // The structural guard against a repeat: every recipe declares its own
    // runtime-owned attribute names in `runtimeAttrs` (lib/conductas-heredadas/types.ts)
    // — a single enumerable claim on a namespace — and the "colisión de
    // namespace" suite in lib/conductas-heredadas/conformance.test.ts greps the rest of
    // the product for any OTHER `setAttribute` writer of the same name.
    // `runtimeAttrs` does NOT mechanically drive this list (enumerating is
    // not the same as interpreting — the removal mechanics below differ per
    // attribute, e.g. lightbox's is a whole-element removal), so keep the two
    // in sync by hand; each entry below is sourced to the recipe that writes
    // it, and if a future recipe (#8+) introduces a NEW runtime-owned marker
    // and it's missing here, the audit-canary test in
    // strip-editor-instrumentation.test.ts goes red.
    for (const attr of [
      "data-ol-filtered", // filter.ts: toggled on each [data-ol-tag] item it hides. NOT data-ol-hidden — see the long comment above.
      "data-ol-stuck", // sticky.ts: toggled on the [data-ol-sticky] nav past scrollY 24
      "data-ol-tab-ready", // tabs.ts: set on the [data-ol-tab-panels] container once the runtime inits.
      "data-ol-tab-active", // tabs.ts: toggled on the active [data-ol-tab-panel]. CRITICAL to strip: if it persisted with data-ol-tab-ready, the CSS ready-gate would hide every OTHER panel on the published page with no runtime to switch (kill-switch off) — silent content loss.
    ]) {
      doc.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
    }
    // lightbox.ts: the modal is a WHOLE element the runtime synthesizes
    // (cloned from the thumbnail already on the page) — remove it, not just
    // an attribute. Its close handlers (backdrop click / Escape) are bound to
    // the click-handler instance that built it, so a copy serialized into
    // static HTML can never be closed by a visitor: a dead black overlay, not
    // merely stale markup.
    doc.querySelectorAll("[data-ol-lb-modal]").forEach((n) => n.remove());

    // ⚰️ AQUÍ VIVÍA EL BLOQUE (B) — «estado de runtime ambiguo», ~90 líneas que
    // restauraban desde un stash lo que las conductas habían mutado en el
    // lienzo: el tema, la cuenta atrás, los filtros, las pestañas, la
    // calculadora, el «copiado». Se fue el 2026-08-31 con el inyector que
    // creaba esos stash (`use-behaviors-preview.ts`).
    //
    // No era código de más: era la factura de que el TALLER ejecutara un
    // runtime que la página publicada ya no tiene. Sin inyector no hay estado
    // que deshacer, y estas líneas no podían dispararse nunca más — ningún
    // documento vuelve a llevar un atributo de stash.
    //
    // (A), justo arriba, SE QUEDA: limpia marcadores `data-ol-*` que pueden
    // venir de páginas viejas creadas cuando las conductas existían.

    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}

/**
 * Lo mismo, sobre un FRAGMENTO en vez de un documento.
 *
 * El taller pasa a guardar ediciones —el outerHTML del elemento que cambió, no
 * una foto del documento entero— y ese fragmento necesita la misma limpieza:
 * cada inyector limpia SÓLO sus propios marcadores, así que el elemento que
 * manda uno puede llevar encima los de los otros cuatro.
 *
 * Se apoya en la función de arriba en vez de repetir su cuerpo. Son trescientas
 * líneas de decisiones sobre qué se restaura y qué no, cada una con su motivo
 * medido; tener dos copias sería garantizar que un día divergen y que el
 * fragmento persista algo que el documento sí limpiaba.
 *
 * Si el fragmento no trae ningún marcador se devuelve INTACTO, sin parsear: un
 * viaje por DOMParser normaliza comillas y atributos, y eso cambiaría el
 * documento del usuario en cada edición sin que nadie lo pidiera.
 */
export function stripEditorInstrumentationFragment(fragmento: string): string {
  if (!fragmento) return fragmento;
  const envuelto = STUB_ABRE + fragmento + STUB_CIERRA;
  const limpio = stripEditorInstrumentation(envuelto);
  if (limpio === envuelto) return fragmento;
  if (typeof DOMParser === "undefined") return fragmento;
  try {
    return new DOMParser().parseFromString(limpio, "text/html").body.innerHTML;
  } catch {
    return fragmento;
  }
}

const STUB_ABRE = '<!doctype html><html><head></head><body>';
const STUB_CIERRA = '</body></html>';
