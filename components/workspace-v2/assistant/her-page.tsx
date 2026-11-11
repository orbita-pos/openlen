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
import { useEffect, useMemo, useRef, useState } from "react";

import { ALLOW_REMOTO, SANDBOX_LOCAL, SANDBOX_REMOTO } from "../sandbox-del-lienzo";
import { useLienzoRemoto } from "../use-lienzo-remoto";

/** What tells the canvas host's frame is alive. In the workshop the editor's runtime says it (use-inline-edit.ts); her
 *  page goes without that runtime, so it carries this line, first thing in its head. Without it the canvas host's
 *  deadline passed: the page reloaded twice and fell back to the document itself, where its folder's images, its
 *  forms and an app do not work. */
const ALIVE = `<script>try{parent.postMessage({type:"openlen:lienzo-vivo"},"*")}catch(_){}</script>`;

/** The page with `ALIVE` first in its head (or right after `<html>` or the doctype: never before the doctype, which
 *  would put the page in quirks mode). */
export function withAliveBeacon(html: string): string {
  for (const tag of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const at = tag.exec(html);
    if (at) return html.slice(0, at.index + at[0].length) + ALIVE + html.slice(at.index + at[0].length);
  }
  return ALIVE + html;
}

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
  // What is shown: the page as her place loaded it, and as it is saved now after «Recargar».
  const [page, setPage] = useState(html);
  useEffect(() => setPage(html), [html]);
  const framed = useMemo(() => withAliveBeacon(page), [page]);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const canvas = useLienzoRemoto({ html: framed, projectId, pagina: null, activo: page !== "", recarga: reload });
  /** «Recargar» reads the page as it is saved now (Len may have changed it since her place loaded), then frames it. */
  const reloadPage = async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/raw`, { cache: "no-store" }).catch(() => null);
    const saved = res?.ok ? await res.text().catch(() => null) : null;
    if (saved !== null) setPage(saved);
    setReload((n) => n + 1);
  };
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
  const source = remote ? { src: remote } : canvas.estado.modo === "esperando" ? { src: "about:blank" } : { srcDoc: framed };
  const quiet = "her-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] fg-muted transition-colors hover:bg-hover hover:fg";
  return (
    // A card on her place's ground, under its top bar (assistant-home.tsx).
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border bd bg-elev shadow-[0_12px_32px_-20px_rgba(0,0,0,0.55)]"
      data-her-page=""
      aria-label={t("ownAssistant.page.title")}
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b bd px-2.5">
        <button type="button" data-her-page-reload="" onClick={() => void reloadPage()} aria-label={t("ownAssistant.page.reload")} title={t("ownAssistant.page.reload")} className={quiet}>
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
      {page === "" ? (
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
