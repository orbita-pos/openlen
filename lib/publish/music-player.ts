// ─────────────────────────────────────────────────────────────────────────────
// Music player — a floating tap-to-play widget baked into the published page.
//
// The guns.lol-style page-music feature: a compact glass card (cover · title ·
// progress · play/pause) fixed to the bottom-left corner. The card paints
// itself entirely from the page's own --ol-* tokens, so it inherits whatever
// Look (or future temática) the page wears — the widget never escapes the
// page's world. No third-party embed, no framework: ~1KB of CSS + ~1.2KB of
// runtime on a plain <audio> element.
//
// This module is the SINGLE SOURCE of the player CSS + markup + runtime,
// shared by:
//   - publish (lib/publish/music.ts → injected into the static HTML, the
//     runtime <script> sealed by the CSP pass like motion/analytics)
//   - the editor preview (components/workspace-v2/use-music-preview.ts →
//     the same markup/CSS/runtime applied live in the iframe)
//
// Autoplay-with-sound is blocked by every modern browser, so the player is
// honest about it: preload="none", visitor taps to listen. The <audio> loops.
// Client-safe: no node imports.
// ─────────────────────────────────────────────────────────────────────────────

import type { MusicSettings } from "@/lib/projects/types";

export const MUSIC_MAX_SRC_LENGTH = 2000;
export const MUSIC_MAX_TITLE_LENGTH = 120;

/** Minimal shape check — the settings route validates URLs properly; this
 *  guards the bake/preview against malformed persisted data. */
export function isMusicSettings(v: unknown): v is MusicSettings {
  if (!v || typeof v !== "object") return false;
  const src = (v as { src?: unknown }).src;
  return typeof src === "string" && src.trim().length > 0 && src.length <= MUSIC_MAX_SRC_LENGTH;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLAY_SVG =
  '<svg class="olmp-ic olmp-ic-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE_SVG =
  '<svg class="olmp-ic olmp-ic-pause" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 5h3.2v14H7.5zM13.3 5h3.2v14h-3.2z"/></svg>';
const NOTE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

/** The player's DOM — the inner HTML injected before `</body>`. All values
 *  are attribute/text-escaped here; callers pass raw settings. */
export function musicMarkup(music: MusicSettings): string {
  const src = escapeHtml(music.src.trim());
  const title = escapeHtml(
    (music.title ?? "").trim().slice(0, MUSIC_MAX_TITLE_LENGTH) || "Audio",
  );
  const cover = music.cover?.trim() ? escapeHtml(music.cover.trim()) : null;
  const coverEl = cover
    ? `<img class="olmp-cover" src="${cover}" alt="" loading="lazy" decoding="async"/>`
    : `<span class="olmp-cover olmp-cover-fallback" aria-hidden="true">${NOTE_SVG}</span>`;
  return (
    `<div class="olmp" data-ol-music role="group" aria-label="Music player">` +
    `<audio preload="none" loop src="${src}"></audio>` +
    coverEl +
    `<div class="olmp-meta">` +
    `<div class="olmp-title">${title}</div>` +
    `<div class="olmp-row">` +
    `<span class="olmp-cur">0:00</span>` +
    `<span class="olmp-bar"><span class="olmp-track"><span class="olmp-fill"></span></span></span>` +
    `<span class="olmp-dur">–:––</span>` +
    `</div></div>` +
    `<button class="olmp-btn" type="button" aria-label="Play">${PLAY_SVG}${PAUSE_SVG}</button>` +
    `</div>`
  );
}

/** The player CSS — the inner text of the injected `<style data-ol-music>`.
 *  Token-driven with hard fallbacks so it renders on pages without --ol-*
 *  vars; pre-color-mix browsers keep the solid fallbacks declared first. */
export function musicCss(): string {
  return `
.olmp{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483000;
display:flex;align-items:center;gap:10px;padding:10px 12px;width:min(300px,calc(100vw - 32px));
box-sizing:border-box;background:var(--ol-surface,#fff);color:var(--ol-fg,#18181b);
border:1px solid var(--ol-border,rgba(24,24,27,.12));border-radius:calc(12px + 6px * var(--ol-r-scale,1));
box-shadow:0 16px 40px -16px rgba(0,0,0,.3);font-family:inherit;line-height:1.2;text-align:left}
.olmp,.olmp *{box-sizing:border-box;margin:0}
@supports ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
.olmp{background:color-mix(in srgb,var(--ol-surface,#fff) 78%,transparent);
-webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5)}}
.olmp audio{display:none}
.olmp-cover{width:44px;height:44px;flex:0 0 44px;border-radius:calc(8px + 4px * var(--ol-r-scale,1));object-fit:cover;display:block}
.olmp-cover-fallback{display:flex;align-items:center;justify-content:center;color:var(--ol-accent,#18181b);
background:var(--ol-surface,#f4f4f5);
background:color-mix(in srgb,var(--ol-accent,#18181b) 14%,var(--ol-surface,#fff))}
.olmp-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.olmp-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ol-fg,#18181b)}
.olmp-row{display:flex;align-items:center;gap:7px}
.olmp-cur,.olmp-dur{font-size:10px;opacity:.65;font-variant-numeric:tabular-nums;min-width:27px}
.olmp-dur{text-align:right}
.olmp-bar{flex:1;height:14px;display:flex;align-items:center;cursor:pointer}
.olmp-track{width:100%;height:3px;border-radius:999px;overflow:hidden;
background:rgba(0,0,0,.12);background:color-mix(in srgb,var(--ol-fg,#18181b) 14%,transparent)}
.olmp-fill{display:block;width:0;height:100%;border-radius:999px;background:var(--ol-accent,#18181b)}
.olmp-btn{flex:0 0 36px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;
border:0;border-radius:999px;cursor:pointer;padding:0;background:var(--ol-accent,#18181b);color:var(--ol-bg,#fff)}
.olmp-btn:hover{filter:brightness(1.07)}
.olmp .olmp-ic-pause{display:none}
.olmp.olmp-on .olmp-ic-pause{display:block}
.olmp.olmp-on .olmp-ic-play{display:none}
.olmp-ic-play{margin-left:2px}
@media (prefers-reduced-motion:no-preference){
.olmp-btn{transition:transform .18s ease,filter .18s ease}
.olmp-btn:hover{transform:scale(1.06)}
.olmp-btn:active{transform:scale(.94)}
.olmp-fill{transition:width .25s linear}}
`;
}

// The runtime BODY: applied in BOTH the published page and the editor
// preview. Wires every [data-ol-music] card (idempotent via data-olmp-wired):
// play/pause toggle, progress fill + current/total time, click-to-seek.
// Plain English aria-labels; no deps; every step try/caught. Wrapped in an
// IIFE for publish (MUSIC_RUNTIME_JS); re-invoked by the preview injector.
export const MUSIC_RUNTIME_BODY = `
  try{
    var boxes=document.querySelectorAll('[data-ol-music]');
    for(var i=0;i<boxes.length;i++){(function(box){
      if(box.tagName==='AUDIO'||box.tagName==='STYLE'||box.tagName==='SCRIPT')return;
      if(box.getAttribute('data-olmp-wired'))return;
      box.setAttribute('data-olmp-wired','');
      var a=box.querySelector('audio');var btn=box.querySelector('.olmp-btn');
      if(!a||!btn)return;
      var fill=box.querySelector('.olmp-fill');var cur=box.querySelector('.olmp-cur');
      var dur=box.querySelector('.olmp-dur');var bar=box.querySelector('.olmp-bar');
      function fmt(s){if(!isFinite(s)||s<0)s=0;var m=Math.floor(s/60),x=Math.floor(s%60);return m+':'+(x<10?'0':'')+x;}
      function lab(){btn.setAttribute('aria-label',a.paused?'Play':'Pause');}
      btn.addEventListener('click',function(){
        if(a.paused){var p=a.play();if(p&&p.catch)p.catch(function(){});}
        else{a.pause();}
      });
      a.addEventListener('play',function(){box.classList.add('olmp-on');lab();});
      a.addEventListener('pause',function(){box.classList.remove('olmp-on');lab();});
      a.addEventListener('ended',function(){box.classList.remove('olmp-on');lab();});
      a.addEventListener('timeupdate',function(){
        if(cur)cur.textContent=fmt(a.currentTime);
        if(fill&&a.duration)fill.style.width=(a.currentTime/a.duration*100)+'%';
      });
      a.addEventListener('loadedmetadata',function(){if(dur)dur.textContent=fmt(a.duration);});
      if(bar)bar.addEventListener('click',function(e){
        if(!a.duration)return;
        var r=bar.getBoundingClientRect();if(!r.width)return;
        var f=(e.clientX-r.left)/r.width;if(f<0)f=0;if(f>1)f=1;
        a.currentTime=f*a.duration;
        if(fill)fill.style.width=(f*100)+'%';
        if(cur)cur.textContent=fmt(a.currentTime);
      });
      lab();
    })(boxes[i]);}
  }catch(_){}
`;

/** Publish-time runtime: the body wrapped in a run-once IIFE. */
export const MUSIC_RUNTIME_JS = `(function(){${MUSIC_RUNTIME_BODY}})();`;
