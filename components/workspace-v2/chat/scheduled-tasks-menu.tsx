"use client";
// THE CLOCK IN THE CHAT'S HEADER (spec local 2026-10-29-tareas-programadas, §7.8; mockups 1 and 2),
// DeepSeek's reloj in the conversation header: only when the project has tasks. Each one with its rule,
// its next run in the reader's clock and how the last run went; edit (name, prompt, when) sends ONE
// update, the same one Len's `schedule_update` makes; delete asks first. Creating stays with Len.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlarmClock, Pause, Pencil, Play, Trash2 } from "lucide-react";

import { useMandoDesplegable } from "../use-mando-desplegable";

import { editFromTask, hhmm, timingBody, zoneOf, type Freq } from "./scheduled-format";

/** One task as GET /api/projects/[id]/scheduled-tasks gives it. */
export interface ClockTask {
  readonly id: string;
  readonly kind: "after" | "at" | "every" | "daily" | "weekly" | "cron";
  readonly title: string;
  readonly prompt: string;
  readonly scheduledAt: string;
  readonly scheduledAtLocal: string;
  readonly state: "scheduled" | "overdue";
  readonly time?: string;
  readonly timeZone?: string;
  readonly weekdays?: readonly number[];
  readonly everySeconds?: number;
  readonly expression?: string;
  readonly createdBy: string;
  readonly lastRun: { readonly at: string; readonly outcome: string | null; readonly reason: string | null } | null;
  /** Paused by a person (spec local 2026-10-31-len-movil, §5.5). */
  readonly paused?: true;
}

export interface ScheduledTasks {
  readonly tasks: readonly ClockTask[];
  update(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; code?: string; message?: string }>;
  remove(id: string): Promise<boolean>;
  /** «Pausar» / «Reanudar»: only recurring tasks. */
  setPaused(id: string, paused: boolean): Promise<boolean>;
}

const city = (zone: string) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");
const lang = () => (typeof document !== "undefined" && document.documentElement.lang) || undefined;
/** ISO weekday 1–7 → its short name in the interface's language (2026-11-02 is a Monday). */
const weekdayName = (d: number) => new Intl.DateTimeFormat(lang(), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + d)));
const when = (iso: string) => new Intl.DateTimeFormat(lang(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function Rule({ task }: { task: ClockTask }) {
  const t = useTranslations("panelsChat");
  const zone = city(zoneOf(task));
  const rule =
    task.kind === "weekly"
      ? `${(task.weekdays ?? []).map(weekdayName).join(", ")} · ${hhmm(task.time)}`
      : task.kind === "daily"
        ? `${t("scheduled.freqDaily")} · ${hhmm(task.time)}`
        : task.kind === "every"
          ? t("scheduled.every", { n: Math.round((task.everySeconds ?? 3600) / 3600) })
          : task.kind === "cron"
            ? `cron ${task.expression ?? ""}`
            : t("scheduled.freqOnce");
  return <small className="block text-[11.5px] leading-snug fg-muted">{`${rule} · ${zone}`}</small>;
}

function Editor({ task, onDone, update }: { task: ClockTask; onDone: () => void; update: ScheduledTasks["update"] }) {
  const t = useTranslations("panelsChat");
  const [initial] = useState(() => editFromTask(task));
  const [title, setTitle] = useState(initial.title);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [freq, setFreq] = useState<Freq>(initial.freq);
  const [time, setTime] = useState(initial.time);
  const [days, setDays] = useState<number[]>([...initial.days]);
  const [hours, setHours] = useState(initial.hours);
  const [expression, setExpression] = useState(initial.expression);
  const [date, setDate] = useState(initial.date);
  const [zone, setZone] = useState(initial.zone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timing = timingBody({ title, prompt, freq, time, days, hours, expression, date, zone });
  const field = "w-full rounded-[9px] border bd bg-elev px-2 py-1.5 text-[12.5px] fg";
  return (
    <div className="space-y-2 p-2 text-[12px]">
      <label className="block fg-muted">
        {t("scheduled.fieldName")}
        <input data-field="title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block fg-muted">
        {t("scheduled.fieldPrompt")}
        <textarea data-field="prompt" className={`${field} min-h-[56px]`} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-1.5 fg-muted">
        {t("scheduled.fieldWhen")}
        <select className={`${field} w-auto`} value={freq} onChange={(e) => setFreq(e.target.value as Freq)}>
          {(["once", "daily", "weekly", "hours", "cron"] as const).map((f) => (
            <option key={f} value={f}>
              {t(`scheduled.freq${f[0]!.toUpperCase()}${f.slice(1)}`)}
            </option>
          ))}
        </select>
        {freq === "once" && <input type="date" className={`${field} w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />}
        {freq === "hours" ? (
          <input data-field="hours" type="number" min={1} className={`${field} w-16`} value={hours} onChange={(e) => setHours(e.target.value)} />
        ) : freq === "cron" ? (
          <input data-field="expression" className={`${field} w-36 font-mono`} value={expression} onChange={(e) => setExpression(e.target.value)} />
        ) : (
          <input data-field="time" type="time" className={`${field} w-auto`} value={time} onChange={(e) => setTime(e.target.value)} />
        )}
      </div>
      {freq === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
              className={`rounded-md border bd px-1.5 py-0.5 text-[11.5px] ${days.includes(d) ? "bg-accent-soft fg" : "fg-muted"}`}
            >
              {weekdayName(d)}
            </button>
          ))}
        </div>
      )}
      {freq !== "hours" && (
        <label className="block fg-muted">
          {t("scheduled.fieldZone")}
          <input data-field="zone" className={field} value={zone} onChange={(e) => setZone(e.target.value)} />
        </label>
      )}
      {error && <p className="text-[11.5px] nc-bad">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded-lg px-2.5 py-1 fg-muted hover:bg-side">
          {t("scheduled.cancel")}
        </button>
        <button
          type="button"
          data-scheduled-save=""
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await update(task.id, { title, prompt, ...timing });
            setBusy(false);
            if (r.ok) onDone();
            else setError(r.message ?? r.code ?? "error");
          }}
          className="rounded-lg bg-[var(--nc-accent)] px-2.5 py-1 font-medium text-white disabled:opacity-60"
        >
          {t("scheduled.save")}
        </button>
      </div>
    </div>
  );
}

export function ScheduledTasksMenu({ scheduled }: { scheduled: ScheduledTasks }) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const menu = useMandoDesplegable({ abierto: open, cerrar: () => setOpen(false) });
  // A refused or failed pause/delete is said on its own row, not swallowed.
  const act = async (id: string, run: () => Promise<boolean>) => {
    setFailed(null);
    const ok = await run();
    if (!ok) setFailed(id);
    return ok;
  };
  if (scheduled.tasks.length === 0) return null;
  return (
    <div className="relative" ref={menu.refContenedor} onKeyDown={menu.alPulsarTecla}>
      <button
        type="button"
        data-scheduled-clock=""
        aria-label={t("scheduled.title")}
        title={t("scheduled.title")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg aria-expanded:bg-elev aria-expanded:fg"
      >
        <AlarmClock size={15} />
        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--nc-accent)]" />
      </button>
      {open && (
        <div className="nc-card-in absolute right-0 top-[calc(100%+6px)] z-30 w-[330px] rounded-[14px] border bd-strong bg-elev p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]">
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] fg-faint">{t("scheduled.title")}</div>
          <ul className="max-h-[360px] list-none overflow-y-auto p-0 nice-scroll">
            {scheduled.tasks.map((task) =>
              editing === task.id ? (
                <li key={task.id}>
                  <Editor task={task} update={scheduled.update} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={task.id} className="flex gap-2.5 rounded-[10px] p-2 hover:bg-side">
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-[var(--nc-accent-text)]">
                    <AlarmClock size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold">{task.title}</b>
                    <Rule task={task} />
                    <small className="block text-[11.5px] leading-snug fg-muted">
                      {task.paused ? <span data-scheduled-paused="" className="font-medium fg">{t("scheduled.paused")}</span> : t("scheduled.next", { when: when(task.scheduledAt) })}
                      {task.lastRun &&
                        ` · ${
                          task.lastRun.outcome === "done"
                            ? t("scheduled.lastDone", { when: when(task.lastRun.at) })
                            : t("scheduled.lastFailed", { why: t(`scheduled.outcome_${task.lastRun.outcome ?? "failed"}`) })
                        }`}
                    </small>
                    {failed === task.id && (
                      <p role="alert" className="text-[11.5px] nc-bad">
                        {t("scheduled.actionFailed")}
                      </p>
                    )}
                    {deleting === task.id && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px]">
                        <span className="fg">{t("scheduled.confirmDelete")}</span>
                        <button
                          type="button"
                          data-scheduled-confirm-delete=""
                          onClick={async () => {
                            if (await act(task.id, () => scheduled.remove(task.id))) setDeleting(null);
                          }}
                          className="rounded-md px-1.5 py-0.5 font-medium nc-bad hover:bg-side"
                        >
                          {t("scheduled.delete")}
                        </button>
                        <button type="button" onClick={() => setDeleting(null)} className="rounded-md px-1.5 py-0.5 fg-muted hover:bg-side">
                          {t("scheduled.cancel")}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-start gap-0.5">
                    {task.kind !== "at" && task.kind !== "after" &&
                      (task.paused ? (
                        <button type="button" data-scheduled-resume="" aria-label={t("scheduled.resume")} title={t("scheduled.resume")} onClick={() => void act(task.id, () => scheduled.setPaused(task.id, false))} className="grid h-6 w-6 place-items-center rounded-md fg-muted hover:bg-elev hover:fg">
                          <Play size={12} />
                        </button>
                      ) : (
                        <button type="button" data-scheduled-pause="" aria-label={t("scheduled.pause")} title={t("scheduled.pause")} onClick={() => void act(task.id, () => scheduled.setPaused(task.id, true))} className="grid h-6 w-6 place-items-center rounded-md fg-muted hover:bg-elev hover:fg">
                          <Pause size={12} />
                        </button>
                      ))}
                    <button type="button" data-scheduled-edit="" aria-label={t("scheduled.edit")} title={t("scheduled.edit")} onClick={() => setEditing(task.id)} className="grid h-6 w-6 place-items-center rounded-md fg-muted hover:bg-elev hover:fg">
                      <Pencil size={12} />
                    </button>
                    <button type="button" data-scheduled-delete="" aria-label={t("scheduled.delete")} title={t("scheduled.delete")} onClick={() => setDeleting(task.id)} className="grid h-6 w-6 place-items-center rounded-md fg-muted hover:bg-elev hover:fg">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
          <div className="mt-1 flex items-center gap-2 border-t bd px-2 pb-1 pt-2 text-[12px] fg-muted">
            {t("scheduled.hint")}
            <span className="ml-auto rounded-md border bd bg-side px-1.5 py-0.5 font-mono text-[11.5px] fg">/schedule</span>
          </div>
        </div>
      )}
    </div>
  );
}
