"use client";

/**
 * A VISUAL IN LEN'S REPLY (local spec 2026-10-16-len-inline-visuals, §4.3–4.6).
 *
 * The iframe on `lienzo-visuals.<lienzo domain>` (or a `srcdoc` without
 * `allow-same-origin` where there is no isolated host), fed by postMessage:
 * the workspace colors, resolved here, and the code — chunk by chunk while Len
 * writes it, then whole. What comes back from the frame is trusted only from
 * that frame: its height, a link (asked about before opening), a prompt (sent
 * only right after the person clicked into the frame, once per click), and what
 * the visual shares about itself — its state, kept by the chat by widget_id (spec
 * local 2026-11-22-visuales-de-verdad). The checks live in `lib/visuals/frame-host.ts`,
 * which the phone's frame uses too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { VISUAL_TOKENS } from "@/lib/agent/visuals/manual";
import { buildVisualFrameDocument } from "@/lib/visuals/frame-document";
import { createVisualFrameHost } from "@/lib/visuals/frame-host";
import type { ParentToFrame } from "@/lib/visuals/protocol";
import type { ReplyWidget } from "@/lib/visuals/split-reply";
import { useVisualFrameUrl } from "@/lib/visuals/use-visual-frame-url";

const LOADING_ROTATE_MS = 2500;

function readTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readTokens(from: Element | null): Record<string, string> {
  const style = getComputedStyle(from ?? document.documentElement);
  const tokens: Record<string, string> = {};
  for (const t of VISUAL_TOKENS) {
    const value = style.getPropertyValue(t.name).trim();
    if (value) tokens[t.name] = value;
  }
  return tokens;
}

export function VisualFrame({
  widget,
  final,
  onPrompt,
  onState,
  widgetId,
  isolated = false,
}: {
  widget: ReplyWidget;
  final: boolean;
  /** Its name in the conversation (`widgetIdOf(row, k)`), for what it shares about itself. */
  widgetId?: string;
  /** Absent for whoever can't write in the chat: the visual can't send then. */
  onPrompt?: (text: string) => void;
  /** What the visual shared about itself (updateModelContext, MCP Apps SEP-1865): its latest state, by `widgetId`. */
  onState?: (widgetId: string, state: string) => void;
  /** Code someone else could steer (a visitor of the owner's assistant, phase 2B of the spec local
   *  2026-11-06-asistente-propio): never on the visuals origin next to the owner's own visuals — a closed srcdoc with a
   *  null origin, no links, and taken down if it navigates its own frame. */
  isolated?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const hostedUrl = useVisualFrameUrl();
  const url = isolated ? null : hostedUrl;
  const frameOrigin = useMemo(() => (url ? new URL(url).origin : null), [url]);
  const srcdoc = useMemo(() => buildVisualFrameDocument({ parentOrigins: [], cspInMeta: true, ...(isolated ? { closed: true } : {}) }), [isolated]);
  const loads = useRef(0);
  const [gone, setGone] = useState(false);
  const [firstLoad, setFirstLoad] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [link, setLink] = useState<string | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const onPromptRef = useRef(onPrompt);
  onPromptRef.current = onPrompt;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  /** The core that checks what the frame says (one per frame origin). */
  const host = useMemo(
    () =>
      createVisualFrameHost({
        frameOrigin,
        isolated,
        now: () => Date.now(),
        onReady: () => setReady(true),
        onHeight: (h) => setHeight(h),
        onLink: (href) => setLink(href),
        onPrompt: (text) => onPromptRef.current?.(text),
        onState: (text) => {
          if (widgetId) onStateRef.current?.(widgetId, text);
        },
      }),
    [frameOrigin, isolated, widgetId],
  );

  const post = (message: ParentToFrame) => {
    ref.current?.contentWindow?.postMessage(message, frameOrigin ?? "*");
  };

  // What the frame says, only from this frame (`createVisualFrameHost`).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => host.onMessage(e, ref.current?.contentWindow ?? null);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [host]);

  // A click into a cross-origin frame blurs this window and focuses the frame.
  useEffect(() => {
    function onBlur() {
      const mark = () => {
        if (document.activeElement === ref.current) host.markClick();
      };
      mark();
      setTimeout(mark, 0);
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [host]);

  // The workspace theme, followed live.
  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready) return;
    post({ kind: "ol-visual:theme", theme, tokens: readTokens(ref.current?.closest(".workspace-v2") ?? null) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` reads the ref and the origin of this render
  }, [ready, theme]);

  // An isolated visual gets its code after the first load: one that navigated earlier would leave a single load in all.
  const canDraw = ready && (!isolated || firstLoad);
  useEffect(() => {
    if (!canDraw) return;
    post({ kind: "ol-visual:render", code: widget.code, final });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` reads the ref and the origin of this render
  }, [canDraw, widget.code, final]);

  // While it is written, its loading messages take turns.
  useEffect(() => {
    if (final || widget.loadingMessages.length < 2) return;
    const id = setInterval(() => setLoadingIndex((i) => i + 1), LOADING_ROTATE_MS);
    return () => clearInterval(id);
  }, [final, widget.loadingMessages.length]);

  const loading = widget.loadingMessages.length
    ? widget.loadingMessages[loadingIndex % widget.loadingMessages.length]
    : t("visualLoading");

  return (
    <div className="my-2 flex flex-col gap-1.5" data-testid="len-visual">
      {url !== undefined && !gone && (
        <iframe
          ref={ref}
          title={t("visualLabel", { title: widget.title || "" })}
          {...(url ? { src: url } : { srcDoc: srcdoc })}
          sandbox={url ? "allow-scripts allow-same-origin" : "allow-scripts"}
          referrerPolicy="no-referrer"
          className="w-full border-0 bg-transparent block"
          style={{ height: `${height}px` }}
          // An isolated visual loads once: a second load is it navigating its own frame somewhere else.
          {...(isolated ? { onLoad: () => (++loads.current > 1 ? setGone(true) : setFirstLoad(true)) } : {})}
        />
      )}
      {!final && <p className="text-[12px] fg-faint m-0" aria-live="polite">{loading}</p>}
      {link && (
        <div role="alertdialog" aria-label={t("visualLinkTitle")} className="rounded-lg border bd bg-elev p-3 flex flex-col gap-2 text-[13px]">
          <p className="m-0 font-medium">{t("visualLinkTitle")}</p>
          <p className="m-0 fg-muted break-all">{link}</p>
          <div className="flex gap-2 justify-end">
            <button type="button" className="px-3 py-1 rounded-md border bd hover:bg-hover" onClick={() => setLink(null)}>
              {t("visualLinkCancel")}
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-md border bd hover:bg-hover"
              onClick={() => {
                window.open(link, "_blank", "noopener,noreferrer");
                setLink(null);
              }}
            >
              {t("visualLinkOpen")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
