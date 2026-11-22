/**
 * WHAT THE CHAT TAKES FROM A VISUAL'S FRAME (local spec 2026-10-16-len-inline-visuals, §4.3–4.6; spec local
 * 2026-11-22-visuales-de-verdad, §2). One core for the web's frame and the phone's: what comes back is trusted only from
 * that frame and its origin; a link only when the frame isn't isolated and only http(s); a prompt (`sendPrompt`) only
 * within 5 s of a tap into the frame, once per tap; and what the visual shares about itself (`updateModelContext`) at any
 * time — it is the visual's state, which the screen keeps and the agent reads only when it asks. An isolated frame (code
 * a visitor could steer) never reports a state. Pure and client-safe.
 */
import { cleanVisualContext } from "@/lib/agent/visuals/model-context";

import { isFrameToParent } from "./protocol";

/** The tallest a visual is drawn. */
export const VISUAL_MAX_HEIGHT_PX = 2000;
/** How long after a tap into the frame a prompt from it still counts once focus has left the frame. */
export const VISUAL_CLICK_WINDOW_MS = 5000;
/** How long a prompt still counts while the person stays focused inside the frame (e.g. a multi-card exercise set). */
export const VISUAL_FOCUSED_WINDOW_MS = 10 * 60_000;

export interface VisualFrameHostOptions {
  /** The frame's origin, or null for a `srcdoc` frame (its messages come from "null"). */
  readonly frameOrigin: string | null;
  readonly isolated: boolean;
  readonly now: () => number;
  /** Whether this frame is still the active focused element in a visible page. When omitted, only `VISUAL_CLICK_WINDOW_MS` applies. */
  readonly isFocused?: () => boolean;
  onReady(): void;
  onHeight(h: number): void;
  onLink(href: string): void;
  onPrompt?(text: string): void;
  onState?(text: string): void;
}

export function createVisualFrameHost(o: VisualFrameHostOptions): { onMessage(e: MessageEvent, frame: Window | null): void; markClick(): void } {
  let tappedAt: number | null = null;
  return {
    markClick() {
      tappedAt = o.now();
    },
    onMessage(e, frame) {
      if (!frame || e.source !== frame) return;
      if (e.origin !== (o.frameOrigin ?? "null")) return;
      if (!isFrameToParent(e.data)) return;
      const d = e.data;
      if (d.kind === "ol-visual:ready") o.onReady();
      else if (d.kind === "ol-visual:height") o.onHeight(Math.min(VISUAL_MAX_HEIGHT_PX, Math.max(0, Math.round(d.height))));
      else if (d.kind === "ol-visual:link") {
        if (!o.isolated && /^https?:\/\//i.test(d.href)) o.onLink(d.href);
      } else if (d.kind === "ol-visual:prompt") {
        const elapsed = tappedAt !== null ? o.now() - tappedAt : Infinity;
        const allowed = elapsed < VISUAL_CLICK_WINDOW_MS || (Boolean(o.isFocused?.()) && elapsed < VISUAL_FOCUSED_WINDOW_MS);
        if (o.onPrompt && allowed) {
          tappedAt = null;
          o.onPrompt(d.text);
        }
      } else if (d.kind === "ol-visual:context") {
        if (!o.isolated) o.onState?.(cleanVisualContext(d.text));
      }
    },
  };
}
