"use client";

// WHAT OPENLEN DRAWS AROUND A TOOL'S FRAME FOR ITS JOBS AND FILES (spec local 2026-11-04-herramientas-hechas-por-len,
// §4.4, §4.6): the confirmation before a job runs, OpenLen's own file picker, and the line of each job the frame started.
// One hook for both places a tool runs in the workspace — installed (`ToolFrame`) and its draft canvas — so the bridge
// host gets the same answers in both.
import { useCallback, useState, type ReactNode } from "react";

import type { ToolJobAsk } from "@/lib/tools/bridge/protocol";
import type { ToolJobView } from "@/lib/tools/jobs/types";

import { FilePickDialog } from "./file-pick-dialog";
import { JobConfirmDialog } from "./job-confirm-dialog";
import { RunningJobsBar } from "./running-jobs-bar";
import type { BridgeHostCaller } from "./use-tool-bridge-host";

export function useToolDialogs(o: { toolTitle: string; locale: string; caller: BridgeHostCaller }): {
  onConfirmJob(job: ToolJobAsk): Promise<boolean>;
  onPickFiles(pick: { accept?: string; multiple: boolean }): Promise<File[] | null>;
  onJobStarted(job: ToolJobView): void;
  /** The dialogs (portaled) and the running-jobs line: render it inside the frame's `relative` box. */
  dialogs: ReactNode;
} {
  const [asking, setAsking] = useState<{ job: ToolJobAsk; resolve: (ok: boolean) => void } | null>(null);
  const [picking, setPicking] = useState<{ accept?: string; multiple: boolean; resolve: (files: File[] | null) => void } | null>(null);
  const [started, setStarted] = useState<ToolJobView[]>([]);

  // A new question answers the one before it as «no»: the frame only ever waits on the latest.
  const onConfirmJob = useCallback(
    (job: ToolJobAsk) =>
      new Promise<boolean>((resolve) =>
        setAsking((prev) => {
          prev?.resolve(false);
          return { job, resolve };
        }),
      ),
    [],
  );
  const onPickFiles = useCallback(
    (pick: { accept?: string; multiple: boolean }) =>
      new Promise<File[] | null>((resolve) =>
        setPicking((prev) => {
          prev?.resolve(null);
          return { ...pick, resolve };
        }),
      ),
    [],
  );
  const onJobStarted = useCallback((job: ToolJobView) => setStarted((s) => [...s.filter((j) => j.id !== job.id), job]), []);

  const answerJob = (ok: boolean) => {
    asking?.resolve(ok);
    setAsking(null);
  };
  const answerPick = (files: File[] | null) => {
    picking?.resolve(files);
    setPicking(null);
  };

  const dialogs = (
    <>
      {asking ? <JobConfirmDialog open toolTitle={o.toolTitle} job={asking.job} locale={o.locale} onRun={() => answerJob(true)} onCancel={() => answerJob(false)} /> : null}
      {picking ? (
        <FilePickDialog
          open
          toolTitle={o.toolTitle}
          accept={picking.accept}
          multiple={picking.multiple}
          onPick={(files) => answerPick(files)}
          onCancel={() => answerPick(null)}
        />
      ) : null}
      <RunningJobsBar
        jobs={started}
        caller={o.caller}
        locale={o.locale}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
        onSettled={(job) => setStarted((s) => s.filter((j) => j.id !== job.id))}
      />
    </>
  );
  return { onConfirmJob, onPickFiles, onJobStarted, dialogs };
}
