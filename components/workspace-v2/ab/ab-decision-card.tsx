"use client";

// Reusable A/B decision card shared by InsightsPanel, Tu Asistente («Pedidos»),
// and Len's chat (for projects without Tu Asistente). Displays live A vs B metrics,
// confidence/lift, SRM warning, and one-click decision actions with conflict recovery.
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, FlaskConical, Sparkles } from "lucide-react";

import { isUnbroughtWinner } from "@/lib/ab/cards";
import type { AbExperimentView } from "@/lib/ab/types";

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function AbDecisionCard({
  experiment,
  readonly = false,
  highlight = false,
  assistantName,
  onUpdated,
}: {
  experiment: AbExperimentView;
  readonly?: boolean;
  highlight?: boolean;
  assistantName?: string | null;
  onUpdated?: (updated: AbExperimentView) => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [current, setCurrent] = useState<AbExperimentView>(experiment);

  useEffect(() => {
    setCurrent(experiment);
  }, [experiment]);

  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);

  const metrics = current.metrics;
  const stats = metrics?.stats;
  const liftPct = Math.round((stats?.relativeLift ?? 0) * 100);
  const probPct = Math.round(
    (current.winnerVariant === "b"
      ? (stats?.probBBeatsA ?? 0)
      : current.winnerVariant === "a"
        ? (stats?.probABeatsB ?? 0)
        : Math.max(stats?.probBBeatsA ?? 0, stats?.probABeatsB ?? 0)) * 100,
  );

  const canDecide =
    !readonly &&
    (current.status === "winner_ready" ||
      current.status === "inconclusive" ||
      current.status === "running") &&
    current.decisionStatus !== "resolved" &&
    current.decisionStatus !== "applying";

  const headline =
    current.status === "paused_harm"
      ? t("ownAssistant.ab.harmStopTitle")
      : current.status === "winner_ready" && current.winnerVariant === "b"
        ? t("ownAssistant.ab.winnerBTitle", { lift: Math.max(0, liftPct) })
        : current.status === "winner_ready" && current.winnerVariant === "a"
          ? t("ownAssistant.ab.winnerATitle")
          : current.status === "inconclusive"
            ? t("ownAssistant.ab.inconclusiveTitle")
            : t("ownAssistant.ab.runningTitle");

  const decide = async (action: "promote_b" | "keep_a" | "extend") => {
    setBusyAction(action);
    setErrorMsg(null);
    setDoneMsg(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(current.projectId)}/ab/${encodeURIComponent(current.id)}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, locale }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        experiment?: AbExperimentView;
        error?: string;
      } | null;
      if (res.status === 409) {
        setErrorMsg(t("ownAssistant.ab.decidedByConflict"));
        return;
      }
      if (!res.ok || !body?.experiment) {
        setErrorMsg(t("ownAssistant.ab.failed"));
        return;
      }
      setCurrent(body.experiment);
      setDoneMsg(
        action === "promote_b"
          ? t("ownAssistant.ab.promotedDone")
          : action === "keep_a"
            ? t("ownAssistant.ab.keptDone")
            : t("ownAssistant.ab.extendedDone"),
      );
      onUpdated?.(body.experiment);
    } catch {
      setErrorMsg(t("ownAssistant.ab.failed"));
    } finally {
      setBusyAction(null);
    }
  };

  const retryBring = async () => {
    setBusyAction("bring");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(current.projectId)}/ab/${encodeURIComponent(current.id)}/bring`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => null)) as { status?: string } | null;
      if (!res.ok) {
        setErrorMsg(t("ownAssistant.ab.failed"));
        return;
      }
      if (body?.status === "brought" || body?.status === "nothing") {
        const next: AbExperimentView = { ...current, bringState: "brought" };
        setCurrent(next);
        onUpdated?.(next);
      } else if (body?.status === "queued") {
        setDoneMsg(t("ownAssistant.ab.bringQueued"));
      } else {
        setErrorMsg(t("ownAssistant.ab.conflictNotice"));
      }
    } catch {
      setErrorMsg(t("ownAssistant.ab.failed"));
    } finally {
      setBusyAction(null);
    }
  };

  // «Don't bring it in»: the owner keeps their draft, production keeps B, and their next publish stops waiting.
  const discardBring = async () => {
    setBusyAction("discard");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(current.projectId)}/ab/${encodeURIComponent(current.id)}/bring`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "discard" }) },
      );
      if (!res.ok) {
        setErrorMsg(t("ownAssistant.ab.failed"));
        return;
      }
      const next: AbExperimentView = { ...current, bringState: "declined" };
      setCurrent(next);
      onUpdated?.(next);
    } catch {
      setErrorMsg(t("ownAssistant.ab.failed"));
    } finally {
      setBusyAction(null);
    }
  };

  const maxRate = Math.max(0.01, metrics?.a.rate ?? 0, metrics?.b.rate ?? 0);
  const aWidth = Math.min(100, Math.round(((metrics?.a.rate ?? 0) / maxRate) * 100));
  const bWidth = Math.min(100, Math.round(((metrics?.b.rate ?? 0) / maxRate) * 100));
  const bPrimary = current.winnerVariant !== "a";

  return (
    <div
      ref={ref}
      data-ab-decision-card={current.id}
      data-ab-status={current.status}
      data-highlight={highlight}
      className={`rounded-xl border bg-elev px-3 py-2.5 text-[12px] ${
        highlight ? "bd-strong ring-2 ring-[var(--accent)]" : "bd"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] fg-faint">
        {current.status === "winner_ready" ? (
          <Sparkles size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
        ) : (
          <FlaskConical size={12} className="shrink-0 text-[var(--nc-accent-text)]" />
        )}
        <span className="truncate font-medium">
          {assistantName
            ? t("ownAssistant.ab.from", { name: assistantName })
            : t("ownAssistant.ab.badge")}
        </span>
        {current.projectTitle ? (
          <span className="truncate fg-faint">· {current.projectTitle}</span>
        ) : null}
        {probPct > 0 && current.status !== "paused_harm" && (
          <span className="ml-auto shrink-0 rounded-full bg-app px-1.5 py-0.5 text-[10px] font-medium fg-muted tabular-nums">
            {t("ownAssistant.ab.confidence", { prob: probPct })}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <b className="text-[12.5px] font-semibold fg">{headline}</b>
        {stats && stats.relativeLift !== 0 && (
          <span
            className={`shrink-0 text-[11px] font-semibold tabular-nums ${
              liftPct > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {liftPct > 0
              ? t("ownAssistant.ab.liftPositive", { lift: liftPct })
              : t("ownAssistant.ab.liftNegative", { lift: liftPct })}
          </span>
        )}
      </div>

      <p className="mt-0.5 text-[11px] fg-muted truncate" title={current.name}>
        {current.name}
        {current.targetPath !== "/" ? ` (${current.targetPath})` : ""}
      </p>

      {metrics && (
        <div className="mt-2 space-y-1.5">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="fg-muted">{t("ownAssistant.ab.controlLabel")}</span>
              <span className="fg tabular-nums font-medium">
                {formatPct(metrics.a.rate)}{" "}
                <span className="fg-faint font-normal">
                  ({t("ownAssistant.ab.conversions", { count: metrics.a.conversions })} /{" "}
                  {t("ownAssistant.ab.views", { count: metrics.a.views })})
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-app overflow-hidden">
              <div
                className="h-full rounded-full bg-[color:var(--fg-faint)]/60"
                style={{ width: `${aWidth}%` }}
              />
            </div>
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="fg font-medium">{t("ownAssistant.ab.variantLabel")}</span>
              <span className="fg tabular-nums font-semibold">
                {formatPct(metrics.b.rate)}{" "}
                <span className="fg-faint font-normal">
                  ({t("ownAssistant.ab.conversions", { count: metrics.b.conversions })} /{" "}
                  {t("ownAssistant.ab.views", { count: metrics.b.views })})
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-app overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent-strong)]"
                style={{ width: `${bWidth}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {current.status === "paused_harm" && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{t("ownAssistant.ab.pausedHarmNotice")}</span>
        </p>
      )}

      {stats?.srmWarning && current.status !== "paused_harm" && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{t("ownAssistant.ab.srmWarning")}</span>
        </p>
      )}

      {isUnbroughtWinner(current) && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200" data-ab-bring={current.bringState}>
          <p>{current.bringState === "pending" ? t("ownAssistant.ab.bringPendingNotice") : t("ownAssistant.ab.conflictNotice")}</p>
          {!readonly && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-ab-bring-retry=""
                disabled={busyAction !== null}
                onClick={() => void retryBring()}
                className="inline-flex h-6 items-center rounded-md border bd bg-elev px-2 text-[11px] font-medium fg hover:bg-hover disabled:opacity-50"
              >
                {busyAction === "bring" ? t("ownAssistant.ab.applying") : t("ownAssistant.ab.retryMerge")}
              </button>
              <button
                type="button"
                data-ab-bring-discard=""
                disabled={busyAction !== null}
                onClick={() => void discardBring()}
                className="inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium fg-muted hover:bg-hover disabled:opacity-50"
              >
                {busyAction === "discard" ? t("ownAssistant.ab.applying") : t("ownAssistant.ab.discardBring")}
              </button>
            </div>
          )}
        </div>
      )}

      {doneMsg && (
        <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <Check size={12} />
          <span>{doneMsg}</span>
        </p>
      )}

      {errorMsg && (
        <p role="alert" className="mt-1.5 text-[11px] nc-bad">
          {errorMsg}
        </p>
      )}

      {canDecide && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-ab-promote-b=""
            disabled={busyAction !== null}
            onClick={() => void decide("promote_b")}
            className={
              bPrimary
                ? "inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-2.5 text-[11px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50"
                : "inline-flex h-7 items-center rounded-md border bd bg-app px-2.5 text-[11px] font-medium fg transition hover:bg-hover disabled:opacity-50"
            }
          >
            {busyAction === "promote_b" ? t("ownAssistant.ab.applying") : t("ownAssistant.ab.promoteB")}
          </button>
          <button
            type="button"
            data-ab-keep-a=""
            disabled={busyAction !== null}
            onClick={() => void decide("keep_a")}
            className={
              !bPrimary
                ? "inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-2.5 text-[11px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50"
                : "inline-flex h-7 items-center rounded-md border bd bg-app px-2.5 text-[11px] font-medium fg transition hover:bg-hover disabled:opacity-50"
            }
          >
            {busyAction === "keep_a" ? t("ownAssistant.ab.applying") : t("ownAssistant.ab.keepA")}
          </button>
          <button
            type="button"
            data-ab-extend=""
            disabled={busyAction !== null}
            onClick={() => void decide("extend")}
            className="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-medium fg-muted transition hover:bg-side hover:fg disabled:opacity-50"
          >
            {busyAction === "extend" ? t("ownAssistant.ab.applying") : t("ownAssistant.ab.extend")}
          </button>
        </div>
      )}
    </div>
  );
}
