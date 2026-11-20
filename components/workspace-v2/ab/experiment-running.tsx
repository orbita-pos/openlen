"use client";

// THE PUBLISH THAT WOULD END A RUNNING A/B TEST (review items 13, 14). The page has an experiment live; publishing the
// draft writes a release without its split, so the test stops. The owner is asked once: «Stop and publish» sends the
// publish again with `stopActiveAb` (the server closes the test only after the publish went through), «Cancel» leaves
// everything as it was. Shared by the Publish dialog and Len's publish card; it looks like `LenWatchFixPending`.
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";

export function AbExperimentRunning({
  name,
  busy,
  onStopAndPublish,
  onCancel,
}: {
  /** The running test's name, when the answer carried it. */
  name?: string;
  busy: boolean;
  onStopAndPublish: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("modalsDeploy.abRunning");
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-[11.5px] dark:border-amber-500/40 dark:bg-amber-500/10" role="alert" data-ab-experiment-running>
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200">
        <FlaskConical size={13} className="shrink-0" />
        {t("title")}
      </div>
      <p className="m-0 mt-0.5 fg-muted">{t("body")}</p>
      {name ? <p className="m-0 mt-1 fg-faint">{t("name", { name })}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onStopAndPublish}
          disabled={busy}
          className="inline-flex h-7 items-center rounded-md bg-[var(--accent-strong)] px-3 text-[11.5px] font-medium text-white disabled:opacity-50"
        >
          {t("stopAndPublish")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="h-7 rounded-md px-2.5 text-[11.5px] font-medium fg-faint hover:bg-hover hover:fg">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
