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
  PREVIEW_COPY_TEXT_STASH,
  PREVIEW_FILTER_PRESSED_STASH,
  PREVIEW_TABS_SELECTED_STASH,
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
    !html.includes("data-ol-filtered") &&
    !html.includes("data-ol-stuck") &&
    !html.includes("data-ol-tab-ready") &&
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
    doc
      .querySelectorAll(
        "[data-openlen-inline-edit],[data-openlen-reorder],[data-openlen-replace],[data-openlen-section-select],[data-openlen-inspect],[data-openlen-section-insert],[data-openlen-drop],[data-openlen-edit-overlay],[data-openlen-motion-preview],[data-openlen-music-preview],[data-openlen-3d-preview],[data-openlen-modules-preview],[data-openlen-scheme],#ol-motion-preview-style,#ol-music-preview-style",
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
    // runtime-owned attribute names in `runtimeAttrs` (lib/behaviors/types.ts)
    // — a single enumerable claim on a namespace — and the "colisión de
    // namespace" suite in lib/behaviors/conformance.test.ts greps the rest of
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
    // the AI actually wrote — touches ONLY textContent, nothing else on the
    // element, so any other attribute survives untouched.
    doc.querySelectorAll(`[${PREVIEW_CD_TEXT_STASH}]`).forEach((n) => {
      n.textContent = n.getAttribute(PREVIEW_CD_TEXT_STASH) ?? "";
      n.removeAttribute(PREVIEW_CD_TEXT_STASH);
    });
    // countdown's style restore matters just as much as the text: once
    // expired, the runtime clears the display:none on [data-ol-cd-ended]
    // (its ONLY style mutation — since the revisión Fable fix it never
    // touches the root's display), so an expired countdown captured mid-edit
    // would publish its "terminó" message VISIBLE by default — pre-revealing
    // the ending on a page whose deadline the creator may be about to push
    // back out — if this didn't revert it to the authored hidden state.
    //
    // Arreglo 1 (final branch review) — this used to restore the WHOLE
    // `style` attribute (`n.setAttribute("style", orig)`), which silently
    // discarded any OTHER style property written on this element AFTER
    // stashBehaviorsPristineState() snapshotted it: the inspector's own style
    // editor (padding/background on the countdown box) and Temáticas'
    // re-ink pass (color on [data-ol-cd-ended]) both write to `style` post-
    // stash, and both got wiped on save. The stash (use-behaviors-preview.ts)
    // now carries just the pristine `display` value for exactly this reason
    // — restore ONLY that one property, via the CSSOM setter, and leave
    // every other property on the element alone. Same pattern as the
    // data-openlen-just-inserted cleanup above: clear the property, then
    // drop the attribute only if nothing else is left in it.
    doc.querySelectorAll(`[${PREVIEW_CD_STYLE_STASH}]`).forEach((n) => {
      const el = n as HTMLElement;
      el.style.display = el.getAttribute(PREVIEW_CD_STYLE_STASH) ?? "";
      el.removeAttribute(PREVIEW_CD_STYLE_STASH);
      if (!el.getAttribute("style")) el.removeAttribute("style");
    });
    // filter: aria-pressed on each chip, restored to whatever the AI actually
    // authored — a click the creator tried in the preview is real interaction,
    // not a shipped default (Arreglo 1, revisión final de rama). Before this
    // restore, aria-pressed was collateral damage of the runtime-owned
    // data-ol-filtered cleanup above: that unhides the items again (correct),
    // but left the LAST-CLICKED chip's aria-pressed on the published page —
    // a chip stuck "pressed" over an unfiltered list, and a screen reader
    // announcing a selection that no longer matches what's shown.
    doc.querySelectorAll(`[${PREVIEW_FILTER_PRESSED_STASH}]`).forEach((n) => {
      n.setAttribute("aria-pressed", n.getAttribute(PREVIEW_FILTER_PRESSED_STASH) ?? "");
      n.removeAttribute(PREVIEW_FILTER_PRESSED_STASH);
    });
    // tabs: aria-selected on each [data-ol-tab] — mismo caso que el
    // aria-pressed de filter. El runtime lo reescribe en cada init Y en cada
    // click; una pestaña que el creador probó en el preview dejaría su
    // aria-selected sobre la página guardada. Se restaura al valor autorado
    // (el runtime publicado lo re-inicializa al cargar de todos modos, pero el
    // estado guardado debe ser el que la IA escribió, no el que el creador
    // tocó — coherente en el estado degradado sin JS).
    doc.querySelectorAll(`[${PREVIEW_TABS_SELECTED_STASH}]`).forEach((n) => {
      n.setAttribute("aria-selected", n.getAttribute(PREVIEW_TABS_SELECTED_STASH) ?? "");
      n.removeAttribute(PREVIEW_TABS_SELECTED_STASH);
    });
    // copy: the button label mid-confirmation ("¡Copiado!") — restored ONLY
    // when the live text is exactly the data-ol-copied value, the one string
    // copy's runtime can ever write (its own double-click guard proves it
    // never writes anything else). Unconditional restore — the countdown
    // pattern above — would revert a label the creator deliberately edited
    // after the stash ran; countdown's digits don't have that problem (the
    // runtime rewrites them every second, so the creator's edit there is
    // ephemeral either way). If the 2s timer already restored the label, the
    // condition is false and only the stash attribute is consumed.
    doc.querySelectorAll(`[${PREVIEW_COPY_TEXT_STASH}]`).forEach((n) => {
      if (n.textContent === n.getAttribute("data-ol-copied")) {
        n.textContent = n.getAttribute(PREVIEW_COPY_TEXT_STASH) ?? "";
      }
      n.removeAttribute(PREVIEW_COPY_TEXT_STASH);
    });

    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  } catch {
    return html;
  }
}
