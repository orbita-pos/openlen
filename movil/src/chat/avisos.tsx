// AN EVENT TASK'S CARDS IN THE PHONE'S CHAT (spec local 2026-11-03-len-que-avisa, §8): the web's card and its two
// buttons, over the conversation, posting to the same route. «Hazlo» starts Len's turn on the server: the chat
// shows it as it shows any turn that started elsewhere. A decided card stays a day as a line that says how it
// ended; a push's card (`resaltar`) is brought into view.
//
// The cards are rows of their own, never chat messages: what a judge wrote from a visitor's data never enters
// the conversation.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";

import "./avisos.css";

/** One card as GET /api/projects/[id]/event-cards gives it. */
export interface TarjetaDeAviso {
  readonly id: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly title: string;
  readonly summary: string;
  readonly proposedAction: string;
  readonly status: "pending" | "accepted" | "dismissed" | "replaced";
  readonly acceptedRowId: string | null;
  readonly createdAt: string;
}

const DIA_MS = 86_400_000;
/** The watcher looks every 60 s: the chat looks as often while it is open. */
const MIRAR_CADA_MS = 60_000;

function Tarjeta({ t, tarjeta, resaltada, children }: { t: ReturnType<typeof useTranslations>; tarjeta: TarjetaDeAviso; resaltada: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (resaltada) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [resaltada]);
  return (
    <article ref={ref} data-aviso={tarjeta.id} className={`ch-aviso${resaltada ? " is-resaltado" : ""}${tarjeta.status === "pending" ? "" : " is-decidida"}`}>
      <small className="ch-aviso-de">{t("eventTasks.cardFrom", { task: tarjeta.taskTitle })}</small>
      <strong className="ch-aviso-titulo">{tarjeta.title}</strong>
      {children}
    </article>
  );
}

export function AvisosDeLen({ cliente, projectId, abierto, resaltar }: { cliente: ClienteDeOpenLen; projectId: string; abierto: boolean; resaltar: string | null }) {
  const t = useTranslations("movil");
  const [tarjetas, setTarjetas] = useState<readonly TarjetaDeAviso[]>([]);
  const [decidiendo, setDecidiendo] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const ruta = `/api/projects/${encodeURIComponent(projectId)}/event-cards`;
  const cargar = useCallback(async () => {
    try {
      const res = await cliente.pedir(ruta);
      const body = res.ok ? ((await res.json()) as { cards?: unknown }) : null;
      if (Array.isArray(body?.cards)) setTarjetas(body.cards as TarjetaDeAviso[]);
    } catch {
      // Without network now; the next look reads again.
    }
  }, [cliente, ruta]);
  useEffect(() => {
    setTarjetas([]);
    if (!abierto) return;
    void cargar();
    const cada = setInterval(() => void cargar(), MIRAR_CADA_MS);
    return () => clearInterval(cada);
  }, [abierto, cargar]);

  const decidir = async (tarjeta: TarjetaDeAviso, action: "accept" | "dismiss") => {
    setDecidiendo(tarjeta.id);
    setFallo(null);
    const res = await cliente
      .pedir(`${ruta}/${encodeURIComponent(tarjeta.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) })
      .catch(() => null);
    setDecidiendo(null);
    if (!res?.ok) setFallo(tarjeta.id);
    await cargar();
  };

  // The pending ones, and a day of the decided: the web keeps the week under «Avisos anteriores».
  const ahora = Date.now();
  const visibles = tarjetas.filter((c) => c.status === "pending" || ahora - Date.parse(c.createdAt) < DIA_MS || c.id === resaltar);
  if (visibles.length === 0) return null;
  const estado = (c: TarjetaDeAviso) => (c.status === "accepted" ? t("eventTasks.done") : c.status === "dismissed" ? t("eventTasks.dismissed") : t("eventTasks.replaced"));
  return (
    <div className="ch-avisos" role="status">
      {visibles.map((c) =>
        c.status === "pending" ? (
          <Tarjeta key={c.id} t={t} tarjeta={c} resaltada={resaltar === c.id}>
            <p className="ch-aviso-resumen">{c.summary}</p>
            <div className="ch-aviso-propuesta" data-aviso-propuesta="">
              <small>{t("eventTasks.proposed")}</small>
              <span>{c.proposedAction}</span>
            </div>
            {fallo === c.id && (
              <small role="alert" className="ch-aviso-fallo">
                {t("eventTasks.failed")}
              </small>
            )}
            <div className="ch-aviso-botones">
              <button type="button" className="ch-aviso-hazlo" data-aviso-hazlo="" disabled={decidiendo === c.id} onClick={() => void decidir(c, "accept")}>
                {t("eventTasks.accept")}
              </button>
              <button type="button" className="ch-aviso-ahora-no" data-aviso-ahora-no="" disabled={decidiendo === c.id} onClick={() => void decidir(c, "dismiss")}>
                {t("eventTasks.dismiss")}
              </button>
            </div>
          </Tarjeta>
        ) : (
          <Tarjeta key={c.id} t={t} tarjeta={c} resaltada={resaltar === c.id}>
            <small className="ch-aviso-estado">{estado(c)}</small>
          </Tarjeta>
        ),
      )}
    </div>
  );
}
