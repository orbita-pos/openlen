// Paste-HTML entry panel. Shown in the left sidebar when the workspace is
// in the "paste" entry mode (user picked "Paste your HTML" from the empty
// state). User pastes HTML from a claude.ai artifact (or anywhere else),
// optionally names the project, and we POST it to /api/projects/from-html
// — that creates a real project row with `data.html` set, then the page
// router-pushes to /new?project=<newId> where Deploy is enabled.

"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { FileText, Sparkles, X } from "../icons";

export function PastePanel() {
  const t = useTranslations("panelsA");
  const locale = useLocale();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCreate = async () => {
    if (submitting) return;
    const trimmed = html.trim();
    if (trimmed.length === 0) {
      setError(t("paste.errorEmpty"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/from-html", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          html: trimmed,
          title: title.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setError(
          data.message ??
            data.error ??
            t("paste.errorHttp", { status: res.status }),
        );
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as { projectId: string; title: string };
      // Hard nav (window.location) rather than router.push because the page
      // needs to re-mount and re-fetch with the new project — soft nav would
      // keep stale state (templatePreview, entryMode, etc).
      window.location.href = `/${locale}/new?project=${data.projectId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const charCount = html.length;
  const showCount = charCount > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <FileText size={13} className="text-accent" />
          <h2 className="text-[11px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
            {t("paste.heading")}
          </h2>
        </div>
        <p className="text-[11px] fg-muted leading-snug">
          {t("paste.description")}
        </p>
      </div>

      <div className="px-3 pb-2 shrink-0">
        <label className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1.5">
          {t("paste.projectNameLabel")}
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("paste.projectNamePlaceholder")}
          disabled={submitting}
          className="w-full h-8 px-2.5 text-[12.5px] rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint focus:outline-none focus:ring-[color:var(--border-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div className="px-3 pb-2 flex-1 min-h-0 flex flex-col">
        <label className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1.5">
          {t("paste.htmlLabel")}
        </label>
        <textarea
          ref={textareaRef}
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder={`<!doctype html>\n<html lang="en">\n<head>\n  ...\n</head>\n<body>\n  ...\n</body>\n</html>`}
          disabled={submitting}
          spellCheck={false}
          className="flex-1 min-h-0 w-full px-2.5 py-2 text-[11.5px] font-mono leading-relaxed rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint focus:outline-none focus:ring-[color:var(--border-strong)] resize-none disabled:opacity-50 disabled:cursor-not-allowed nice-scroll"
        />
        {showCount && (
          <div className="mt-1 text-[10px] fg-faint font-mono tabular-nums">
            {t("paste.charCount", { count: charCount })}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 shrink-0 flex items-start gap-2 px-2.5 py-2 rounded-md ring-1 ring-red-300 dark:ring-red-500/30 bg-red-50 dark:bg-red-500/5">
          <X size={12} className="text-red-600 dark:text-red-400 shrink-0 mt-px" />
          <span className="text-[11px] text-red-700 dark:text-red-300 leading-snug">
            {error}
          </span>
        </div>
      )}

      <div className="px-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting || html.trim().length === 0}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-white/80 animate-pulse" />
              {t("paste.creating")}
            </>
          ) : (
            <>
              <Sparkles size={12} />
              {t("paste.createProject")}
            </>
          )}
        </button>
        <p className="mt-2 text-[10px] fg-faint leading-relaxed text-center">
          {t("paste.deployHint")}
        </p>
      </div>
    </div>
  );
}
