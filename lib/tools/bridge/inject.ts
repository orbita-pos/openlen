// WHERE window.openlen COMES FROM (spec local 2026-11-04-herramientas-hechas-por-len, §4.4): one script tag, first in
// the tool's <head> so the bridge exists before its bundle runs — in the installed release, in its project's
// canvas and in Len's eyes. Pure. The scan for the <head> is the shared, linear one (`head-scan.ts`).
import { insertFirstInHead } from "./head-scan";

export const TOOL_BRIDGE_PATH = "/openlen/tool-bridge.js";
const SCRIPT_TAG = `<script src="${TOOL_BRIDGE_PATH}"></script>`;

/** Idempotent: a document that already has the tag first in its <head> (or, with no <head>, first of all) is returned as it is. */
export function injectToolBridge(html: string): string {
  const inHead = insertFirstInHead(html, SCRIPT_TAG);
  if (inHead !== null) return inHead;
  return html.startsWith(SCRIPT_TAG) ? html : SCRIPT_TAG + html;
}
