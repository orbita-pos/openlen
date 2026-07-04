// Inline text editing for marketing posts. The preview iframe makes tagged text
// elements contentEditable; the user's edits (keyed by a stable per-element id)
// are baked into the export here. Preview and export both run tagEditableText on
// the SAME filled HTML, so the ids match by construction — the tagging heuristic
// only needs to be deterministic, not perfect.

import { escapeHtml } from "./fill";

// Leaf text elements the user can edit. Allowlist of visible-text tags so we
// never touch <style>/<script>/<svg>/<head> content. A leaf = no nested tags in
// its content ([^<]*), which is how curated post designs hold their text.
const TEXT_TAGS =
  "div|span|p|h[1-6]|a|li|strong|em|b|i|small|label|button|figcaption|blockquote|cite";
const LEAF = new RegExp(
  `<(${TEXT_TAGS})\\b([^>]*)>([^<]*[^\\s<][^<]*)</\\1>`,
  "gi",
);

/** Tag each leaf text element with a stable `data-ol-tid="N"` (document order). */
export function tagEditableText(html: string): string {
  let n = 0;
  return html.replace(LEAF, (_m, tag: string, attrs: string, text: string) => {
    if (/\bdata-ol-tid=/.test(attrs)) return _m; // already tagged (idempotent)
    return `<${tag}${attrs} data-ol-tid="${n++}">${text}</${tag}>`;
  });
}

/** Replace the inner text of tagged elements from an edits map ({tid: text}). */
export function applyTextEdits(html: string, edits: Record<string, string>): string {
  if (!edits || Object.keys(edits).length === 0) return html;
  return html.replace(
    /(<([a-z0-9]+)\b[^>]*\bdata-ol-tid="(\d+)"[^>]*>)([^<]*)(<\/\2>)/gi,
    (_m, open: string, _tag: string, tid: string, inner: string, close: string) => {
      const v = edits[tid];
      return v === undefined ? _m : `${open}${escapeHtml(v)}${close}`;
    },
  );
}
