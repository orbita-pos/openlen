"use client";

// HER PAGE, BESIDE HER CHAT (11/11, Jesús, on the reference he sent: «que muestre la página como ellos lo hacen a la
// derecha»): the page she serves, running, in a pane with a browser's quiet bar — reload, its address, a way to open
// it in a tab of its own. It only shows: nothing here edits the page, and nothing in the page reaches openlen.
//
// It is drawn the way the workshop's canvas draws it (`useLienzoRemoto`): the document is sent to the canvas host —
// another origin, like the published site's — and framed from there; where that host is not there (a machine
// without one, a test), it is the document itself in a frame with no way out (`SANDBOX_LOCAL`). An app's document is
// only its shell, so without the canvas host an app shows nothing: the same as the workshop.
import { ExternalLink, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ALLOW_REMOTO, SANDBOX_LOCAL, SANDBOX_REMOTO } from "../sandbox-del-lienzo";
import { useLienzoRemoto } from "../use-lienzo-remoto";

export function HerPage({
  projectId,
  html,
  address,
  title,
}: {
  projectId: string;
  /** Her home's page, as it is saved. Empty: nothing was made yet. */
  html: string;
  /** Where it is published (`tienda.openlen.app`), or null. */
  address: string | null;
  /** The project's name, shown where there is no address. */
  title: string | null;
}) {
  const t = useTranslations("panelsChat");
  const [reload, setReload] = useState(0);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const canvas = useLienzoRemoto({ html, projectId, pagina: null, activo: html !== "", recarga: reload });
  const ready = useRef(canvas.marcarListo);
  ready.current = canvas.marcarListo;
  // The canvas host says it served our document; without that word in time the hook falls back to the document itself.
  useEffect(() => {
    const heard = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== "object") return;
      const type = (e.data as { type?: unknown }).type;
      if (type === "openlen:lienzo-vivo" || type === "openlen:iframe-ready") ready.current();
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, []);

  const remote = canvas.estado.modo === "remoto" ? canvas.estado.url : null;
  const source = remote ? { src: remote } : canvas.estado.modo === "esperando" ? { src: "about:blank" } : { srcDoc: html };
  const quiet = "her-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] fg-muted transition-colors hover:bg-hover hover:fg";
  return (
    // A card under its tab in her place's top bar (assistant-home.tsx): the tab sits on its top-left corner.
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] rounded-tl-none border bd bg-elev shadow-[0_12px_32px_-20px_rgba(0,0,0,0.55)]"
      data-her-page=""
      aria-label={t("ownAssistant.page.title")}
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b bd px-2.5">
        <button type="button" data-her-page-reload="" onClick={() => setReload((n) => n + 1)} aria-label={t("ownAssistant.page.reload")} title={t("ownAssistant.page.reload")} className={quiet}>
          <RotateCw size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <div className="flex h-7 min-w-0 flex-1 items-center justify-center rounded-[8px] bg-side px-3">
          <span data-her-page-address="" className="truncate text-[12px] fg-muted">
            {address ?? title ?? t("ownAssistant.page.title")}
          </span>
        </div>
        {address && (
          <a data-her-page-open="" href={`https://${address}/`} target="_blank" rel="noreferrer" aria-label={t("ownAssistant.page.open")} title={t("ownAssistant.page.open")} className={quiet}>
            <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
          </a>
        )}
      </div>
      {html === "" ? (
        <p data-her-page-empty="" className="m-auto max-w-[280px] px-6 text-center text-[13.5px] leading-relaxed fg-muted">
          {t("ownAssistant.page.empty")}
        </p>
      ) : (
        <iframe
          key={`${remote ?? "local"}:${reload}`}
          ref={frame}
          {...source}
          title={t("ownAssistant.page.title")}
          // The flags and why: `sandbox-del-lienzo.ts`.
          sandbox={remote ? SANDBOX_REMOTO : SANDBOX_LOCAL}
          {...(remote ? { allow: ALLOW_REMOTO } : {})}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </section>
  );
}
