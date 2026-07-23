// Site pages — the project's page tree (Framer-style "Pages" rail). Home +
// flat /slug routes; click switches the canvas, + creates (born as a copy
// of Home so it wears the project's look immediately), hover-trash deletes.
// Slug renames are deliberately absent in v1 (they'd break published links).

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { validatePageSlug, MAX_SITE_PAGES } from "@/lib/projects/site-pages";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import {
  AlertTriangle,
  FileText,
  HomeIcon,
  Loader,
  LockIcon,
  LockOpen,
  Plus,
  Trash,
  X,
} from "../icons";
import { useFocusTrap } from "../use-focus-trap";
import { useToast } from "../toast";

interface SitePagesPanelProps {
  pages: SitePageSummary[];
  /** null = home document. */
  activePage: string | null;
  onSwitch: (slug: string | null) => void;
  /** Returns an i18n error key (sitePages.err*) or null on success. */
  onCreate: (slug: string) => Promise<string | null>;
  onDelete: (slug: string) => Promise<boolean>;
  /** Members module: flip a subpage's members-only flag. Resolves false on
   *  failure (the row reverts). Absent → no lock affordance rendered. */
  onToggleMembersOnly?: (slug: string, next: boolean) => Promise<boolean>;
  /** Members door on → show the auto /cuenta access page as a system row, so
   *  the owner SEES the login/register page exists (Jesús, 2026-07-22). */
  membersDoorOn?: boolean;
}

export function SitePagesPanel({
  pages,
  activePage,
  onSwitch,
  onCreate,
  onDelete,
  onToggleMembersOnly,
  membersDoorOn = false,
}: SitePagesPanelProps) {
  const t = useTranslations("wsChrome");
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [togglingLock, setTogglingLock] = useState<string | null>(null);

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
          const gated = p.membersOnly === true;
          return (
            <div key={p.slug} className="relative group">
              <button
                type="button"
                onClick={() => onSwitch(p.slug)}
                className={rowClass(active)}
              >
                <FileText size={13} className="shrink-0" />
                <span className="text-[12px] truncate tabular">/{p.slug}</span>
                {gated && (
                  <span
                    className="ml-auto shrink-0 text-accent group-hover:opacity-0 transition-opacity"
                    title={t("sitePages.membersOnlyBadge")}
                  >
                    <LockIcon size={11} />
                  </span>
                )}
              </button>
              {onToggleMembersOnly && (
                <button
                  type="button"
                  disabled={togglingLock === p.slug}
                  aria-label={t(
                    gated ? "sitePages.membersOnlyOff" : "sitePages.membersOnlyOn",
                    { slug: p.slug },
                  )}
                  title={t(
                    gated ? "sitePages.membersOnlyOff" : "sitePages.membersOnlyOn",
                    { slug: p.slug },
                  )}
                  onClick={async () => {
                    if (togglingLock) return;
                    setTogglingLock(p.slug);
                    await onToggleMembersOnly(p.slug, !gated);
                    setTogglingLock(null);
                  }}
                  className={`absolute right-8 top-1 h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded transition disabled:opacity-50 ${
                    gated
                      ? "text-accent hover:bg-hover"
                      : "fg-faint hover:fg hover:bg-hover"
                  }`}
                >
                  {togglingLock === p.slug ? (
                    <Loader size={11} className="animate-spin" />
                  ) : gated ? (
                    <LockIcon size={11} />
                  ) : (
                    <LockOpen size={11} />
                  )}
                </button>
              )}
              <button
                type="button"
                disabled={deleting === p.slug}
                aria-label={t("sitePages.deleteLabel", { slug: p.slug })}
                title={t("sitePages.deleteLabel", { slug: p.slug })}
                onClick={() => setDeleteTarget(p.slug)}
                className="absolute right-1 top-1 h-6 w-6 hidden group-hover:inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50"
              >
                {deleting === p.slug ? (
                  <Loader size={11} className="animate-spin" />
                ) : (
                  <Trash size={11} />
                )}
              </button>
            </div>
          );
        })}

        {membersDoorOn && (
          <div
            className="flex items-center gap-2 w-full h-8 px-2 rounded-md fg-muted cursor-default"
            title={t("sitePages.doorTitle")}
          >
            <LockOpen size={13} className="shrink-0" />
            <span className="text-[12px] truncate tabular">/cuenta</span>
            <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide fg-faint rounded px-1 py-0.5 ring-1 ring-[color:var(--border)]">
              {t("sitePages.doorBadge")}
            </span>
          </div>
        )}

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
          <>
            <button
              type="button"
              disabled={atLimit}
              onClick={() => setAdding(true)}
              className="mt-2 flex items-center justify-center gap-1.5 w-full h-8 rounded-md border border-dashed bd fg-faint hover:fg hover:bg-hover transition text-[12px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={12} />
              {t("sitePages.addPage")}
            </button>
            {atLimit && (
              <div className="px-1 pt-1 text-[10.5px] fg-faint">
                {t("sitePages.errLimit")}
              </div>
            )}
          </>
        )}
      </div>
      <div className="shrink-0 px-3 py-2 border-t bd text-[10.5px] fg-faint leading-relaxed">
        {t("sitePages.hint")}
      </div>
      {deleteTarget && (
        <DeletePageDialog
          slug={deleteTarget}
          busy={deleting === deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const slug = deleteTarget;
            setDeleting(slug);
            const ok = await onDelete(slug);
            setDeleting(null);
            if (ok) {
              setDeleteTarget(null);
              toast.success(t("toast.deleted.title"));
            } else {
              toast.error(t("toast.deleteFailed.title"));
            }
          }}
        />
      )}
    </div>
  );
}

// Type-to-confirm delete — same contract as the project delete dialog: the
// red button stays disabled until the user types the slug of the page they
// are destroying. Portaled to <body> with the workspace-v2 class so the
// tokens resolve outside the panel's stacking context.
function DeletePageDialog({
  slug,
  busy,
  onConfirm,
  onClose,
}: {
  slug: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("wsChrome");
  const [typed, setTyped] = useState("");
  const match = typed.trim() === slug;
  const trapRef = useFocusTrap(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const overlay = (
    <div
      className="workspace-v2 fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-page-title"
        className="w-[360px] max-w-[90vw] rounded-xl bg-elev border bd shadow-elev p-5 slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400">
            <AlertTriangle size={17} />
          </span>
          <div className="min-w-0">
            <h3
              id="delete-page-title"
              className="text-[15px] font-semibold fg leading-tight font-display"
            >
              {t("sitePages.deleteTitle", { slug })}
            </h3>
            <p className="mt-1 text-[12px] fg-muted leading-relaxed">
              {t("sitePages.deleteBody")}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-[11.5px] font-medium fg-muted mb-1.5">
            {t("sitePages.confirmLabel", { slug })}
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && match && !busy) onConfirm();
            }}
            placeholder={slug}
            className="w-full px-3 h-9 rounded-md bg-app border bd text-[13px] fg placeholder:fg-faint outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/30"
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md text-[12px] font-medium fg-muted hover:fg hover:bg-hover transition"
          >
            {t("sitePages.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!match || busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-red-600 text-white text-[12px] font-semibold hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader size={12} className="animate-spin" />
            ) : (
              <Trash size={12} />
            )}
            {t("sitePages.confirmBtn")}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
