// Click-to-select + double-click-to-edit + drag-to-reorder + resize-handle
// + shift-click multi-select injection for model-backed (Canva-mode) projects.
//
// One tiny script:
//
//   - mousemove sets a hover outline on the nearest [data-ol-id]
//   - click (no modifier) replaces selection with one node
//   - click (shift / cmd / ctrl) toggles that node in the multi-selection
//   - dblclick on a Text-leaf flips it to contentEditable=plaintext-only
//   - mousedown + drag (>5px) on any [data-ol-id] starts a drag-to-reorder.
//     Drop intent is decided by vertical thirds over the target:
//       top    → 'before' (sibling above)
//       bottom → 'after'  (sibling below)
//       middle → 'inside' if the target is a container (data-ol-container),
//                 else 'after'. Cross-parent is allowed; the source's own
//                 subtree is blocked. Sibling drops show a line, nest drops
//                 show a filled outline.
//   - A bottom-right resize handle floats over the selected element (only
//     when exactly ONE node is selected — group-resize comes later)
//   - mousedown + drag from the root background (or Alt+drag anywhere) draws
//     a marquee. On release, every data-ol-id element FULLY CONTAINED by the
//     rect is selected — filtered to the topmost matches so picking a section
//     doesn't also grab its children. Shift held during marquee adds to the
//     existing selection instead of replacing it.
//
// Resolves selection via the compiler's stable node IDs (data-ol-id) — the
// Document is the source of truth, so the parent can map ids → Nodes
// directly instead of walking CSS breadcrumbs.
//
// Parent contract (postMessage):
//   OUT { type: "openlen:model-select",    ids: string[] }     -- length 0/1/N
//   OUT { type: "openlen:model-text-edit", id, text }
//   OUT { type: "openlen:model-reorder",   id, toParentId, toIndex }
//   OUT { type: "openlen:model-resize",    id, width, height }
//   OUT { type: "openlen:model-duplicate" }                    -- ⌘D / Ctrl+D
//   OUT { type: "openlen:model-delete" }                       -- Del / Backspace
//   OUT { type: "openlen:model-action", action: string }       -- context menu
//   OUT { type: "openlen:model-undo", redo: boolean }          -- ⌘Z / ⌘⇧Z
//   OUT { type: "openlen:library-drop", payload, toParentId, toIndex }
//   IN  { type: "openlen:model-scroll-to", id }                -- center node
//   IN  { type: "openlen:model-set-selected", ids: string[] }  -- also accepts
//                                                                 { id } for
//                                                                 backcompat

const STYLE = `
[data-ol-selected] {
  outline: 2px solid rgba(255,90,54,0.95) !important;
  outline-offset: -2px !important;
}
[data-ol-hover]:not([data-ol-selected]):not([data-ol-editing]):not([data-ol-dragging]) {
  outline: 2px solid rgba(255,90,54,0.4) !important;
  outline-offset: -2px !important;
}
[data-ol-editing] {
  outline: 2px solid rgba(0,140,255,0.9) !important;
  outline-offset: -2px !important;
  cursor: text !important;
  caret-color: rgba(0,140,255,1) !important;
}
[data-ol-editing] * { pointer-events: none; }
[data-ol-dragging] {
  opacity: 0.5 !important;
  cursor: grabbing !important;
}
body.ol-dragging, body.ol-dragging * {
  cursor: grabbing !important;
  user-select: none !important;
}
body.ol-resizing, body.ol-resizing * {
  cursor: nwse-resize !important;
  user-select: none !important;
}
body.ol-marqueeing, body.ol-marqueeing * {
  cursor: crosshair !important;
  user-select: none !important;
}
`;

const SCRIPT = `
(function () {
  var SKIP = {HTML:1,HEAD:1,BODY:1,SCRIPT:1,STYLE:1,LINK:1,META:1,TITLE:1,NOSCRIPT:1,TEMPLATE:1};
  var DRAG_THRESHOLD = 5; // px
  var hovered = null;
  var selectedIds = [];
  var editing = null;
  var editingOriginal = '';
  var pendingDrag = null;
  var dragging = null;         // { el }
  var dropTarget = null;       // element the cursor is over (any data-ol-id)
  var dropIntent = 'after';    // 'before' | 'after' | 'inside'
  var resizing = null;
  var suppressNextClick = false;
  var resizeHandle = null;
  var dropIndicator = null;    // line (before/after)
  var boxIndicator = null;     // outline (inside, nest)
  var pendingMarquee = null;   // { startX, startY, addToExisting }
  var marquee = null;          // armed once threshold is passed
  var marqueeBox = null;       // visible rect div
  var contextMenu = null;      // floating right-click menu (lazy)
  var snapGuideV = null;       // vertical alignment line during resize
  var snapGuideH = null;       // horizontal alignment line during resize

  function withId(el) {
    if (!el || !el.closest) return null;
    // Locked elements are inert in the iframe (Layers panel is the bypass).
    if (el.closest('[data-ol-locked]')) return null;
    return el.closest('[data-ol-id]') || null;
  }
  function cssEscape(id) { return id.replace(/"/g, '\\\\"'); }

  function setHover(el) {
    if (hovered && hovered !== el) hovered.removeAttribute('data-ol-hover');
    hovered = el;
    if (hovered && selectedIds.indexOf(hovered.getAttribute('data-ol-id')) < 0) {
      hovered.setAttribute('data-ol-hover', '');
    }
  }

  function clearSelection() {
    var marked = document.querySelectorAll('[data-ol-selected]');
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute('data-ol-selected');
    selectedIds = [];
  }

  function markId(id) {
    var el = document.querySelector('[data-ol-id="' + cssEscape(id) + '"]');
    if (el) {
      el.setAttribute('data-ol-selected', '');
      el.removeAttribute('data-ol-hover');
    }
  }

  function setSelection(ids) {
    clearSelection();
    selectedIds = ids.slice();
    for (var i = 0; i < ids.length; i++) markId(ids[i]);
  }

  function toggleSelection(id) {
    var idx = selectedIds.indexOf(id);
    if (idx >= 0) {
      selectedIds.splice(idx, 1);
      var el = document.querySelector('[data-ol-id="' + cssEscape(id) + '"]');
      if (el) el.removeAttribute('data-ol-selected');
    } else {
      selectedIds.push(id);
      markId(id);
    }
  }

  function postSelection() {
    try {
      window.parent.postMessage({ type: 'openlen:model-select', ids: selectedIds.slice() }, '*');
    } catch (_) {}
  }

  function isTextLeaf(el) {
    if (!el) return false;
    return !el.querySelector('[data-ol-id]');
  }
  function placeCaretAtEnd(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  // ── EDIT ─────────────────────────────────────────────────────────────
  function startEdit(el) {
    if (editing === el) return;
    if (editing) commitEdit();
    editing = el;
    editingOriginal = el.textContent || '';
    el.setAttribute('data-ol-editing', '');
    el.setAttribute('contenteditable', 'plaintext-only');
    el.removeAttribute('data-ol-hover');
    el.focus();
    placeCaretAtEnd(el);
  }
  function commitEdit() {
    if (!editing) return;
    var el = editing;
    var id = el.getAttribute('data-ol-id');
    var text = el.textContent || '';
    editing = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-ol-editing');
    if (id && text !== editingOriginal) {
      try {
        window.parent.postMessage({ type: 'openlen:model-text-edit', id: id, text: text }, '*');
      } catch (_) {}
    }
    editingOriginal = '';
  }
  function cancelEdit() {
    if (!editing) return;
    var el = editing;
    el.textContent = editingOriginal;
    editing = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-ol-editing');
    editingOriginal = '';
    el.blur();
  }

  // ── DRAG TO REORDER ──────────────────────────────────────────────────
  function siblingsOf(parentEl) {
    if (!parentEl) return [];
    var out = [];
    var all = parentEl.querySelectorAll('[data-ol-id]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var p = el.parentElement && el.parentElement.closest('[data-ol-id]');
      if (p === parentEl) out.push(el);
    }
    return out;
  }
  function isContainerEl(el) {
    return !!el && el.hasAttribute && el.hasAttribute('data-ol-container');
  }
  function parentDataEl(el) {
    return el && el.parentElement && el.parentElement.closest('[data-ol-id]');
  }
  // Cross-parent drop planner. Returns null if the cursor isn't over a valid
  // target — same-source, source's own subtree, or a non-data-ol-id area.
  // Otherwise classifies into 3 vertical zones:
  //   top-third    → 'before' (sibling above)
  //   bottom-third → 'after'  (sibling below)
  //   middle-third → 'inside' if target is a container, else 'after'
  // Hitting the root with intent !== 'inside' is coerced to inside, since the
  // root can't have siblings.
  function findDropPlan(point, sourceEl) {
    var el = document.elementFromPoint(point.x, point.y);
    if (!el || !el.closest) return null;
    var t = el.closest('[data-ol-id]');
    if (!t || t === sourceEl) return null;
    if (sourceEl.contains(t)) return null; // can't nest into own subtree
    var rect = t.getBoundingClientRect();
    var top3 = rect.top + rect.height / 3;
    var bot3 = rect.bottom - rect.height / 3;
    var intent;
    if (point.y < top3) intent = 'before';
    else if (point.y > bot3) intent = 'after';
    else intent = isContainerEl(t) ? 'inside' : 'after';
    // No parent → can't be a sibling; coerce to inside or reject.
    if (intent !== 'inside' && !parentDataEl(t)) {
      if (isContainerEl(t)) intent = 'inside';
      else return null;
    }
    return { target: t, intent: intent };
  }
  function ensureDropIndicator() {
    if (dropIndicator) return dropIndicator;
    var d = document.createElement('div');
    d.setAttribute('data-ol-drop-indicator', '');
    d.style.cssText = 'position:absolute;height:2px;background:rgba(0,140,255,1);box-shadow:0 0 0 1px rgba(0,140,255,0.3);z-index:2147483646;pointer-events:none;display:none;';
    document.body.appendChild(d);
    dropIndicator = d;
    return d;
  }
  function ensureBoxIndicator() {
    if (boxIndicator) return boxIndicator;
    var b = document.createElement('div');
    b.setAttribute('data-ol-box-indicator', '');
    b.style.cssText = 'position:absolute;border:2px solid rgba(0,140,255,0.9);background:rgba(0,140,255,0.08);box-shadow:0 0 0 1px rgba(0,140,255,0.3) inset;z-index:2147483646;pointer-events:none;display:none;border-radius:4px;';
    document.body.appendChild(b);
    boxIndicator = b;
    return b;
  }
  function showLineIndicator(target, after) {
    var d = ensureDropIndicator();
    var rect = target.getBoundingClientRect();
    d.style.left = (rect.left + window.scrollX) + 'px';
    d.style.width = rect.width + 'px';
    d.style.top = (after ? (rect.bottom + window.scrollY - 1) : (rect.top + window.scrollY - 1)) + 'px';
    d.style.display = 'block';
  }
  function showBoxIndicator(target) {
    var b = ensureBoxIndicator();
    var rect = target.getBoundingClientRect();
    b.style.left = (rect.left + window.scrollX) + 'px';
    b.style.top = (rect.top + window.scrollY) + 'px';
    b.style.width = rect.width + 'px';
    b.style.height = rect.height + 'px';
    b.style.display = 'block';
  }
  function showDropIndicator(target, intent) {
    if (intent === 'inside') {
      if (dropIndicator) dropIndicator.style.display = 'none';
      showBoxIndicator(target);
    } else {
      if (boxIndicator) boxIndicator.style.display = 'none';
      showLineIndicator(target, intent === 'after');
    }
  }
  function hideDropIndicator() {
    if (dropIndicator) dropIndicator.style.display = 'none';
    if (boxIndicator) boxIndicator.style.display = 'none';
  }
  function endDrag(commit) {
    if (!dragging) return;
    var fromEl = dragging.el;
    fromEl.removeAttribute('data-ol-dragging');
    document.body.classList.remove('ol-dragging');
    hideDropIndicator();
    if (commit && dropTarget) {
      var srcId = fromEl.getAttribute('data-ol-id');
      var targetEl = dropTarget;
      var targetId = targetEl.getAttribute('data-ol-id');
      var toParentId, toIndex;
      if (dropIntent === 'inside') {
        toParentId = targetId;
        toIndex = siblingsOf(targetEl).length;
      } else {
        var tParent = parentDataEl(targetEl);
        if (tParent) {
          toParentId = tParent.getAttribute('data-ol-id');
          var sibs = siblingsOf(tParent);
          var tIdx = sibs.indexOf(targetEl);
          if (tIdx < 0) { dragging = null; dropTarget = null; pendingDrag = null; return; }
          toIndex = dropIntent === 'after' ? tIdx + 1 : tIdx;
        } else {
          dragging = null; dropTarget = null; pendingDrag = null; return;
        }
      }
      // editMove's toIndex is after-detach. Same-parent + source-before-target
      // shifts the slot left by 1; same-parent + same index = no-op.
      var fromParent = parentDataEl(fromEl);
      if (fromParent && fromParent.getAttribute('data-ol-id') === toParentId) {
        var fromSibs = siblingsOf(fromParent);
        var fromIdx = fromSibs.indexOf(fromEl);
        if (fromIdx >= 0 && fromIdx < toIndex) toIndex -= 1;
        if (fromIdx === toIndex) {
          dragging = null; dropTarget = null; pendingDrag = null; return;
        }
      }
      try {
        window.parent.postMessage({
          type: 'openlen:model-reorder',
          id: srcId,
          toParentId: toParentId,
          toIndex: toIndex
        }, '*');
      } catch (_) {}
    }
    dragging = null;
    dropTarget = null;
    pendingDrag = null;
  }

  // ── RESIZE HANDLE ────────────────────────────────────────────────────
  function ensureResizeHandle() {
    if (resizeHandle) return resizeHandle;
    var h = document.createElement('div');
    h.setAttribute('data-ol-resize-handle', '');
    h.style.cssText = 'position:absolute;width:12px;height:12px;background:rgba(255,90,54,1);border:2px solid white;border-radius:3px;cursor:nwse-resize;z-index:2147483646;pointer-events:auto;display:none;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
    document.body.appendChild(h);
    resizeHandle = h;
    h.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIds.length !== 1) return;
      var sel = document.querySelector('[data-ol-selected]');
      if (!sel) return;
      var rect = sel.getBoundingClientRect();
      resizing = {
        el: sel,
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height
      };
      document.body.classList.add('ol-resizing');
    });
    return h;
  }
  function updateResizeHandle() {
    if (resizing || dragging || editing) return;
    if (selectedIds.length !== 1) {
      if (resizeHandle) resizeHandle.style.display = 'none';
      return;
    }
    var sel = document.querySelector('[data-ol-selected]');
    if (!sel) {
      if (resizeHandle) resizeHandle.style.display = 'none';
      return;
    }
    var h = ensureResizeHandle();
    var rect = sel.getBoundingClientRect();
    h.style.left = (rect.right + window.scrollX - 6) + 'px';
    h.style.top = (rect.bottom + window.scrollY - 6) + 'px';
    h.style.display = 'block';
  }

  // ── MARQUEE SELECT ───────────────────────────────────────────────────
  function ensureMarqueeBox() {
    if (marqueeBox) return marqueeBox;
    var b = document.createElement('div');
    b.setAttribute('data-ol-marquee', '');
    b.style.cssText = 'position:absolute;background:rgba(0,140,255,0.12);border:1px solid rgba(0,140,255,0.6);z-index:2147483646;pointer-events:none;display:none;';
    document.body.appendChild(b);
    marqueeBox = b;
    return b;
  }
  function showMarqueeBox(left, top, w, h) {
    var b = ensureMarqueeBox();
    b.style.left = (left + window.scrollX) + 'px';
    b.style.top = (top + window.scrollY) + 'px';
    b.style.width = w + 'px';
    b.style.height = h + 'px';
    b.style.display = 'block';
  }
  function hideMarqueeBox() {
    if (marqueeBox) marqueeBox.style.display = 'none';
  }
  function isRootEl(el) {
    if (!el) return false;
    return !(el.parentElement && el.parentElement.closest('[data-ol-id]'));
  }
  function rectInside(inner, outer) {
    return inner.left >= outer.left &&
           inner.right <= outer.right &&
           inner.top >= outer.top &&
           inner.bottom <= outer.bottom;
  }
  // "Fully contained" + topmost filter (drop any element whose ancestor is
  // also matched). Root is always excluded — selecting the whole page from
  // a marquee is never the user intent.
  function computeMarqueeMatches(rect) {
    var all = document.querySelectorAll('[data-ol-id]');
    var contained = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isRootEl(el)) continue;
      if (rectInside(el.getBoundingClientRect(), rect)) contained.push(el);
    }
    var set = new Set ? new Set(contained) : null;
    var out = [];
    for (var j = 0; j < contained.length; j++) {
      var el2 = contained[j];
      var anc = el2.parentElement && el2.parentElement.closest('[data-ol-id]');
      var hasAncMatch = false;
      while (anc) {
        if (set ? set.has(anc) : contained.indexOf(anc) >= 0) { hasAncMatch = true; break; }
        anc = anc.parentElement && anc.parentElement.closest('[data-ol-id]');
      }
      if (!hasAncMatch) out.push(el2.getAttribute('data-ol-id'));
    }
    return out;
  }

  // ── SNAP GUIDES (resize) ─────────────────────────────────────────────
  // Webflow-style guides only during SE resize. Drag-to-reorder skips this:
  // the source stays in place during the drag (only opacity drops); the
  // existing drop indicator already conveys the insertion point, so snap
  // guides would just clutter.
  var SNAP_THRESHOLD = 4;
  function ensureSnapGuide(orientation) {
    var ref = orientation === 'v' ? snapGuideV : snapGuideH;
    if (ref) return ref;
    var g = document.createElement('div');
    g.setAttribute('data-ol-snap-guide', orientation);
    g.style.cssText = 'position:absolute;background:rgba(255,90,54,0.95);z-index:2147483646;pointer-events:none;display:none;';
    document.body.appendChild(g);
    if (orientation === 'v') snapGuideV = g;
    else snapGuideH = g;
    return g;
  }
  function showSnapGuideV(x) {
    var g = ensureSnapGuide('v');
    g.style.left = (x + window.scrollX) + 'px';
    g.style.top = '0px';
    g.style.width = '1px';
    g.style.height = document.documentElement.scrollHeight + 'px';
    g.style.display = 'block';
  }
  function showSnapGuideH(y) {
    var g = ensureSnapGuide('h');
    g.style.left = '0px';
    g.style.top = (y + window.scrollY) + 'px';
    g.style.width = document.documentElement.scrollWidth + 'px';
    g.style.height = '1px';
    g.style.display = 'block';
  }
  function hideSnapGuides() {
    if (snapGuideV) snapGuideV.style.display = 'none';
    if (snapGuideH) snapGuideH.style.display = 'none';
  }
  function collectSnapEdges(self) {
    var x = [];
    var y = [];
    var parent = self.parentElement && self.parentElement.closest('[data-ol-id]');
    if (parent) {
      var pr = parent.getBoundingClientRect();
      x.push(pr.left, pr.left + pr.width / 2, pr.right);
      y.push(pr.top, pr.top + pr.height / 2, pr.bottom);
      var sibs = siblingsOf(parent);
      for (var i = 0; i < sibs.length; i++) {
        if (sibs[i] === self) continue;
        var sr = sibs[i].getBoundingClientRect();
        x.push(sr.left, sr.left + sr.width / 2, sr.right);
        y.push(sr.top, sr.top + sr.height / 2, sr.bottom);
      }
    }
    return { x: x, y: y };
  }

  // ── CONTEXT MENU (right-click) ───────────────────────────────────────
  function ensureContextMenu() {
    if (contextMenu) return contextMenu;
    var m = document.createElement('div');
    m.setAttribute('data-ol-context-menu', '');
    m.style.cssText = 'position:absolute;min-width:180px;z-index:2147483647;background:#fff;color:#111;border:1px solid rgba(0,0,0,0.12);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:4px 0;font:12px system-ui,-apple-system,sans-serif;display:none;user-select:none;';
    document.body.appendChild(m);
    contextMenu = m;
    return m;
  }
  function hideContextMenu() {
    if (contextMenu) contextMenu.style.display = 'none';
  }
  function buildMenuItems() {
    var items = [];
    var n = selectedIds.length;
    if (n === 0) return items;
    var hasRoot = false;
    var soleEl = null;
    for (var i = 0; i < selectedIds.length; i++) {
      var el = document.querySelector('[data-ol-id="' + cssEscape(selectedIds[i]) + '"]');
      if (el && !parentDataEl(el)) hasRoot = true;
      if (n === 1) soleEl = el;
    }
    if (!hasRoot) {
      items.push({ label: 'Duplicar', shortcut: '⌘D', action: 'duplicate' });
      items.push({ label: 'Borrar', shortcut: 'Supr', action: 'delete' });
      items.push({ divider: true });
    }
    if (n === 1 && !hasRoot && soleEl) {
      items.push({ label: 'Subir', action: 'moveUp' });
      items.push({ label: 'Bajar', action: 'moveDown' });
      items.push({ divider: true });
      items.push({ label: 'Envolver en caja', action: 'wrap' });
      if (isContainerEl(soleEl) && soleEl.querySelector('[data-ol-id]')) {
        items.push({ label: 'Desagrupar', action: 'ungroup' });
      }
    }
    if (n >= 2 && !hasRoot) {
      items.push({ label: 'Agrupar', action: 'group' });
    }
    return items;
  }
  function showContextMenu(x, y) {
    var items = buildMenuItems();
    if (items.length === 0) return;
    var m = ensureContextMenu();
    m.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.divider) {
        var s = document.createElement('div');
        s.style.cssText = 'height:1px;margin:4px 0;background:rgba(0,0,0,0.08);';
        m.appendChild(s);
        continue;
      }
      var row = document.createElement('div');
      row.setAttribute('role', 'menuitem');
      row.setAttribute('data-action', it.action);
      row.style.cssText = 'padding:6px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:24px;';
      row.addEventListener('mouseenter', function () { this.style.background = 'rgba(0,0,0,0.06)'; });
      row.addEventListener('mouseleave', function () { this.style.background = ''; });
      var label = document.createElement('span');
      label.textContent = it.label;
      row.appendChild(label);
      if (it.shortcut) {
        var sh = document.createElement('span');
        sh.textContent = it.shortcut;
        sh.style.cssText = 'color:rgba(0,0,0,0.4);font-size:11px;font-family:ui-monospace,monospace;';
        row.appendChild(sh);
      }
      m.appendChild(row);
    }
    m.style.display = 'block';
    var rect = m.getBoundingClientRect();
    var maxX = window.innerWidth - rect.width - 8;
    var maxY = window.innerHeight - rect.height - 8;
    m.style.left = (Math.min(x, maxX) + window.scrollX) + 'px';
    m.style.top = (Math.min(y, maxY) + window.scrollY) + 'px';
  }

  // ── EVENTS ───────────────────────────────────────────────────────────
  document.addEventListener('mousemove', function (e) {
    if (resizing) {
      e.preventDefault();
      var newW = Math.max(16, Math.round(resizing.startW + (e.clientX - resizing.startX)));
      var newH = Math.max(16, Math.round(resizing.startH + (e.clientY - resizing.startY)));
      // Hold shift to lock the aspect ratio captured at drag start. Free
      // resize otherwise. Shift also disables snap (ratio takes priority).
      if (e.shiftKey && resizing.startW > 0 && resizing.startH > 0) {
        var ratio = resizing.startH / resizing.startW;
        newH = Math.max(16, Math.round(newW * ratio));
        hideSnapGuides();
      } else {
        // Try to snap right + bottom edges to sibling/parent edges. Left/top
        // never move on a SE handle, so we only need x and y axes.
        var srcRect = resizing.el.getBoundingClientRect();
        var edges = collectSnapEdges(resizing.el);
        var sx = null, sy = null;
        var targetR = srcRect.left + newW;
        for (var i = 0; i < edges.x.length; i++) {
          if (Math.abs(targetR - edges.x[i]) <= SNAP_THRESHOLD) {
            sx = edges.x[i];
            newW = Math.max(16, Math.round(sx - srcRect.left));
            break;
          }
        }
        var targetB = srcRect.top + newH;
        for (var j = 0; j < edges.y.length; j++) {
          if (Math.abs(targetB - edges.y[j]) <= SNAP_THRESHOLD) {
            sy = edges.y[j];
            newH = Math.max(16, Math.round(sy - srcRect.top));
            break;
          }
        }
        if (sx !== null) showSnapGuideV(sx); else if (snapGuideV) snapGuideV.style.display = 'none';
        if (sy !== null) showSnapGuideH(sy); else if (snapGuideH) snapGuideH.style.display = 'none';
      }
      resizing.el.style.width = newW + 'px';
      resizing.el.style.height = newH + 'px';
      if (resizeHandle) {
        var rect = resizing.el.getBoundingClientRect();
        resizeHandle.style.left = (rect.right + window.scrollX - 6) + 'px';
        resizeHandle.style.top = (rect.bottom + window.scrollY - 6) + 'px';
      }
      return;
    }
    if (marquee) {
      e.preventDefault();
      var mLeft = Math.min(marquee.startX, e.clientX);
      var mTop = Math.min(marquee.startY, e.clientY);
      var mW = Math.abs(e.clientX - marquee.startX);
      var mH = Math.abs(e.clientY - marquee.startY);
      showMarqueeBox(mLeft, mTop, mW, mH);
      return;
    }
    if (pendingMarquee) {
      var pmdx = e.clientX - pendingMarquee.startX;
      var pmdy = e.clientY - pendingMarquee.startY;
      if (pmdx * pmdx + pmdy * pmdy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        marquee = pendingMarquee;
        pendingMarquee = null;
        document.body.classList.add('ol-marqueeing');
        if (resizeHandle) resizeHandle.style.display = 'none';
        showMarqueeBox(
          Math.min(marquee.startX, e.clientX),
          Math.min(marquee.startY, e.clientY),
          Math.abs(e.clientX - marquee.startX),
          Math.abs(e.clientY - marquee.startY)
        );
      }
      return;
    }
    if (dragging) {
      e.preventDefault();
      var plan = findDropPlan({ x: e.clientX, y: e.clientY }, dragging.el);
      if (plan) {
        dropTarget = plan.target;
        dropIntent = plan.intent;
        showDropIndicator(plan.target, plan.intent);
      } else {
        hideDropIndicator();
        dropTarget = null;
      }
      return;
    }
    if (pendingDrag) {
      var dx = e.clientX - pendingDrag.startX;
      var dy = e.clientY - pendingDrag.startY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        var src = pendingDrag.el;
        // Source must have a parent in the tree — the root can't be moved.
        if (parentDataEl(src)) {
          dragging = { el: src };
          src.setAttribute('data-ol-dragging', '');
          document.body.classList.add('ol-dragging');
          if (resizeHandle) resizeHandle.style.display = 'none';
        }
        pendingDrag = null;
      }
      return;
    }
    if (editing) return;
    var ht = withId(e.target);
    if (!ht || SKIP[ht.tagName]) { setHover(null); return; }
    setHover(ht);
  }, true);

  document.addEventListener('mouseleave', function () {
    if (!dragging && !resizing) setHover(null);
  }, true);

  document.addEventListener('mousedown', function (e) {
    if (editing) return;
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('[data-ol-resize-handle]')) return;
    var t = withId(e.target);
    if (!t) return;
    // Marquee path: drag from the root background (the only "empty space" in
    // the compiled page) OR Alt+drag anywhere. Threshold-gated so a plain
    // click on root still falls through to the click handler.
    if (isRootEl(t) || e.altKey) {
      pendingMarquee = {
        startX: e.clientX,
        startY: e.clientY,
        addToExisting: e.shiftKey || e.metaKey || e.ctrlKey
      };
      return;
    }
    pendingDrag = { el: t, startX: e.clientX, startY: e.clientY };
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (resizing) {
      e.preventDefault();
      e.stopPropagation();
      var id = resizing.el.getAttribute('data-ol-id');
      var w = resizing.el.style.width;
      var h = resizing.el.style.height;
      try {
        window.parent.postMessage({
          type: 'openlen:model-resize', id: id, width: w, height: h
        }, '*');
      } catch (_) {}
      resizing = null;
      document.body.classList.remove('ol-resizing');
      hideSnapGuides();
      suppressNextClick = true;
      setTimeout(function () { suppressNextClick = false; }, 50);
      return;
    }
    if (marquee) {
      e.preventDefault();
      e.stopPropagation();
      var mLeft = Math.min(marquee.startX, e.clientX);
      var mTop = Math.min(marquee.startY, e.clientY);
      var mRight = Math.max(marquee.startX, e.clientX);
      var mBottom = Math.max(marquee.startY, e.clientY);
      var add = marquee.addToExisting;
      hideMarqueeBox();
      document.body.classList.remove('ol-marqueeing');
      marquee = null;
      if (mRight - mLeft >= 3 && mBottom - mTop >= 3) {
        var ids = computeMarqueeMatches({
          left: mLeft, top: mTop, right: mRight, bottom: mBottom
        });
        if (add) {
          var merged = selectedIds.slice();
          for (var k = 0; k < ids.length; k++) {
            if (merged.indexOf(ids[k]) < 0) merged.push(ids[k]);
          }
          setSelection(merged);
        } else {
          setSelection(ids);
        }
        postSelection();
      }
      suppressNextClick = true;
      setTimeout(function () { suppressNextClick = false; }, 50);
      return;
    }
    if (dragging) {
      e.preventDefault();
      e.stopPropagation();
      endDrag(true);
      suppressNextClick = true;
      setTimeout(function () { suppressNextClick = false; }, 50);
      return;
    }
    pendingDrag = null;
    pendingMarquee = null;
  }, true);

  document.addEventListener('click', function (e) {
    // Context menu intercept: clicks inside the menu dispatch the action and
    // close. Clicks outside an open menu close it before normal selection runs.
    if (contextMenu && contextMenu.style.display === 'block') {
      if (contextMenu.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        var row = e.target.closest && e.target.closest('[role="menuitem"]');
        if (row) {
          var action = row.getAttribute('data-action');
          hideContextMenu();
          try {
            window.parent.postMessage({ type: 'openlen:model-action', action: action }, '*');
          } catch (_) {}
        }
        return;
      }
      hideContextMenu();
      // Fall through so the click still selects whatever was under it.
    }
    if (suppressNextClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (editing && editing.contains(e.target)) return;
    if (editing) {
      e.preventDefault();
      e.stopPropagation();
      commitEdit();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    var t = withId(e.target);
    if (!t) {
      setSelection([]);
      postSelection();
      return;
    }
    var id = t.getAttribute('data-ol-id');
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSelection(id);
    } else {
      setSelection([id]);
    }
    postSelection();
  }, true);

  document.addEventListener('contextmenu', function (e) {
    if (editing) return;
    var t = withId(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    var id = t.getAttribute('data-ol-id');
    // If the right-clicked element isn't in the current selection, jump to
    // single-select on it (matches Figma/Webflow/Canva expectations).
    if (selectedIds.indexOf(id) < 0) {
      setSelection([id]);
      postSelection();
    }
    showContextMenu(e.clientX, e.clientY);
  }, true);

  document.addEventListener('dblclick', function (e) {
    var t = withId(e.target);
    if (!t || SKIP[t.tagName] || !isTextLeaf(t)) return;
    e.preventDefault();
    e.stopPropagation();
    pendingDrag = null;
    setSelection([t.getAttribute('data-ol-id')]);
    postSelection();
    startEdit(t);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); return; }
      return;
    }
    if (dragging && e.key === 'Escape') {
      e.preventDefault();
      endDrag(false);
      return;
    }
    if (marquee && e.key === 'Escape') {
      e.preventDefault();
      hideMarqueeBox();
      document.body.classList.remove('ol-marqueeing');
      marquee = null;
      pendingMarquee = null;
      return;
    }
    if (contextMenu && contextMenu.style.display === 'block' && e.key === 'Escape') {
      e.preventDefault();
      hideContextMenu();
      return;
    }
    // Cmd/Ctrl+D: ask the parent to duplicate the current selection.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
      if (selectedIds.length === 0) return;
      e.preventDefault();
      try {
        window.parent.postMessage({ type: 'openlen:model-duplicate' }, '*');
      } catch (_) {}
      return;
    }
    // Delete / Backspace: ask the parent to remove the current selection.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIds.length === 0) return;
      e.preventDefault();
      try {
        window.parent.postMessage({ type: 'openlen:model-delete' }, '*');
      } catch (_) {}
      return;
    }
    // Cmd/Ctrl+Z (undo) or Cmd/Ctrl+Shift+Z (redo): bubble to parent. Parent
    // owns docEditor and dispatches; redo flag piggybacks on the same message.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      try {
        window.parent.postMessage({ type: 'openlen:model-undo', redo: !!e.shiftKey }, '*');
      } catch (_) {}
      return;
    }
    if (e.key !== 'Escape') return;
    setSelection([]);
    postSelection();
  }, true);

  document.addEventListener('focusout', function (e) {
    if (editing && e.target === editing) commitEdit();
  }, true);

  function tick() {
    updateResizeHandle();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── DRAG-FROM-LIBRARY (parent rail → iframe) ────────────────────────
  // Library items in the LeftSidebar tag their drag with the mime type below
  // and a JSON {kind:'element'|'section', id} payload. We compute a drop plan
  // the same way as in-iframe drag-to-reorder (3 zones) and post the resolved
  // {payload, toParentId, toIndex} back so the parent can dispatch editInsert.
  var LIBRARY_MIME = 'application/openlen-library';
  function isLibraryDrag(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    var t = e.dataTransfer.types;
    for (var i = 0; i < t.length; i++) {
      if (t[i] === LIBRARY_MIME) return true;
    }
    return false;
  }
  function findLibraryDropPlan(point) {
    var el = document.elementFromPoint(point.x, point.y);
    if (!el || !el.closest) return null;
    var t = el.closest('[data-ol-id]');
    if (!t) return null;
    var rect = t.getBoundingClientRect();
    var top3 = rect.top + rect.height / 3;
    var bot3 = rect.bottom - rect.height / 3;
    var intent;
    if (point.y < top3) intent = 'before';
    else if (point.y > bot3) intent = 'after';
    else intent = isContainerEl(t) ? 'inside' : 'after';
    if (intent !== 'inside' && !parentDataEl(t)) {
      if (isContainerEl(t)) intent = 'inside';
      else return null;
    }
    return { target: t, intent: intent };
  }
  document.addEventListener('dragover', function (e) {
    if (!isLibraryDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    var plan = findLibraryDropPlan({ x: e.clientX, y: e.clientY });
    if (plan) showDropIndicator(plan.target, plan.intent);
    else hideDropIndicator();
  });
  document.addEventListener('dragleave', function (e) {
    if (!isLibraryDrag(e)) return;
    if (!e.relatedTarget) hideDropIndicator();
  });
  document.addEventListener('drop', function (e) {
    if (!isLibraryDrag(e)) return;
    e.preventDefault();
    hideDropIndicator();
    var raw = '';
    try { raw = e.dataTransfer ? e.dataTransfer.getData(LIBRARY_MIME) : ''; } catch (_) {}
    var payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch (_) {}
    if (!payload) return;
    var plan = findLibraryDropPlan({ x: e.clientX, y: e.clientY });
    if (!plan) return;
    var target = plan.target;
    var intent = plan.intent;
    var toParentId, toIndex;
    if (intent === 'inside') {
      toParentId = target.getAttribute('data-ol-id');
      toIndex = siblingsOf(target).length;
    } else {
      var p = parentDataEl(target);
      if (!p) return;
      toParentId = p.getAttribute('data-ol-id');
      var sibs = siblingsOf(p);
      var tIdx = sibs.indexOf(target);
      if (tIdx < 0) return;
      toIndex = intent === 'after' ? tIdx + 1 : tIdx;
    }
    try {
      window.parent.postMessage({
        type: 'openlen:library-drop',
        payload: payload,
        toParentId: toParentId,
        toIndex: toIndex
      }, '*');
    } catch (_) {}
  });

  // Push from parent: { ids: string[] } sets selection; { id } also accepted
  // for backcompat. { type: 'model-scroll-to', id } centers a node in view.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'openlen:model-scroll-to') {
      if (typeof d.id !== 'string') return;
      var sel = document.querySelector('[data-ol-id="' + cssEscape(d.id) + '"]');
      if (sel && sel.scrollIntoView) {
        try { sel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
      }
      return;
    }
    if (d.type !== 'openlen:model-set-selected') return;
    var ids = null;
    if (Array.isArray(d.ids)) {
      ids = [];
      for (var i = 0; i < d.ids.length; i++) {
        if (typeof d.ids[i] === 'string') ids.push(d.ids[i]);
      }
    } else if (typeof d.id === 'string') {
      ids = [d.id];
    } else if (d.id === null) {
      ids = [];
    }
    if (ids === null) return;
    setSelection(ids);
  });
})();
`;

const INJECTION = `<style data-openlen-inspect>${STYLE}</style><script data-openlen-inspect>${SCRIPT}</script>`;

/** Returns the HTML with model-select instrumentation appended just before
 *  `</body>`. Data-openlen-inspect attributes are stripped by postClean if
 *  the legacy serializer ever runs over this (it shouldn't — model projects
 *  persist via the Document, not the iframe HTML — but the marker keeps the
 *  invariant aligned with use-element-inspect.ts). */
export function injectModelSelect(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
