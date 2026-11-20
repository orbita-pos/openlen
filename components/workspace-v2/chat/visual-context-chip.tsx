"use client";

/**
 * WHAT A VISUAL REPORTED FOR THE NEXT MESSAGE (updateModelContext, MCP Apps SEP-1865), over the composer. It goes
 * to the model as data after what the person writes, and it is text they didn't write — so it is shown in full on
 * demand (one truncated line would hide what the model is about to read) and can be dropped with the ×.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";

export function VisualContextChip({ text, onClear }: { text: string; onClear: () => void }) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="visual-context-chip" className="mb-1.5 flex items-start gap-2 rounded-lg border bd bg-elev px-2.5 py-1 text-[12px] fg-muted">
      <button
        type="button"
        data-testid="visual-context-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-w-0 flex-1 rounded text-left hover:fg"
      >
        <span data-testid="visual-context-text" className={open ? "block whitespace-pre-wrap break-words" : "block truncate"}>
          <span className="fg-faint">{t("visualContextLabel")}</span> {text}
        </span>
      </button>
      <button type="button" onClick={onClear} className="shrink-0 rounded px-1 text-[12px] fg-faint hover:bg-hover hover:fg" aria-label={t("visualContextClear")}>
        ×
      </button>
    </div>
  );
}
