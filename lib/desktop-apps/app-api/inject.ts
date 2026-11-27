// WHERE window.openlenApp COMES FROM (spec local 2026-11-27-notificaciones-del-escritorio, §4.2 and §8): one script tag,
// first in the <head> of every app's shell on the desktop, so the API exists before the app's bundle runs — before the
// tool bridge's tag too, when the row is a tool. Pure. The twin of `lib/tools/bridge/inject.ts`, with two differences:
//   · a shell with no <head> does not get the tag in front of its doctype (that would put the page in quirks mode);
//   · the scan is LINEAR. The shell is the author's and this runs in the server's own process on every request, so an
//     open tag is found without a pattern that can backtrack: `/<head(\s[^>]*)?>/` on a megabyte of `<head <head …` with
//     no `>` retries at every `<head` and scans to the end each time. Here a candidate is `<head` followed by `>` or a
//     blank (a lookahead, nothing to backtrack), and if the first `>` after it does not exist none after it can either.
import { APP_API_PATH } from "./protocol";

const SCRIPT_TAG = `<script src="${APP_API_PATH}"></script>`;

/** Where the open tag `<name …>` ends (the index after its `>`), or -1: the first one in the text, case-insensitive. */
function openTagEnd(html: string, name: "head" | "html"): number {
  const candidate = new RegExp(`<${name}(?=[\\s>])`, "gi");
  const m = candidate.exec(html);
  if (!m) return -1;
  const close = html.indexOf(">", m.index + name.length + 1);
  return close < 0 ? -1 : close + 1;
}

/** Idempotent: a document that already has the tag is returned as it is. */
export function injectAppApi(html: string): string {
  if (html.includes(SCRIPT_TAG)) return html;
  const headEnd = openTagEnd(html, "head");
  if (headEnd >= 0) return html.slice(0, headEnd) + SCRIPT_TAG + html.slice(headEnd);
  const htmlEnd = openTagEnd(html, "html");
  if (htmlEnd >= 0) return `${html.slice(0, htmlEnd)}<head>${SCRIPT_TAG}</head>${html.slice(htmlEnd)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype[0].length) + SCRIPT_TAG + html.slice(doctype[0].length);
  return SCRIPT_TAG + html;
}
