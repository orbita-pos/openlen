"use client";
// THE CLOCK IN THE CHAT'S HEADER (spec local 2026-10-29-tareas-programadas, §7.8; mockups 1 and 2),
// DeepSeek's reloj in the conversation header: only when the project has tasks. Each one with its rule,
// its next run in the reader's clock and how the last run went; edit (name, prompt, when) sends ONE
// update, the same one Len's `schedule_update` makes; delete asks first. Creating stays with Len.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlarmClock, Pencil, Trash2 } from "lucide-react";

import { useMandoDesplegable } from "../use-mando-desplegable";

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
}

export interface ScheduledTasks {
  readonly tasks: readonly ClockTask[];
  update(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; code?: string; message?: string }>;
  remove(id: string): Promise<boolean>;
}

type Freq = "once" | "daily" | "weekly" | "hours" | "cron";

const zoneOf = (task: ClockTask) => task.timeZone ?? /\[([^\]]+)\]$/.exec(task.scheduledAtLocal)?.[1] ?? "UTC";
const city = (zone: string) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");
const hhmm = (time: string | undefined) => (time ?? "09:00").slice(0, 5);
const lang = () => (typeof document !== "undefined" && document.documentElement.lang) || undefined;
/** ISO weekday 1–7 → its short name in the interface's language (2026-11-02 is a Monday). */
const weekdayName = (d: number) => new Intl.DateTimeFormat(lang(), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + d)));
const when = (iso: string) => new Intl.DateTimeFormat(lang(), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function freqOf(task: ClockTask): Freq {
  if (task.kind === "daily") return "daily";
  if (task.kind === "weekly") return "weekly";
  if (task.kind === "every") return "hours";
  if (task.kind === "cron") return "cron";
  return "once";
}

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
  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);
  const [freq, setFreq] = useState<Freq>(freqOf(task));
  const [time, setTime] = useState(hhmm(task.time ?? /T(\d\d:\d\d)/.exec(task.scheduledAtLocal)?.[1]));
  const [days, setDays] = useState<number[]>([...(task.weekdays ?? [1])]);
  const [hours, setHours] = useState(String(Math.max(1, Math.round((task.everySeconds ?? 3600) / 3600))));
  const [expression, setExpression] = useState(task.expression ?? "");
  const [date, setDate] = useState(/^(\d{4}-\d\d-\d\d)/.exec(task.scheduledAtLocal)?.[1] ?? "");
  const [zone, setZone] = useState(zoneOf(task));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timing: Record<string, unknown> =
    freq === "daily"
      ? { daily: { time: `${time}:00`, time_zone: zone } }
      : freq === "weekly"
        ? { weekly: { time: `${time}:00`, time_zone: zone, weekdays: [...days].sort() } }
        : freq === "hours"
          ? { every_seconds: Number(hours) * 3600 }
          : freq === "cron"
            ? { cron: { expression, time_zone: zone } }
            : { at: { date, time: `${time}:00`, time_zone: zone } };
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
  const menu = useMandoDesplegable({ abierto: open, cerrar: () => setOpen(false) });
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
                      {t("scheduled.next", { when: when(task.scheduledAt) })}
                      {task.lastRun &&
                        ` · ${
                          task.lastRun.outcome === "done"
                            ? t("scheduled.lastDone", { when: when(task.lastRun.at) })
                            : t("scheduled.lastFailed", { why: t(`scheduled.outcome_${task.lastRun.outcome ?? "failed"}`) })
                        }`}
                    </small>
                    {deleting === task.id && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px]">
                        <span className="fg">{t("scheduled.confirmDelete")}</span>
                        <button
                          type="button"
                          data-scheduled-confirm-delete=""
                          onClick={async () => {
                            await scheduled.remove(task.id);
                            setDeleting(null);
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
