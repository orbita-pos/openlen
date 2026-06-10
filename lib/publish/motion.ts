// Publish-time Motion Looks injection. When a project has a motion preset
// set (data.settings.motion), publishToDir stamps <html data-ol-motion="…">,
// inlines the preset's CSS as <style data-ol-motion>, and appends the runtime
// as <script data-ol-motion> just before </body>.
//
// Ordering: this runs AFTER sanitize and the other injectors, BEFORE the CSP
// seal — exactly like the analytics snippet — so the seal hashes the motion
// runtime into script-src and it's allowed to execute. The motion <script> is
// part of the page's closed script set (sanitize strips everything else), so
// the hash-locked policy stays honest.
//
// Editor preview uses the SAME preset CSS + runtime (lib/publish/
// motion-presets.ts) via components/workspace-v2/use-motion-preview.ts, so
// what the creator previews is what publishes.

import {
  isMotionPreset,
  motionCss,
  MOTION_RUNTIME_JS,
  type MotionPreset,
} from "@/lib/publish/motion-presets";

/** Inject the chosen motion preset into the page. No-op (returns the input
 *  verbatim) when `preset` is absent/invalid or the page has no <html>/<body>
 *  to anchor to — motion is purely additive. */
export function bakeMotion(html: string, preset: string | undefined): string {
  if (!preset || !isMotionPreset(preset)) return html;
  if (html.includes("data-ol-motion")) return html; // idempotent
  return applyMotion(html, preset);
}

function applyMotion(html: string, preset: MotionPreset): string {
  // Stamp the marker attribute on <html>. The CSS + runtime both gate on it.
  const htmlTag = /<html\b([^>]*)>/i;
  let out: string;
  if (htmlTag.test(html)) {
    out = html.replace(htmlTag, (full, attrs: string) =>
      / data-ol-motion[=\s>]/.test(full)
        ? full
        : `<html${attrs} data-ol-motion="${preset}">`,
    );
  } else {
    // Degenerate fragment without <html> — anchor the attr on a wrapper so the
    // selectors still resolve. Rare; the normalizer gives every page an <html>.
    out = `<html data-ol-motion="${preset}">${html}</html>`;
  }

  const style = `<style data-ol-motion>${motionCss(preset)}</style>`;
  const script = `<script data-ol-motion>${MOTION_RUNTIME_JS}</script>`;

  // Style into <head> (after the page's own styles so it doesn't fight them);
  // runtime before </body> (DOM is parsed by the time it runs).
  const headClose = /<\/head\s*>/i;
  out = headClose.test(out)
    ? out.replace(headClose, (c) => `${style}${c}`)
    : out.replace(/<body\b[^>]*>/i, (b) => `${b}${style}`);

  const bodyIdx = out.lastIndexOf("</body>");
  out =
    bodyIdx === -1
      ? out + script
      : out.slice(0, bodyIdx) + script + out.slice(bodyIdx);
  return out;
}
