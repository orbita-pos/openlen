// THE PHONE'S «ENTREGADO» (spec local 2026-10-31-len-movil, §5.3), like Claude Duet's Make: everything Len
// delivered, in every project the person can see, newest first; tapping one opens the viewer. The panel
// wears Gestión's look (`.app-gestion`).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { ViewerFile } from "@/components/viewer/viewer";

import { useAtras } from "../atras";
import { fetchDelivered, type DeliveredItem } from "../api/overview";
import { PhoneViewer } from "../viewer/phone-viewer";
import "../gestion/gestion.css";
import "./overview.css";

const fileOf = (d: DeliveredItem): ViewerFile => ({
  name: d.name,
  url: d.url,
  size: d.size,
  ...(d.description ? { description: d.description } : {}),
  ...(d.previewUrl ? { preview: d.previewUrl } : {}),
  projectTitle: d.projectTitle,
});

export function DeliveredTab({ cliente, onCerrar }: { cliente: ClienteDeOpenLen; onCerrar: () => void }) {
  const t = useTranslations("movil.resumen");
  const [items, setItems] = useState<DeliveredItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<ViewerFile | null>(null);
  useAtras(true, onCerrar);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetchDelivered(cliente).then((x) => alive && setItems(x), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [cliente, attempt]);
  const when = (iso: string) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return (
    <section className="app-gestion app-resumen lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby="entregado-titulo">
      <header>
        <div>
          <p className="gestion-ceja">Len</p>
          <h1 id="entregado-titulo">{t("entregado")}</h1>
        </div>
        <button className="gestion-cerrar" onClick={onCerrar} aria-label={t("cerrar")}>
          ×
        </button>
      </header>
      <div className="gestion-cuerpo">
        {failed ? (
          <div className="gestion-error" role="alert">
            <strong>{t("error")}</strong>
            <button onClick={() => setAttempt((n) => n + 1)}>{t("reintentar")}</button>
          </div>
        ) : items === null ? (
          <p role="status">{t("cargando")}</p>
        ) : items.length === 0 ? (
          <p>{t("vacioEntregado")}</p>
        ) : (
          <ul className="resumen-lista">
            {items.map((d) => (
              <li key={d.id}>
                <button type="button" className="resumen-fila" data-delivered-item="" onClick={() => setOpen(fileOf(d))}>
                  <b>{d.name}</b>
                  <small>{[d.projectTitle, d.description, when(d.createdAt)].filter(Boolean).join(" · ")}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && createPortal(<PhoneViewer cliente={cliente} file={open} onClose={() => setOpen(null)} />, document.body)}
    </section>
  );
}
