// THE PHONE'S «TAREAS» (spec local 2026-10-31-len-movil, §5.4–5.5), like Claude Duet's Tasks: what needs
// the person (marked), what Len is doing, their scheduled tasks and what was resolved in 7 days, across
// every project they can see. A row goes to its project, where it is answered; a scheduled task is
// paused, resumed, edited or deleted here, like the web clock. The panel wears Gestión's look.
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { OverviewItem, ScheduledItem, TasksOverview } from "@/lib/movil/tasks-overview";

import { useAtras } from "../atras";
import { deleteScheduledTask, fetchTasks, setTaskPaused } from "../api/overview";
import { ScheduledTaskEditor } from "./scheduled-task-editor";
import "../gestion/gestion.css";
import "./overview.css";

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function TasksTab({ cliente, onAbrirProyecto, onCerrar }: { cliente: ClienteDeOpenLen; onAbrirProyecto: (projectId: string, open: "chat" | "gestion") => void; onCerrar: () => void }) {
  const t = useTranslations("movil.resumen");
  const [overview, setOverview] = useState<TasksOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState<string | null>(null);
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
      <button type="button" className={`resumen-fila${needsYou ? " is-necesita" : ""}`} {...(needsYou ? { "data-needs-you": "" } : {})} onClick={() => onAbrirProyecto(i.projectId, i.open)}>
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

  const empty = overview && !overview.needsYou.length && !overview.working.length && !overview.scheduled.length && !overview.resolved.length;
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
            <h2>{t("resueltas")}</h2>
            <ul className="resumen-lista">{overview.resolved.length ? overview.resolved.map((i, k) => row(i, k)) : <li className="resumen-nada">{t("nada")}</li>}</ul>
          </>
        )}
      </div>
    </section>
  );
}
