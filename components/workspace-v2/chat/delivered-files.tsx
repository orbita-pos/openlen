"use client";

/**
 * THE FILES LEN DELIVERED with `present` (spec local 2026-10-26-len-skills, §4.9): one card per file
 * of the turn. DeepSeek's host shows presented files after the turn the same way. Tapping the card
 * opens the shared viewer (spec local 2026-10-31-len-movil, §5.1), the one the phone uses too; the
 * download stays one tap away, on the card and in the viewer.
 */
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Viewer, type ViewerFile } from "@/components/viewer/viewer";

import type { AgentAction } from "../agent-action-card";

function size(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} B`;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(/\.0$/, "")} KB`;
  return `${(kb / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** The web fetches with its cookie; an HTML opens on the canvas host (`…/view`). */
const loadBytes = async (url: string): Promise<Blob> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
};
const openHtml = async (url: string): Promise<string> => {
  const res = await fetch(`${url}/view`, { method: "POST" });
  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  if (!res.ok || typeof body?.url !== "string") throw new Error(String(res.status));
  return body.url;
};

export function DeliveredFiles({ actions }: { actions: readonly AgentAction[] | undefined }) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState<ViewerFile | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const files = (actions ?? []).filter((a) => a.tool === "present").flatMap((a) => a.delivered ?? []);
  if (files.length === 0) return null;
  const download = (f: ViewerFile, className: string) => (
    <a href={f.url} target="_blank" rel="noopener noreferrer" download={f.name} title={t("turn.download")} aria-label={t("turn.download")} className={className}>
      <Download size={14} className="shrink-0" />
    </a>
  );
  return (
    <div className="mt-2 flex flex-col gap-1.5" aria-label={t("turn.deliveredFiles")}>
      <span className="text-[11px] font-medium fg-muted">{t("turn.deliveredFiles")}</span>
      {files.map((f) => (
        <div key={f.url} className="group flex items-center gap-1 rounded-lg border bd bg-elev pr-1.5 text-[12.5px] hover:bg-hover">
          <button type="button" data-delivered-open="" onClick={() => setOpen(f)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
            <FileText size={16} className="shrink-0 text-[var(--nc-accent-text)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium fg">{f.name}</span>
              <span className="block truncate text-[11px] fg-muted">
                {f.description ? `${f.description} · ` : ""}
                {size(f.size)}
              </span>
            </span>
          </button>
          {download(f, "grid h-7 w-7 shrink-0 place-items-center rounded-md fg-muted hover:bg-side hover:fg")}
        </div>
      ))}
      {open &&
        createPortal(
          <Viewer
            file={open}
            loadBytes={loadBytes}
            openHtml={openHtml}
            onClose={close}
            actions={
              <a href={open.url} target="_blank" rel="noopener noreferrer" download={open.name}>
                {t("viewer.download")}
              </a>
            }
            labels={{
              close: t("viewer.close"),
              download: t("viewer.download"),
              noPreview: t("viewer.noPreview"),
              loading: t("viewer.loading"),
              failed: t("viewer.failed"),
              page: (n, total) => `${n} / ${total}`,
            }}
          />,
          document.body,
        )}
    </div>
  );
}
