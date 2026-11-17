// WHAT LEN DID, TO READ (spec local 2026-11-16-movil-es-tu-asistente, §5.4.9, §5.5): in her app there is one chat, hers;
// Len's turns are read here — what was asked (and who passed it), what Len said, his steps — with nowhere to type, as
// Claude Code shows a subagent's transcript. Reread every 4 s while Len works.
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { StoredChatTurn } from "@/lib/projects/types";

import { leerTurno } from "../api/proyectos";
import { useAtras } from "../atras";
import { parrafos } from "../chat/hilo";
import { Progreso } from "../entrega/entrega";
import { pasosDelTrabajo } from "../entrega/progreso";
import "../gestion/gestion.css";
import "./len-turn-view.css";

const EVERY_MS = 4000;

export function LenTurnView({ cliente, fila, projectTitle, onClose }: { cliente: ClienteDeOpenLen; fila: string; projectTitle: string; onClose: () => void }) {
  const t = useTranslations("movil.asistente");
  const [turn, setTurn] = useState<StoredChatTurn | null>(null);
  const [gone, setGone] = useState(false);
  useAtras(true, onClose);

  useEffect(() => {
    let off = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const r = await leerTurno(cliente, fila);
        if (off) return;
        setTurn(r.turno);
        setGone(false);
        if (r.turno.enCurso) timer = setTimeout(() => void read(), EVERY_MS);
      } catch {
        if (!off) setGone(true);
      }
    };
    void read();
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [cliente, fila]);

  const from = turn?.origen && "kind" in turn.origen && turn.origen.kind === "assistant" ? turn.origen.assistantName : null;
  return (
    <section className="app-gestion lm-m lm-marca app-len-turn" role="dialog" aria-modal="true" aria-labelledby="len-turn-title">
      <header className="lenturn-top">
        <div>
          <p className="gestion-ceja">{projectTitle}</p>
          <h1 id="len-turn-title">{t("loQueHizoLen")}</h1>
        </div>
        <button className="gestion-cerrar" onClick={onClose} aria-label={t("cerrar")}>×</button>
      </header>
      <div className="gestion-cuerpo lenturn-body">
        {gone ? (
          <p role="alert">{t("turnoNoEsta")}</p>
        ) : !turn ? (
          <p role="status">{t("cargandoTurno")}</p>
        ) : (
          <>
            {turn.userText.trim() && (
              <div className="lenturn-asked">
                {from && <small>{t("deElla", { name: from })}</small>}
                <p>{turn.userText.trim()}</p>
              </div>
            )}
            <Progreso pasos={pasosDelTrabajo(turn.actions ?? [])} trabajando={turn.enCurso === true} />
            {parrafos(turn.assistantReasoning).map((p, i) => (
              <p key={i} className="lenturn-said">{p}</p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
