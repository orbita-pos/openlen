// HER TAB IN LEN MÓVIL (spec local 2026-11-06-asistente-propio, §4.6.3, §4.6.2, phase 5): the person's own assistant
// beside «Entregado» and «Tareas», with what her place on the web has — «Hablar con {name}» (her chat is the main
// screen's, over this tab and outside it, as Len's: final review I1), «Conversaciones» (every line her visitors and she
// said, read-only) and «Pedidos» (what they asked for and she couldn't do, with the web's «Que Len lo haga» / «Ahora no»,
// why Len couldn't start one, and «Ver a Len en el chat» for one passed to him). The phone uses her and never manages
// her: renaming her or her morning summary stay on the web, as with Herramientas. Her notices open it on their part.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { AssistantListItem } from "@/lib/assistants/view";

import { useAtras } from "../atras";
import { leerSusPedidos, leerSusVisitas, marcarSusVisitasLeidas, tocarPedido } from "../api/asistente";
import type { ParteDeLaAsistente } from "../avisos/controlador";
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
  /** The project whose Len does it. */
  readonly projectId: string;
  readonly title: string;
  readonly visitors: number;
  readonly status: string;
  /** Why Len's turn couldn't start (`no_credits`, …): the card waits again. */
  readonly failure?: string | null;
  readonly projectTitle?: string | null;
}

export function AssistantTab({
  cliente,
  asistente,
  parte,
  tarjeta,
  idioma,
  onCerrar,
  onHablar,
  onVerLen,
}: {
  cliente: ClienteDeOpenLen;
  asistente: AssistantListItem;
  /** The part a notice of hers opens (none, or «hablar» — her chat opens over it: Conversaciones). */
  parte?: ParteDeLaAsistente;
  /** A request notice's card, highlighted and brought into view. */
  tarjeta?: string | null;
  idioma: string;
  onCerrar: () => void;
  /** Opens her chat (the main screen's). */
  onHablar: () => void;
  /** Len's chat in the project a request was passed to. */
  onVerLen: (projectId: string) => void;
}) {
  const t = useTranslations("movil.asistente");
  // Opened by a notice of one deleted since (principal.tsx), there is no name: «your assistant» (no gender, as the web's).
  const name = asistente.name || t("own.place.yours");
  const [vista, setVista] = useState<"conversaciones" | "pedidos">(parte === "pedidos" ? "pedidos" : "conversaciones");
  const [visitas, setVisitas] = useState<readonly Visita[] | null>(null);
  const [pedidos, setPedidos] = useState<readonly Pedido[] | null>(null);
  const [falla, setFalla] = useState<"noEsta" | "error" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rechazado, setRechazado] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  useAtras(true, onCerrar);

  const fallo = useCallback((e: unknown) => setFalla(e instanceof Error && e.message === "404" ? "noEsta" : "error"), []);
  const recargarPedidos = useCallback(() => leerSusPedidos<Pedido>(cliente, asistente.id).then(setPedidos, fallo), [cliente, asistente.id, fallo]);
  useEffect(() => {
    setFalla(null);
    void leerSusVisitas<Visita>(cliente, asistente.id).then(setVisitas, fallo);
    void recargarPedidos();
  }, [cliente, asistente.id, intento, recargarPedidos, fallo]);

  // Phase 4E: her conversations on screen are read, as on the web — so `list_messages` in her chat counts what's new.
  // Opened on «Pedidos», or under her chat (a notice of her turn), they aren't on screen until «Conversaciones» is tapped.
  const [aLaVista, setALaVista] = useState(parte !== "pedidos" && parte !== "hablar");
  const marcadas = useRef(false);
  useEffect(() => {
    if (!aLaVista || vista !== "conversaciones" || !visitas?.length || marcadas.current) return;
    marcadas.current = true;
    void marcarSusVisitasLeidas(cliente, asistente.id, visitas.slice(0, 50).map((v) => ({ id: v.id, lastAt: v.lastAt })));
  }, [aLaVista, vista, visitas, cliente, asistente.id]);

  const tocar = async (cardId: string, accion: "accept" | "dismiss") => {
    setOcupado(true);
    setRechazado(null);
    const r = await tocarPedido(cliente, asistente.id, cardId, accion);
    setOcupado(false);
    if (!r.ok) setRechazado(cardId);
    await recargarPedidos();
  };
  // As the web's: the waiting ones first.
  const ordenados = pedidos ? [...pedidos].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")) : null;
  const cuando = (iso: string) => new Date(iso).toLocaleString(idioma, { dateStyle: "medium", timeStyle: "short" });

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
            <button type="button" className="lm-btn asist-hablar" data-asistente-hablar="" onClick={onHablar}>
              {t("hablarCon", { name })}
            </button>
            <div role="tablist" className="asist-partes">
              {(["conversaciones", "pedidos"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={vista === k}
                  data-asistente-parte={k}
                  onClick={() => {
                    setVista(k);
                    if (k === "conversaciones") setALaVista(true);
                  }}
                >
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
                      <time dateTime={v.lastAt}>{cuando(v.lastAt)}</time> · {t("own.place.messages", { count: v.messageCount })}
                      {v.projectTitle ? ` · ${t("own.place.inProject", { project: v.projectTitle })}` : ""}
                      {v.handedOff ? ` · ${t("own.place.handedOff")}` : ""}
                    </small>
                    {/* Every line the route gives, as the web: a number a visitor left in their second message is here. */}
                    {v.lines.map((l, i) =>
                      l.text ? (
                        <p key={i} data-visita-linea="" className={l.role === "visitor" ? "asist-de-visitante" : "asist-de-ella"}>
                          <span className="asist-sr">{l.role === "visitor" ? t("own.place.visitor") : name}: </span>
                          {l.text}
                        </p>
                      ) : null,
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="asist-lista">
                {ordenados?.length === 0 && <li className="asist-vacio">{t("own.requests.empty", { name })}</li>}
                {ordenados?.map((p) => {
                  const resaltado = p.id === tarjeta;
                  const aviso = rechazado === p.id ? t("own.requests.failed") : p.status === "pending" && p.failure ? (p.failure === "no_credits" ? t("own.requests.noCredits") : t("own.requests.failed")) : null;
                  return (
                    <li key={p.id} className="asist-pedido" data-pedido={p.id} data-resaltado={String(resaltado)} ref={resaltado ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
                      <small>{t("own.requests.from", { name })}</small>
                      <b>{p.title}</b>
                      <p>{t("own.requests.visitors", { count: p.visitors })}</p>
                      {aviso && <p role="alert" className="asist-aviso">{aviso}</p>}
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
                        <>
                          <small>{p.status === "accepted" ? t("own.requests.done") : t("own.requests.dismissed")}</small>
                          {p.status === "accepted" && (
                            <button type="button" className="lm-btn lm-sec" data-pedido-ver-len="" onClick={() => onVerLen(p.projectId)}>
                              {t("own.requests.openChat")}
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
