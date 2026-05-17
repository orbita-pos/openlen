// OpenLen iframe-editor — Session 12 inline WYSIWYG.
//
// Loaded into the preview iframe ONLY when the workspace has edit mode on.
// Finds every `[data-slot-path]` span (stamped by EditableText during the
// editor-mode render), turns them into plaintext-only contenteditable spans,
// and posts commits back to the parent window as
//   { type: "openlen-edit", path, value }
//
// Lifecycle, in order:
//   1. Inject a <style> block (hover outline, active border, "↵ to save"
//      hint). The hint is positioned absolutely off the span's bounding box
//      via a pseudo-element-free approach — we attach a real DOM node so we
//      can place it under floating spans like buttons.
//   2. Hide the existing __inari-overlay regenerate/edit buttons (rendered
//      by the buildSrcDoc script in preview-panel.tsx). They overlap with
//      the inline-edit hover targets when both are active; the user can
//      toggle edit mode off to get them back.
//   3. Walk every `[data-slot-path]` element and stamp it with `tabindex=0`
//      so keyboard focus works.
//   4. Delegate click/keydown/blur on document. We don't put listeners per
//      span — too many spans, too easy to leak.
//
// Keep it small (<200 LOC), no deps, no bundling. Plain ES5+ so the iframe
// can swallow it on every browser the parent supports.

(function () {
  if (window.__openlenEditorBooted) return;
  window.__openlenEditorBooted = true;

  // ── 1. CSS ───────────────────────────────────────────────────────────────
  // Pinned to `body` rather than `:root` so we don't fight the page's own
  // base stylesheet. The 30% coral matches the workspace's accent token.
  var style = document.createElement("style");
  style.setAttribute("data-openlen-editor", "");
  style.textContent = [
    // Suppress the section-level regenerate/edit overlay while inline editing.
    ".__inari-overlay { display: none !important; }",

    // Editable spans default to invisible outline so the page reads as
    // normal until the user hovers/focuses one. Outline (not border) so we
    // don't add box-model padding that would reflow text in the surrounding
    // line.
    "[data-slot-path] {",
    "  outline: 1px dashed transparent;",
    "  outline-offset: 2px;",
    "  border-radius: 3px;",
    "  cursor: text;",
    "  transition: outline-color 100ms ease, background-color 100ms ease;",
    // Block the iOS long-press callout on editable text. Without this, the
    // user's tap-to-edit gesture is preempted by the native "Copy/Look up"
    // menu.
    "  -webkit-touch-callout: none;",
    "}",
    "[data-slot-path]:hover { outline-color: rgba(255, 90, 54, 0.4); }",
    "[data-slot-path]:focus, [data-slot-path][data-openlen-active] {",
    "  outline: 1px solid rgba(255, 90, 54, 0.9);",
    "  background: rgba(255, 90, 54, 0.06);",
    "  outline-offset: 2px;",
    "}",
    // Hint shown next to the active span. Positioned via JS (it follows the
    // viewport since we can't anchor a tooltip purely with CSS to an
    // arbitrary inline element). Plain coral chip with the keymap.
    ".__openlen-hint {",
    "  position: fixed;",
    "  z-index: 2147483647;",
    "  background: #18181b;",
    "  color: #fff;",
    "  font: 500 11px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;",
    "  padding: 4px 8px;",
    "  border-radius: 6px;",
    "  box-shadow: 0 4px 12px rgba(0,0,0,0.25);",
    "  pointer-events: none;",
    "  opacity: 0;",
    "  transition: opacity 80ms ease;",
    "  white-space: nowrap;",
    "}",
    ".__openlen-hint[data-visible] { opacity: 1; }",
    ".__openlen-hint kbd {",
    "  background: rgba(255,255,255,0.12);",
    "  border-radius: 3px;",
    "  padding: 1px 4px;",
    "  margin: 0 2px;",
    "  font: inherit;",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // ── 2. Hint chip (one shared instance, repositioned per active span) ────
  var hint = document.createElement("div");
  hint.className = "__openlen-hint";
  hint.innerHTML =
    "<kbd>↵</kbd> save · <kbd>Esc</kbd> cancel · <kbd>Shift</kbd>+<kbd>↵</kbd> newline";
  document.body.appendChild(hint);

  function positionHint(target) {
    var rect = target.getBoundingClientRect();
    // Below the span if there's room; otherwise above.
    var below = rect.bottom + 6;
    var above = rect.top - 28;
    var spaceBelow = window.innerHeight - below;
    hint.style.left = Math.max(8, Math.round(rect.left)) + "px";
    hint.style.top = (spaceBelow > 32 ? below : above) + "px";
    hint.setAttribute("data-visible", "");
  }

  function hideHint() {
    hint.removeAttribute("data-visible");
  }

  // ── 3. State: the currently active span + its pre-edit value ────────────
  var active = null;
  var preEditValue = "";

  function commit(target, value) {
    try {
      parent.postMessage(
        { type: "openlen-edit", path: target.getAttribute("data-slot-path"), value: value },
        "*",
      );
    } catch (err) {
      // postMessage rarely throws — if it does, the parent will ask for a
      // fresh reassemble on the next user action.
    }
  }

  function exitEdit(target, options) {
    if (!target) return;
    var save = options && options.save;
    var revert = options && options.revert;
    target.removeAttribute("contenteditable");
    target.removeAttribute("data-openlen-active");
    if (revert) {
      target.textContent = preEditValue;
    } else if (save) {
      var value = (target.textContent || "").trim();
      if (value !== preEditValue) commit(target, value);
    }
    hideHint();
    active = null;
    preEditValue = "";
  }

  function enterEdit(target) {
    // If a different span is currently being edited, commit it first.
    if (active && active !== target) exitEdit(active, { save: true });
    active = target;
    preEditValue = target.textContent || "";
    target.setAttribute("contenteditable", "plaintext-only");
    target.setAttribute("data-openlen-active", "");
    target.focus();
    // Select all text so the user can replace by typing.
    try {
      var range = document.createRange();
      range.selectNodeContents(target);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {
      // Selection API can throw on detached nodes — non-fatal.
    }
    positionHint(target);
  }

  // ── 4. Delegated event handlers ─────────────────────────────────────────
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      while (t && t.nodeType === 1) {
        // Block link navigation while edit mode is live. The user is here
        // to type, not to follow CTAs.
        if (t.tagName === "A") {
          e.preventDefault();
        }
        if (t.hasAttribute && t.hasAttribute("data-slot-path")) {
          // Don't re-enter if this span is already the active one.
          if (t !== active) {
            e.preventDefault();
            e.stopPropagation();
            enterEdit(t);
          }
          return;
        }
        t = t.parentNode;
      }
      // Click landed outside any editable — commit the active edit.
      if (active) exitEdit(active, { save: true });
    },
    true,
  );

  document.addEventListener("keydown", function (e) {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      exitEdit(active, { revert: true });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // Plain Enter commits. Shift+Enter falls through and inserts a newline
      // (the plaintext-only contenteditable handles that natively).
      e.preventDefault();
      exitEdit(active, { save: true });
    }
  });

  document.addEventListener(
    "blur",
    function (e) {
      // Focus moved away from the active span — commit. We listen on
      // document with capture because plain blur doesn't bubble.
      if (!active) return;
      if (e.target !== active) return;
      // Defer so a click that just moved focus to another editable can
      // open it cleanly without racing the exitEdit.
      setTimeout(function () {
        if (active === e.target) exitEdit(active, { save: true });
      }, 0);
    },
    true,
  );

  // Touch: long-press to enter edit. Without this, mobile Safari's native
  // text-selection callout pre-empts the click handler. The 450 ms threshold
  // matches iOS's own long-press timing.
  var touchTimer = null;
  var touchTarget = null;
  document.addEventListener(
    "touchstart",
    function (e) {
      var t = e.target;
      while (t && t.nodeType === 1) {
        if (t.hasAttribute && t.hasAttribute("data-slot-path")) {
          touchTarget = t;
          touchTimer = setTimeout(function () {
            if (touchTarget) enterEdit(touchTarget);
            touchTarget = null;
          }, 450);
          return;
        }
        t = t.parentNode;
      }
    },
    { passive: true },
  );
  document.addEventListener("touchend", function () {
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
      touchTarget = null;
    }
  });

  // Make every editable span keyboard-focusable. The block authors don't
  // have to think about this — the script handles it once on load.
  function makeFocusable() {
    var nodes = document.querySelectorAll("[data-slot-path]");
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].hasAttribute("tabindex")) nodes[i].setAttribute("tabindex", "0");
    }
  }
  makeFocusable();
  // Re-run after iframe resize / reassemble swaps innerHTML.
  if (typeof MutationObserver !== "undefined") {
    try {
      new MutationObserver(makeFocusable).observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (err) {
      // Older browser — fine to skip; the iframe srcDoc swap will re-run
      // this script anyway.
    }
  }

  // Surface a clear failure when the parent rejects an edit (Zod validation).
  // The parent posts { type: "openlen-edit-rejected", path, reason } back.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object" || d.type !== "openlen-edit-rejected") return;
    var span = document.querySelector('[data-slot-path="' + cssEscape(d.path) + '"]');
    if (!span) return;
    // Briefly outline the offender red, then revert. The parent already
    // shipped a toast; this is just the iframe-side confirmation.
    span.style.outline = "1px solid #ef4444";
    span.style.background = "rgba(239, 68, 68, 0.08)";
    setTimeout(function () {
      span.style.outline = "";
      span.style.background = "";
    }, 1200);
  });

  function cssEscape(s) {
    // Minimal escape for use inside a `[data-slot-path="..."]` selector.
    // Paths only contain alphanumerics, dots, and brackets, so the surface
    // is small.
    return String(s).replace(/(["\\\[\]])/g, "\\$1");
  }
})();
