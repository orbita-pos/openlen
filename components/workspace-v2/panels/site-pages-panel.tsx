// Site pages — the project's page tree (Framer-style "Pages" rail). Home +
// flat /slug routes; click switches the canvas, + creates (born as a copy
// of Home so it wears the project's look immediately), hover-trash deletes.
// Slug renames are deliberately absent in v1 (they'd break published links).

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { validatePageSlug, MAX_SITE_PAGES } from "@/lib/projects/site-pages";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import { FileText, HomeIcon, Loader, Plus, Trash, X } from "../icons";
import { Tooltip } from "../ui";

interface SitePagesPanelProps {
  pages: SitePageSummary[];
  /** null = home document. */
  activePage: string | null;
  onSwitch: (slug: string | null) => void;
  /** Returns an i18n error key (sitePages.err*) or null on success. */
  onCreate: (slug: string) => Promise<string | null>;
  onDelete: (slug: string) => Promise<boolean>;
}

export function SitePagesPanel({
  pages,
  activePage,
  onSwitch,
  onCreate,
  onDelete,
}: SitePagesPanelProps) {
  const t = useTranslations("wsChrome");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const atLimit = pages.length >= MAX_SITE_PAGES;
  const draftCheck = draft.trim() ? validatePageSlug(draft) : null;

  const submit = async () => {
    if (creating) return;
    const check = validatePageSlug(draft);
    if (!check.ok) {
      setError(check.reason === "reserved" ? "errReserved" : "errInvalid");
      return;
    }
    setCreating(true);
    setError(null);
    const err = await onCreate(check.slug);
    setCreating(false);
    if (err) {
      setError(err);
      return;
    }
    setDraft("");
    setAdding(false);
  };

  const rowClass = (active: boolean) =>
    `group flex items-center gap-2 w-full text-left h-8 px-2 rounded-md transition ${
      active ? "bg-elev fg shadow-card border bd" : "fg-muted hover:fg hover:bg-hover"
    }`;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-2 py-2 space-y-0.5">
        <button
          type="button"
          onClick={() => onSwitch(null)}
          className={rowClass(activePage === null)}
        >
          <HomeIcon size={13} className="shrink-0" />
          <span className="text-[12px] font-medium truncate">
            {t("sitePages.home")}
          </span>
        </button>

        {pages.map((p) => {
          const active = activePage === p.slug;
          return (
            <div key={p.slug} className="relative group">
              <button
                type="button"
                onClick={() => onSwitch(p.slug)}
                className={rowClass(active)}
              >
                <FileText size={13} className="shrink-0" />
                <span className="text-[12px] truncate tabular">/{p.slug}</span>
              </button>
              <Tooltip label={t("sitePages.deleteLabel", { slug: p.slug })}>
                <button
                  type="button"
                  disabled={deleting === p.slug}
                  aria-label={t("sitePages.deleteLabel", { slug: p.slug })}
                  onClick={async () => {
                    if (!window.confirm(t("sitePages.deleteConfirm", { slug: p.slug })))
                      return;
                    setDeleting(p.slug);
                    await onDelete(p.slug);
                    setDeleting(null);
                  }}
                  className="absolute right-1 top-1 h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50"
                >
                  {deleting === p.slug ? (
                    <Loader size={11} className="animate-spin" />
                  ) : (
                    <Trash size={11} />
                  )}
                </button>
              </Tooltip>
            </div>
          );
        })}

        {adding ? (
          <div className="mt-2 rounded-md border bd bg-elev p-2 space-y-2 fade-in">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] fg-faint shrink-0">/</span>
              <input
                autoFocus
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setDraft("");
                    setError(null);
                  }
                }}
                placeholder={t("sitePages.slugPlaceholder")}
                className="flex-1 min-w-0 bg-app border bd rounded px-2 h-7 text-[12px] fg outline-none focus:border-[color:var(--accent)]"
              />
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraft("");
                  setError(null);
                }}
                aria-label={t("sitePages.cancel")}
                className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
              >
                <X size={12} />
              </button>
            </div>
            {error ? (
              <div className="text-[11px] text-red-600 dark:text-red-400">
                {t(`sitePages.${error}`)}
              </div>
            ) : draftCheck?.ok && draftCheck.slug !== draft.trim() ? (
              <div className="text-[11px] fg-faint tabular">/{draftCheck.slug}</div>
            ) : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={creating || !draft.trim()}
              className="w-full h-7 rounded-md bg-[var(--accent-strong)] text-white text-[11.5px] font-medium hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {creating && <Loader size={11} className="animate-spin" />}
              {creating ? t("sitePages.creating") : t("sitePages.create")}
            </button>
          </div>
        ) : (
          <Tooltip label={atLimit ? t("sitePages.errLimit") : t("sitePages.addPage")}>
            <button
              type="button"
              disabled={atLimit}
              onClick={() => setAdding(true)}
              className="mt-2 flex items-center justify-center gap-1.5 w-full h-8 rounded-md border border-dashed bd fg-faint hover:fg hover:bg-hover transition text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={12} />
              {t("sitePages.addPage")}
            </button>
          </Tooltip>
        )}
      </div>
      <div className="shrink-0 px-3 py-2 border-t bd text-[10.5px] fg-faint leading-relaxed">
        {t("sitePages.hint")}
      </div>
    </div>
  );
}
