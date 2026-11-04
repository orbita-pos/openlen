// WHERE window.openlen COMES FROM (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): one script tag, first in
// the tool's <head> so the bridge exists before its bundle runs — in the installed release, in its project's
// canvas and in Len's eyes. Pure.

export const TOOL_BRIDGE_PATH = "/openlen/tool-bridge.js";
const SCRIPT_TAG = `<script src="${TOOL_BRIDGE_PATH}"></script>`;

/** Idempotent: a document that already has the tag is returned as it is. */
export function injectToolBridge(html: string): string {
  if (html.includes(SCRIPT_TAG)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return SCRIPT_TAG + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + SCRIPT_TAG + html.slice(at);
}
