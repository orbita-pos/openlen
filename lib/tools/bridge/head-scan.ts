// FINDING THE <head> OF A SHELL, LINEARLY — the one scan behind every script tag OpenLen puts first in an app's <head>
// (the tools' bridge, `lib/tools/bridge/inject.ts`; the desktop's `window.openlenApp`, `lib/desktop-apps/app-api/inject.ts`).
// Pure. The shell is the AUTHOR's text and this runs in the server's own process on every request that serves it, so
// there is no pattern that can backtrack: `/<head(\s[^>]*)?>/` on `"<head ".repeat(n)` retries at every `<head` and
// scans to the end each time (75 KB took 1.2 s, 300 KB 20 s). Here:
//   · a candidate is `<name` followed by a blank or `>` (a lookahead: nothing to backtrack, `<header` is not one);
//   · only the FIRST candidate is tried, and its tag is walked once, character by character, to its `>`; when it never
//     reaches one (the text ends first, or a quote never closes) nothing after it can either, so the answer is «no tag»;
//   · a `>` inside a QUOTED attribute value does not end the tag — a quote opens a value only right after `=` (in
//     `data-x=a"b` the quote is part of an unquoted value, as a browser reads it), and closes at the next same quote.
// It does not read comments, `<script>` text or any other raw-text element: whatever it mis-reads there only puts the tag
// somewhere a browser does not run it, which the author did to themself.

/** The index right after the `>` of the first `<name …>` open tag (`head` or `html`, any case), or -1 when there is none. */
export function openTagEnd(html: string, name: "head" | "html"): number {
  const candidate = new RegExp(`<${name}(?=[\\s>])`, "i").exec(html);
  if (!candidate) return -1;
  let prev = "";
  for (let i = candidate.index + name.length + 1; i < html.length; i++) {
    const c = html[i]!;
    if (c === ">") return i + 1;
    if ((c === '"' || c === "'") && prev === "=") {
      const close = html.indexOf(c, i + 1);
      if (close < 0) return -1;
      i = close;
      prev = c;
      continue;
    }
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r" && c !== "\f") prev = c;
  }
  return -1;
}

/** `tag` as the first thing in the <head>: the document with it there, the document itself when it already is the first
 *  thing there (the same tag anywhere else does not count), or `null` when the document has no <head> open tag. */
export function insertFirstInHead(html: string, tag: string): string | null {
  const at = openTagEnd(html, "head");
  if (at < 0) return null;
  return html.startsWith(tag, at) ? html : html.slice(0, at) + tag + html.slice(at);
}
