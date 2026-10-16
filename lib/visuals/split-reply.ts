/**
 * WHERE EACH VISUAL GOES IN LEN'S REPLY (local spec 2026-10-16-len-inline-visuals, §4.5).
 *
 * A turn's text arrives as one string and its tool calls as a separate list;
 * each `show_widget` card carries `textOffset`, the characters of text Len had
 * written when it drew the visual. This cuts the text at those points. An
 * offset that no longer fits (the text was trimmed, a retry discarded some, an
 * old row has none) puts the visual at the end: it is never lost.
 */

export interface ReplyWidget {
  readonly title: string | null;
  readonly loadingMessages: readonly string[];
  readonly code: string;
}

export type ReplyPart =
  | { kind: "text"; text: string }
  | { kind: "widget"; key: string; widget: ReplyWidget; live: boolean };

export function splitReplyAtWidgets(
  text: string,
  widgets: readonly { key: string; offset: number | undefined; widget: ReplyWidget; live: boolean }[],
): ReplyPart[] {
  const placed = widgets
    .map((w, order) => {
      const o = w.offset;
      const at = typeof o === "number" && Number.isFinite(o) && o >= 0 ? Math.min(o, text.length) : text.length;
      return { ...w, at, order };
    })
    .sort((a, b) => a.at - b.at || a.order - b.order);
  const parts: ReplyPart[] = [];
  let from = 0;
  for (const w of placed) {
    if (w.at > from) parts.push({ kind: "text", text: text.slice(from, w.at) });
    from = Math.max(from, w.at);
    parts.push({ kind: "widget", key: w.key, widget: w.widget, live: w.live });
  }
  if (from < text.length) parts.push({ kind: "text", text: text.slice(from) });
  return parts;
}
