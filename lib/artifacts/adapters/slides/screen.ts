/**
 * A deck lays its slides out at their real size (1920×1080 for Claude-style decks), because that is what the
 * renderer measures, prints and turns into PowerPoint. On a narrower screen — the preview pane, a laptop opening a
 * downloaded deck.html — that showed only each slide's top-left corner behind scroll bars. This screen-only rule
 * zooms every slide down to the page's width with CSS alone (a deck runs no scripts): tan(atan2(a, b)) is a / b as
 * a plain number, and 100cqw is the page's width without its scroll bar. At the slide's own width and in print it
 * does nothing, so renders, PDFs and the PPTX measurements stay as they were.
 *
 * No imports: deck.ts puts the rule in every new deck, so this module cannot depend on it back.
 */
export function deckScreenCss(slideWidth: number): string {
  return `@media screen and (max-width:${slideWidth - 0.02}px){body{container-type:inline-size}.slide{zoom:min(1,tan(atan2(100cqw,${slideWidth}px)))}}`;
}

/** The rule at the end of the deck's head, or at the end of the document when it has none. */
export function withDeckScreenCss(html: string, slideWidth: number): string {
  const style = `<style>${deckScreenCss(slideWidth)}</style>`;
  const head = html.indexOf("</head>");
  return head === -1 ? html + style : html.slice(0, head) + style + html.slice(head);
}

/** The slide width a saved deck was laid out at: a v1 deck says its own; a Claude-style deck (version 3), or one
 *  whose deck.json cannot be read, is `claudeWidth` (deck.ts's SLIDE_WIDTH, passed in by the caller). */
export function deckSlideWidth(files: Readonly<Record<string, string>>, claudeWidth: number): number {
  try {
    const deck = JSON.parse(files["deck.json"] ?? "") as { version?: unknown; width?: unknown };
    if (deck.version !== 3 && Number.isSafeInteger(deck.width) && (deck.width as number) >= 320 && (deck.width as number) <= 4096) return deck.width as number;
  } catch { /* not a readable deck.json: the Claude-style width */ }
  return claudeWidth;
}
