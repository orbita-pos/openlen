import {
  buildEditPath,
  editChildTags,
  isEditorNode,
  EDITOR_NODE_ATTRS,
} from "./edit-path";

// Image/icon replace injection — hover overlay button that posts the
// clicked asset's path + kind to the parent, which opens a modal (Lucide
// picker for icons, URL paste for images). Parent posts the chosen
// payload back, the script performs the swap in place + emits the clean
// HTML via the existing `openlen:html-changed` flow.
//
// Detection heuristic:
//   - <img>                  → kind: image
//   - <svg> ≤ 32×32          → kind: icon (Lucide picker)
//   - <svg> ≥ 40×40          → kind: image (URL paste; converts svg → img)
//   - <div> pintado por background-image, declarado (aspect-*) o vacío,
//     y que no sea un velo puesto encima de sus hermanos → kind: image
//
// Parent contract (postMessage):
//   OUT: { type: "openlen:asset-clicked", kind, path, currentSrc?, currentSvg? }
//   IN:  { type: "openlen:swap-asset", kind, path, payload }
//        payload for icon: { svgMarkup: string }
//        payload for image: { url: string, alt?: string }
//   OUT: { type: "openlen:html-changed", outerHtml, source: "replace" }
//   OUT: { type: "openlen:html-changed", outerHtml, source: "resize" }  // grip drag
//   OUT: { type: "openlen:asset-remove", kind, path }                   // trash
//   OUT: { type: "openlen:replace-cancelled" }  // ESC

import { resizeWidthPct } from "./drop-place-core";

const REPLACE_STYLE = `
.openlen-replace-button {
  position: absolute;
  z-index: 999999;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  background: #FF5A36;
  color: white;
  border: none;
  border-radius: 7px;
  font: 600 11.5px system-ui, -apple-system, sans-serif;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0,0,0,0.18), 0 1px 3px rgba(255,90,54,0.4);
  white-space: nowrap;
  pointer-events: auto;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.openlen-replace-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(0,0,0,0.22), 0 2px 4px rgba(255,90,54,0.5);
}
.openlen-replace-button svg {
  width: 12px;
  height: 12px;
}
.openlen-replace-remove {
  position: absolute;
  z-index: 999999;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(17,17,17,0.92);
  color: white;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0,0,0,0.18);
  pointer-events: auto;
  transition: transform 120ms ease, background 120ms ease;
}
.openlen-replace-remove:hover {
  transform: translateY(-1px);
  background: #dc2626;
}
.openlen-replace-remove svg { width: 13px; height: 13px; }
.openlen-resize-grip {
  position: absolute;
  z-index: 999999;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  border: 2.5px solid #FF5A36;
  box-shadow: 0 2px 6px rgba(0,0,0,0.25);
  cursor: nwse-resize;
  pointer-events: auto;
  touch-action: none;
}
body[data-openlen-resizing] .openlen-replace-button,
body[data-openlen-resizing] .openlen-replace-remove,
body[data-openlen-resizing] .openlen-reorder-handle,
body[data-openlen-resizing] .openlen-section-toolbar,
body[data-openlen-resizing] .openlen-block-chip {
  display: none !important;
}
body[data-openlen-resizing] [data-openlen-replace-target] {
  outline: 2px solid rgba(255,90,54,0.9) !important;
}
[data-openlen-replace-target] {
  outline: 2px dashed rgba(255,90,54,0.55);
  outline-offset: -2px;
  cursor: pointer !important;
}
.openlen-replace-copy-chip {
  position: absolute;
  z-index: 999999;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 4px 0 9px;
  background: rgba(255,255,255,0.98);
  color: #FF5A36;
  border: 1px solid rgba(255,90,54,0.45);
  border-radius: 13px;
  font: 600 11px system-ui, -apple-system, sans-serif;
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(0,0,0,0.12);
  white-space: nowrap;
  pointer-events: auto;
  animation: openlen-replace-chip-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.openlen-replace-copy-chip:hover {
  background: #FF5A36;
  color: white;
}
.openlen-replace-copy-chip svg { width: 12px; height: 12px; }
.openlen-replace-copy-chip .openlen-replace-copy-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border-radius: 50%;
  background: rgba(255,90,54,0.12);
  cursor: pointer;
}
.openlen-replace-copy-chip:hover .openlen-replace-copy-close {
  background: rgba(255,255,255,0.25);
}
@keyframes openlen-replace-chip-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Editor V3 gate — script + UI nodes live permanently in the persistent
   iframe; visibility is gated on body[data-openlen-edit-mode]. */
body:not([data-openlen-edit-mode]) .openlen-replace-button,
body:not([data-openlen-edit-mode]) .openlen-replace-remove,
body:not([data-openlen-edit-mode]) .openlen-resize-grip,
body:not([data-openlen-edit-mode]) .openlen-replace-copy-chip {
  display: none !important;
}
body:not([data-openlen-edit-mode]) [data-openlen-replace-target] {
  outline: none !important;
  cursor: auto !important;
}
`;

// LAS FUNCIONES DE edit-path.ts, SERIALIZADAS AL IFRAME.
//
// Este script vive dentro de una cadena: nada de lo que este fichero importe
// existe ahi dentro. Sin esto, `buildEditPath` y `editChildTags` son
// ReferenceError en cuanto el usuario toca algo — y el editor entero se queda
// mudo, sin un error en ningun log del servidor.
//
// `editChildTags` llama a `isEditorNode`, que a su vez lee EDITOR_NODE_ATTRS:
// las tres cosas tienen que viajar. Serializar una funcion suelta y olvidar su
// dependencia es exactamente el fallo que esto evita, y lo cazo una prueba de
// navegador el 2026-08-27.
const CORE_SRC = [
  `var EDITOR_NODE_ATTRS = ${JSON.stringify(EDITOR_NODE_ATTRS)};`,
  `var isEditorNode = ${isEditorNode.toString()};`,
  `var buildEditPath = ${buildEditPath.toString()};`,
  `var editChildTags = ${editChildTags.toString()};`,
].join("\n");
const REPLACE_SCRIPT = `
${CORE_SRC}
(function () {
  var resizeWidthPct = ${resizeWidthPct.toString()};
  var hoverButton = null;
  var removeButton = null;
  var hoveredEl = null;
  var hoveredKind = null;
  var hoveredPath = null;
  var hoverHideTimer = null;
  var copyChip = null;
  var copyChipDismissTimer = null;

  function buildPath(el) {
    var segs = [];
    var cur = el;
    while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && cur.parentElement) {
      var tag = cur.tagName.toLowerCase();
      var nth = 1;
      var sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) nth += 1;
        sib = sib.previousElementSibling;
      }
      segs.unshift(tag + ':nth-of-type(' + nth + ')');
      cur = cur.parentElement;
    }
    return segs.join(' > ');
  }

  function getReplaceableKind(el) {
    if (!el || !el.tagName || !el.getBoundingClientRect) return null;
    // Skip our own injected UI (Replace button + chip, Reorder handles
    // and drop indicator) — their inner SVGs would otherwise register as
    // "replaceable icons" and the buttons would chase each other around.
    if (el.closest && (el.closest('[data-openlen-replace]') || el.closest('[data-openlen-reorder]'))) {
      return null;
    }
    var tag = el.tagName;
    var rect = el.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height);
    if (size < 8) return null;

    if (tag === 'IMG') return 'image';
    if (tag === 'VIDEO') return 'video';

    if (tag === 'svg') {
      return size <= 32 ? 'icon' : 'image';
    }

    // Área de imagen = caja PINTADA, declarada (aspect-*) o vacía. El porqué
    // entero está en drop-place-core.ts, que es la otra copia de esto.
    if (tag === 'DIV' && size >= 60) {
      var cs;
      try { cs = getComputedStyle(el); } catch (_) { return null; }
      if (!cs.backgroundImage || cs.backgroundImage === 'none') return null;
      if ((cs.position === 'absolute' || cs.position === 'fixed') &&
          el.parentElement && el.parentElement.children.length > 1) return null;
      var cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (/\\baspect-/.test(cls)) return 'image';
      if (Math.min(rect.width, rect.height) < 60) return null;
      return (el.textContent || '').trim() === '' ? 'image' : null;
    }

    return null;
  }

  function findReplaceable(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      var kind = getReplaceableKind(el);
      if (kind) return { el: el, kind: kind };
      el = el.parentElement;
    }
    return null;
  }

  function makeButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-openlen-replace', 'button');
    btn.className = 'openlen-replace-button';
    btn.addEventListener('click', onButtonClick, true);
    btn.addEventListener('mouseenter', cancelHide, true);
    btn.addEventListener('mouseleave', scheduleHide, true);
    document.body.appendChild(btn);
    return btn;
  }

  function ensureButton() {
    if (!hoverButton) hoverButton = makeButton();
    return hoverButton;
  }

  // Trash sibling of the Replace pill — removes a dropped image or video (the
  // parent routes it to the inspect script's applyRemoveImage: un-split / clear
  // bg / remove the media, plus the drop-created section when it's left empty).
  function ensureRemoveButton() {
    if (removeButton) return removeButton;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-openlen-replace', 'remove');
    btn.className = 'openlen-replace-remove';
    btn.title = 'Remove image';
    btn.setAttribute('aria-label', 'Remove image');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    btn.addEventListener('click', onRemoveClick, true);
    btn.addEventListener('mouseenter', cancelHide, true);
    btn.addEventListener('mouseleave', scheduleHide, true);
    document.body.appendChild(btn);
    removeButton = btn;
    return btn;
  }

  function onRemoveClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!hoveredPath) return;
    try {
      window.parent.postMessage({
        type: 'openlen:asset-remove',
        kind: hoveredKind,
        path: hoveredPath,
      }, '*');
    } catch (_) {}
    clearHover();
  }

  // The inspect script stops click propagation at document capture (its
  // select gesture), which kills target-level listeners. This script
  // registers FIRST (derive order), so a document-capture handler here wins
  // the race and BOTH pill buttons stay clickable in edit mode (the main
  // Replace pill had the same silent death — clicking the image worked,
  // clicking the pill didn't).
  function onDocChromeClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.openlen-replace-remove')) {
      onRemoveClick(e);
      return;
    }
    if (t.closest('.openlen-replace-button')) {
      onButtonClick(e);
    }
  }

  function updateButton(el, kind) {
    var btn = ensureButton();
    var label = kind === 'icon' ? 'Replace icon' : kind === 'video' ? 'Replace video' : 'Replace image';
    var iconSvg = kind === 'icon'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.51-7.13"/><polyline points="21 4 21 11 14 11"/></svg>'
      : kind === 'video'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
    btn.innerHTML = iconSvg + '<span>' + label + '</span>';
    var rect = el.getBoundingClientRect();
    // Position to the top-right of the element, but clamp into the viewport.
    var top = Math.max(8, rect.top + window.scrollY + 8);
    var left = rect.right + window.scrollX - 130;
    if (left < rect.left + window.scrollX + 8) left = rect.left + window.scrollX + 8;
    btn.style.top = top + 'px';
    btn.style.left = left + 'px';
    btn.style.display = 'inline-flex';
    // The trash sibling sits just left of the pill — images + video (removing
    // an inline icon is a different, riskier edit, so icons keep no trash).
    var rm = ensureRemoveButton();
    if (kind === 'image' || kind === 'video') {
      var rmLabel = kind === 'video' ? 'Remove video' : 'Remove image';
      rm.title = rmLabel;
      rm.setAttribute('aria-label', rmLabel);
      rm.style.top = top + 'px';
      rm.style.left = (left - 34) + 'px';
      rm.style.display = 'inline-flex';
    } else {
      rm.style.display = 'none';
    }
    // The resize grip — real <img> only (a % width on an svg/bg-div behaves
    // unpredictably; img + height:auto keeps the ratio).
    if (kind === 'image' && el.tagName === 'IMG') {
      positionGrip(el);
    } else if (resizeGrip) {
      resizeGrip.style.display = 'none';
    }
  }

  function clearHover() {
    if (resizing) return; // mid-drag the hover state must survive
    if (hoveredEl) hoveredEl.removeAttribute('data-openlen-replace-target');
    hoveredEl = null;
    hoveredKind = null;
    hoveredPath = null;
    if (hoverButton) hoverButton.style.display = 'none';
    if (removeButton) removeButton.style.display = 'none';
    if (resizeGrip) resizeGrip.style.display = 'none';
    document.body.removeAttribute('data-openlen-over-image');
  }

  function scheduleHide() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(clearHover, 120);
  }

  function cancelHide() {
    if (hoverHideTimer) {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = null;
    }
  }

  function onMouseMove(e) {
    if (resizing) return;
    // While a reorder drag is in progress, suppress our hover button —
    // the dragged section's bounding rect is mid-transform and our
    // absolute-positioned button would float at a stale location.
    if (document.body.hasAttribute('data-openlen-drag-active')) {
      clearHover();
      document.body.removeAttribute('data-openlen-over-image');
      return;
    }
    // Pointer over our OWN hover chrome (Replace pill / trash / resize grip /
    // copy chip) — keep it all visible so the user can actually reach and click
    // it. Without this the document-level mousemove reschedules the hide while
    // the pointer is ON the button (findReplaceable ignores our UI → returns
    // null → scheduleHide), so the buttons vanish just as the user goes to
    // click. Mirrors the own-chrome guard in use-section-reorder.ts.
    if (e.target && e.target.closest && e.target.closest('[data-openlen-replace]')) {
      cancelHide();
      return;
    }
    var found = findReplaceable(e.target);
    if (!found) {
      scheduleHide();
      document.body.removeAttribute('data-openlen-over-image');
      return;
    }
    cancelHide();
    // Coordination signal — Reorder reads this and suppresses its drag
    // handle so the user gets a single unambiguous affordance over an
    // image (Replace), not handle + button competing.
    document.body.setAttribute('data-openlen-over-image', '1');
    if (found.el === hoveredEl) return;
    if (hoveredEl) hoveredEl.removeAttribute('data-openlen-replace-target');
    hoveredEl = found.el;
    hoveredKind = found.kind;
    hoveredPath = buildPath(found.el);
    hoveredEl.setAttribute('data-openlen-replace-target', '');
    updateButton(hoveredEl, hoveredKind);
  }

  function onButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!hoveredEl || !hoveredKind || !hoveredPath) return;
    // Snapshot for the parent — include current src/svg outerHTML where
    // useful so the modal can show a preview / pre-fill the URL input.
    var currentSrc = null;
    var currentSvg = null;
    if (hoveredEl.tagName === 'IMG') currentSrc = hoveredEl.src;
    if (hoveredEl.tagName === 'VIDEO') { var hs = hoveredEl.querySelector('source'); currentSrc = (hs && hs.getAttribute('src')) || hoveredEl.getAttribute('src') || ''; }
    if (hoveredEl.tagName === 'svg') currentSvg = hoveredEl.outerHTML;
    try {
      window.parent.postMessage({
        type: 'openlen:asset-clicked',
        kind: hoveredKind,
        path: hoveredPath,
        currentSrc: currentSrc,
        currentSvg: currentSvg,
      }, '*');
    } catch (_) {}
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    try {
      window.parent.postMessage({ type: 'openlen:replace-cancelled' }, '*');
    } catch (_) {}
  }

  function openReplaceFor(target) {
    var kind = getReplaceableKind(target);
    if (!kind) return;
    var currentSrc = null;
    var currentSvg = null;
    if (target.tagName === 'IMG') currentSrc = target.src;
    if (target.tagName === 'VIDEO') { var ts = target.querySelector('source'); currentSrc = (ts && ts.getAttribute('src')) || target.getAttribute('src') || ''; }
    if (target.tagName === 'svg') currentSvg = target.outerHTML;
    try {
      window.parent.postMessage({
        type: 'openlen:asset-clicked',
        kind: kind,
        path: buildPath(target),
        currentSrc: currentSrc,
        currentSvg: currentSvg,
      }, '*');
    } catch (_) {}
  }

  // Click anywhere on an image-like element opens Replace directly.
  // Drag is gated to the section's handle (use-section-reorder.ts), so
  // there's no longer any conflict between "tap to replace" and "drag
  // to reorder" — the affordances are spatially separate.
  function onImageClick(e) {
    if (e.target && e.target.closest && e.target.closest('[data-openlen-replace]')) {
      // Our own Replace button → its onclick handler covers that path.
      return;
    }
    var found = findReplaceable(e.target);
    if (!found) return;
    e.preventDefault();
    openReplaceFor(found.el);
  }

  function performSwap(kind, path, payload) {
    var target;
    try {
      target = document.querySelector('body > ' + path);
      if (!target) target = document.querySelector(path);
    } catch (_) {
      return null;
    }
    if (!target) return null;

    if (kind === 'icon' && payload && typeof payload.svgMarkup === 'string') {
      // Parse new SVG, preserve outer attributes (class/style/data-*) from
      // the original, but use the new SVG's content (Lucide standard stroke
      // attrs).
      var parser = new DOMParser();
      var doc = parser.parseFromString(payload.svgMarkup, 'image/svg+xml');
      var newSvg = doc.documentElement;
      if (!newSvg || newSvg.tagName.toLowerCase() !== 'svg') return null;
      // Carry over class & inline style; everything else comes from the
      // new (Lucide) SVG so the stroke/fill semantics match.
      if (target.hasAttribute('class')) newSvg.setAttribute('class', target.getAttribute('class'));
      if (target.hasAttribute('style')) newSvg.setAttribute('style', target.getAttribute('style'));
      // Carry over any width/height the template chose, only if they were
      // explicit attributes (not class-based).
      if (target.hasAttribute('width')) newSvg.setAttribute('width', target.getAttribute('width'));
      if (target.hasAttribute('height')) newSvg.setAttribute('height', target.getAttribute('height'));
      target.parentNode.replaceChild(newSvg, target);
      return newSvg;
    }

    if (kind === 'image' && payload && typeof payload.url === 'string') {
      var url = payload.url.trim();
      if (!url) return null;
      var alt = (payload.alt && typeof payload.alt === 'string') ? payload.alt : '';
      var newImage;
      if (target.tagName === 'IMG') {
        target.setAttribute('src', url);
        if (alt) target.setAttribute('alt', alt);
        newImage = target;
      } else {
        // Replace svg / div with an <img>. Preserve class for sizing.
        var img = document.createElement('img');
        img.setAttribute('src', url);
        img.setAttribute('alt', alt);
        var prevClass = target.getAttribute('class') || '';
        if (!/\\bobject-(cover|contain|fill|none|scale-down)\\b/.test(prevClass)) {
          prevClass = (prevClass + ' object-cover').trim();
        }
        img.setAttribute('class', prevClass);
        target.parentNode.replaceChild(img, target);
        newImage = img;
      }
      // Replace any prior auto-credit pinned to the previous asset so the
      // credit always matches the current image. We identify ours by the
      // data-openlen-credit attribute; the user can opt out by removing it.
      var sib = newImage.nextElementSibling;
      if (sib && sib.getAttribute && sib.getAttribute('data-openlen-credit')) {
        sib.parentNode.removeChild(sib);
      }
      if (payload.credit && typeof payload.credit.author === 'string' && payload.credit.author.length > 0) {
        var credit = document.createElement('span');
        credit.setAttribute('data-openlen-credit', 'unsplash');
        credit.setAttribute('class', 'openlen-unsplash-credit');
        credit.setAttribute('style', 'display:block;margin-top:4px;font-size:10px;line-height:1.3;opacity:0.55;color:inherit');
        var authorUrl = (payload.credit.authorUrl || '').replace(/"/g, '&quot;');
        var author = (payload.credit.author || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        credit.innerHTML = 'Photo by <a href="' + authorUrl + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">' + author + '</a> on <a href="https://unsplash.com?utm_source=openlen&utm_medium=referral" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">Unsplash</a>';
        if (newImage.parentNode) {
          newImage.parentNode.insertBefore(credit, newImage.nextSibling);
        }
      }
      return newImage;
    }

    if (kind === 'video' && payload && typeof payload.url === 'string') {
      var vurl = payload.url.trim();
      if (!vurl || target.tagName !== 'VIDEO') return null;
      var sourceEl = target.querySelector('source');
      if (sourceEl) sourceEl.setAttribute('src', vurl);
      else target.setAttribute('src', vurl);
      try { target.load(); } catch (_) {}
      return target;
    }

    return null;
  }

  function buildHintForCopyChip(el, kind) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      var alt = el.getAttribute('alt') || '';
      if (alt) return 'img — "' + alt.slice(0, 50) + (alt.length > 50 ? '…' : '') + '"';
      var src = el.getAttribute('src') || '';
      return 'img · ' + src.slice(0, 50);
    }
    // For svg / replaced elements, fall back to parent context if possible.
    var parent = el.parentElement;
    var ctx = parent && parent.id ? parent.id : (parent && parent.className && typeof parent.className === 'string' ? parent.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '');
    if (ctx) return (kind === 'icon' ? 'icon in ' : 'image in ') + tag + (ctx ? '.' + ctx : '');
    return kind === 'icon' ? 'icon' : 'image';
  }

  function showCopyChip(newTarget, kind) {
    removeCopyChip();
    var chip = document.createElement('div');
    chip.setAttribute('data-openlen-replace', 'copy-chip');
    chip.className = 'openlen-replace-copy-chip';
    var label = kind === 'icon' ? 'Update copy to match?' : 'Update copy to match?';
    chip.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
      '<span>' + label + '</span>' +
      '<span class="openlen-replace-copy-close" data-close="1" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</span>';
    chip.addEventListener('click', function (ev) {
      var t = ev.target;
      var isClose = false;
      while (t && t !== chip) {
        if (t.getAttribute && t.getAttribute('data-close') === '1') { isClose = true; break; }
        t = t.parentNode;
      }
      if (isClose) {
        removeCopyChip();
        return;
      }
      try {
        window.parent.postMessage({
          type: 'openlen:asset-copy-chip-clicked',
          path: buildPath(newTarget),
          kind: kind,
          hint: buildHintForCopyChip(newTarget, kind),
        }, '*');
      } catch (_) {}
      removeCopyChip();
    });
    document.body.appendChild(chip);
    copyChip = chip;
    positionCopyChip(newTarget);
    if (copyChipDismissTimer) clearTimeout(copyChipDismissTimer);
    copyChipDismissTimer = setTimeout(removeCopyChip, 6000);
  }

  function positionCopyChip(target) {
    if (!copyChip || !target) return;
    var rect = target.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 8;
    var left = rect.left + window.scrollX;
    copyChip.style.top = top + 'px';
    copyChip.style.left = left + 'px';
  }

  function removeCopyChip() {
    if (copyChip) {
      copyChip.remove();
      copyChip = null;
    }
    if (copyChipDismissTimer) {
      clearTimeout(copyChipDismissTimer);
      copyChipDismissTimer = null;
    }
  }

  // UN ELEMENTO, no el documento entero. postClean, aqui abajo, clona el
  // documento VIVO — la practica que obliga a congelar el JavaScript del modelo
  // mientras se edita, porque con el script corriendo se persistiria lo que el
  // script hizo. Un intercambio de imagen o un redimensionado tocan UN elemento
  // y se pueden nombrar: no hace falta mandar la pagina entera.
  function postEdicion(el, source) {
    if (!el || !el.parentElement) return;
    var clone = el.cloneNode(true);
    for (var i = 0; i < EDITOR_NODE_ATTRS.length; i++) {
      clone.removeAttribute(EDITOR_NODE_ATTRS[i]);
    }
    clone.removeAttribute('data-openlen-replace-target');
    clone.querySelectorAll('[data-openlen-replace]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[data-openlen-replace-target]').forEach(function (n) {
      n.removeAttribute('data-openlen-replace-target');
    });
    try {
      window.parent.postMessage({
        type: 'openlen:edit',
        op: 'replace',
        path: buildEditPath(el),
        tag: el.tagName.toLowerCase(),
        hijos: editChildTags(el),
        html: clone.outerHTML,
        source: source || 'replace'
      }, '*');
    } catch (_) {}
  }

  // Aqui vivia postClean(): clonaba el documento VIVO entero y lo mandaba como
  // la pagina del usuario. Se fue el 2026-08-26 al migrar este inyector a
  // ediciones, y con el se va la razon por la que el taller tenia que congelar
  // el JavaScript del modelo en este camino.

  // ── Resize grip — drag the corner to size an image (width %, responsive) ──
  var resizeGrip = null;
  var resizing = null; // { el, startX, startW, parentW }

  function ensureGrip() {
    if (resizeGrip) return resizeGrip;
    var g = document.createElement('div');
    g.setAttribute('data-openlen-replace', 'resize');
    g.className = 'openlen-resize-grip';
    g.title = 'Resize image';
    g.addEventListener('pointerdown', onGripDown, true);
    // Captured-pointer events land on the grip itself.
    g.addEventListener('pointermove', onGripMove, true);
    g.addEventListener('pointerup', onGripUp, true);
    g.addEventListener('lostpointercapture', onGripUp, true);
    g.addEventListener('mouseenter', cancelHide, true);
    g.addEventListener('mouseleave', scheduleHide, true);
    document.body.appendChild(g);
    resizeGrip = g;
    return g;
  }

  function positionGrip(el) {
    var g = ensureGrip();
    var r = el.getBoundingClientRect();
    g.style.top = (r.bottom + window.scrollY - 8) + 'px';
    g.style.left = (r.right + window.scrollX - 8) + 'px';
    g.style.display = 'block';
  }

  function onGripDown(e) {
    if (!hoveredEl || hoveredEl.tagName !== 'IMG') return;
    e.preventDefault();
    e.stopPropagation();
    var parent = hoveredEl.parentElement;
    if (!parent) return;
    var pr = parent.getBoundingClientRect();
    var ir = hoveredEl.getBoundingClientRect();
    resizing = { el: hoveredEl, startX: e.clientX, startW: ir.width, parentW: pr.width };
    document.body.setAttribute('data-openlen-resizing', '');
    try { resizeGrip.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onGripMove(e) {
    if (!resizing) return;
    e.preventDefault();
    var pct = resizeWidthPct(resizing.startW, e.clientX - resizing.startX, resizing.parentW);
    resizing.el.style.width = pct + '%';
    resizing.el.style.height = 'auto';
    resizing.el.style.maxWidth = '100%';
    positionGrip(resizing.el);
  }

  function onGripUp(e) {
    if (!resizing) return;
    var el = resizing.el;
    resizing = null;
    document.body.removeAttribute('data-openlen-resizing');
    try { resizeGrip.releasePointerCapture(e.pointerId); } catch (_) {}
    positionGrip(el);
    postEdicion(el, 'resize');
  }

  function onParentMessage(e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'openlen:swap-asset') return;
    if (typeof data.path !== 'string') return;
    var newTarget = performSwap(data.kind, data.path, data.payload);
    if (newTarget) {
      clearHover();
      // La edicion se manda ANTES de enseñar la pastilla, para que el elemento
      // serializado no la lleve dentro si el usuario guarda al instante.
      postEdicion(newTarget);
      if (data.kind !== 'video') showCopyChip(newTarget, data.kind);
    } else {
      try {
        window.parent.postMessage({
          type: 'openlen:asset-swap-failed',
          path: data.path,
          reason: 'target_not_found_or_invalid_payload',
        }, '*');
      } catch (_) {}
    }
  }

  function setup() {
    // Editor V3 — gate user-facing interaction handlers on edit mode. The
    // message handler is the parent contract (asset swaps come back from
    // the modal) and stays always-on so post-edit swaps still apply if
    // the user momentarily exits edit mode mid-flow.
    function gated(fn) {
      return function (e) {
        if (!document.body || !document.body.hasAttribute('data-openlen-edit-mode')) return;
        return fn(e);
      };
    }
    document.addEventListener('mousemove', gated(onMouseMove), true);
    document.addEventListener('keydown', gated(onKey), true);
    document.addEventListener('click', gated(onDocChromeClick), true);
    document.addEventListener('click', gated(onImageClick), true);
    window.addEventListener('message', onParentMessage);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
`;

const INJECTION = `<style data-openlen-replace>${REPLACE_STYLE}</style><script data-openlen-replace>${REPLACE_SCRIPT}</script>`;

/** Returns the HTML with replace instrumentation appended just before
 *  `</body>`. The injected style/script carry `data-openlen-replace`
 *  markers so the script can strip them before posting clean HTML. */
export function injectImageReplace(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}

/** Source identifier used in postMessage payloads + version timeline.
 *  Mirrors the pattern in use-section-reorder.ts. */
export const REPLACE_SOURCE = "replace" as const;
