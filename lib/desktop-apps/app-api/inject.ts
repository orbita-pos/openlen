// WHERE window.openlenApp COMES FROM (spec local 2026-11-27-notificaciones-del-escritorio, §4.2 and §8): one script tag,
// first in the <head> of every app's shell on the desktop, so the API exists before the app's bundle runs — before the
// tool bridge's tag too, when the row is a tool. Pure. The twin of `lib/tools/bridge/inject.ts` and the same linear scan
// for the <head> (`lib/tools/bridge/head-scan.ts`: the shell is the author's, this runs on every request), with one
// difference: a shell with no <head> does not get the tag in front of its doctype (that would put the page in quirks mode).
import { insertFirstInHead, openTagEnd } from "@/lib/tools/bridge/head-scan";

import { APP_API_PATH } from "./protocol";

const SCRIPT_TAG = `<script src="${APP_API_PATH}"></script>`;

/** Idempotent: a document that already has the tag first in its <head> (or first where it would otherwise go) is returned as it is. */
export function injectAppApi(html: string): string {
  const inHead = insertFirstInHead(html, SCRIPT_TAG);
  if (inHead !== null) return inHead;
  const htmlEnd = openTagEnd(html, "html");
  if (htmlEnd >= 0) return `${html.slice(0, htmlEnd)}<head>${SCRIPT_TAG}</head>${html.slice(htmlEnd)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return html.startsWith(SCRIPT_TAG, at) ? html : html.slice(0, at) + SCRIPT_TAG + html.slice(at);
}
