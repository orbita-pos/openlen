// Editor-side live preview for the page-music player. A self-contained
// injector script (always present in the editor srcDoc, like the motion
// preview) that listens for `openlen:apply-music` and drops the SAME markup +
// CSS + runtime that publish bakes (lib/publish/music-player.ts) into the
// iframe — so the preview (including actually listening to the track) is
// faithful to the published page.
//
// The parent (preview-area.tsx) computes the markup/CSS from the project's
// settings.music and posts them when the track changes (and on iframe-ready,
// to restore the saved player after a reload). Posting an empty payload
// removes the player.
//
// Preview-only: every node this script creates (the style + the host wrapper
// around the player) carries the data-openlen-music-preview marker and is
// stripped from the saved HTML by stripEditorInstrumentation — the player
// reaches the published page solely through the publish-time bake. The host
// also carries data-openlen-edit-noedit so the inline editor leaves it alone.

import { MUSIC_RUNTIME_BODY } from "@/lib/publish/music-player";

const MUSIC_PREVIEW_SCRIPT = `(function(){
  function clear(){
    var st=document.getElementById('ol-music-preview-style');
    if(st)st.remove();
    var els=document.querySelectorAll('div[data-openlen-music-preview],style[data-openlen-music-preview]');
    for(var i=0;i<els.length;i++)els[i].remove();
  }
  function apply(html,css){
    clear();
    if(!html)return;
    var st=document.createElement('style');
    st.id='ol-music-preview-style';
    st.setAttribute('data-openlen-music-preview','');
    st.textContent=css||'';
    (document.head||document.documentElement).appendChild(st);
    var host=document.createElement('div');
    host.setAttribute('data-openlen-music-preview','');
    host.setAttribute('data-openlen-edit-noedit','');
    host.innerHTML=html;
    (document.body||document.documentElement).appendChild(host);
    (function(){${MUSIC_RUNTIME_BODY}})();
  }
  window.addEventListener('message',function(e){
    var d=e.data;
    if(!d||typeof d!=='object'||d.type!=='openlen:apply-music')return;
    apply(d.html||'', d.css||'');
  });
})();`;

const INJECTION = `<script data-openlen-music-preview>${MUSIC_PREVIEW_SCRIPT}</script>`;

/** Append the music-preview injector just before `</body>`. Always injected
 *  (self-gates on the apply-music message); editor-only — stripped on save. */
export function injectMusicPreview(html: string): string {
  if (!html) return html;
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + INJECTION;
  return html.slice(0, idx) + INJECTION + html.slice(idx);
}
