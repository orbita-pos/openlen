"use client";

// THE CONFIRMATION OPENLEN DRAWS BEFORE A TOOL'S JOB RUNS (spec local 2026-11-04-herramientas-hechas-por-len, §4.4,
// §4.6): a job costs the person per second in OpenLen's box, and OpenLen can't see clicks inside the tool's frame, so
// it runs only when the person presses «Ejecutar» here — with the job's title, the most minutes and credits it can
// take (from the version's declaration, never from the tool) and the files it gets.
import { useTranslations } from "next-intl";

import type { ToolJobAsk } from "@/lib/tools/bridge/protocol";

import { ModalShell } from "../modal-shell";

/** Credits from centicredits, as the person reads them: at most two decimals. */
export function creditsText(centis: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(centis / 100);
}

export function JobConfirmDialog({
  open,
  toolTitle,
  job,
  locale,
  onRun,
  onCancel,
}: {
  open: boolean;
  toolTitle: string;
  job: ToolJobAsk;
  locale: string;
  onRun: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wsChrome");
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      titleId="tool-job-confirm-title"
      title={t("tools.jobs.confirm.title", { tool: toolTitle, job: job.title })}
      subtitle={t("tools.jobs.confirm.subtitle")}
      size="lg"
      closeLabel={t("tools.jobs.confirm.cancel")}
    >
      <ul className="space-y-1 rounded-lg border bd px-3 py-2 text-[13px] fg">
        <li>{t("tools.jobs.confirm.minutes", { minutes: job.maxMinutes })}</li>
        <li>{t("tools.jobs.confirm.credits", { credits: creditsText(job.mostCentis, locale) })}</li>
      </ul>
      {job.files.length > 0 ? (
        <div className="mt-3">
          <p className="text-[12px] fg-muted">{t("tools.jobs.confirm.files")}</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[12px] fg">
            {job.files.map((f) => (
              <li key={f.id} data-tool-job-file>
                {f.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[13px] fg-muted hover:bg-hover">
          {t("tools.jobs.confirm.cancel")}
        </button>
        <button type="button" onClick={onRun} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white">
          {t("tools.jobs.confirm.run")}
        </button>
      </div>
    </ModalShell>
  );
}
