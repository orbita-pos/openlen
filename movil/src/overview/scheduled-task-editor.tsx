// Editing a scheduled task on the phone (spec local 2026-10-31-len-movil, §5.4): the same fields as the
// web clock (name, what to do, when, zone) and the same PATCH body (`scheduled-format.ts`).
import { useState } from "react";
import { useTranslations } from "use-intl";

import { editFromTask, timingBody, type Freq, type TaskEdit } from "@/components/workspace-v2/chat/scheduled-format";
import type { ScheduledItem } from "@/lib/movil/tasks-overview";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { editScheduledTask } from "../api/overview";

const FREQS: readonly Freq[] = ["once", "daily", "weekly", "hours", "cron"];
const weekdayName = (d: number) => new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + d)));

export function ScheduledTaskEditor({ cliente, task, onDone }: { cliente: ClienteDeOpenLen; task: ScheduledItem; onDone: (saved: boolean) => void }) {
  const t = useTranslations("movil.resumen");
  const [edit, setEdit] = useState<TaskEdit>(() => editFromTask(task));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TaskEdit>) => setEdit((e) => ({ ...e, ...patch }));
  const save = async () => {
    setBusy(true);
    const r = await editScheduledTask(cliente, task.projectId, task.id, { title: edit.title, prompt: edit.prompt, ...timingBody(edit) });
    setBusy(false);
    if (r.ok) onDone(true);
    else setError(r.message ?? r.code ?? t("error"));
  };
  return (
    <div className="resumen-editor">
      <label>
        {t("nombre")}
        <input value={edit.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label>
        {t("queHacer")}
        <textarea rows={3} value={edit.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </label>
      <label>
        {t("cuando")}
        <select value={edit.freq} onChange={(e) => set({ freq: e.target.value as Freq })}>
          {FREQS.map((f) => (
            <option key={f} value={f}>
              {t(`frecuencia_${f}`)}
            </option>
          ))}
        </select>
      </label>
      {edit.freq === "once" && <input type="date" value={edit.date} onChange={(e) => set({ date: e.target.value })} />}
      {edit.freq === "hours" ? (
        <input type="number" min={1} value={edit.hours} onChange={(e) => set({ hours: e.target.value })} />
      ) : edit.freq === "cron" ? (
        <input value={edit.expression} onChange={(e) => set({ expression: e.target.value })} />
      ) : (
        <input type="time" value={edit.time} onChange={(e) => set({ time: e.target.value })} />
      )}
      {edit.freq === "weekly" && (
        <div className="resumen-dias">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} type="button" aria-pressed={edit.days.includes(d)} onClick={() => set({ days: edit.days.includes(d) ? edit.days.filter((x) => x !== d) : [...edit.days, d] })}>
              {weekdayName(d)}
            </button>
          ))}
        </div>
      )}
      {edit.freq !== "hours" && (
        <label>
          {t("zona")}
          <input value={edit.zone} onChange={(e) => set({ zone: e.target.value })} />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="gestion-acciones">
        <button type="button" onClick={() => onDone(false)}>
          {t("cancelar")}
        </button>
        <button type="button" className="gestion-principal" disabled={busy} onClick={() => void save()}>
          {t("guardar")}
        </button>
      </div>
    </div>
  );
}
