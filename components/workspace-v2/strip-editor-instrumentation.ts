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
import { EDITOR_NODE_ATTRS } from "./edit-path";

// Fast path skips the parse when there's nothing to strip.
export function stripEditorInstrumentation(html: string): string {
  if (!html) return html;
  if (!html.includes("data-openlen-") && !html.includes("contenteditable")) {
    return html;
  }
  if (typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Injected <style>/<script> + the UI nodes they create (drag handles,
    // replace buttons, drop indicator, copy chip) + the inline-edit overlay
    // all carry a marker — removing the marked elements clears the surface.
    // El selector sale de EDITOR_NODE_ATTRS (edit-path.ts), que es la misma
    // lista con la que el iframe decide qué hijos NO cuentan para la firma de
    // una edición. Eran dos listas y tenían que decir lo mismo; ahora es una.
    // (Las de motion/música/3D se fueron con sus módulos el 2026-08-26.)
    doc
      .querySelectorAll(
        EDITOR_NODE_ATTRS.map((a) => `[${a}]`).join(","),
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
    // ⚰️ AQUÍ SE LIMPIABA LO QUE DEJABAN TRES MOTORES EN EL LIENZO: el de las
    // conductas `data-ol-*` (sus scripts horneados y el estado que escribían:
    // `data-ol-stuck`, `-filtered`, `-tab-*`, `-calc-off`, el modal del
    // lightbox), el del carrusel y el de la animación (`data-ol-motion`,
    // `data-ol-counted`). Ninguno se inyecta ya —el lienzo dejó de hornear el
    // 2026-08-31 y la animación se fue con su módulo el 2026-08-26—, y en
    // producción ningún proyecto llevaba sus marcadores (medido el
    // 2026-10-04). Un limpiador se justifica por su emisor, y no le quedaba
    // ninguno: se retiró ese día con las conductas.

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
 * Se apoya en la función de arriba en vez de repetir su cuerpo. Son decenas de
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
