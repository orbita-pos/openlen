// Links in chat text — what Len writes and what the person writes, also while
// they type in the composer. Pure and client-safe.
//
// A bare URL follows GitHub Flavored Markdown's autolink rule (what Claude's
// chat renders): it starts at `http://` or `https://` and runs to the first
// space; trailing punctuation is not part of it, and neither is a closing `)`
// that has no `(` inside the URL — "(see https://x.com)" links `https://x.com`.
// Only http(s): nothing else becomes an `href`.

export interface LinkPiece {
  readonly text: string;
  /** Present when the piece is a link: the address it opens. */
  readonly href?: string;
}

const BARE_URL = /https?:\/\/[^\s<>`"]+/g;
const TRAILING_PUNCTUATION = /[.,:;!?'*_~»”’]+$/u;

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/** The URL without what GFM leaves out at its end. */
export function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCTUATION, "");
  while (url.endsWith(")") && count(url, "(") < count(url, ")")) url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  while (url.endsWith("]") && count(url, "[") < count(url, "]")) url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  return url;
}

/** The text cut into plain pieces and links, losing no character. */
export function splitLinks(text: string): LinkPiece[] {
  const pieces: LinkPiece[] = [];
  let from = 0;
  for (const m of text.matchAll(BARE_URL)) {
    const url = trimUrl(m[0]);
    // "https://" alone, or eaten whole by the trimming, is not a link.
    if (url.length <= url.indexOf("//") + 2) continue;
    const at = m.index;
    if (at > from) pieces.push({ text: text.slice(from, at) });
    pieces.push({ text: url, href: url });
    from = at + url.length;
  }
  if (from < text.length || pieces.length === 0) pieces.push({ text: text.slice(from) });
  return pieces;
}

export function hasLink(text: string): boolean {
  return splitLinks(text).some((p) => p.href !== undefined);
}
