"use client";

// THE FRAME'S LINE FOR A JOB (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): a job costs the person per
// second, so OpenLen shows every job of this tool that is running — the ones this frame started and the ones already
// running when it opened (a reload, the tool reopened) — with its title, how long it has run, its progress line and
// «Detener», even when the tool shows nothing, and follows each every 2 s. When one settles, the line says how it
// ended and links the files it left (here, on OpenLen's own origin, where the person's session opens them) until the
// person closes it.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { TERMINAL_JOB_STATUSES, type ToolJobView } from "@/lib/tools/jobs/types";

import type { BridgeHostCaller } from "./use-tool-bridge-host";

const FOLLOW_EVERY_MS = 2_000;
const LIVE = (j: ToolJobView) => !TERMINAL_JOB_STATUSES.includes(j.status);

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
  onDismiss,
  fetchImpl,
}: {
  /** The jobs this frame started. */
  jobs: readonly ToolJobView[];
  caller: BridgeHostCaller;
  locale: string;
  timeZone: string;
  /** The person closed a settled job's line. */
  onDismiss: (id: string) => void;
  fetchImpl?: typeof fetch;
}) {
  const t = useTranslations("wsChrome");
  const [views, setViews] = useState<Record<string, ToolJobView>>({});
  /** Jobs already running when the frame opened. */
  const [found, setFound] = useState<ToolJobView[]>([]);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef({ caller, locale, timeZone, fetchImpl });
  latest.current = { caller, locale, timeZone, fetchImpl };

  const fields = (): Record<string, string> => {
    const { caller: c, locale: l, timeZone: z } = latest.current;
    return { ...(c as Record<string, string>), locale: l, timeZone: z };
  };
  const doFetch = (...a: Parameters<typeof fetch>) => (latest.current.fetchImpl ?? fetch)(...a);
  const callerKey = JSON.stringify(caller);

  // A reload, or the tool reopened: the jobs that are still running come back with their line.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await doFetch(`/api/tools/jobs?${new URLSearchParams(fields())}`).catch(() => null);
      const listed = res?.ok ? ((await res.json().catch(() => ({}))) as { jobs?: ToolJobView[] }).jobs : undefined;
      if (alive && Array.isArray(listed)) setFound(listed.filter(LIVE));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callerKey]);

  const all = [...jobs, ...found.filter((f) => !jobs.some((j) => j.id === f.id))].map((j) => views[j.id] ?? j).filter((j) => !closed.has(j.id));
  const following = all.filter(LIVE).map((j) => j.id);
  const followKey = following.join(",");

  useEffect(() => {
    if (!followKey) return;
    let busy = false;
    const tick = setInterval(async () => {
      setNow(Date.now());
      if (busy) return;
      busy = true;
      try {
        for (const id of followKey.split(",")) {
          const res = await doFetch(`/api/tools/jobs/${encodeURIComponent(id)}?${new URLSearchParams(fields())}`).catch(() => null);
          const view = res?.ok ? ((await res.json().catch(() => ({}))) as { job?: ToolJobView }).job : undefined;
          if (view) setViews((v) => ({ ...v, [view.id]: view }));
        }
      } finally {
        busy = false;
      }
    }, FOLLOW_EVERY_MS);
    return () => clearInterval(tick);
    // The ids decide what is followed; the rest is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followKey]);

  const stop = async (id: string) => {
    const res = await doFetch(`/api/tools/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields()),
    }).catch(() => null);
    const view = res?.ok ? ((await res.json().catch(() => ({}))) as { job?: ToolJobView }).job : undefined;
    if (view) setViews((v) => ({ ...v, [view.id]: view }));
  };
  const dismiss = (id: string) => {
    setClosed((c) => new Set([...c, id]));
    onDismiss(id);
  };

  if (all.length === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 space-y-px border-t bd bg-elev text-[12.5px]">
      {all.map((job) =>
        LIVE(job) ? (
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
        ) : (
          <div key={job.id} data-tool-running-job className="flex items-center gap-2 px-3 py-1.5">
            <span className="truncate fg">{job.title}</span>
            <span className="fg-faint">·</span>
            <span className={job.status === "completed" ? "fg-muted" : "text-[var(--accent-strong)]"}>{t(`tools.jobs.running.${job.status}`)}</span>
            {job.status !== "completed" && job.detail ? <span className="truncate fg-faint">{job.detail}</span> : null}
            {job.delivered.map((f) => (
              <a key={f.url} data-tool-job-file href={f.url} download={f.name} className="truncate underline fg hover:text-[var(--link)]">
                {f.name}
              </a>
            ))}
            <span className="ml-auto" />
            <button type="button" onClick={() => dismiss(job.id)} className="rounded px-2 py-0.5 fg-muted hover:bg-hover hover:fg">
              {t("tools.jobs.running.dismiss")}
            </button>
          </div>
        ),
      )}
    </div>
  );
}
