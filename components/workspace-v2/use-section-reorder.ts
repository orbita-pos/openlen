// Section-reorder injection for the iframe — drag handles + drop indicator
// + pointer-event wiring that lets the user move top-level page blocks
// without going through the chat model. Works on mouse, touch, and pen
// via a single code path (HTML5 drag-and-drop was rejected for being
// touch-hostile).
//
// Mirrors the inline-edit pattern: inject style + script before </body>,
// the script mutates the DOM in place, applies a FLIP animation, and on
// each drop strips its own markers and posts the clean outerHTML to the
// parent via `openlen:html-changed` — reusing the same PATCH plumbing.
// PATCH body includes `source: "reorder"` so the version timeline tags
// these snapshots distinctly from inline-edit autosaves.
//
// Draggable set discovery:
//   1. Start from <body>. Filter out landmarks (header/footer/nav), inert
//      tags (script/style/etc.), and overlays (position: fixed/absolute).
//   2. If ≥ 2 reorderable children remain, body IS the content root.
//   3. Else, if body has exactly 1 reorderable child (templates that wrap
//      everything in a single <main>/<section>), drill into that child and
//      use ITS children as the draggable set.
//   4. Minimum element height: 60px. Below that is almost always decoration.
//
// Pointer state machine:
//   idle → pointerdown on draggable → armed
//   armed (mouse) → movement > 5px → dragging
//   armed (touch) → long-press 280ms holds → dragging
//   armed (touch) → movement > 8px BEFORE long-press → cancel (scroll intent)
//   dragging → pointerup → drop (FLIP + post HTML)
//   dragging → pointercancel → endDrag, idle
//
// Parent contract (postMessage):
//   { type: "openlen:html-changed", outerHtml, source: "reorder" }
//   { type: "openlen:reorder-cancelled" }  // ESC

const REORDER_STYLE = `
.openlen-reorder-handle {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  color: white;
  background: #FF5A36;
  border: none;
  border-radius: 11px;
  z-index: 999999;
  pointer-events: auto;
  box-shadow: 0 3px 10px rgba(255,90,54,0.35), 0 1px 3px rgba(0,0,0,0.15);
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 130ms ease, transform 130ms ease;
  cursor: grab;
  font: 600 10px ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  user-select: none;
}
.openlen-reorder-handle.visible {
  opacity: 1;
  transform: translateX(0);
}
.openlen-reorder-handle:active {
  cursor: grabbing;
}
.openlen-reorder-indicator {
  position: absolute;
  height: 3px;
  background: rgba(255,90,54,0.95);
  border-radius: 2px;
  z-index: 999999;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(255,90,54,0.6);
  opacity: 0;
  transition: opacity 120ms ease, top 90ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.openlen-reorder-indicator.visible {
  opacity: 1;
}
[data-openlen-reorder-index] {
  transition: outline-color 120ms;
}
[data-openlen-reorder-index][data-openlen-hovering] {
  outline: 2px solid rgba(255,90,54,0.35);
  outline-offset: -2px;
}
/* Editor V3 gate — script + UI nodes live permanently in the persistent
   iframe; visibility is gated on body[data-openlen-edit-mode]. */
body:not([data-openlen-edit-mode]) .openlen-reorder-handle,
body:not([data-openlen-edit-mode]) .openlen-reorder-indicator {
  display: none !important;
}
body:not([data-openlen-edit-mode]) [data-openlen-reorder-index][data-openlen-hovering] {
  outline: none !important;
}
body[data-openlen-drag-active],
body[data-openlen-drag-active] * {
  cursor: grabbing !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}
`;

const REORDER_SCRIPT = `
(function () {
  var IGNORE_TAGS = {HEADER:1, FOOTER:1, NAV:1, SCRIPT:1, STYLE:1, NOSCRIPT:1, META:1, LINK:1, TITLE:1, TEMPLATE:1};
  var MIN_HEIGHT = 60;
  var DRAG_THRESHOLD_MOUSE = 5;
  var DRAG_THRESHOLD_TOUCH = 8;
  var LONG_PRESS_MS = 280;
  var AUTO_SCROLL_ZONE = 60;
  var AUTO_SCROLL_SPEED = 12;
  var draggables = [];
  var handles = [];
  var draggingEl = null;
  var dropIndicator = null;
  var contentRoot = null;
  // Pointer-event state machine: 'idle' → 'armed' (pointerdown, waiting for
  // long-press on touch or movement threshold on mouse) → 'dragging'.
  var pointerState = 'idle';
  var armedEl = null;
  var activePointerId = null;
  var activePointerType = null;
  var startX = 0;
  var startY = 0;
  var longPressTimer = null;
  // Auto-scroll while dragging near the viewport edges. The RAF loop runs
  // independently of pointer movement so a user holding their finger near
  // the edge keeps scrolling without needing to wiggle.
  var autoScrollDirection = 0;
  var autoScrollRaf = null;
  var lastPointerClientY = null;
  // Live reorder preview state — snapshot of rects + dragged element
  // height at drag start, plus the predicted-new-index tracked across
  // pointermoves so we only re-apply shifts when the prediction changes.
  var dragStartRects = null;
  var draggedHeight = 0;
  var lastPredictedIdx = -1;
  // Cursor Y at the moment the drag actually began. Used to compute the
  // dragged section's translateY so it follows the finger. Combined with
  // dragOriginScroll so the math survives auto-scroll without the
  // section appearing to "jump up" when the document scrolls underneath.
  var dragOriginY = 0;
  var dragOriginScroll = 0;

  // True when the CSS color string is a solid (alpha == 1) opaque color.
  // Catches "rgb(...)", "rgba(...,1)", named colors, hex. Rejects fully
  // transparent OR semi-transparent (alpha < 0.99) values — we don't want
  // a 50%-transparent backdrop, only a real opaque one.
  function isOpaqueBgColor(value) {
    if (!value) return false;
    if (value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return false;
    var m = value.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (m) {
      if (typeof m[1] === 'undefined') return true;
      return parseFloat(m[1]) >= 0.99;
    }
    // Hex / named color / hsl — assume opaque if not explicitly transparent.
    return true;
  }

  // Returns true if the page is using a dark theme (luminance of body's
  // text color suggests light text on dark surface).
  function isLightTextOnDarkTheme(colorStr) {
    if (!colorStr) return true;
    var m = colorStr.match(/\d+(?:\.\d+)?/g);
    if (!m || m.length < 3) return true;
    var r = parseFloat(m[0]);
    var g = parseFloat(m[1]);
    var b = parseFloat(m[2]);
    // Rec. 601 luma — quick perceptual brightness check.
    return r * 0.299 + g * 0.587 + b * 0.114 > 160;
  }

  function filterCandidates(parent) {
    if (!parent || !parent.children) return [];
    var out = [];
    for (var i = 0; i < parent.children.length; i++) {
      var el = parent.children[i];
      if (!el.tagName || IGNORE_TAGS[el.tagName]) continue;
      var st;
      try { st = getComputedStyle(el); } catch (_) { continue; }
      if (st.position === 'fixed' || st.position === 'absolute') continue;
      if (st.display === 'none') continue;
      if (el.offsetHeight < MIN_HEIGHT) continue;
      out.push(el);
    }
    return out;
  }

  function findContentRoot() {
    var body = document.body;
    if (!body) return null;
    var top = filterCandidates(body);
    if (top.length >= 2) return body;
    if (top.length === 1) {
      var deeper = filterCandidates(top[0]);
      if (deeper.length >= 2) return top[0];
    }
    return body;
  }

  function makeHandle(target, idx) {
    var h = document.createElement('div');
    h.setAttribute('data-openlen-reorder', 'handle');
    h.setAttribute('data-handle-idx', String(idx));
    h.className = 'openlen-reorder-handle';
    h.title = 'Drag to reorder this section';
    // Text-only — no SVG, no other elements that the Replace detector
    // could ever mistake for a swappable icon. The pill says exactly
    // what it is.
    h.textContent = 'DRAG';
    document.body.appendChild(h);
    positionHandle(h, target);
    return h;
  }

  function positionHandle(h, target) {
    var r = target.getBoundingClientRect();
    // Place the pill at the section's top-left, slightly inset so it
    // overlaps the upper corner of the section. More discoverable than
    // floating off in the margin.
    h.style.top = (r.top + window.scrollY + 8) + 'px';
    h.style.left = (r.left + window.scrollX + 12) + 'px';
  }

  function repositionHandles() {
    for (var i = 0; i < handles.length && i < draggables.length; i++) {
      positionHandle(handles[i], draggables[i]);
    }
  }

  function tearDownHandles() {
    handles.forEach(function (h) { h.remove(); });
    handles = [];
  }

  var hoverHideTimer = null;
  var hoveredIdx = -1;

  function showHandleFor(idx) {
    // When the user is hovering an image-like asset, suppress the drag
    // handle so the Replace button is the only affordance — avoids the
    // "two buttons competing for my attention" feeling.
    if (document.body.hasAttribute('data-openlen-over-image')) {
      scheduleHideHandle();
      return;
    }
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
    if (hoveredIdx === idx) return;
    if (hoveredIdx >= 0) {
      var prev = handles[hoveredIdx];
      if (prev) prev.classList.remove('visible');
      var prevEl = draggables[hoveredIdx];
      if (prevEl) prevEl.removeAttribute('data-openlen-hovering');
    }
    hoveredIdx = idx;
    var h = handles[idx];
    if (h) {
      positionHandle(h, draggables[idx]);
      h.classList.add('visible');
    }
    if (draggables[idx]) {
      draggables[idx].setAttribute('data-openlen-hovering', '');
    }
  }

  function scheduleHideHandle() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(function () {
      hoverHideTimer = null;
      if (hoveredIdx >= 0) {
        var prev = handles[hoveredIdx];
        if (prev) prev.classList.remove('visible');
        var prevEl = draggables[hoveredIdx];
        if (prevEl) prevEl.removeAttribute('data-openlen-hovering');
      }
      hoveredIdx = -1;
    }, 140);
  }

  // Global mousemove handler — single source of truth for "which handle
  // should be visible right now". Replaces per-element mouseenter
  // listeners so the handle reacts to ALL cursor movements (including
  // moving from an image inside a section back to the section bg, where
  // mouseenter would never re-fire).
  function onGlobalMouseMove(e) {
    if (pointerState === 'dragging') return;
    // Cursor over an image-like asset → Replace owns the affordance.
    if (document.body.hasAttribute('data-openlen-over-image')) {
      if (hoveredIdx >= 0) scheduleHideHandle();
      return;
    }
    var target = e.target;
    if (!target || !target.closest) return;
    // Cursor over our own handle — keep it visible.
    if (target.closest('.openlen-reorder-handle')) {
      if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
      return;
    }
    var sectionEl = target.closest('[data-openlen-reorder-index]');
    if (!sectionEl) {
      scheduleHideHandle();
      return;
    }
    var idxStr = sectionEl.getAttribute('data-openlen-reorder-index');
    if (idxStr === null) return;
    var idx = parseInt(idxStr, 10);
    if (!isFinite(idx) || idx < 0 || idx >= draggables.length) return;
    showHandleFor(idx);
  }

  function refreshDraggables() {
    tearDownHandles();
    draggables.forEach(function (el) {
      el.removeAttribute('data-openlen-reorder-index');
      el.removeAttribute('data-openlen-hovering');
    });
    draggables = filterCandidates(contentRoot);
    handles = draggables.map(function (el, idx) {
      var h = makeHandle(el, idx);
      h.addEventListener('mouseenter', function () {
        if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
      });
      h.addEventListener('mouseleave', scheduleHideHandle);
      return h;
    });
    draggables.forEach(function (el, idx) {
      el.setAttribute('data-openlen-reorder-index', String(idx));
    });
    hoveredIdx = -1;
  }

  function endDrag() {
    // Visual styles (opacity/shadow/transform) are cleared by either the
    // FLIP cleanup setTimeout (successful drop) or animateDraggedBack
    // (cancel paths). endDrag's job is just state-var cleanup so the
    // next drag starts fresh.
    if (dropIndicator) dropIndicator.classList.remove('visible');
    draggingEl = null;
    document.body.removeAttribute('data-openlen-drag-active');
    stopAutoScroll();
    lastPointerClientY = null;
    dragStartRects = null;
    draggedHeight = 0;
    lastPredictedIdx = -1;
    dragOriginY = 0;
    dragOriginScroll = 0;
  }

  function resetPointer() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    // Release the captured pointer so other UI inside the iframe gets
    // events again. releasePointerCapture throws if the pointer wasn't
    // captured — try/catch handles the no-op case.
    try {
      if (activePointerId !== null && document.body.releasePointerCapture) {
        document.body.releasePointerCapture(activePointerId);
      }
    } catch (_) {}
    pointerState = 'idle';
    armedEl = null;
    activePointerId = null;
    activePointerType = null;
  }

  function startAutoScroll() {
    if (autoScrollRaf) return;
    autoScrollRaf = requestAnimationFrame(autoScrollStep);
  }

  function stopAutoScroll() {
    if (autoScrollRaf) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
    autoScrollDirection = 0;
  }

  function autoScrollStep() {
    autoScrollRaf = null;
    if (autoScrollDirection === 0 || pointerState !== 'dragging') return;
    window.scrollBy(0, autoScrollDirection * AUTO_SCROLL_SPEED);
    if (lastPointerClientY !== null) {
      // Re-apply everything that depends on the current scroll position
      // so the dragged card stays glued to the finger AND the live
      // preview keeps predicting correctly as new sections come into view.
      applyDraggedFollow(lastPointerClientY);
      updateDropIndicator(lastPointerClientY);
      var predicted = computePredictedIndex(lastPointerClientY);
      applyDragShifts(predicted);
    }
    autoScrollRaf = requestAnimationFrame(autoScrollStep);
  }

  // Drag only arms when pointerdown happens on the handle (or its
  // descendants — the inner SVG). Clicks on the section body, an image,
  // or text DON'T trigger a drag — they leave room for direct content
  // interactions (Replace, inline-edit). This kills the old drag↔click
  // ambiguity that needed tap-vs-drag heuristics.
  function findHandleTarget(el) {
    if (!el || !el.closest) return null;
    var handle = el.closest('.openlen-reorder-handle');
    if (!handle) return null;
    var idxStr = handle.getAttribute('data-handle-idx');
    if (idxStr === null) return null;
    var idx = parseInt(idxStr, 10);
    if (!isFinite(idx) || idx < 0 || idx >= draggables.length) return null;
    return draggables[idx];
  }

  function beginDrag() {
    if (!armedEl) return;
    // Clean slate — wipe any leftover transforms from a previous drop's
    // FLIP animation so the rect snapshot below captures true positions.
    draggables.forEach(function (el) {
      if (el.style.transform || el.style.transition) {
        el.style.transition = 'none';
        el.style.transform = '';
      }
    });
    pointerState = 'dragging';
    draggingEl = armedEl;
    // Lifted-off-the-page look — section becomes a card the user is
    // visibly carrying.
    draggingEl.style.opacity = '1';
    draggingEl.style.boxShadow = '0 18px 50px rgba(0,0,0,0.22), 0 4px 14px rgba(255,90,54,0.18)';
    draggingEl.style.zIndex = '999998';
    draggingEl.style.position = 'relative';
    draggingEl.style.transition = 'none';
    draggingEl.style.transform = 'translateY(0)';
    // Make the dragged card visually opaque so the text below doesn't
    // bleed through. We check BOTH backgroundColor (solid) AND
    // backgroundImage (gradient) — some templates leave sections with
    // no bg of their own and let the body's gradient show through. In
    // that case we mirror the body's full background onto the section.
    // Last resort: a solid color sourced from body's text color (light
    // text → dark theme → dark backdrop; dark text → light backdrop).
    try {
      var sectionStyle = window.getComputedStyle(draggingEl);
      var sectionHasOpaqueBg =
        isOpaqueBgColor(sectionStyle.backgroundColor) ||
        (sectionStyle.backgroundImage && sectionStyle.backgroundImage !== 'none');
      if (!sectionHasOpaqueBg) {
        var bodyStyle = window.getComputedStyle(document.body);
        var bodyBgColor = bodyStyle.backgroundColor;
        var bodyBgImage = bodyStyle.backgroundImage;
        var applied = false;
        if (isOpaqueBgColor(bodyBgColor)) {
          draggingEl.style.backgroundColor = bodyBgColor;
          applied = true;
        }
        if (bodyBgImage && bodyBgImage !== 'none') {
          draggingEl.style.backgroundImage = bodyBgImage;
          draggingEl.style.backgroundSize = bodyStyle.backgroundSize;
          draggingEl.style.backgroundPosition = bodyStyle.backgroundPosition;
          draggingEl.style.backgroundRepeat = bodyStyle.backgroundRepeat;
          applied = true;
        }
        if (!applied) {
          // Both transparent — infer theme from text color and use a
          // solid fallback. Better than letting the text bleed through.
          draggingEl.style.backgroundColor = isLightTextOnDarkTheme(
            bodyStyle.color,
          )
            ? '#0a0a0c'
            : '#ffffff';
          applied = true;
        }
        if (applied) {
          draggingEl.setAttribute('data-openlen-drag-bg-applied', '');
        }
      }
    } catch (_) {}
    // Marker so postClean knows which element to strip inline styles
    // from in the serialized HTML clone — our lifted-card styles must
    // never leak to disk.
    draggingEl.setAttribute('data-openlen-dragging', '1');
    // Snapshot original geometry as DOCUMENT-relative coords (rect.top
    // already viewport-rel, add scrollY). Live-preview math then survives
    // auto-scroll — midpoints stay valid even as the user scrolls past
    // the originally-visible sections.
    var originScrollAtSnapshot = window.scrollY;
    dragStartRects = draggables.map(function (el) {
      var r = el.getBoundingClientRect();
      return { top: r.top + originScrollAtSnapshot, height: r.height };
    });
    draggedHeight = draggingEl.getBoundingClientRect().height;
    lastPredictedIdx = draggables.indexOf(draggingEl);
    dragOriginY = startY;
    dragOriginScroll = originScrollAtSnapshot;
    // Coordination signal — the Replace script reads this and suppresses
    // its hover button while we're dragging. The CSS gated on this attr
    // also disables text selection + sets cursor: grabbing globally.
    document.body.setAttribute('data-openlen-drag-active', '');
    // Clear any stale text selection so the user doesn't see leftover
    // highlights from clicks before the drag started.
    try {
      var sel = window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (_) {}
    // Capture the pointer on body so events keep flowing even if the user
    // drags past the iframe edges or over elements with their own pointer
    // handlers. Released in resetPointer.
    try {
      if (document.body.setPointerCapture && activePointerId !== null) {
        document.body.setPointerCapture(activePointerId);
      }
    } catch (_) {}
    // Subtle haptic confirms the drag has armed (touch only — mouse users
    // already see the visual opacity change).
    if (activePointerType === 'touch' && navigator.vibrate) {
      try { navigator.vibrate(20); } catch (_) {}
    }
  }

  // Maps a predicted index (from computePredictedIndex) to an {el, before}
  // descriptor — the element to position the drop indicator relative to,
  // AND the spot to insertBefore() during the DOM mutation. Returns null
  // when predicted === dragIdx (no swap).
  function predictedToTarget(predicted) {
    if (predicted < 0) return null;
    var dragIdx = draggables.indexOf(draggingEl);
    if (predicted === dragIdx) return null;
    if (predicted < dragIdx) {
      // Dragged lands BEFORE the target at the predicted original index.
      return { el: draggables[predicted], before: true };
    }
    // predicted > dragIdx — dragged lands AFTER the target at that
    // index. For DOM insertBefore, that means inserting before the
    // element at predicted+1 (or appendChild if predicted is last).
    if (predicted + 1 < draggables.length) {
      return { el: draggables[predicted + 1], before: true };
    }
    return { el: draggables[predicted], before: false };
  }

  function getDropTarget(clientY) {
    var predicted = computePredictedIndex(clientY);
    return predictedToTarget(predicted);
  }

  // Where the dragged section WOULD land in the array if dropped now.
  //
  // Uses the DRAGGED SECTION'S EDGES (not the cursor) as the indicator —
  // bottom edge when dragging down, top edge when dragging up. This way,
  // swap fires as soon as the dragged section visually overlaps a
  // target's midpoint, regardless of how large or small the dragged or
  // the target are. Critical when dragging a big section into a small
  // one — cursor would need to traverse the entire big section before
  // crossing the small target's midpoint, which felt broken.
  function computePredictedIndex(clientY) {
    if (!dragStartRects) return -1;
    var dragIdx = draggables.indexOf(draggingEl);
    if (dragIdx < 0) return -1;
    var totalDelta = (clientY - dragOriginY) + (window.scrollY - dragOriginScroll);
    var dragRect = dragStartRects[dragIdx];
    var draggedTopDoc = dragRect.top + totalDelta;
    var draggedBottomDoc = dragRect.top + dragRect.height + totalDelta;

    var predicted = dragIdx;

    // Drag DOWN: walk targets below original position. As long as the
    // dragged's BOTTOM edge has crossed a target's midpoint, dragged
    // lands at or after that target.
    for (var i = dragIdx + 1; i < dragStartRects.length; i++) {
      var r = dragStartRects[i];
      var mid = r.top + r.height / 2;
      if (draggedBottomDoc > mid) {
        predicted = i;
      } else {
        break;
      }
    }

    // Drag UP: walk targets above original. Dragged's TOP edge crossing
    // target's midpoint commits the swap above that target.
    for (var j = dragIdx - 1; j >= 0; j--) {
      var r2 = dragStartRects[j];
      var mid2 = r2.top + r2.height / 2;
      if (draggedTopDoc < mid2) {
        predicted = j;
      } else {
        break;
      }
    }

    return predicted;
  }

  // Apply translateY transforms to "make room" for the dragged element at
  // its predicted index — purely visual, no DOM mutation. Each pointermove
  // calls this; the CSS transition smooths each shift.
  function applyDragShifts(predictedIdx) {
    if (predictedIdx < 0 || !draggingEl) return;
    if (predictedIdx === lastPredictedIdx) return;
    lastPredictedIdx = predictedIdx;
    var dragIdx = draggables.indexOf(draggingEl);
    if (dragIdx < 0) return;
    for (var i = 0; i < draggables.length; i++) {
      var el = draggables[i];
      if (el === draggingEl) continue;
      var shift = 0;
      if (predictedIdx > dragIdx && i > dragIdx && i <= predictedIdx) {
        // Dragging down past elements between original and predicted —
        // they shift up to fill the gap left by the dragged element.
        shift = -draggedHeight;
      } else if (predictedIdx < dragIdx && i < dragIdx && i >= predictedIdx) {
        // Dragging up past elements between predicted and original —
        // they shift down to make room above.
        shift = draggedHeight;
      }
      el.style.transition = 'transform 160ms cubic-bezier(0.2, 0.85, 0.3, 1)';
      el.style.transform = shift !== 0 ? 'translateY(' + shift + 'px)' : 'translateY(0)';
    }
  }

  // Smooth-clear live-shift transforms (used on cancel / invalid drop).
  function animateClearShifts() {
    draggables.forEach(function (el) {
      if (el === draggingEl) return;
      if (el.style.transform && el.style.transform !== 'translateY(0px)') {
        el.style.transition = 'transform 180ms ease-out';
        el.style.transform = 'translateY(0)';
        setTimeout(function () {
          if (!el.isConnected) return;
          el.style.transition = '';
          el.style.transform = '';
        }, 220);
      }
    });
  }

  // Apply the cursor-follow translateY to the dragged section. Called on
  // every pointermove AND every auto-scroll tick — must be instant (no
  // transition) so the section glues to the finger.
  //
  // The formula combines (a) cursor delta in viewport space + (b) scroll
  // delta. Without (b), auto-scroll would slide the document underneath
  // the section while translateY stayed the same, making the section
  // appear to "jump up" toward the top of the viewport.
  function applyDraggedFollow(clientY) {
    if (!draggingEl) return;
    var dy =
      (clientY - dragOriginY) + (window.scrollY - dragOriginScroll);
    draggingEl.style.transition = 'none';
    draggingEl.style.transform = 'translateY(' + dy + 'px)';
  }

  // Reset the lifted-card styles on the dragged element. Safe to call
  // multiple times. Doesn't touch transform — caller decides whether to
  // animate a return or clear instantly.
  function clearDraggedStyles(el) {
    if (!el) return;
    el.style.opacity = '';
    el.style.boxShadow = '';
    el.style.zIndex = '';
    el.style.position = '';
    // Restore the section's original (transparent or templated) bg only
    // if WE applied an override — never clobber a template-author's bg.
    if (el.hasAttribute && el.hasAttribute('data-openlen-drag-bg-applied')) {
      el.style.backgroundColor = '';
      el.style.backgroundImage = '';
      el.style.backgroundSize = '';
      el.style.backgroundPosition = '';
      el.style.backgroundRepeat = '';
      el.removeAttribute('data-openlen-drag-bg-applied');
    }
    if (el.removeAttribute) el.removeAttribute('data-openlen-dragging');
  }

  // Cancel-path animation: ease the dragged section back to its slot
  // (translateY 0) and fade out the lifted look, then strip all the
  // inline styles. Used by pointercancel + drop-on-self.
  function animateDraggedBack(el) {
    if (!el) return;
    var hasTransform =
      el.style.transform && el.style.transform !== 'translateY(0px)' && el.style.transform !== '';
    if (hasTransform) {
      el.style.transition = 'transform 200ms ease-out, opacity 200ms ease-out, box-shadow 200ms ease-out';
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
      el.style.boxShadow = '0 0 0 rgba(0,0,0,0)';
      setTimeout(function () {
        if (!el.isConnected) return;
        el.style.transition = '';
        el.style.transform = '';
        clearDraggedStyles(el);
      }, 220);
    } else {
      clearDraggedStyles(el);
    }
  }

  function updateDropIndicator(clientY) {
    if (!dropIndicator) return;
    var t = getDropTarget(clientY);
    if (!t) {
      dropIndicator.classList.remove('visible');
      return;
    }
    var r = t.el.getBoundingClientRect();
    var topY = (t.before ? r.top : r.bottom) + window.scrollY;
    dropIndicator.classList.add('visible');
    dropIndicator.style.top = (topY - 1) + 'px';
    dropIndicator.style.left = (r.left + window.scrollX) + 'px';
    dropIndicator.style.width = r.width + 'px';
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var target = findHandleTarget(e.target);
    if (!target) return;
    armedEl = target;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType || 'mouse';
    startX = e.clientX;
    startY = e.clientY;
    pointerState = 'armed';
    if (activePointerType === 'touch') {
      // On touch, require a long-press to disambiguate from scroll. If the
      // user moves more than DRAG_THRESHOLD_TOUCH before the timer fires,
      // we treat the gesture as a scroll and bail.
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        if (pointerState === 'armed') beginDrag();
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e) {
    if (e.pointerId !== activePointerId) return;
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    var moved = Math.max(Math.abs(dx), Math.abs(dy));

    if (pointerState === 'armed') {
      if (activePointerType === 'touch') {
        // Pre-long-press touch movement = scroll intent → cancel.
        if (moved > DRAG_THRESHOLD_TOUCH) resetPointer();
        return;
      }
      // Mouse / pen: any movement past threshold starts the drag.
      if (moved > DRAG_THRESHOLD_MOUSE) beginDrag();
      if (pointerState !== 'dragging') return;
    }

    if (pointerState !== 'dragging') return;
    // While dragging, suppress native scroll / text-selection so the drag
    // feels solid. Listener must be registered { passive: false }.
    e.preventDefault();
    lastPointerClientY = e.clientY;
    updateDropIndicator(e.clientY);

    // Dragged section follows the finger — translateY by the cursor
    // delta from the moment the drag began. Instant (no transition) so
    // it feels physically attached to the pointer.
    applyDraggedFollow(e.clientY);

    // Live reorder preview — shift other sections to show where the
    // dragged section would land. Cheap (just transform updates), only
    // mutates when the prediction actually changes.
    var predicted = computePredictedIndex(e.clientY);
    applyDragShifts(predicted);

    // Auto-scroll: cursor in the top/bottom AUTO_SCROLL_ZONE pixels of the
    // viewport triggers a RAF loop that scrolls the iframe continuously
    // until the cursor leaves the zone or the drag ends.
    var vh = window.innerHeight;
    var newDir = 0;
    if (e.clientY < AUTO_SCROLL_ZONE) newDir = -1;
    else if (e.clientY > vh - AUTO_SCROLL_ZONE) newDir = 1;
    if (newDir !== autoScrollDirection) {
      autoScrollDirection = newDir;
      if (newDir !== 0) startAutoScroll();
      else stopAutoScroll();
    }
  }

  function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    if (pointerState === 'armed') {
      resetPointer();
      return;
    }
    if (pointerState !== 'dragging' || !draggingEl) {
      endDrag();
      resetPointer();
      return;
    }
    performDrop(e.clientY);
    resetPointer();
  }

  function onPointerCancel(e) {
    if (e.pointerId !== activePointerId) return;
    var el = draggingEl;
    animateClearShifts();
    if (el) animateDraggedBack(el);
    endDrag();
    resetPointer();
  }

  function performDrop(clientY) {
    if (!draggingEl) return;
    var t = getDropTarget(clientY);
    if (!t || t.el === draggingEl) {
      // No swap — animate the live shifts back to zero AND ease the
      // dragged section back to its slot, then end.
      var el = draggingEl;
      animateClearShifts();
      animateDraggedBack(el);
      endDrag();
      return;
    }
    var parent = draggingEl.parentNode;
    if (!parent) {
      var el2 = draggingEl;
      animateClearShifts();
      animateDraggedBack(el2);
      endDrag();
      return;
    }

    // FLIP — First. Snapshot CURRENT visual positions (with live drag-
    // shifts applied) so the post-mutation animation starts from the
    // exact layout the user was looking at when they let go.
    var animEls = draggables.slice();
    var firstRects = animEls.map(function (el) { return el.getBoundingClientRect(); });

    // Clear live-shift transforms before DOM mutation — otherwise the
    // post-mutation rect measurement would include the stale offsets
    // and the FLIP math goes wrong.
    animEls.forEach(function (el) {
      el.style.transition = 'none';
      el.style.transform = '';
    });

    // Mutate.
    if (t.before) {
      parent.insertBefore(draggingEl, t.el);
    } else if (t.el.nextSibling) {
      parent.insertBefore(draggingEl, t.el.nextSibling);
    } else {
      parent.appendChild(draggingEl);
    }

    endDrag();

    // Post the new HTML NOW — DOM has the new order, no transforms applied
    // yet, so serialization is clean. The FLIP that follows is purely
    // cosmetic; the save can fire in parallel.
    postClean();

    // Last + Invert.
    var hasAnim = false;
    for (var i = 0; i < animEls.length; i++) {
      var el = animEls[i];
      var f = firstRects[i];
      var l = el.getBoundingClientRect();
      var dy = f.top - l.top;
      var dx = f.left - l.left;
      if (Math.abs(dy) < 0.5 && Math.abs(dx) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      hasAnim = true;
    }

    if (!hasAnim) {
      refreshDraggables();
      return;
    }

    // Force reflow so the inverse transform "takes" before we transition.
    void document.body.offsetWidth;

    // Play — clear transforms with an easing transition.
    requestAnimationFrame(function () {
      for (var j = 0; j < animEls.length; j++) {
        var elJ = animEls[j];
        if (elJ.style.transform) {
          elJ.style.transition = 'transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)';
          elJ.style.transform = 'translate(0,0)';
        }
      }
    });

    // After the animation: clear inline styles, strip the lifted-card
    // look from whichever element was being dragged, and reposition
    // handles for the new layout.
    setTimeout(function () {
      for (var k = 0; k < animEls.length; k++) {
        if (animEls[k].isConnected) {
          animEls[k].style.transition = '';
          animEls[k].style.transform = '';
          // Belt-and-suspenders: any of these might be set on the dragged
          // element. Clearing on every animEl is a no-op for non-dragged.
          clearDraggedStyles(animEls[k]);
        }
      }
      refreshDraggables();
    }, 320);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    try {
      window.parent.postMessage({ type: 'openlen:reorder-cancelled' }, '*');
    } catch (_) {}
  }

  function postClean() {
    var clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-openlen-reorder]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[data-openlen-reorder-index]').forEach(function (n) {
      n.removeAttribute('data-openlen-reorder-index');
    });
    clone.querySelectorAll('[data-openlen-hovering]').forEach(function (n) {
      n.removeAttribute('data-openlen-hovering');
    });
    // The dragged element still has the lifted-card inline styles at
    // postClean time (the FLIP cleanup setTimeout runs ~320ms later).
    // Strip them from the clone so the saved HTML stays pristine.
    clone.querySelectorAll('[data-openlen-dragging]').forEach(function (n) {
      n.style.opacity = '';
      n.style.boxShadow = '';
      n.style.zIndex = '';
      n.style.position = '';
      n.style.transform = '';
      n.style.transition = '';
      if (n.hasAttribute('data-openlen-drag-bg-applied')) {
        n.style.backgroundColor = '';
        n.style.backgroundImage = '';
        n.style.backgroundSize = '';
        n.style.backgroundPosition = '';
        n.style.backgroundRepeat = '';
        n.removeAttribute('data-openlen-drag-bg-applied');
      }
      n.removeAttribute('data-openlen-dragging');
    });
    var cloneBody = clone.querySelector('body');
    if (cloneBody) {
      cloneBody.removeAttribute('data-openlen-drag-active');
    }
    try {
      window.parent.postMessage(
        {
          type: 'openlen:html-changed',
          outerHtml: '<!doctype html>\\n' + clone.outerHTML,
          source: 'reorder',
        },
        '*'
      );
    } catch (_) {}
  }

  function setup() {
    contentRoot = findContentRoot();
    if (!contentRoot) return;

    dropIndicator = document.createElement('div');
    dropIndicator.setAttribute('data-openlen-reorder', 'indicator');
    dropIndicator.className = 'openlen-reorder-indicator';
    document.body.appendChild(dropIndicator);

    refreshDraggables();

    // Pointer events instead of HTML5 drag-drop — works on mouse, touch,
    // and pen with one code path. pointermove must be { passive: false }
    // so we can preventDefault to stop the browser from auto-scrolling
    // while the user is mid-drag.
    // Editor V3 — gate all interaction handlers on body[data-openlen-edit-mode].
    // The listeners stay registered permanently (persistent iframe pattern);
    // when edit mode is off they early-return and no drag UI / state changes.
    // repositionHandles is layout-only and runs always so handles don't
    // drift after a viewport resize.
    function gated(fn) {
      return function (e) {
        if (!document.body || !document.body.hasAttribute('data-openlen-edit-mode')) return;
        return fn(e);
      };
    }
    document.addEventListener('pointerdown', gated(onPointerDown), true);
    document.addEventListener('pointermove', gated(onPointerMove), { capture: true, passive: false });
    document.addEventListener('pointerup', gated(onPointerUp), true);
    document.addEventListener('pointercancel', gated(onPointerCancel), true);
    document.addEventListener('keydown', gated(onKey), true);
    document.addEventListener('mousemove', gated(onGlobalMouseMove), true);
    window.addEventListener('resize', repositionHandles);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
`;

const INJECTION = `<style data-openlen-reorder>${REORDER_STYLE}</style><script data-openlen-reorder>${REORDER_SCRIPT}</script>`;

/** Returns the HTML with reorder instrumentation appended just before
 *  `</body>`. Caller is responsible for only invoking this when the
 *  toggle is on. The injected style/script carry `data-openlen-reorder`
 *  markers so the script can strip them before posting clean HTML. */
export function injectSectionReorder(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
