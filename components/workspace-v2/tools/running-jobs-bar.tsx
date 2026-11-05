"use client";

// THE FRAME'S LINE FOR A RUNNING JOB (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): a job costs the person
// per second, so OpenLen shows every job the tool started from this frame — its title, how long it has run, its
// progress line and «Detener» — even when the tool shows nothing, and follows it every 2 s until it settles.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { TERMINAL_JOB_STATUSES, type ToolJobView } from "@/lib/tools/jobs/types";

import type { BridgeHostCaller } from "./use-tool-bridge-host";

const FOLLOW_EVERY_MS = 2_000;

/** m:ss, or h:mm:ss past an hour. */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

export function RunningJobsBar({
  jobs,
  caller,
  locale,
  timeZone,
  onSettled,
  fetchImpl,
}: {
  jobs: readonly ToolJobView[];
  caller: BridgeHostCaller;
  locale: string;
  timeZone: string;
  onSettled: (job: ToolJobView) => void;
  fetchImpl?: typeof fetch;
}) {
  const t = useTranslations("wsChrome");
  const [views, setViews] = useState<Record<string, ToolJobView>>({});
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef({ jobs, caller, locale, timeZone, onSettled, fetchImpl });
  latest.current = { jobs, caller, locale, timeZone, onSettled, fetchImpl };

  const fields = (): Record<string, string> => {
    const { caller: c, locale: l, timeZone: z } = latest.current;
    return { ...(c as Record<string, string>), locale: l, timeZone: z };
  };
  const doFetch = (...a: Parameters<typeof fetch>) => (latest.current.fetchImpl ?? fetch)(...a);

  const ids = jobs.map((j) => j.id).join(",");
  useEffect(() => {
    if (!ids) return;
    const tick = setInterval(async () => {
      setNow(Date.now());
      for (const job of latest.current.jobs) {
        const res = await doFetch(`/api/tools/jobs/${encodeURIComponent(job.id)}?${new URLSearchParams(fields())}`).catch(() => null);
        const view = res?.ok ? ((await res.json().catch(() => ({}))) as { job?: ToolJobView }).job : undefined;
        if (!view) continue;
        setViews((v) => ({ ...v, [view.id]: view }));
        if (TERMINAL_JOB_STATUSES.includes(view.status)) latest.current.onSettled(view);
      }
    }, FOLLOW_EVERY_MS);
    return () => clearInterval(tick);
    // The ids decide what is followed; the rest is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const stop = async (id: string) => {
    const res = await doFetch(`/api/tools/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields()),
    }).catch(() => null);
    const view = res?.ok ? ((await res.json().catch(() => ({}))) as { job?: ToolJobView }).job : undefined;
    if (view) setViews((v) => ({ ...v, [view.id]: view }));
  };

  const live = jobs.map((j) => views[j.id] ?? j).filter((j) => !TERMINAL_JOB_STATUSES.includes(j.status));
  if (live.length === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 space-y-px border-t bd bg-elev text-[12.5px]">
      {live.map((job) => (
        <div key={job.id} data-tool-running-job className="flex items-center gap-2 px-3 py-1.5">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden />
          <span className="truncate fg">{job.title}</span>
          <span className="fg-faint">·</span>
          <span className="tabular-nums fg-muted">{elapsedText(now - Date.parse(job.startedAt))}</span>
          {job.progress ? <span className="truncate fg-muted">{job.progress}</span> : null}
          <span className="ml-auto" />
          {job.status === "stopping" ? (
            <span className="fg-faint">{t("tools.jobs.running.stopping")}</span>
          ) : (
            <button type="button" onClick={() => void stop(job.id)} className="rounded px-2 py-0.5 fg-muted hover:bg-hover hover:fg">
              {t("tools.jobs.running.stop")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
