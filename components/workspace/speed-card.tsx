"use client";

import { useEffect, useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

// Speed Card — surfaces the Flight Check report (post-publish Lighthouse
// lab run, see lib/publish/flight-check.ts) inside the publish modal's
// manage view. Polls the owner-gated report endpoint while the modal is
// open: the audit runs fire-and-forget after the deploy, so right after
// publishing there's a "measuring…" window before the row lands.

interface FlightReport {
  perfScore: number | null;
  a11yScore: number | null;
  bpScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  totalBytes: number | null;
  requestCount: number | null;
}

const POLL_MS = 4_000;
// ~2 min of polling — covers the one-at-a-time Lighthouse queue on the box.
const MAX_POLLS = 30;

function scoreTone(score: number): string {
  if (score >= 90) return "text-emerald-600 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10";
  if (score >= 50) return "text-amber-600 dark:text-amber-400 ring-amber-200 dark:ring-amber-500/30 bg-amber-50 dark:bg-amber-500/10";
  return "text-red-600 dark:text-red-400 ring-red-200 dark:ring-red-500/30 bg-red-50 dark:bg-red-500/10";
}

export function SpeedCard({
  projectId,
  active,
}: {
  projectId: string;
  active: boolean;
}) {
  const t = useTranslations("modalsDomain");
  const [report, setReport] = useState<FlightReport | null>(null);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setExhausted(false);

    const tick = async () => {
      polls++;
      try {
        const res = await fetch(`/api/projects/${projectId}/flight-report`);
        if (res.ok) {
          const data = (await res.json()) as { report: FlightReport | null };
          if (stopped) return;
          if (data.report) {
            setReport(data.report);
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (stopped) return;
      if (polls >= MAX_POLLS) {
        setExhausted(true);
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, projectId]);

  if (!report) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-zinc-50/60 dark:bg-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3.5 py-3 text-[11.5px] text-zinc-500">
        {exhausted ? (
          <>
            <Gauge size={13} className="shrink-0 text-zinc-400" />
            {t("publish.speedCard.pending")}
          </>
        ) : (
          <>
            <Loader2 size={13} className="shrink-0 animate-spin text-zinc-400" />
            {t("publish.speedCard.measuring")}
          </>
        )}
      </div>
    );
  }

  const facts: string[] = [];
  if (report.lcpMs !== null) {
    facts.push(
      t("publish.speedCard.loadsIn", {
        seconds: (report.lcpMs / 1000).toFixed(1),
      }),
    );
  }
  if (report.totalBytes !== null) {
    facts.push(
      t("publish.speedCard.weight", {
        kb: Math.max(1, Math.round(report.totalBytes / 1024)),
      }),
    );
  }
  if (report.requestCount !== null) {
    facts.push(t("publish.speedCard.requests", { count: report.requestCount }));
  }
  const chips: Array<{ label: string; score: number }> = [];
  if (report.a11yScore !== null)
    chips.push({ label: t("publish.speedCard.a11y"), score: report.a11yScore });
  if (report.seoScore !== null)
    chips.push({ label: t("publish.speedCard.seo"), score: report.seoScore });
  if (report.bpScore !== null)
    chips.push({ label: t("publish.speedCard.practices"), score: report.bpScore });

  return (
    <div className="rounded-lg bg-zinc-50/60 dark:bg-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3.5 py-3">
      <div className="flex items-center gap-3">
        {report.perfScore !== null && (
          <div
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full ring-2 text-[15px] font-bold tabular-nums",
              scoreTone(report.perfScore),
            )}
          >
            {report.perfScore}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-200">
            {t("publish.speedCard.title")}
          </div>
          {facts.length > 0 && (
            <div className="text-[11.5px] text-zinc-500 truncate">
              {facts.join(" · ")}
            </div>
          )}
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 rounded-md bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 px-1.5 py-0.5 text-[10.5px] text-zinc-600 dark:text-zinc-300"
            >
              {c.label}
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  c.score >= 90
                    ? "text-emerald-600 dark:text-emerald-400"
                    : c.score >= 50
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400",
                )}
              >
                {c.score}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-[10.5px] text-zinc-400">
        {t("publish.speedCard.labNote")}
      </div>
    </div>
  );
}
