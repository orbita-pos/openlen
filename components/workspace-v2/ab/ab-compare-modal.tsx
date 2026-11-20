"use client";

// Side-by-side Control A vs Variant B preview modal before launching a 50/50 split.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FlaskConical, Rocket, Trash2, X } from "lucide-react";

import type { AbExperimentView } from "@/lib/ab/types";

export function AbCompareModal({
  experiment,
  onClose,
  onUpdated,
}: {
  experiment: AbExperimentView;
  onClose: () => void;
  onUpdated: (updated: AbExperimentView) => void;
}) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [busy, setBusy] = useState<"launch" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewA = `/api/projects/${encodeURIComponent(experiment.projectId)}/ab/${encodeURIComponent(experiment.id)}/preview?variant=a`;
  const previewB = `/api/projects/${encodeURIComponent(experiment.projectId)}/ab/${encodeURIComponent(experiment.id)}/preview?variant=b`;

  const launch = async () => {
    setBusy("launch");
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(experiment.projectId)}/ab/${encodeURIComponent(experiment.id)}/launch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locale }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        experiment?: AbExperimentView;
        message?: string;
      } | null;
      if (!res.ok || !body?.experiment) {
        setError(body?.message || t("ownAssistant.ab.failed"));
        return;
      }
      onUpdated(body.experiment);
      onClose();
    } catch {
      setError(t("ownAssistant.ab.failed"));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(experiment.projectId)}/ab/${encodeURIComponent(experiment.id)}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        },
      );
      const body = (await res.json().catch(() => null)) as {
        experiment?: AbExperimentView;
      } | null;
      if (!res.ok || !body?.experiment) {
        setError(t("ownAssistant.ab.failed"));
        return;
      }
      onUpdated(body.experiment);
      onClose();
    } catch {
      setError(t("ownAssistant.ab.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={experiment.name}
    >
      <div className="flex h-[85vh] w-full max-w-[1160px] flex-col overflow-hidden rounded-xl border bd bg-app shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b bd bg-elev px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] fg-faint">
              <FlaskConical size={12} className="text-[var(--nc-accent-text)]" />
              <span>{t("ownAssistant.ab.badge")}</span>
            </div>
            <h2 className="truncate text-[15px] font-semibold fg">{experiment.name}</h2>
            <p className="truncate text-[11.5px] fg-muted">
              {experiment.hypothesis || t("ownAssistant.ab.compareSubtitle")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {experiment.status === "draft" && (
              <>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void discard()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border bd bg-app px-3 text-[12px] font-medium fg-muted transition hover:bg-hover hover:fg disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  <span>{t("ownAssistant.ab.discard")}</span>
                </button>
                <button
                  type="button"
                  data-ab-launch=""
                  disabled={busy !== null}
                  onClick={() => void launch()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-strong)] px-3.5 text-[12px] font-medium text-white shadow-coral transition hover:brightness-105 disabled:opacity-50"
                >
                  <Rocket size={13} />
                  <span>
                    {busy === "launch" ? t("ownAssistant.ab.applying") : t("ownAssistant.ab.launch5050")}
                  </span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("ownAssistant.ab.close")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md fg-muted hover:bg-hover hover:fg"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[var(--border)] md:grid-cols-2">
          <div className="flex min-h-0 flex-col bg-app">
            <div className="border-b bd bg-elev px-3 py-1.5 text-[11px] font-semibold fg-muted">
              {t("ownAssistant.ab.controlLabel")}
            </div>
            <iframe
              title={t("ownAssistant.ab.controlLabel")}
              src={previewA}
              sandbox="allow-scripts allow-same-origin"
              className="min-h-0 flex-1 w-full bg-white"
            />
          </div>
          <div className="flex min-h-0 flex-col bg-app">
            <div className="border-b bd bg-elev px-3 py-1.5 text-[11px] font-semibold text-[var(--nc-accent-text)]">
              {t("ownAssistant.ab.variantLabel")}
            </div>
            <iframe
              title={t("ownAssistant.ab.variantLabel")}
              src={previewB}
              sandbox="allow-scripts allow-same-origin"
              className="min-h-0 flex-1 w-full bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
