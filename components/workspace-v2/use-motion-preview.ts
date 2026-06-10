// Editor-side live preview for Motion Looks. A self-contained injector
// script (always present in the editor srcDoc, like the other 5 editor
// scripts) that listens for `openlen:apply-motion` and applies the picked
// preset to the iframe in real time — the SAME CSS + runtime that publish
// bakes (lib/publish/motion-presets.ts), so the preview is faithful.
//
// The parent (page.tsx) posts the preset name + its CSS when a motion bead
// is clicked (and on iframe-ready, to restore the saved preset). Switching
// presets resets prior state (reveal classes, counter text restored from
// data-ol-orig) before re-applying, so toggling between beads is clean.
//
// Preview-only: this script carries the data-openlen-* marker and is stripped
// from the saved HTML by stripEditorInstrumentation — motion reaches the
// published page solely through the publish-time bake.

import { MOTION_RUNTIME_BODY } from "@/lib/publish/motion-presets";

const MOTION_PREVIEW_SCRIPT = `(function(){
  function reset(){
    var root=document.documentElement;
    root.classList.remove('ol-motion-native','ol-motion-js');
    var inEls=document.querySelectorAll('.ol-in');
    for(var i=0;i<inEls.length;i++)inEls[i].classList.remove('ol-in');
    var counted=document.querySelectorAll('[data-ol-counted]');
    for(var j=0;j<counted.length;j++){
      var o=counted[j].getAttribute('data-ol-orig');
      if(o!=null)counted[j].textContent=o;
      counted[j].removeAttribute('data-ol-counted');
      counted[j].removeAttribute('data-ol-orig');
    }
  }
  function apply(preset,css){
    reset();
    var root=document.documentElement;
    var st=document.getElementById('ol-motion-preview-style');
    if(!preset){ if(st)st.remove(); root.removeAttribute('data-ol-motion'); return; }
    if(!st){ st=document.createElement('style'); st.id='ol-motion-preview-style';
      st.setAttribute('data-openlen-motion-preview','');
      (document.head||document.documentElement).appendChild(st); }
    st.textContent=css||'';
    root.setAttribute('data-ol-motion',preset);
    (function(){${MOTION_RUNTIME_BODY}})();
  }
  window.addEventListener('message',function(e){
    var d=e.data;
    if(!d||typeof d!=='object'||d.type!=='openlen:apply-motion')return;
    apply(d.preset||'', d.css||'');
  });
})();`;

const INJECTION = `<script data-openlen-motion-preview>${MOTION_PREVIEW_SCRIPT}</script>`;

/** Append the motion-preview injector just before `</body>`. Always injected
 *  (self-gates on the apply-motion message); editor-only — stripped on save. */
export function injectMotionPreview(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
