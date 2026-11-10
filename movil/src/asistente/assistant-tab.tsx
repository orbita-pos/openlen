// HER TAB IN LEN MÓVIL (spec local 2026-11-06-asistente-propio, §4.6.3, §4.6.2, phase 5): the person's own assistant
// beside «Entregado» and «Tareas», with what her place on the web has — «Hablar» (the phone's own chat, talking to her:
// every message carries her id), «Conversaciones» (what her visitors said, read-only) and «Pedidos» (what they asked
// for and she couldn't do, with the web's «Que Len lo haga» / «Ahora no»). The phone uses her and never manages her:
// renaming her or her morning summary stay on the web, as with Herramientas. Her notices open it on their part.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { AssistantListItem } from "@/lib/assistants/view";
import type { StoredChatTurn } from "@/lib/projects/types";

import { useAtras } from "../atras";
import { leerSuChat, leerSusPedidos, leerSusVisitas, tocarPedido } from "../api/asistente";
import type { ParteDeLaAsistente } from "../avisos/controlador";
import { PantallaChat } from "../chat/chat";
import { useChat } from "../chat/use-chat";
import "../gestion/gestion.css";
import "../overview/overview.css";
import "./asistente.css";

interface Visita {
  readonly id: string;
  readonly projectTitle?: string | null;
  readonly lastAt: string;
  readonly messageCount: number;
  readonly handedOff: boolean;
  readonly lines: readonly { readonly role: string; readonly text: string; readonly at: string }[];
}

interface Pedido {
  readonly id: string;
  readonly title: string;
  readonly visitors: number;
  readonly status: string;
  readonly projectTitle?: string | null;
}

const SIN_HISTORIAL: StoredChatTurn[] = [];
/** The last lines of a conversation the list shows, as the web's. */
const LINEAS = 4;

export function AssistantTab({
  cliente,
  base,
  asistente,
  parte,
  tarjeta,
  idioma,
  onCerrar,
}: {
  cliente: ClienteDeOpenLen;
  base: string;
  asistente: AssistantListItem;
  /** The part a notice of hers opens (none: Conversaciones). */
  parte?: ParteDeLaAsistente;
  /** A request notice's card, highlighted. */
  tarjeta?: string | null;
  idioma: string;
  onCerrar: () => void;
}) {
  const t = useTranslations("movil.asistente");
  const tc = useTranslations("movil.chat");
  const ta = useTranslations("movil.adjuntos");
  const name = asistente.name;
  const [vista, setVista] = useState<"conversaciones" | "pedidos">(parte === "pedidos" ? "pedidos" : "conversaciones");
  const [chatAbierto, setChatAbierto] = useState(parte === "hablar");
  const [historial, setHistorial] = useState<StoredChatTurn[]>(SIN_HISTORIAL);
  const [visitas, setVisitas] = useState<readonly Visita[] | null>(null);
  const [pedidos, setPedidos] = useState<readonly Pedido[] | null>(null);
  const [falla, setFalla] = useState<"noEsta" | "error" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [intento, setIntento] = useState(0);
  // Back: the chat takes it while it is open (PantallaChat), the tab otherwise.
  useAtras(!chatAbierto, onCerrar);

  const fallo = useCallback((e: unknown) => setFalla(e instanceof Error && e.message === "404" ? "noEsta" : "error"), []);
  const recargarChat = useCallback(() => {
    void leerSuChat(cliente, asistente.id).then(setHistorial, fallo);
  }, [cliente, asistente.id, fallo]);
  const recargarPedidos = useCallback(() => leerSusPedidos<Pedido>(cliente, asistente.id).then(setPedidos, fallo), [cliente, asistente.id, fallo]);
  useEffect(() => {
    setFalla(null);
    recargarChat();
    void leerSusVisitas<Visita>(cliente, asistente.id).then(setVisitas, fallo);
    void recargarPedidos();
  }, [cliente, asistente.id, intento, recargarChat, recargarPedidos, fallo]);

  // The phone's own chat, talking to her: her home is the project, and every message carries her id.
  const chat = useChat({
    cliente,
    base,
    projectId: asistente.projectId,
    idioma,
    historial,
    alCambiarLaPagina: recargarChat,
    textoDeFotoSola: tc("fotoSola"),
    textoDeArchivoSolo: ta("archivoSolo"),
    assistantId: asistente.id,
  });

  const tocar = async (cardId: string, accion: "accept" | "dismiss") => {
    setOcupado(true);
    await tocarPedido(cliente, asistente.id, cardId, accion);
    setOcupado(false);
    await recargarPedidos();
  };

  return (
    <section className="app-gestion app-resumen lm-m lm-marca app-asistente" role="dialog" aria-modal="true" aria-labelledby="asistente-titulo">
      <header>
        <div>
          <p className="gestion-ceja">{t("own.place.yours")}</p>
          <h1 id="asistente-titulo">
            <span className="asist-figura" aria-hidden="true" style={{ background: asistente.color }} />
            {name}
          </h1>
        </div>
        <button className="gestion-cerrar" onClick={onCerrar} aria-label={t("cerrar")}>
          ×
        </button>
      </header>
      <div className="gestion-cuerpo">
        {falla ? (
          <div className="gestion-error" role="alert">
            <strong>{falla === "noEsta" ? t("noEsta", { name }) : t("own.place.loadError")}</strong>
            {falla === "error" && <button onClick={() => setIntento((n) => n + 1)}>{t("reintentar")}</button>}
          </div>
        ) : (
          <>
            <button type="button" className="lm-btn asist-hablar" data-asistente-hablar="" onClick={() => setChatAbierto(true)}>
              {t("hablarCon", { name })}
            </button>
            <div role="tablist" className="asist-partes">
              {(["conversaciones", "pedidos"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={vista === k} data-asistente-parte={k} onClick={() => setVista(k)}>
                  {k === "conversaciones" ? t("own.place.conversations") : t("own.requests.tab")}
                </button>
              ))}
            </div>
            {vista === "conversaciones" ? (
              <ul className="asist-lista">
                {visitas?.length === 0 && <li className="asist-vacio">{t("own.place.empty", { name })}</li>}
                {visitas?.map((v) => (
                  <li key={v.id} className="asist-visita">
                    <small>
                      {t("own.place.visitor")} · {t("own.place.messages", { count: v.messageCount })}
                      {v.projectTitle ? ` · ${t("own.place.inProject", { project: v.projectTitle })}` : ""}
                      {v.handedOff ? ` · ${t("own.place.handedOff")}` : ""}
                    </small>
                    {v.lines.slice(-LINEAS).map((l, i) => (
                      <p key={i} className={l.role === "visitor" ? "asist-de-visitante" : "asist-de-ella"}>
                        {l.text}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="asist-lista">
                {pedidos?.length === 0 && <li className="asist-vacio">{t("own.requests.empty", { name })}</li>}
                {pedidos?.map((p) => (
                  <li key={p.id} className="asist-pedido" data-pedido={p.id} data-resaltado={String(p.id === tarjeta)}>
                    <small>{t("own.requests.from", { name })}</small>
                    <b>{p.title}</b>
                    <p>{t("own.requests.visitors", { count: p.visitors })}</p>
                    {p.status === "pending" ? (
                      <div className="asist-acciones">
                        <button type="button" className="lm-btn" data-pedido-hazlo="" disabled={ocupado} onClick={() => void tocar(p.id, "accept")}>
                          {t("own.requests.doIt")}
                        </button>
                        <button type="button" className="lm-btn lm-sec" data-pedido-ahora-no="" disabled={ocupado} onClick={() => void tocar(p.id, "dismiss")}>
                          {t("own.requests.notNow")}
                        </button>
                      </div>
                    ) : (
                      <small>{p.status === "accepted" ? t("own.requests.done") : t("own.requests.dismissed")}</small>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <PantallaChat
        abierto={chatAbierto}
        chat={chat}
        cliente={cliente}
        projectId={asistente.projectId}
        idioma={idioma}
        conPip={false}
        onCerrar={() => setChatAbierto(false)}
        onLlamar={() => {}}
        onVerPagina={() => {}}
        asistente={{ name, color: asistente.color }}
      />
    </section>
  );
}
