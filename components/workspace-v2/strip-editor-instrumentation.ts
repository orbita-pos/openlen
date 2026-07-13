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
import { BEHAVIORS_MARKER } from "@/lib/behaviors/build";
import {
  PREVIEW_CD_STYLE_STASH,
  PREVIEW_CD_TEXT_STASH,
  PREVIEW_HTML_CLASS_STASH,
} from "./use-behaviors-preview";
import { MARKER as CAROUSEL_MARKER } from "@/lib/publish/carousel";

// Fast path skips the parse when there's nothing to strip.
export function stripEditorInstrumentation(html: string): string {
  if (!html) return html;
  if (
    !html.includes("data-openlen-") &&
    !html.includes("contenteditable") &&
    !html.includes("data-ol-motion") &&
    !html.includes("data-ol-counted") &&
    !html.includes("data-ol-hidden") &&
    !html.includes("data-ol-stuck") &&
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
    doc
      .querySelectorAll(
        "[data-openlen-inline-edit],[data-openlen-reorder],[data-openlen-replace],[data-openlen-section-select],[data-openlen-inspect],[data-openlen-section-insert],[data-openlen-drop],[data-openlen-edit-overlay],[data-openlen-motion-preview],[data-openlen-music-preview],[data-openlen-3d-preview],#ol-motion-preview-style,#ol-music-preview-style",
      )
      .forEach((n) => n.remove());
    // The behaviors preview injector (use-behaviors-preview.ts) bakes the same
    // <script data-ol-behaviors[-head]> that publish does. bakeBehaviors guards
    // on BEHAVIORS_MARKER's mere presence in the string — so if a save ever
    // persisted this script, that guard would permanently no-op the preview
    // injector on this document (stuck on whatever runtime got baked in). Strip
    // both the body and head script on every save so the guard never sees them.
    // Same reasoning for the carousel script (Task 14b): its preview injector
    // (also use-behaviors-preview.ts) guards on CAROUSEL_MARKER the same way.
    doc
      .querySelectorAll(`script[${BEHAVIORS_MARKER}],script[${BEHAVIORS_MARKER}-head],script[${CAROUSEL_MARKER}]`)
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

    // Behaviors runtime (lib/behaviors/recipes/*.ts) — injected live into the
    // editor preview for editor↔published parity (use-behaviors-preview.ts),
    // it mutates the SAME live DOM this function is cleaning. Two kinds of
    // leftover, two treatments:
    //
    // (A) Runtime-OWNED markers — no author or the AI ever writes these; only
    // the live runtime does, while the creator pokes at their own page in the
    // preview (click a filter chip, scroll past the sticky threshold).
    // Stripping is ALWAYS correct: there is no legitimate authored value to
    // preserve. Each is sourced to the recipe that writes it; if a future
    // recipe (#8+) introduces a NEW runtime-owned marker and it's missing
    // here, the audit-canary test in strip-editor-instrumentation.test.ts
    // goes red.
    for (const attr of [
      "data-ol-hidden", // filter.ts: toggled on each [data-ol-tag] item it hides
      "data-ol-stuck", // sticky.ts: toggled on the [data-ol-sticky] nav past scrollY 24
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

    // (B) Ambiguous runtime state — restored from a preview-only stash (see
    // stashBehaviorsPristineState in use-behaviors-preview.ts) rather than
    // undone unconditionally: unlike (A) and unlike motion's restore above,
    // the mutated value here could ALSO be exactly what the author/AI wrote
    // on purpose, so there's no way to tell after the fact without having
    // snapshotted the pristine value BEFORE the runtime ran.
    //
    // theme: the on-page [data-ol-theme] button is a VISITOR-facing control
    // (lets a visitor pick THEIR preference) — clicking it inside the editor
    // preview is the creator trying it out, never a way to set the page's
    // shipped default (that's the inspector's own Dark toggle, a separate
    // control). So the correct save-time value is always whatever <html
    // class> was BEFORE the runtime got a chance to touch it — resync just
    // the `dark` token to the stash (leave every other class alone,
    // including whatever the motion restore above already did). Absent
    // stash ⇒ this document never went through the preview injector (e.g. a
    // raw from-html/from-template save) ⇒ nothing to do.
    const themeStash = root.getAttribute(PREVIEW_HTML_CLASS_STASH);
    if (themeStash !== null) {
      root.classList.toggle("dark", themeStash.split(/\s+/).includes("dark"));
      root.removeAttribute(PREVIEW_HTML_CLASS_STASH);
      if (!root.getAttribute("class")) root.removeAttribute("class");
    }
    // countdown: digits frozen mid-count, restored to whatever placeholder
    // the AI actually wrote. The style restore matters just as much as the
    // text: the runtime only ever SETS display:none on its own root once
    // expired, it never clears it back — so a countdown that happened to be
    // expired while the creator was mid-edit would publish permanently
    // invisible, surviving even a LATER edit that pushes the deadline back
    // out, if this didn't restore the pre-runtime style too.
    doc.querySelectorAll(`[${PREVIEW_CD_TEXT_STASH}]`).forEach((n) => {
      n.textContent = n.getAttribute(PREVIEW_CD_TEXT_STASH) ?? "";
      n.removeAttribute(PREVIEW_CD_TEXT_STASH);
    });
    doc.querySelectorAll(`[${PREVIEW_CD_STYLE_STASH}]`).forEach((n) => {
      const orig = n.getAttribute(PREVIEW_CD_STYLE_STASH) ?? "";
      if (orig) n.setAttribute("style", orig);
      else n.removeAttribute("style");
      n.removeAttribute(PREVIEW_CD_STYLE_STASH);
    });

    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}
