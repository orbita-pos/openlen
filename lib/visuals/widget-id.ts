/**
 * A VISUAL'S ID (spec local 2026-11-22-visuales-de-verdad, §2): Claude Code names a view `widget_` and 8 characters taken
 * from the tool call that drew it. Here the stored card has no call id, so the id comes from the row that drew it and
 * its place among that row's visuals — the cards with a `widget` of the `show_widget` tool, in order (the filter of
 * `components/workspace-v2/chat/len-reply.tsx`). The web, the phone and the server compute it with this one function,
 * so what a screen reports names a visual the server can check. Pure, with no Node or browser API.
 */

export const WIDGET_ID_PATTERN = /^widget_[a-z0-9]{8}$/;

/** FNV-1a over the UTF-16 units, 32 bits, from `seed`. Not a secret: only a stable, short name. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function widgetIdOf(rowId: string, index: number): string {
  const key = `${rowId}:${index}`;
  const a = fnv1a(key, 0x811c9dc5).toString(36).padStart(7, "0");
  const b = fnv1a(key, 0x01000193).toString(36).padStart(7, "0");
  return `widget_${(a + b).slice(0, 8)}`;
}
