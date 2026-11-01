// What Len delivered with `present`, as cards in the phone's chat (spec local 2026-10-31-len-movil,
// §5.1), like the web's: tapping one opens the viewer, over everything (a portal on the body).
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { DeliveredFile } from "@/lib/agent/skills/present";

import { PhoneViewer } from "../viewer/phone-viewer";
import "./adjuntos.css";

function size(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function DeliveredCards({ cliente, archivos }: { cliente: ClienteDeOpenLen; archivos: readonly DeliveredFile[] }) {
  const t = useTranslations("movil.entregado");
  const [open, setOpen] = useState<DeliveredFile | null>(null);
  return (
    <div className="ch-entregado" aria-label={t("titulo")}>
      {archivos.map((f) => (
        <button key={f.url} type="button" className="ch-entregado-card" data-delivered-card="" onClick={() => setOpen(f)}>
          <b>{f.name}</b>
          <small>{f.description ? `${f.description} · ${size(f.size)}` : size(f.size)}</small>
        </button>
      ))}
      {open && createPortal(<PhoneViewer cliente={cliente} file={open} onClose={() => setOpen(null)} />, document.body)}
    </div>
  );
}
