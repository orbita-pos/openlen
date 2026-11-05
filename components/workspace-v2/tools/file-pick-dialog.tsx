"use client";

// OPENLEN'S OWN FILE PICKER FOR A TOOL (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.6): a tool runs in
// a frame on its own host and never reads the person's disk; when it asks for files, the person chooses them here, in
// a real `<input type="file">` of the workspace, and the tool gets only those — the only files a job ever receives.
import { useState } from "react";
import { useTranslations } from "next-intl";

import { UPLOADS_PER_PICK } from "@/lib/tools/jobs/types";

import { ModalShell } from "../modal-shell";

export function FilePickDialog({
  open,
  toolTitle,
  accept,
  multiple,
  onPick,
  onCancel,
}: {
  open: boolean;
  toolTitle: string;
  accept?: string;
  multiple: boolean;
  onPick: (files: File[]) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wsChrome");
  const [chosen, setChosen] = useState<File[]>([]);
  const limit = multiple ? UPLOADS_PER_PICK : 1;
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      titleId="tool-file-pick-title"
      title={t("tools.files.pick.title", { tool: toolTitle })}
      subtitle={t("tools.files.pick.subtitle")}
      size="lg"
      closeLabel={t("tools.files.pick.cancel")}
    >
      <label className="block cursor-pointer rounded-lg border border-dashed bd px-3 py-4 text-center text-[13px] fg-muted hover:bg-hover">
        {t("tools.files.pick.choose")}
        <input
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          onChange={(e) => setChosen(Array.from(e.currentTarget.files ?? []).slice(0, limit))}
        />
      </label>
      {chosen.length > 0 ? (
        <ul className="mt-3 space-y-0.5 font-mono text-[12px] fg">
          {chosen.map((f, i) => (
            <li key={`${f.name}-${i}`} data-tool-picked-file>
              {f.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[13px] fg-muted hover:bg-hover">
          {t("tools.files.pick.cancel")}
        </button>
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() => onPick(chosen)}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {t("tools.files.pick.use")}
        </button>
      </div>
    </ModalShell>
  );
}
