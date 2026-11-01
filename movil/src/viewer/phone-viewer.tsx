// The phone's viewer of what Len delivered (spec local 2026-10-31-len-movil, §5.1): the viewer the web
// uses too (`components/viewer`), fed by the phone. Bytes come through the phone's client, with its key
// in a header (an <img src> can't carry it); an HTML opens on the canvas host through the view route;
// and instead of a download, Share and Open with another app.
import { useCallback, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { Viewer, type ViewerFile } from "@/components/viewer/viewer";

import { useAtras } from "../atras";
import { openWith, shareFile } from "./file-actions";

async function blobFrom(c: ClienteDeOpenLen, url: string): Promise<Blob> {
  const res = await c.pedir(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}

/** `onGoToChat`: opened from «Entregado», the viewer also leads to the chat turn that delivered the file. */
export function PhoneViewer({ cliente, file, onClose, onGoToChat }: { cliente: ClienteDeOpenLen; file: ViewerFile; onClose: () => void; onGoToChat?: () => void }) {
  const t = useTranslations("movil.entregado");
  const [busy, setBusy] = useState(false);
  useAtras(true, onClose);
  const loadBytes = useCallback((url: string) => blobFrom(cliente, url), [cliente]);
  const openHtml = useCallback(async (url: string) => {
    const res = await cliente.pedir(`${url}/view`, { method: "POST" });
    const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
    if (!res.ok || typeof body?.url !== "string") throw new Error(String(res.status));
    return body.url;
  }, [cliente]);
  const act = (run: (f: ViewerFile, blob: Blob) => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await run(file, await blobFrom(cliente, file.url));
    } catch {
      // Cancelling the share sheet lands here too: nothing to say.
    } finally {
      setBusy(false);
    }
  };
  return (
    <Viewer
      file={file}
      loadBytes={loadBytes}
      openHtml={openHtml}
      onClose={onClose}
      actions={
        <>
          <button type="button" data-share="" disabled={busy} onClick={act(shareFile)}>
            {t("compartir")}
          </button>
          <button type="button" data-open-with="" disabled={busy} onClick={act(openWith)}>
            {t("abrirCon")}
          </button>
          {onGoToChat && (
            <button type="button" data-go-to-chat="" onClick={onGoToChat}>
              {t("verEnChat")}
            </button>
          )}
        </>
      }
      labels={{ close: t("cerrar"), download: t("abrirCon"), noPreview: t("sinVista"), loading: t("abriendo"), failed: t("fallo"), page: (n, total) => `${n} / ${total}` }}
    />
  );
}
