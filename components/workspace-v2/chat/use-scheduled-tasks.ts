"use client";
// The clock's data (spec local 2026-10-29-tareas-programadas, §7.8): the project's tasks, read when the
// chat opens and again each time a turn ends (Len may have just created, changed or removed one).
import { useCallback, useEffect, useRef, useState } from "react";

import type { ClockTask, ScheduledTasks } from "./scheduled-tasks-menu";

export function useScheduledTasks(projectId: string | null, busy: boolean): ScheduledTasks {
  const [tasks, setTasks] = useState<readonly ClockTask[]>([]);
  const base = projectId ? `/api/projects/${encodeURIComponent(projectId)}/scheduled-tasks` : null;
  const load = useCallback(async () => {
    if (!base) return;
    try {
      const res = await fetch(base);
      if (res.ok) setTasks(((await res.json()) as { tasks: ClockTask[] }).tasks);
    } catch {
      // No clock this time; the next turn's end reads again.
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void load();
    wasBusy.current = busy;
  }, [busy, load]);
  return {
    tasks,
    update: async (id, body) => {
      if (!base) return { ok: false };
      const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      const value = ((await res?.json().catch(() => null)) ?? {}) as { code?: string; message?: string };
      if (res?.ok) await load();
      return { ok: Boolean(res?.ok), ...(value.code ? { code: value.code } : {}), ...(value.message ? { message: value.message } : {}) };
    },
    remove: async (id) => {
      if (!base) return false;
      const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
      await load();
      return Boolean(res?.ok);
    },
  };
}
