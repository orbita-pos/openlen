"use client";

/**
 * THE FILES LEN DELIVERED with `present` (spec local 2026-10-26-len-skills, §4.9): one card per file
 * of the turn, to download it. DeepSeek's host shows presented files after the turn the same way.
 */
import { Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AgentAction } from "../agent-action-card";

function size(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} B`;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(/\.0$/, "")} KB`;
  return `${(kb / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

export function DeliveredFiles({ actions }: { actions: readonly AgentAction[] | undefined }) {
  const t = useTranslations("panelsChat");
  const files = (actions ?? []).filter((a) => a.tool === "present").flatMap((a) => a.delivered ?? []);
  if (files.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5" aria-label={t("turn.deliveredFiles")}>
      <span className="text-[11px] font-medium fg-muted">{t("turn.deliveredFiles")}</span>
      {files.map((f) => (
        <a
          key={f.url}
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          download={f.name}
          title={t("turn.download")}
          className="group flex items-center gap-2 rounded-lg border bd bg-elev px-2.5 py-2 text-[12.5px] hover:bg-hover"
        >
          <FileText size={16} className="shrink-0 text-[var(--nc-accent-text)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium fg">{f.name}</span>
            <span className="block truncate text-[11px] fg-muted">
              {f.description ? `${f.description} · ` : ""}
              {size(f.size)}
            </span>
          </span>
          <Download size={14} className="shrink-0 fg-muted group-hover:fg" />
        </a>
      ))}
    </div>
  );
}
