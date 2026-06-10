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
// Fast path skips the parse when there's nothing to strip.
export function stripEditorInstrumentation(html: string): string {
  if (!html) return html;
  if (
    !html.includes("data-openlen-") &&
    !html.includes("contenteditable") &&
    !html.includes("data-ol-motion") &&
    !html.includes("data-ol-counted")
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
    doc
      .querySelectorAll(
        "[data-openlen-inline-edit],[data-openlen-reorder],[data-openlen-replace],[data-openlen-section-select],[data-openlen-inspect],[data-openlen-edit-overlay],[data-openlen-motion-preview],[data-openlen-music-preview],#ol-motion-preview-style,#ol-music-preview-style",
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
    ]) {
      doc.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
    }
    if (doc.body) {
      for (const attr of [
        "data-openlen-drag-active",
        "data-openlen-replace-mode",
        "data-openlen-over-image",
        "data-openlen-select-mode",
        "data-openlen-inspect-mode",
        "data-openlen-edit-mode",
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
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}
