"use client";

// Active experiment surface inside `InsightsPanel`:
//   - `draft` → shows «Comparar A y B» / «Lanzar 50/50» modal launcher
//   - `running` | `winner_ready` | `inconclusive` | `paused_harm` → renders `AbDecisionCard`
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Columns2, FlaskConical } from "lucide-react";

import type { AbExperimentView } from "@/lib/ab/types";
import { AbCompareModal } from "./ab-compare-modal";
import { AbDecisionCard } from "./ab-decision-card";

export function AbExperimentCard({
  experiment,
  onUpdated,
}: {
  experiment: AbExperimentView;
  onUpdated: (updated: AbExperimentView) => void;
}) {
  const t = useTranslations("panelsChat");
  const [comparing, setComparing] = useState(false);

  if (experiment.status === "draft") {
    return (
      <>
        <div
          data-ab-draft-card={experiment.id}
          className="rounded-md ring-1 ring-[color:var(--accent)]/30 bg-accent-soft p-2.5 text-[12px]"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] fg-muted">
            <FlaskConical size={12} className="text-[var(--nc-accent-text)]" />
            <span>{t("ownAssistant.ab.draftTitle")}</span>
          </div>
          <p className="mt-1 font-medium fg">{experiment.name}</p>
          {experiment.hypothesis && (
            <p className="mt-0.5 text-[11px] fg-muted leading-relaxed">{experiment.hypothesis}</p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              data-ab-open-compare=""
              onClick={() => setComparing(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-strong)] px-2.5 text-[11.5px] font-medium text-white shadow-coral transition hover:brightness-105"
            >
              <Columns2 size={12} />
              <span>{t("ownAssistant.ab.compare")}</span>
            </button>
          </div>
        </div>
        {comparing && (
          <AbCompareModal
            experiment={experiment}
            onClose={() => setComparing(false)}
            onUpdated={onUpdated}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-1.5">
      <AbDecisionCard experiment={experiment} onUpdated={onUpdated} />
      {experiment.status === "running" && experiment.metrics && (
        <p className="px-1 text-[10px] fg-faint">
          {t("ownAssistant.ab.collectingHint", {
            views: experiment.metrics.a.views + experiment.metrics.b.views,
          })}
        </p>
      )}
    </div>
  );
}
