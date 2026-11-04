// AN EVENT TASK'S CARDS IN THE PHONE'S CHAT (spec local 2026-11-03-len-que-avisa, §8): the web's card and its
// buttons, over the conversation, posting to the same route. «Hazlo» starts Len's turn on the server: the chat
// shows it as it shows any turn that started elsewhere. A decided card stays a day as a line that says how it
// ended; a push's card (`resaltar`) is brought into view.
//
// Each action has its block, in one column (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §8): the data
// change as «columna · antes → después», the message with who it goes to, the subject and the text. «Hazlo» reads
// «Aplicar» or «Aplicar y enviar» when it touches the real data. A card that still needs the owner — a row that
// changed, a message still being sent — keeps its buttons: «Volver a mirar», «Retirar». «Ahora no» asks «¿Qué
// cambiarías?». Every button is a 44 px target.
//
// The cards are rows of their own, never chat messages: what a judge wrote from a visitor's data never enters
// the conversation.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { EXPIRED, INTERRUPTED, NOT_SENT_CHANGE, WITHDRAWN, type CardActionRecord } from "@/lib/event-tasks/actions/types";

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
  /** Null on a card from before the actions: its proposal is `proposedAction`. */
  readonly actions: readonly CardActionRecord[] | null;
  readonly dismissNote: string | null;
  readonly subjectKey: string | null;
  /** What Len found when it looked again and made no new card. */
  readonly lookedAgain: string | null;
}

type Pulsacion = { action: "accept" } | { action: "dismiss"; note?: string } | { action: "look_again" } | { action: "withdraw_send"; index: number };
type T = ReturnType<typeof useTranslations>;

const DIA_MS = 86_400_000;
/** The watcher looks every 60 s: the chat looks as often while it is open. */
const MIRAR_CADA_MS = 60_000;

const tiene = (c: TarjetaDeAviso, estado: CardActionRecord["state"]) => (c.actions ?? []).some((r) => r.state === estado);

function Tarjeta({ t, tarjeta, resaltada, decidida, children }: { t: T; tarjeta: TarjetaDeAviso; resaltada: boolean; decidida: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (resaltada) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [resaltada]);
  return (
    <article ref={ref} data-aviso={tarjeta.id} className={`ch-aviso${resaltada ? " is-resaltado" : ""}${decidida ? " is-decidida" : ""}`}>
      <small className="ch-aviso-de">{t("eventTasks.cardFrom", { task: tarjeta.taskTitle })}</small>
      <strong className="ch-aviso-titulo">{tarjeta.title}</strong>
      {children}
    </article>
  );
}

/** What came of one action, in a line; nothing while it waits for «Hazlo». */
function Linea({ r, t }: { r: CardActionRecord; t: T }) {
  const a = r.action;
  if (r.state === "pending") return null;
  let texto: string;
  let tono: "ok" | "aviso" | "mal";
  if (a.kind === "data_change") {
    [texto, tono] =
      r.state === "done"
        ? [t("eventTasks.doneApplied", { result: r.result ?? "" }), "ok"]
        : r.state === "blocked"
          ? [t("eventTasks.rowChanged"), "aviso"]
          : r.error === INTERRUPTED
            ? [t("eventTasks.interrupted"), "aviso"]
            : [t("eventTasks.actionFailed", { error: r.error ?? "" }), "mal"];
  } else if (a.kind === "reply") {
    [texto, tono] =
      r.state === "done"
        ? [t("eventTasks.doneSent", { to: r.result ?? a.to }), "ok"]
        : r.state === "sending"
          ? [t("eventTasks.sending", { attempts: r.attempts }), "aviso"]
          : r.error === WITHDRAWN
            ? [t("eventTasks.withdrawn"), "mal"]
            : r.error === NOT_SENT_CHANGE
              ? [t("eventTasks.notSentChange"), "aviso"]
              : r.error === EXPIRED
                ? [t("eventTasks.sendExpired"), "mal"]
                : [t("eventTasks.sendFailed", { error: r.error ?? "" }), "mal"];
  } else {
    [texto, tono] = r.state === "done" ? [t("eventTasks.done"), "ok"] : r.error === INTERRUPTED ? [t("eventTasks.interrupted"), "aviso"] : [t("eventTasks.actionFailed", { error: r.error ?? "" }), "mal"];
  }
  return (
    <small data-aviso-estado={r.state} className={`ch-aviso-linea is-${tono}`}>
      {texto}
      {(r.state === "blocked" || (r.state === "failed" && a.kind === "data_change")) && r.result ? <span>{t("eventTasks.rowNow", { now: r.result })}</span> : null}
    </small>
  );
}

function Acciones({ tarjeta, repliesTo, t }: { tarjeta: TarjetaDeAviso; repliesTo: string | null; t: T }) {
  return (
    <>
      {(tarjeta.actions ?? []).map((r, i) => {
        const a = r.action;
        if (a.kind === "data_change") {
          return (
            <div key={i} className="ch-aviso-accion" data-aviso-accion="data_change">
              <small className="ch-aviso-rotulo">{t("eventTasks.actionData", { table: a.table })}</small>
              {Object.entries(a.set).map(([col, valor]) => (
                <div key={col} className="ch-aviso-columna" data-aviso-columna={col}>
                  <code>{col}</code>
                  <span>
                    <s>{a.before[col] ?? "∅"}</s> → <b>{valor}</b>
                  </span>
                </div>
              ))}
              <Linea r={r} t={t} />
            </div>
          );
        }
        if (a.kind === "reply") {
          return (
            <div key={i} className="ch-aviso-accion" data-aviso-accion="reply">
              <small className="ch-aviso-de">
                {a.channel === "chat"
                  ? t("eventTasks.actionReplyChat", { to: a.toLabel ?? a.to })
                  : a.channel === "github"
                    ? t("eventTasks.actionReplyGithub", { to: a.toLabel ?? a.to })
                    : t("eventTasks.actionReply", { to: a.to })}
              </small>
              {a.subject ? <strong className="ch-aviso-asunto">{a.subject}</strong> : null}
              <p className="ch-aviso-cuerpo">{a.body}</p>
              {repliesTo && a.channel === "email" ? <small className="ch-aviso-de">{t("eventTasks.repliesGoTo", { email: repliesTo })}</small> : null}
              <Linea r={r} t={t} />
            </div>
          );
        }
        return (
          <div key={i} className="ch-aviso-propuesta" data-aviso-accion="project">
            <small>{t("eventTasks.proposed")}</small>
            <span>{a.text}</span>
            <Linea r={r} t={t} />
          </div>
        );
      })}
    </>
  );
}

export function AvisosDeLen({ cliente, projectId, abierto, resaltar }: { cliente: ClienteDeOpenLen; projectId: string; abierto: boolean; resaltar: string | null }) {
  const t = useTranslations("movil");
  const [tarjetas, setTarjetas] = useState<readonly TarjetaDeAviso[]>([]);
  const [repliesTo, setRepliesTo] = useState<string | null>(null);
  const [decidiendo, setDecidiendo] = useState<string | null>(null);
  const [fallo, setFallo] = useState<{ id: string; limite: boolean } | null>(null);
  const [anotando, setAnotando] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [mirandoOtraVez, setMirandoOtraVez] = useState<ReadonlySet<string>>(new Set());
  const ruta = `/api/projects/${encodeURIComponent(projectId)}/event-cards`;
  const cargar = useCallback(async () => {
    try {
      const res = await cliente.pedir(ruta);
      const body = res.ok ? ((await res.json()) as { cards?: unknown; repliesTo?: unknown }) : null;
      if (Array.isArray(body?.cards)) setTarjetas(body.cards as TarjetaDeAviso[]);
      if (body) setRepliesTo(typeof body.repliesTo === "string" ? body.repliesTo : null);
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

  const decidir = async (tarjeta: TarjetaDeAviso, p: Pulsacion) => {
    setDecidiendo(tarjeta.id);
    setFallo(null);
    const res = await cliente
      .pedir(`${ruta}/${encodeURIComponent(tarjeta.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) })
      .catch(() => null);
    setDecidiendo(null);
    if (!res?.ok) {
      const error = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
      setFallo({ id: tarjeta.id, limite: error === "daily_limit" });
    } else if (p.action === "look_again") setMirandoOtraVez((s) => new Set(s).add(tarjeta.id));
    else if (p.action === "dismiss") setAnotando(null);
    await cargar();
  };
  const descartar = (tarjeta: TarjetaDeAviso) => {
    const limpia = nota.trim();
    void decidir(tarjeta, limpia ? { action: "dismiss", note: limpia } : { action: "dismiss" });
  };

  // A card is over for the owner once a newer one about the same row has come.
  const sustituida = (c: TarjetaDeAviso) => c.subjectKey !== null && tarjetas.some((o) => o.id !== c.id && o.taskId === c.taskId && o.subjectKey === c.subjectKey && o.createdAt > c.createdAt);
  const teNecesita = (c: TarjetaDeAviso) =>
    c.status === "pending" || (c.status === "accepted" && (tiene(c, "sending") || (tiene(c, "blocked") && !sustituida(c) && !c.lookedAgain)));
  // The ones that need the owner, and a day of the decided: the web keeps the week under «Avisos anteriores».
  const ahora = Date.now();
  const visibles = tarjetas.filter((c) => teNecesita(c) || ahora - Date.parse(c.createdAt) < DIA_MS || c.id === resaltar);
  if (visibles.length === 0) return null;
  // Accepted with actions and none of them done (a row that changed, a send withdrawn): not «Hecho».
  const nadaHecho = (c: TarjetaDeAviso) => (c.actions ?? []).length > 0 && !tiene(c, "done");
  const estado = (c: TarjetaDeAviso) =>
    c.status === "accepted" ? t(nadaHecho(c) ? "eventTasks.notDone" : "eventTasks.done") : c.status === "dismissed" ? t("eventTasks.dismissed") : t("eventTasks.replaced");
  const hazlo = (c: TarjetaDeAviso) => {
    const tipos = new Set((c.actions ?? []).map((r) => r.action.kind));
    return tipos.has("data_change") ? (tipos.has("reply") ? t("eventTasks.applyAndSend") : t("eventTasks.apply")) : t("eventTasks.accept");
  };
  return (
    <div className="ch-avisos" role="status">
      {visibles.map((c) =>
        teNecesita(c) ? (
          <Tarjeta key={c.id} t={t} tarjeta={c} resaltada={resaltar === c.id} decidida={false}>
            <p className="ch-aviso-resumen">{c.summary}</p>
            {c.actions ? (
              <Acciones tarjeta={c} repliesTo={repliesTo} t={t} />
            ) : (
              <div className="ch-aviso-propuesta" data-aviso-propuesta="">
                <small>{t("eventTasks.proposed")}</small>
                <span>{c.proposedAction}</span>
              </div>
            )}
            {fallo?.id === c.id && (
              <small role="alert" className="ch-aviso-fallo">
                {fallo.limite ? t("eventTasks.dailyLimit") : t("eventTasks.failed")}
              </small>
            )}
            {c.status === "accepted" && mirandoOtraVez.has(c.id) && <small className="ch-aviso-estado">{t("eventTasks.lookingAgain")}</small>}
            {c.status === "pending" ? (
              <>
                <div className="ch-aviso-botones">
                  <button type="button" className="ch-aviso-hazlo" data-aviso-hazlo="" disabled={decidiendo === c.id} onClick={() => void decidir(c, { action: "accept" })}>
                    {hazlo(c)}
                  </button>
                  <button
                    type="button"
                    className="ch-aviso-ahora-no"
                    data-aviso-ahora-no=""
                    disabled={decidiendo === c.id}
                    onClick={() => {
                      setAnotando(anotando === c.id ? null : c.id);
                      setNota("");
                    }}
                  >
                    {t("eventTasks.dismiss")}
                  </button>
                </div>
                {anotando === c.id && (
                  <>
                    <textarea
                      className="ch-aviso-nota"
                      data-aviso-nota=""
                      value={nota}
                      onChange={(e) => setNota(e.target.value)}
                      placeholder={t("eventTasks.whatWouldYouChange")}
                      maxLength={1000}
                      rows={2}
                    />
                    <div className="ch-aviso-botones">
                      <button type="button" className="ch-aviso-ahora-no" data-aviso-descartar="" disabled={decidiendo === c.id} onClick={() => descartar(c)}>
                        {nota.trim() ? t("eventTasks.askAgain") : t("eventTasks.dismissConfirm")}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="ch-aviso-botones">
                {tiene(c, "blocked") && !mirandoOtraVez.has(c.id) && (
                  <button type="button" className="ch-aviso-ahora-no" data-aviso-mirar="" disabled={decidiendo === c.id} onClick={() => void decidir(c, { action: "look_again" })}>
                    {t("eventTasks.lookAgain")}
                  </button>
                )}
                {(c.actions ?? []).map((r, i) =>
                  r.action.kind === "reply" && r.state === "sending" ? (
                    <button key={i} type="button" className="ch-aviso-ahora-no" data-aviso-retirar="" disabled={decidiendo === c.id} onClick={() => void decidir(c, { action: "withdraw_send", index: i })}>
                      {t("eventTasks.withdraw")}
                    </button>
                  ) : null,
                )}
              </div>
            )}
          </Tarjeta>
        ) : (
          <Tarjeta key={c.id} t={t} tarjeta={c} resaltada={resaltar === c.id} decidida>
            <small className="ch-aviso-estado">{estado(c)}</small>
            {c.status === "accepted" && (c.actions ?? []).map((r, i) => (r.action.kind === "project" ? null : <Linea key={i} r={r} t={t} />))}
            {c.dismissNote ? <small className="ch-aviso-estado">{t("eventTasks.yourNote", { note: c.dismissNote })}</small> : null}
            {c.lookedAgain ? <small className="ch-aviso-estado">{t("eventTasks.lookedAgain", { answer: c.lookedAgain })}</small> : null}
          </Tarjeta>
        ),
      )}
    </div>
  );
}
