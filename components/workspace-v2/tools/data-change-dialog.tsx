"use client";

// THE CONFIRMATION OPENLEN DRAWS BEFORE A TOOL WRITES PRODUCTION (spec local 2026-11-04-herramientas-hechas-por-len,
// §4.4, Jesús's option B): OpenLen can't see clicks inside the tool's frame, so a production row only changes when
// the person accepts it here, outside the frame, with the change in front of them — as «Hazlo» does, and as Claude
// Duet asks before anything with consequences.
import { useTranslations } from "next-intl";

import { DataChangeRows } from "../chat/event-cards";
import { ModalShell } from "../modal-shell";

export interface ToolDataChange {
  readonly projectId: string;
  readonly table: string;
  readonly key: Readonly<Record<string, unknown>>;
  readonly set: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>>;
}

export function DataChangeDialog({
  open,
  toolTitle,
  projectTitle,
  change,
  onAccept,
  onCancel,
}: {
  open: boolean;
  toolTitle: string;
  projectTitle: string;
  change: ToolDataChange;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("wsChrome");
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      titleId="tool-data-change-title"
      title={t("tools.change.title", { tool: toolTitle, table: change.table, project: projectTitle })}
      subtitle={t("tools.change.subtitle")}
      size="lg"
      closeLabel={t("tools.change.cancel")}
    >
      <div className="rounded-lg border bd px-3 py-2">
        <DataChangeRows change={change} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[13px] fg-muted hover:bg-hover">
          {t("tools.change.cancel")}
        </button>
        <button type="button" onClick={onAccept} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white">
          {t("tools.change.apply")}
        </button>
      </div>
    </ModalShell>
  );
}
