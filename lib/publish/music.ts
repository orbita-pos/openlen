// Publish-time music-player injection. When a project has a track set
// (data.settings.music), publishToDir inlines the player CSS as
// <style data-ol-music>, drops the player markup + appends the runtime as
// <script data-ol-music> just before </body>.
//
// Ordering: this runs AFTER sanitize and the other injectors, BEFORE the CSP
// seal — exactly like the motion bake — so the seal hashes the player runtime
// into script-src and it's allowed to execute on the live page. Locale
// variants are built from the baked HTML, so they inherit the player.
//
// Editor preview uses the SAME markup + CSS + runtime (lib/publish/
// music-player.ts) via components/workspace-v2/use-music-preview.ts, so what
// the creator previews is what publishes.

import type { MusicSettings } from "@/lib/projects/types";
import {
  isMusicSettings,
  musicCss,
  musicMarkup,
  MUSIC_RUNTIME_JS,
} from "@/lib/publish/music-player";

/** Inject the music player into the page. No-op (returns the input verbatim)
 *  when `music` is absent/malformed or the page already carries a player —
 *  the widget is purely additive. */
export function bakeMusic(
  html: string,
  music: MusicSettings | null | undefined,
): string {
  if (!isMusicSettings(music)) return html;
  if (html.includes("data-ol-music")) return html; // idempotent
  return applyMusic(html, music);
}

function applyMusic(html: string, music: MusicSettings): string {
  const style = `<style data-ol-music>${musicCss()}</style>`;
  const widget = `${musicMarkup(music)}<script data-ol-music>${MUSIC_RUNTIME_JS}</script>`;

  // Style into <head> (after the page's own styles so the token vars it
  // reads are already declared); markup + runtime before </body>.
  const headClose = /<\/head\s*>/i;
  let out = headClose.test(html)
    ? html.replace(headClose, (c) => `${style}${c}`)
    : html.replace(/<body\b[^>]*>/i, (b) => `${b}${style}`);
  if (!/<\/head\s*>/i.test(html) && !/<body\b/i.test(html)) {
    // Degenerate fragment — prepend the style so the widget still paints.
    out = style + html;
  }

  const bodyIdx = out.lastIndexOf("</body>");
  out =
    bodyIdx === -1
      ? out + widget
      : out.slice(0, bodyIdx) + widget + out.slice(bodyIdx);
  return out;
}
