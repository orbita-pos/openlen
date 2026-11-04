// THE PHONE'S «TAREAS» (spec local 2026-10-31-len-movil, §5.4–5.5), like Claude Duet's Tasks: what needs
// the person (marked), what Len is doing, their scheduled tasks and what was resolved in 7 days, across
// every project they can see. A row goes to its project, where it is answered; a scheduled task is
// paused, resumed, edited or deleted here, like the web clock. The panel wears Gestión's look. Event tasks
// (spec local 2026-11-03-len-que-avisa, §8) have their section: what they watch, read-only, and «Registros»;
// a pending card of one is in «Te necesita» and opens the project's chat on it.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { ViewerFile } from "@/components/viewer/viewer";
import type { EventItem, OverviewItem, ScheduledItem, TasksOverview } from "@/lib/movil/tasks-overview";

import { useAtras } from "../atras";
import { deleteScheduledTask, fetchTasks, setTaskPaused } from "../api/overview";
import { PhoneViewer } from "../viewer/phone-viewer";
import { ScheduledTaskEditor } from "./scheduled-task-editor";
import "../gestion/gestion.css";
import "./overview.css";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type Registro = EventItem["records"][number];

export function TasksTab({
  cliente,
  onAbrirProyecto,
  onCerrar,
}: {
  cliente: ClienteDeOpenLen;
  /** `card`: a pending event card, which the chat brings into view. */
  onAbrirProyecto: (projectId: string, open: "chat" | "gestion", card?: string) => void;
  onCerrar: () => void;
}) {
  const t = useTranslations("movil.resumen");
  const te = useTranslations("movil");
  const [records, setRecords] = useState<string | null>(null);
  const [overview, setOverview] = useState<TasksOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewerFile | null>(null);
  useAtras(true, onCerrar);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetchTasks(cliente).then((o) => alive && setOverview(o), () => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [cliente, attempt]);
  const reload = () => setAttempt((n) => n + 1);
  // A refused or failed pause/delete is said on its own row, not swallowed.
  const run = async (taskId: string, f: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    setActionFailed(null);
    const ok = await f().catch(() => false);
    setBusy(false);
    if (!ok) setActionFailed(taskId);
    reload();
  };

  const label = (i: OverviewItem) =>
    i.kind === "turn" ? t("lenTrabajando") : i.kind === "len_watch" ? i.text || t("lenWatch") : i.kind === "incident" ? i.text || t("incidenteResuelto") : i.text;
  const row = (i: OverviewItem, k: number, needsYou = false) => (
    <li key={`${i.kind}:${i.projectId}:${k}`}>
      <button
        type="button"
        className={`resumen-fila${needsYou ? " is-necesita" : ""}`}
        {...(needsYou ? { "data-needs-you": "" } : {})}
        onClick={() => (i.card ? onAbrirProyecto(i.projectId, i.open, i.card) : onAbrirProyecto(i.projectId, i.open))}
      >
        <b>{label(i)}</b>
        <small>{`${i.projectTitle} · ${when(i.at)}${i.kind === "run" ? ` · ${t(i.outcome === "done" ? "ultimaBien" : "ultimaMal")}` : ""}`}</small>
      </button>
    </li>
  );
  const scheduled = (s: ScheduledItem) =>
    editing === s.id ? (
      <li key={s.id} data-task={s.id}>
        <ScheduledTaskEditor cliente={cliente} task={s} onDone={(saved) => { setEditing(null); if (saved) reload(); }} />
      </li>
    ) : (
      <li key={s.id} data-task={s.id} className="resumen-tarea">
        <b>{s.title}</b>
        <small>{s.projectTitle}</small>
        <small>
          {s.paused ? t("enPausa") : t("proxima", { when: when(s.scheduledAt) })}
          {s.lastRun ? ` · ${t(s.lastRun.outcome === "done" ? "ultimaBien" : "ultimaMal")}` : ""}
        </small>
        {s.lastRun?.files.length ? (
          <div className="resumen-archivos">
            {s.lastRun.files.map((f) => (
              <button
                key={f.url}
                type="button"
                data-run-file=""
                onClick={() => setViewing({ name: f.name, url: f.url, size: f.size, ...(f.description ? { description: f.description } : {}), ...(f.previewUrl ? { preview: f.previewUrl } : {}), projectTitle: s.projectTitle })}
              >
                {f.name}
              </button>
            ))}
          </div>
        ) : null}
        {actionFailed === s.id && <small role="alert" className="resumen-fallo">{t("accionFallo")}</small>}
        {deleting === s.id ? (
          <div className="gestion-acciones">
            <span>{t("confirmarBorrar")}</span>
            <button
              type="button"
              data-confirm-delete=""
              disabled={busy}
              onClick={() =>
                void run(s.id, async () => {
                  const ok = await deleteScheduledTask(cliente, s.projectId, s.id);
                  if (ok) setDeleting(null);
                  return ok;
                })
              }
            >
              {t("borrar")}
            </button>
            <button type="button" onClick={() => setDeleting(null)}>
              {t("cancelar")}
            </button>
          </div>
        ) : (
          <div className="gestion-acciones">
            {s.recurring &&
              (s.paused ? (
                <button type="button" data-resume="" disabled={busy} onClick={() => void run(s.id, () => setTaskPaused(cliente, s.projectId, s.id, false))}>
                  {t("reanudar")}
                </button>
              ) : (
                <button type="button" data-pause="" disabled={busy} onClick={() => void run(s.id, () => setTaskPaused(cliente, s.projectId, s.id, true))}>
                  {t("pausar")}
                </button>
              ))}
            <button type="button" data-edit="" onClick={() => setEditing(s.id)}>
              {t("editar")}
            </button>
            <button type="button" data-delete="" onClick={() => setDeleting(s.id)}>
              {t("borrar")}
            </button>
          </div>
        )}
      </li>
    );

  const source = (e: EventItem) => {
    const p = e.params as { table?: string; form?: string };
    return e.source === "app_rows" ? te("eventTasks.sourceRows", { table: p.table ?? "" }) : p.form ? te("eventTasks.sourceForm", { form: p.form }) : te("eventTasks.sourceAllForms");
  };
  const recordLine = (r: Registro) => {
    const what =
      r.kind === "delivered"
        ? r.notified
          ? te("eventTasks.recNotified")
          : te("eventTasks.recDelivered")
        : r.kind === "filtered"
          ? te("eventTasks.recFiltered", { reason: r.reason ?? "" })
          : te("eventTasks.recFailed", { reason: r.reason ?? "" });
    return r.count > 1 ? `${what} ${te("eventTasks.recCount", { count: r.count })}` : what;
  };
  const event = (e: EventItem) => (
    <li key={e.id} data-event-task={e.id} className="resumen-tarea">
      <b>{e.title}</b>
      <small>{e.projectTitle}</small>
      <small>{source(e)}</small>
      <small>{e.paused ? t("enPausa") : e.lastCheckedAt ? te("eventTasks.lastCheck", { when: when(e.lastCheckedAt) }) : ""}</small>
      <button type="button" className="resumen-registros" data-event-records="" aria-expanded={records === e.id} onClick={() => setRecords((cur) => (cur === e.id ? null : e.id))}>
        {te("eventTasks.records")}
      </button>
      {records === e.id && (
        <ul className="resumen-registros-lista">
          {e.records.length === 0 ? (
            <li>{te("eventTasks.noRecords")}</li>
          ) : (
            e.records.map((r) => (
              <li key={r.id} data-event-record="">
                {`${when(r.at)} · ${recordLine(r)}`}
              </li>
            ))
          )}
        </ul>
      )}
      {actionFailed === e.id && <small role="alert" className="resumen-fallo">{t("accionFallo")}</small>}
      {deleting === e.id ? (
        <div className="gestion-acciones">
          <span>{t("confirmarBorrar")}</span>
          <button
            type="button"
            data-confirm-delete=""
            disabled={busy}
            onClick={() =>
              void run(e.id, async () => {
                const ok = await deleteScheduledTask(cliente, e.projectId, e.id);
                if (ok) setDeleting(null);
                return ok;
              })
            }
          >
            {t("borrar")}
          </button>
          <button type="button" onClick={() => setDeleting(null)}>
            {t("cancelar")}
          </button>
        </div>
      ) : (
        <div className="gestion-acciones">
          {e.paused ? (
            <button type="button" data-resume="" disabled={busy} onClick={() => void run(e.id, () => setTaskPaused(cliente, e.projectId, e.id, false))}>
              {t("reanudar")}
            </button>
          ) : (
            <button type="button" data-pause="" disabled={busy} onClick={() => void run(e.id, () => setTaskPaused(cliente, e.projectId, e.id, true))}>
              {t("pausar")}
            </button>
          )}
          <button type="button" data-delete="" onClick={() => setDeleting(e.id)}>
            {t("borrar")}
          </button>
        </div>
      )}
    </li>
  );

  const events = overview?.events ?? [];
  const empty = overview && !overview.needsYou.length && !overview.working.length && !overview.scheduled.length && !overview.resolved.length && !events.length;
  return (
    <section className="app-gestion app-resumen lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby="tareas-titulo">
      <header>
        <div>
          <p className="gestion-ceja">Len</p>
          <h1 id="tareas-titulo">{t("tareas")}</h1>
        </div>
        <button className="gestion-cerrar" onClick={onCerrar} aria-label={t("cerrar")}>
          ×
        </button>
      </header>
      <div className="gestion-cuerpo">
        {failed ? (
          <div className="gestion-error" role="alert">
            <strong>{t("error")}</strong>
            <button onClick={reload}>{t("reintentar")}</button>
          </div>
        ) : !overview ? (
          <p role="status">{t("cargando")}</p>
        ) : empty ? (
          <p>{t("vacioTareas")}</p>
        ) : (
          <>
            <h2>{t("teNecesita")}</h2>
            <ul className="resumen-lista">{overview.needsYou.length ? overview.needsYou.map((i, k) => row(i, k, true)) : <li className="resumen-nada">{t("nada")}</li>}</ul>
            <h2>{t("trabajando")}</h2>
            <ul className="resumen-lista">{overview.working.length ? overview.working.map((i, k) => row(i, k)) : <li className="resumen-nada">{t("nada")}</li>}</ul>
            <h2>{t("programadas")}</h2>
            <ul className="resumen-lista">{overview.scheduled.length ? overview.scheduled.map(scheduled) : <li className="resumen-nada">{t("nada")}</li>}</ul>
            {events.length > 0 && (
              <>
                <h2>{te("eventTasks.filterEvents")}</h2>
                <ul className="resumen-lista">{events.map(event)}</ul>
              </>
            )}
            <h2>{t("resueltas")}</h2>
            <ul className="resumen-lista">{overview.resolved.length ? overview.resolved.map((i, k) => row(i, k)) : <li className="resumen-nada">{t("nada")}</li>}</ul>
          </>
        )}
      </div>
      {viewing && createPortal(<PhoneViewer cliente={cliente} file={viewing} onClose={() => setViewing(null)} />, document.body)}
    </section>
  );
}
