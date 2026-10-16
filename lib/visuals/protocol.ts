/**
 * THE MESSAGES BETWEEN THE CHAT AND A VISUAL'S FRAME (local spec
 * 2026-10-16-len-inline-visuals, §4.3–4.6). Pure: the chat (client) and the
 * frame document's tests import it.
 */

export type ParentToFrame =
  | { readonly kind: "ol-visual:render"; readonly code: string; readonly final: boolean }
  | { readonly kind: "ol-visual:theme"; readonly theme: "light" | "dark"; readonly tokens: Readonly<Record<string, string>> };

export type FrameToParent =
  | { readonly kind: "ol-visual:ready" }
  | { readonly kind: "ol-visual:height"; readonly height: number }
  | { readonly kind: "ol-visual:link"; readonly href: string }
  | { readonly kind: "ol-visual:prompt"; readonly text: string };

export function isFrameToParent(value: unknown): value is FrameToParent {
  if (!value || typeof value !== "object") return false;
  const v = value as { kind?: unknown; height?: unknown; href?: unknown; text?: unknown };
  switch (v.kind) {
    case "ol-visual:ready":
      return true;
    case "ol-visual:height":
      return typeof v.height === "number" && Number.isFinite(v.height);
    case "ol-visual:link":
      return typeof v.href === "string";
    case "ol-visual:prompt":
      return typeof v.text === "string";
    default:
      return false;
  }
}
