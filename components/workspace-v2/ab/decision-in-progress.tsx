"use client";

// THE PUBLISH THAT MET A DECISION IN PROGRESS (review: writers outside the claim). «Stop and publish» claims the experiment's
// decision like any decision does; while someone else — the harm brake, another click, the system — holds it, the publish
// is refused 409 `ab_decision_in_progress` and nothing is touched. The owner reads why and tries again in a minute. Shared by the
// Publish dialog and Len's publish card; it looks like `AbExperimentRunning`.
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

export function AbDecisionInProgress({ onClose }: { onClose: () => void }) {
  const t = useTranslations("modalsDeploy.abDecisionInProgress");
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11.5px] dark:border-amber-500/40 dark:bg-amber-500/10" role="alert" data-ab-decision-in-progress>
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
        <FlaskConical size={13} className="shrink-0" />
        {t("title")}
      </div>
      <p className="m-0 mt-0.5 fg-muted">{t("body")}</p>
      <div className="mt-2">
        <button type="button" onClick={onClose} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg hover:bg-hover">
          {t("ok")}
        </button>
      </div>
    </div>
  );
}
