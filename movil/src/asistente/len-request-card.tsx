// LEN'S CARD IN HER CHAT (spec local 2026-11-16-movil-es-tu-asistente, §5.4): what she passed to Len, as it goes — in
// line, Len working (his steps, «Parar»), done (what he said last, «Antes / Ahora», «Publicar»), couldn't, or lost. One
// chat: you see Len's work here, and you talk only to her.
import { useTranslations } from "use-intl";

import type { LenRequestRef } from "@/lib/assistants/len-request-ref";
import type { LenRequestView } from "@/lib/assistants/len-requests";

import { parrafos } from "../chat/hilo";
import { Progreso } from "../entrega/entrega";
import { pasosDelTrabajo } from "../entrega/progreso";
import "./len-request-card.css";

export function LenRequestCard(p: {
  view: LenRequestView | undefined;
  lenRef: LenRequestRef;
  /** The project it went to, by name. */
  projectTitle: string;
  /** Hers: «ask her again». */
  name: string;
  onStop: (turnoId: string) => void;
  onCompare: () => void;
  onPublish: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations("movil.asistente");
  const v = p.view;
  const status = v?.status ?? "queued";
  const said = status === "done" ? parrafos(v?.turn?.assistantReasoning ?? "").at(-1) ?? "" : "";
  return (
    <div className="lenreq" data-len-request={p.lenRef.filaId} data-status={status}>
      {status === "queued" && <p className="lenreq-st">{t("lenEnCola")}</p>}
      {status === "running" && (
        <>
          <p className="lenreq-st lenreq-live">{t("lenTrabajandoEn", { project: p.projectTitle })}</p>
          <Progreso pasos={pasosDelTrabajo(v?.turn?.actions ?? [])} trabajando />
          {v?.turnoId && (
            <div className="lenreq-acc">
              <button type="button" className="lm-btn lm-sec" onClick={() => p.onStop(v.turnoId!)}>{t("parar")}</button>
            </div>
          )}
        </>
      )}
      {status === "done" && (
        <>
          <p className="lenreq-st">{t("lenTermino")}</p>
          {said && <p className="lenreq-dijo">{said}</p>}
          <div className="lenreq-acc">
            <button type="button" className="lm-btn lm-sec" onClick={p.onCompare}>{t("antesAhora")}</button>
            <button type="button" className="lm-btn lm-pri" onClick={p.onPublish}>{t("publicar")}</button>
          </div>
        </>
      )}
      {status === "failed" && (
        <p className="lenreq-st" role="alert">{v?.reason === "no_credits" ? t("sinCreditos") : t("lenNoPudo")}</p>
      )}
      {status === "lost" && <p className="lenreq-st" role="alert">{t("lenSePerdio", { name: p.name })}</p>}
      {v?.turn && (
        <button type="button" className="lenreq-ver" onClick={p.onOpen}>{t("verLoQueHizo")}</button>
      )}
    </div>
  );
}
