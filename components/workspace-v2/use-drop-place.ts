// Drop engine (P1) — drag an image file from the OS (or paste-then-place) onto
// the live preview. This script does detection + transient affordances ONLY:
// it never mutates committed DOM and never posts openlen:html-changed. On
// commit it posts an intent; the parent uploads the file and routes the result
// through the EXISTING apply contracts:
//   replace-image → openlen:swap-asset            (use-image-replace.ts applies)
//   section-bg    → openlen:apply-prop style-bg   (use-element-inspect.ts applies)
//   new-section   → openlen:section-insert        (use-section-insert.ts applies)
//
// Parent → iframe:  { type:"openlen:set-mode", dropEnabled }  (additive flag)
// Parent → iframe:  { type:"openlen:place-start", token }
// Parent → iframe:  { type:"openlen:place-cancel" }
// Iframe → parent:  { type:"openlen:drop-intent", intent, file }   (OS file drag)
// Iframe → parent:  { type:"openlen:drop-intent", intent, asset }  (panel URL drag)
// Iframe → parent:  { type:"openlen:drop-intent", intent:{action:'swap-images',fromPath,toPath} }
// Iframe → parent:  { type:"openlen:place-commit", token, intent }
// Iframe → parent:  { type:"openlen:place-cancelled", token }
// Iframe → parent:  { type:"openlen:paste-file", file }   (paste w/ canvas focus)
// Iframe → parent:  { type:"openlen:undo-request" }       (Ctrl/Cmd+Z in canvas)
//
// Gated on dropEnabled (a project open in editing mode), NOT the edit-mode
// body attr — dragging a file over the page is unambiguous intent even with
// the TopBar edit toggle off. Idle cost is zero: no UI exists until a file
// drag enters (or place mode starts). dragover/drop are preventDefault'd for
// file drags even when disabled, so a stray drop never navigates the iframe.

import {
  DROP_EDGE_PX,
  buildPathFromBody,
  canSplitSection,
  dropPayloadKind,
  dropSectionCandidates,
  findImageDropTarget,
  isImageDropTarget,
  parseDropAsset,
  resolveBodySide,
  resolveDropZone,
  splitContainer,
} from "./drop-place-core";

export { DROP_ASSET_MIME, DROP_SWAP_MIME } from "./drop-place-core";
export type { DropAsset } from "./drop-place-core";

export type DropIntent =
  | { action: "replace-image"; path: string }
  | { action: "section-bg"; path: string }
  | { action: "media-split"; path: string; side: "left" | "right" }
  | { action: "swap-images"; fromPath: string; toPath: string }
  | { action: "new-section"; anchorPath?: string | null };

export type DropLabels = {
  replace: string;
  newSection: string;
  background: string;
  splitLeft: string;
  splitRight: string;
  swap: string;
};

const FALLBACK_LABELS: DropLabels = {
  replace: "Replace image",
  newSection: "New section",
  background: "Section background",
  splitLeft: "Image on the left",
  splitRight: "Image on the right",
  swap: "Swap images",
};

const DROP_STYLE = `
.openlen-drop-line {
  position: absolute;
  height: 3px;
  border-radius: 2px;
  background: rgba(255,90,54,0.95);
  box-shadow: 0 1px 6px rgba(255,90,54,0.4);
  z-index: 2147483600;
  pointer-events: none;
  display: none;
}
.openlen-drop-overlay {
  position: absolute;
  background: rgba(255,90,54,0.14);
  box-shadow: inset 0 0 0 2px rgba(255,90,54,0.55);
  border-radius: 6px;
  z-index: 2147483599;
  pointer-events: none;
  display: none;
}
.openlen-drop-chip {
  position: absolute;
  display: none;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(17,17,17,0.92);
  color: #fff;
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  box-shadow: 0 4px 14px rgba(0,0,0,0.3);
  white-space: nowrap;
  z-index: 2147483601;
  pointer-events: none;
}
[data-openlen-drop-target] {
  outline: 2px solid rgba(255,90,54,0.9) !important;
  outline-offset: 2px !important;
}
/* While a drag/place is live, the Replace pill + reorder handles would fight
   the drop affordances for the same pixels — park them. */
body[data-openlen-drop-active] .openlen-replace-button,
body[data-openlen-drop-active] .openlen-replace-remove,
body[data-openlen-drop-active] .openlen-replace-copy-chip,
body[data-openlen-drop-active] .openlen-reorder-handle,
body[data-openlen-drop-active] .openlen-reorder-indicator,
body[data-openlen-drop-active] .openlen-section-toolbar {
  display: none !important;
}
`;

// Core decision logic, serialized for the iframe (tested functions ARE the
// injected functions — see drop-place-core.ts).
const CORE_SRC = [
  `var DROP_EDGE_PX = ${String(DROP_EDGE_PX)};`,
  `var DROP_ASSET_MIME = 'application/x-openlen-image';`,
  `var DROP_SWAP_MIME = 'application/x-openlen-swap';`,
  `var isImageDropTarget = ${isImageDropTarget.toString()};`,
  `var findImageDropTarget = ${findImageDropTarget.toString()};`,
  `var dropSectionCandidates = ${dropSectionCandidates.toString()};`,
  `var buildPathFromBody = ${buildPathFromBody.toString()};`,
  `var resolveDropZone = ${resolveDropZone.toString()};`,
  `var splitContainer = ${splitContainer.toString()};`,
  `var canSplitSection = ${canSplitSection.toString()};`,
  `var resolveBodySide = ${resolveBodySide.toString()};`,
  `var dropPayloadKind = ${dropPayloadKind.toString()};`,
  `var parseDropAsset = ${parseDropAsset.toString()};`,
].join("\n");

// Runtime glue — like the inline-edit glue it contains NO regex and no \`$\{\`
// of its own; everything regex-bearing lives in CORE_SRC.
function buildScript(labelsJson: string): string {
  return `
(function () {
${CORE_SRC}
  var LABELS = ${labelsJson};

  var enabled = false;
  var mode = 'idle';
  var dragKind = null;
  var placeToken = 0;
  var sections = null;
  var current = null;
  var lastX = 0;
  var lastY = 0;
  var rafPending = false;
  var watchdog = null;
  var line = null;
  var tint = null;
  var chip = null;
  var markedEl = null;

  function post(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (_) {}
  }

  function ensureUi() {
    if (line || !document.body) return;
    line = document.createElement('div');
    line.className = 'openlen-drop-line';
    line.setAttribute('data-openlen-drop', 'ui');
    tint = document.createElement('div');
    tint.className = 'openlen-drop-overlay';
    tint.setAttribute('data-openlen-drop', 'ui');
    chip = document.createElement('div');
    chip.className = 'openlen-drop-chip';
    chip.setAttribute('data-openlen-drop', 'ui');
    document.body.appendChild(line);
    document.body.appendChild(tint);
    document.body.appendChild(chip);
  }

  function cacheSections() {
    var els = dropSectionCandidates(document.body);
    sections = [];
    for (var i = 0; i < els.length; i++) {
      sections.push({ el: els[i], path: buildPathFromBody(els[i]) });
    }
  }

  function clearMark() {
    if (markedEl) {
      markedEl.removeAttribute('data-openlen-drop-target');
      markedEl = null;
    }
  }

  function hideUi() {
    if (line) line.style.display = 'none';
    if (tint) tint.style.display = 'none';
    if (chip) chip.style.display = 'none';
    clearMark();
  }

  function clearAll() {
    hideUi();
    current = null;
    sections = null;
    mode = 'idle';
    dragKind = null;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (document.body) document.body.removeAttribute('data-openlen-drop-active');
  }

  function enter(newMode) {
    if (!document.body) return;
    ensureUi();
    cacheSections();
    mode = newMode;
    document.body.setAttribute('data-openlen-drop-active', newMode);
  }

  function showChip(label, x, y) {
    chip.textContent = label;
    chip.style.display = 'inline-flex';
    chip.style.left = (x + window.scrollX + 16) + 'px';
    chip.style.top = (y + window.scrollY + 18) + 'px';
  }

  // Shared hit-test (drag + place). Priority: boundary edge (insert line) >
  // image slot (replace) > section body (background). Rects read live each
  // frame so scroll/lazy-layout stays accurate; the element list is cached at
  // activation.
  function hitTest() {
    rafPending = false;
    if (mode === 'idle' || !sections) return;

    // Internal image-swap drag: the ONLY valid target is another <img>.
    if (mode === 'drag' && dragKind === 'swap') {
      clearMark();
      var underSwap = document.elementFromPoint(lastX, lastY);
      var imgSwap = findImageDropTarget(underSwap, isImageDropTarget);
      if (imgSwap && imgSwap.tagName === 'IMG') {
        line.style.display = 'none';
        tint.style.display = 'none';
        imgSwap.setAttribute('data-openlen-drop-target', '');
        markedEl = imgSwap;
        showChip(LABELS.swap, lastX, lastY);
        current = { action: 'swap-images', fromPath: '', toPath: buildPathFromBody(imgSwap) };
      } else {
        hideUi();
        current = null;
      }
      return;
    }

    var rects = [];
    for (var i = 0; i < sections.length; i++) {
      rects.push(sections[i].el.getBoundingClientRect());
    }
    var zone = resolveDropZone(rects, lastY, DROP_EDGE_PX);
    clearMark();

    if (zone && zone.zone !== 'body') {
      var r = rects[zone.index];
      var edgeY = zone.zone === 'before' ? r.top : r.bottom;
      line.style.display = 'block';
      line.style.left = (r.left + window.scrollX) + 'px';
      line.style.width = r.width + 'px';
      line.style.top = (edgeY + window.scrollY - 1) + 'px';
      tint.style.display = 'none';
      showChip(LABELS.newSection, lastX, lastY);
      var anchorIdx = zone.zone === 'before' ? zone.index : zone.index + 1;
      var anchorPath = anchorIdx < sections.length ? sections[anchorIdx].path : null;
      current = { action: 'new-section', anchorPath: anchorPath };
      return;
    }

    var under = document.elementFromPoint(lastX, lastY);
    var img = findImageDropTarget(under, isImageDropTarget);
    if (img) {
      line.style.display = 'none';
      tint.style.display = 'none';
      img.setAttribute('data-openlen-drop-target', '');
      markedEl = img;
      showChip(LABELS.replace, lastX, lastY);
      current = { action: 'replace-image', path: buildPathFromBody(img) };
      return;
    }

    if (zone) {
      var sec = sections[zone.index];
      var sr = rects[zone.index];
      // Splittable text section: the outer thirds read as "image beside the
      // text" (tint covers the half the image would take); the center stays
      // the background target. Non-splittable: the whole body is background.
      var splittable = canSplitSection(sec.el, splitContainer);
      var side = resolveBodySide(sr.left, sr.width, lastX, splittable);
      line.style.display = 'none';
      tint.style.display = 'block';
      tint.style.top = (sr.top + window.scrollY) + 'px';
      tint.style.height = sr.height + 'px';
      if (side === 'left' || side === 'right') {
        var half = sr.width / 2;
        tint.style.left = ((side === 'left' ? sr.left : sr.left + half) + window.scrollX) + 'px';
        tint.style.width = half + 'px';
        showChip(side === 'left' ? LABELS.splitLeft : LABELS.splitRight, lastX, lastY);
        current = { action: 'media-split', path: sec.path, side: side };
      } else {
        tint.style.left = (sr.left + window.scrollX) + 'px';
        tint.style.width = sr.width + 'px';
        showChip(LABELS.background, lastX, lastY);
        current = { action: 'section-bg', path: sec.path };
      }
      return;
    }

    hideUi();
    current = null;
  }

  function scheduleHit(x, y) {
    lastX = x;
    lastY = y;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(hitTest);
  }

  function hasDropPayload(e) {
    return dropPayloadKind(e.dataTransfer && e.dataTransfer.types) !== null;
  }

  // OS drags don't reliably emit a terminal event when the user bails outside
  // the iframe — a short no-dragover watchdog clears the affordances.
  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(function () {
      if (mode === 'drag') clearAll();
    }, 500);
  }

  // Dragging an existing page image arms the swap gesture: stamp its path on
  // the dataTransfer so dropping it on another image exchanges the two.
  function onDragStart(e) {
    if (!enabled) return;
    var el = e.target;
    if (!el || el.tagName !== 'IMG') return;
    if (!isImageDropTarget(el)) return;
    try {
      e.dataTransfer.setData(DROP_SWAP_MIME, buildPathFromBody(el));
      e.dataTransfer.effectAllowed = 'move';
    } catch (_) {}
  }

  function onDragEnter(e) {
    if (hasDropPayload(e)) e.preventDefault();
  }

  function onDragOver(e) {
    var kind = dropPayloadKind(e.dataTransfer && e.dataTransfer.types);
    if (!kind) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = enabled ? (kind === 'swap' ? 'move' : 'copy') : 'none';
    } catch (_) {}
    if (!enabled) return;
    if (mode === 'place') {
      post({ type: 'openlen:place-cancelled', token: placeToken });
      clearAll();
    }
    if (mode !== 'drag') enter('drag');
    dragKind = kind;
    armWatchdog();
    scheduleHit(e.clientX, e.clientY);
  }

  function onDrop(e) {
    var kind = dropPayloadKind(e.dataTransfer && e.dataTransfer.types);
    if (!kind) return;
    e.preventDefault();
    if (!enabled || mode !== 'drag') { clearAll(); return; }
    // Lock the final intent synchronously from the drop point (the last rAF
    // may lag the pointer by a frame).
    lastX = e.clientX;
    lastY = e.clientY;
    hitTest();
    var intent = current;
    if (kind === 'swap') {
      var fromPath = '';
      try { fromPath = e.dataTransfer.getData(DROP_SWAP_MIME) || ''; } catch (_) {}
      clearAll();
      if (!intent || intent.action !== 'swap-images' || !fromPath) return;
      if (fromPath === intent.toPath) return; // dropped on itself
      post({
        type: 'openlen:drop-intent',
        intent: { action: 'swap-images', fromPath: fromPath, toPath: intent.toPath },
      });
      return;
    }
    var asset = null;
    var file = null;
    // OJO: ESTA RAMA YA NO SE DISPARA, y queda a proposito. El unico productor
    // de DROP_ASSET_MIME era el panel de Imagenes del rail (startAssetDrag),
    // que salio el 2026-08-29 — hoy nadie escribe ese tipo en un dataTransfer.
    //
    // No la borro por dos razones: dropPayloadKind decide 'asset' vs 'file'
    // leyendo los tipos, y la rama de ficheros —arrastrar desde el escritorio,
    // que SI esta viva y da las cinco intenciones— cuelga del mismo else.
    // Tocarlo para quitar codigo que no cuesta nada arriesgaria lo que si
    // funciona. Si alguien vuelve a necesitar un origen de arrastre desde
    // nuestras bibliotecas, el receptor ya esta aqui.
    //
    // Y SIN ACENTOS NI BACKTICKS A PROPOSITO: este bloque no es codigo, es una
    // CADENA que se inyecta en el iframe. Un backtick aqui cierra el literal.
    if (kind === 'asset') {
      asset = parseDropAsset(e.dataTransfer.getData(DROP_ASSET_MIME));
    } else {
      file = e.dataTransfer.files && e.dataTransfer.files[0];
    }
    clearAll();
    if (!intent) return;
    if (asset) {
      post({ type: 'openlen:drop-intent', intent: intent, asset: asset });
      return;
    }
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) return;
    post({ type: 'openlen:drop-intent', intent: intent, file: file });
  }

  function onPlaceMove(e) {
    if (mode !== 'place') return;
    scheduleHit(e.clientX, e.clientY);
  }

  function onPlaceClick(e) {
    if (mode !== 'place') return;
    e.preventDefault();
    e.stopPropagation();
    if (!current) return;
    var token = placeToken;
    var intent = current;
    clearAll();
    post({ type: 'openlen:place-commit', token: token, intent: intent });
  }

  function onPlaceKey(e) {
    if (mode !== 'place' || e.key !== 'Escape') return;
    var token = placeToken;
    clearAll();
    post({ type: 'openlen:place-cancelled', token: token });
  }

  // Ctrl/Cmd+Z with focus in the canvas → the parent's one-step undo. The
  // inline-edit overlay keeps NATIVE text undo (skip while an editable has
  // focus); redo combos pass through untouched.
  function onUndoKey(e) {
    if (!enabled) return;
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.shiftKey || e.altKey) return;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    e.preventDefault();
    e.stopPropagation();
    post({ type: 'openlen:undo-request' });
  }

  // Paste with focus inside the canvas — forward the image to the parent,
  // which owns the upload + placement lifecycle. Pasting into the inline-edit
  // overlay (contenteditable) keeps its normal text-paste behavior.
  function onPaste(e) {
    if (!enabled) return;
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    var files = e.clipboardData && e.clipboardData.files;
    var file = files && files[0];
    if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
    e.preventDefault();
    post({ type: 'openlen:paste-file', file: file });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'openlen:set-mode') {
      if ('dropEnabled' in d) {
        enabled = !!d.dropEnabled;
        if (!enabled && mode !== 'idle') {
          if (mode === 'place') post({ type: 'openlen:place-cancelled', token: placeToken });
          clearAll();
        }
      }
      return;
    }
    if (d.type === 'openlen:place-start') {
      if (!enabled) return;
      if (mode !== 'idle') clearAll();
      placeToken = typeof d.token === 'number' ? d.token : 0;
      enter('place');
      return;
    }
    if (d.type === 'openlen:place-cancel') {
      if (mode === 'place') clearAll();
      return;
    }
  });

  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragenter', onDragEnter, true);
  document.addEventListener('dragover', onDragOver, true);
  document.addEventListener('drop', onDrop, true);
  document.addEventListener('mousemove', onPlaceMove, true);
  document.addEventListener('click', onPlaceClick, true);
  document.addEventListener('keydown', onPlaceKey, true);
  document.addEventListener('keydown', onUndoKey, true);
  document.addEventListener('paste', onPaste, true);
  window.addEventListener('blur', function () {
    if (mode === 'drag') clearAll();
  });
})();
`;
}

function buildInjection(labels: DropLabels): string {
  // <-escape so a translated label can never close the script tag.
  const json = JSON.stringify(labels).replace(/</g, "\\u003c");
  return `<style data-openlen-drop>${DROP_STYLE}</style><script data-openlen-drop>${buildScript(json)}</script>`;
}

/** Append drop-place instrumentation just before `</body>`. Always injected
 *  (Editor V3 persistent-iframe pattern); inert until the parent's set-mode
 *  carries dropEnabled:true, and visually silent until a file drag enters. */
export function injectDropPlace(html: string, labels?: DropLabels): string {
  if (!html) return html;
  const inj = buildInjection(labels || FALLBACK_LABELS);
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + inj;
  return html.slice(0, idx) + inj + html.slice(idx);
}

// Composed runtime for the parse test (new Function(...) syntactic gate).
export const __DROP_PLACE_SCRIPT_FOR_TEST = buildScript(
  JSON.stringify(FALLBACK_LABELS),
);
