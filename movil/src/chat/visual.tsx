// A VISUAL IN THE PHONE'S CHAT (spec local 2026-11-22-visuales-de-verdad, §1–2).
// Runs in the same `lienzo-visuals` host as the web (or a `srcdoc` frame without `allow-same-origin` when unavailable)
// and shares the web's message-handling core (`createVisualFrameHost`). Follows the phone's light/dark theme with the
// workspace palette (`WORKSPACE_TOOL_THEME`), asks before opening links in the system browser, sends `sendPrompt` only
// right after a tap into the frame, and reports `updateModelContext` under `widgetId`.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";
import { buildVisualFrameDocument } from "@/lib/visuals/frame-document";
import { createVisualFrameHost } from "@/lib/visuals/frame-host";
import type { ParentToFrame } from "@/lib/visuals/protocol";
import type { ReplyWidget } from "@/lib/visuals/split-reply";
import { urlDelMarcoDeVisuales } from "../api/visuales";
import { plataforma } from "../sesion/plataforma";
import "./visual.css";

const LOADING_ROTATE_MS = 2500;

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function tokensFor(theme: "light" | "dark"): Record<string, string> {
  const font = getComputedStyle(document.body).fontFamily.trim();
  return { ...WORKSPACE_TOOL_THEME[theme], ...(font ? { "--font-sans": font } : {}) };
}

export function VisualDelChat({
  widgetId,
  widget,
  final,
  cliente,
  onPrompt,
  onState,
}: {
  widgetId: string;
  widget: ReplyWidget;
  final: boolean;
  cliente: ClienteDeOpenLen;
  onPrompt?: (text: string) => void;
  onState?: (widgetId: string, state: string) => void;
}) {
  const t = useTranslations("movil.visual");
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() => readTheme());
  const [link, setLink] = useState<string | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const onPromptRef = useRef(onPrompt);
  onPromptRef.current = onPrompt;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    let alive = true;
    void urlDelMarcoDeVisuales(cliente).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [cliente]);

  const frameOrigin = useMemo(() => (url ? new URL(url).origin : null), [url]);
  const srcdoc = useMemo(() => buildVisualFrameDocument({ parentOrigins: [], cspInMeta: true }), []);

  const host = useMemo(
    () =>
      createVisualFrameHost({
        frameOrigin,
        isolated: false,
        now: () => Date.now(),
        onReady: () => setReady(true),
        onHeight: (h) => setHeight(h),
        onLink: (href) => setLink(href),
        onPrompt: (text) => onPromptRef.current?.(text),
        onState: (text) => onStateRef.current?.(widgetId, text),
      }),
    [frameOrigin, widgetId],
  );

  const post = (message: ParentToFrame) => {
    ref.current?.contentWindow?.postMessage(message, frameOrigin ?? "*");
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => host.onMessage(e, ref.current?.contentWindow ?? null);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [host]);

  // A tap into the frame blurs this window and focuses the iframe.
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

  // Follow the phone's light/dark theme live (`data-theme` on <html>, tema.ts).
  useEffect(() => {
    setTheme(readTheme());
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready) return;
    post({ kind: "ol-visual:theme", theme, tokens: tokensFor(theme) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` reads the ref and the origin of this render
  }, [ready, theme]);

  useEffect(() => {
    if (!ready) return;
    post({ kind: "ol-visual:render", code: widget.code, final });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `post` reads the ref and the origin of this render
  }, [ready, widget.code, final]);

  useEffect(() => {
    if (final || widget.loadingMessages.length < 2) return;
    const id = setInterval(() => setLoadingIndex((i) => i + 1), LOADING_ROTATE_MS);
    return () => clearInterval(id);
  }, [final, widget.loadingMessages.length]);

  const loading = widget.loadingMessages.length
    ? widget.loadingMessages[loadingIndex % widget.loadingMessages.length]
    : t("visualLoading");

  return (
    <div className="ch-visual" data-testid="len-visual" data-no-deslizar="">
      {url !== undefined && (
        <iframe
          ref={ref}
          title={t("visualLabel", { title: widget.title || "" })}
          {...(url ? { src: url } : { srcDoc: srcdoc })}
          sandbox={url ? "allow-scripts allow-same-origin" : "allow-scripts"}
          referrerPolicy="no-referrer"
          className="ch-visual-frame"
          style={{ height: `${height}px` }}
        />
      )}
      {!final && (
        <p className="ch-visual-loading" aria-live="polite">
          {loading}
        </p>
      )}
      {link && (
        <div role="alertdialog" aria-label={t("visualLinkTitle")} className="ch-visual-link">
          <p className="ch-visual-link-title">{t("visualLinkTitle")}</p>
          <p className="ch-visual-link-href">{link}</p>
          <div className="ch-visual-link-actions">
            <button type="button" className="ch-visual-link-cancel" onClick={() => setLink(null)}>
              {t("visualLinkCancel")}
            </button>
            <button
              type="button"
              className="ch-visual-link-open"
              onClick={() => {
                const href = link;
                setLink(null);
                void plataforma.abrirNavegador(href);
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
