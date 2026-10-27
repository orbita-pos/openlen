// The workshop's side of the «@» highlight (spec local 2026-10-27, §6.5):
//
//   workshop → canvas  { type: "openlen:mention-highlight", key, target }   (null target clears)
//   canvas → workshop  { type: "openlen:mention-highlighted", key, count }  (0 = not on screen now)
//
// A page canvas answers in the section-select script (`use-section-select.ts`),
// an app canvas in the Design mode script (`design-mode/inject-design-mode.ts`).

import type { AppTarget, PageTarget } from "@/lib/mentions/types";

export function highlightMention(win: Window | null | undefined, key: string, target: PageTarget | AppTarget | null): void {
  try {
    win?.postMessage({ type: "openlen:mention-highlight", key, target }, "*");
  } catch {
    // A canvas that is reloading has no window to talk to: nothing to outline.
  }
}

export function onMentionHighlighted(handler: (key: string, count: number) => void): () => void {
  const listener = (e: MessageEvent) => {
    const d = e.data as { type?: unknown; key?: unknown; count?: unknown } | null;
    if (d && d.type === "openlen:mention-highlighted" && typeof d.key === "string" && typeof d.count === "number") {
      handler(d.key, d.count);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
