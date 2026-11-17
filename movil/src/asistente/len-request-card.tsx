// LEN'S CARD IN HER CHAT (spec local 2026-11-16-movil-es-tu-asistente, §5.4): what she passed to Len, as it goes — in
// line, Len working (his steps, «Parar»), done (what he said last; «Antes / Ahora» and «Publicar» only if he changed
// the page), asking you something («Contestar»), stopped, couldn't, or lost. One chat: you see Len's work here, and you
// talk only to her.
import { useTranslations } from "use-intl";

import type { LenRequestRef } from "@/lib/assistants/len-request-ref";
import type { LenRequestView } from "@/lib/assistants/len-requests";

import { parrafos, pendingQuestionOf } from "../chat/hilo";
import { esEntrega, Progreso } from "../entrega/entrega";
import { pasosDelTrabajo } from "../entrega/progreso";
import "./len-request-card.css";

export function LenRequestCard(p: {
  view: LenRequestView | undefined;
  lenRef: LenRequestRef;
  /** The project it went to, by name. */
  projectTitle: string;
  /** Its project is no longer in your list (deleted, or no longer shared): nothing to open. */
  gone?: boolean;
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
  const turn = v?.turn;
  const question = status === "done" && turn ? pendingQuestionOf(turn) : null;
  const asked = question ? (question.preguntas?.[0]?.question ?? question.pregunta ?? "") : "";
  const said = status === "done" || status === "stopped" ? parrafos(turn?.assistantReasoning ?? "").at(-1) ?? "" : "";
  // What a delivery is everywhere on the phone (Entregado): applied, a change to the page, not cut, not a question.
  const changed = status === "done" && esEntrega(turn);
  if (p.gone) {
    return (
      <div className="lenreq" data-len-request={p.lenRef.filaId} data-status="gone">
        <p className="lenreq-st">{t("proyectoNoEsta")}</p>
      </div>
    );
  }
  // What you can do with it, as one row of links under what Len said (the clean look of a message, not a form).
  const links: { key: string; label: string; onClick: () => void; main?: boolean }[] = [
    ...(status === "running" && v?.turnoId ? [{ key: "stop", label: t("parar"), onClick: () => p.onStop(v.turnoId!) }] : []),
    ...(question ? [{ key: "answer", label: t("contestar"), onClick: p.onOpen, main: true }] : []),
    ...(changed ? [{ key: "compare", label: t("antesAhora"), onClick: p.onCompare }, { key: "publish", label: t("publicar"), onClick: p.onPublish, main: true }] : []),
    ...(turn && !question ? [{ key: "open", label: t("verLoQueHizo"), onClick: p.onOpen }] : []),
  ];
  return (
    <div className="lenreq" data-len-request={p.lenRef.filaId} data-status={status}>
      {status === "queued" && <p className="lenreq-st">{t("lenEnCola")}</p>}
      {status === "running" && (
        <>
          <p className="lenreq-st lenreq-live">{t("lenTrabajandoEn", { project: p.projectTitle })}</p>
          <Progreso pasos={pasosDelTrabajo(turn?.actions ?? [])} trabajando />
        </>
      )}
      {status === "done" && (
        <>
          <p className="lenreq-st">{question ? t("lenPregunta") : t("lenTermino")}</p>
          {said && <p className="lenreq-dijo">{said}</p>}
          {asked && <p className="lenreq-dijo lenreq-pregunta">{asked}</p>}
        </>
      )}
      {status === "stopped" && (
        <>
          <p className="lenreq-st">{t("lenSeDetuvo")}</p>
          {said && <p className="lenreq-dijo">{said}</p>}
        </>
      )}
      {status === "failed" && (
        <p className="lenreq-st" role="alert">{v?.reason === "no_credits" ? t("sinCreditos") : t("lenNoPudo")}</p>
      )}
      {status === "lost" && <p className="lenreq-st" role="alert">{t("lenSePerdio", { name: p.name })}</p>}
      {links.length > 0 && (
        <div className="lenreq-acc">
          {links.map((l) => (
            <button key={l.key} type="button" className={`lenreq-link${l.main ? " is-main" : ""}`} onClick={l.onClick}>{l.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
