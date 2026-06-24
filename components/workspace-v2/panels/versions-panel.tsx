// Versions mode panel — per-document timeline of project snapshots with live
// iframe thumbnails. Every snapshot is scoped to one document (home or a site
// page); the filter defaults to the document on the canvas. Auto-snapshots
// happen on:
//   - template clone / paste (source: "initial")
//   - chat-applied AI redesign (source: "chat", label = truncated prompt)
//   - publish (source: "publish", label = "Published to <sub>.openlen.com")
//   - structural edits (reorder / asset replace / section insert) + idle
//     checkpoints while inline-editing
//   - restore — captures pre-restore state before overwriting current
// Users can also snapshot on demand ("Save version"), name versions, and pin
// them so they survive the per-document eviction cap.
//
// Click a card → full-size preview overlay → Restore → parent gets the new
// HTML via `onRestoreApplied` and refreshes the right document.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { SitePageSummary } from "@/lib/projects/site-pages";
import { Check, HistoryIcon, Loader, Pencil, Pin, Plus, Sparkles, X } from "../icons";
import { useFocusTrap } from "../use-focus-trap";
import { useToast } from "../toast";

type VersionSource =
  | "initial"
  | "chat"
  | "publish"
  | "restore"
  | "manual"
  | "style-match"
  | "reorder"
  | "replace";

interface VersionItem {
  id: string;
  projectId: string;
  label: string;
  source: VersionSource;
  page: string | null;
  pinned: boolean;
  createdAt: string;
}

interface VersionsPanelProps {
  /** Project the user is currently viewing. Null = no project loaded —
   *  Versions surfaces an empty state pointing the user at Pages. */
  currentProjectId?: string | null;
  /** Site page on the canvas (null = home) — scopes the default filter and
   *  the "Save version" snapshot. */
  activeSitePage?: string | null;
  /** The project's site pages — used to label page chips. */
  sitePages?: SitePageSummary[];
  /** Called after a successful restore with the new HTML, the page scope it
   *  landed on (null = home), and the server's new updatedAt (ms) so the
   *  parent can refresh the right document + its concurrency base. */
  onRestoreApplied?: (
    html: string,
    page: string | null,
    updatedAtMs?: number,
  ) => void;
  /** Flush any pending canvas autosave and resolve once it settled, so a
   *  server-side snapshot reads the freshest document. */
  onPrepareSnapshot?: () => Promise<void>;
}

export function VersionsPanel({
  currentProjectId,
  activeSitePage = null,
  sitePages = [],
  onRestoreApplied,
  onPrepareSnapshot,
}: VersionsPanelProps) {
  const t = useTranslations("panelsB");
  const toast = useToast();
  const [items, setItems] = useState<VersionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<VersionItem | null>(null);
  const [filter, setFilter] = useState<"page" | "all">("page");
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const activeScope = activeSitePage ?? null;

  const refetch = useCallback(async () => {
    if (!currentProjectId) return;
    const res = await fetch(`/api/projects/${currentProjectId}/versions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { versions: VersionItem[] };
    setItems(data.versions);
  }, [currentProjectId]);

  useEffect(() => {
    if (!currentProjectId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setItems(null);
    setError(null);
    void fetch(`/api/projects/${currentProjectId}/versions`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ versions: VersionItem[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.versions);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("versions.loadError"));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  // Multi-page affordances only matter when the project actually has page
  // scopes in play (site pages now, or orphan snapshots of deleted pages).
  const hasPageScopes =
    sitePages.length > 0 || (items ?? []).some((i) => i.page !== null);

  const visible = useMemo(() => {
    if (items === null) return null;
    if (filter === "all" && hasPageScopes) return items;
    return items.filter((i) => (i.page ?? null) === activeScope);
  }, [items, filter, hasPageScopes, activeScope]);

  // The newest snapshot of each document is that document's "current" marker
  // — listVersions returns newest-first, so the first hit per scope wins.
  const currentIds = useMemo(() => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const item of items ?? []) {
      const scope = item.page ?? "~home";
      if (!seen.has(scope)) {
        seen.add(scope);
        ids.add(item.id);
      }
    }
    return ids;
  }, [items]);

  const pageLabel = useCallback(
    (page: string | null): string => {
      if (page === null) return t("versions.pageHome");
      return sitePages.find((p) => p.slug === page)?.title ?? page;
    },
    [sitePages, t],
  );

  const doRestore = useCallback(
    async (item: VersionItem) => {
      if (!currentProjectId) return;
      setRestoring(item.id);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/${currentProjectId}/versions/${item.id}/restore`,
          { method: "POST" },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          html: string;
          label: string;
          page: string | null;
          updatedAt?: string;
        };
        const updatedAtMs = data.updatedAt
          ? new Date(data.updatedAt).getTime()
          : undefined;
        onRestoreApplied?.(data.html, data.page ?? null, updatedAtMs);
        // Refresh the timeline — the restore created new snapshots
        // ("Before restoring…" + the forward marker) we want to show.
        await refetch().catch(() => {});
        setPreviewing(null);
        const label = (data.label ?? item.label)?.trim();
        toast.success(
          label
            ? t("toast.restored", { label })
            : t("toast.restoredNoLabel"),
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("versions.restoreError"),
        );
        toast.error(t("toast.restoreError"));
      } finally {
        setRestoring(null);
      }
    },
    [currentProjectId, onRestoreApplied, refetch, t, toast],
  );

  const doPin = useCallback(
    async (item: VersionItem) => {
      if (!currentProjectId) return;
      setPinBusyId(item.id);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/${currentProjectId}/versions/${item.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pinned: !item.pinned }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            body.error === "pin_limit"
              ? t("versions.pinLimit")
              : t("versions.pinError"),
          );
        }
        setItems((prev) =>
          prev
            ? prev.map((i) =>
                i.id === item.id ? { ...i, pinned: !item.pinned } : i,
              )
            : prev,
        );
        toast.success(
          item.pinned ? t("toast.unpinned") : t("toast.pinned"),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : t("versions.pinError"));
        toast.error(t("toast.pinError"));
      } finally {
        setPinBusyId(null);
      }
    },
    [currentProjectId, t, toast],
  );

  const doRename = useCallback(
    async (item: VersionItem, name: string) => {
      setRenamingId(null);
      const label = name.trim();
      if (!currentProjectId || !label || label === item.label) return;
      setError(null);
      // Optimistic — a rename that fails reverts on the next refetch.
      setItems((prev) =>
        prev
          ? prev.map((i) => (i.id === item.id ? { ...i, label } : i))
          : prev,
      );
      try {
        const res = await fetch(
          `/api/projects/${currentProjectId}/versions/${item.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label }),
          },
        );
        if (!res.ok) throw new Error();
      } catch {
        setError(t("versions.renameError"));
        await refetch().catch(() => {});
      }
    },
    [currentProjectId, refetch, t],
  );

  const doSaveNow = useCallback(async () => {
    if (!currentProjectId || saveBusy) return;
    setSaveBusy(true);
    setError(null);
    try {
      // Flush the canvas's debounced autosave first — the snapshot reads the
      // project server-side and must see the latest keystrokes.
      await onPrepareSnapshot?.().catch(() => {});
      const label = saveName.trim() || t("versions.defaultSaveName");
      const res = await fetch(`/api/projects/${currentProjectId}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          page: activeScope,
        }),
      });
      if (!res.ok) throw new Error();
      setSaveName("");
      setSaveOpen(false);
      await refetch().catch(() => {});
      toast.success(t("toast.saved", { label }));
    } catch {
      setError(t("versions.saveError"));
      toast.error(t("toast.saveError"));
    } finally {
      setSaveBusy(false);
    }
  }, [
    currentProjectId,
    saveBusy,
    saveName,
    activeScope,
    onPrepareSnapshot,
    refetch,
    t,
    toast,
  ]);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <HistoryIcon size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">
            {t("versions.perProject")}
          </p>
          <p className="mt-1.5 text-[10.5px] fg-faint leading-relaxed">
            {t("versions.perProjectHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* No panel title here — the sidebar's panel header already shows it. */}
      <div className="px-3 pt-2.5 pb-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] fg-faint leading-snug flex-1 min-w-0">
            {t("versions.subtitle")}
          </div>
          <button
            type="button"
            onClick={() => setSaveOpen((o) => !o)}
            className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] bg-elev text-[10.5px] font-medium fg-muted hover:fg transition"
          >
            <Plus size={11} />
            {t("versions.save")}
          </button>
        </div>
        {saveOpen && (
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void doSaveNow();
            }}
          >
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              maxLength={120}
              placeholder={t("versions.saveNamePlaceholder")}
              className="flex-1 min-w-0 h-7 px-2 rounded-md ring-1 ring-[color:var(--border)] focus:ring-[color:var(--accent)] outline-none bg-[color:var(--bg)] text-[11.5px] fg placeholder:fg-faint"
            />
            <button
              type="submit"
              disabled={saveBusy}
              className="inline-flex items-center justify-center h-7 px-2.5 rounded-md bg-[color:var(--accent)] text-white text-[11px] font-medium hover:brightness-105 disabled:opacity-60 transition"
            >
              {saveBusy ? <Loader size={11} className="animate-spin" /> : t("versions.saveConfirm")}
            </button>
          </form>
        )}
        {hasPageScopes && (
          <div className="mt-2 flex items-center gap-1" role="tablist" aria-label={t("versions.filterLabel")}>
            <FilterChip
              active={filter === "page"}
              onClick={() => setFilter("page")}
              label={`${t("versions.filterPage")} · ${pageLabel(activeScope)}`}
            />
            <FilterChip
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label={t("versions.filterAll")}
            />
          </div>
        )}
      </div>
      {error && (
        <div className="mx-3 mt-1 mb-2 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 pt-1">
        {visible === null && <Skeletons />}
        {visible !== null && visible.length === 0 && !error && (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
              <Sparkles size={14} />
            </div>
            <p className="text-[12px] fg-muted leading-relaxed">
              {items && items.length > 0
                ? t("versions.emptyScoped")
                : t("versions.empty")}
            </p>
            <p className="mt-1 text-[10.5px] fg-faint leading-relaxed">
              {t("versions.emptyHint")}
            </p>
          </div>
        )}
        {visible !== null && visible.length > 0 && (
          <div className="space-y-2.5">
            {visible.map((item) => (
              <VersionCard
                key={item.id}
                item={item}
                isCurrent={currentIds.has(item.id)}
                showPageChip={filter === "all" && hasPageScopes}
                pageLabel={pageLabel(item.page)}
                disabled={restoring !== null}
                pinBusy={pinBusyId === item.id}
                renaming={renamingId === item.id}
                onOpenPreview={() => {
                  setError(null);
                  setPreviewing(item);
                }}
                onTogglePin={() => void doPin(item)}
                onStartRename={() => setRenamingId(item.id)}
                onCancelRename={() => setRenamingId(null)}
                onCommitRename={(name) => void doRename(item, name)}
              />
            ))}
          </div>
        )}
      </div>
      {previewing && (
        <VersionPreviewModal
          item={previewing}
          isCurrent={currentIds.has(previewing.id)}
          pageLabel={pageLabel(previewing.page)}
          isRestoring={restoring === previewing.id}
          error={error}
          onClose={() => {
            if (restoring === null) setPreviewing(null);
          }}
          onRestore={() => void doRestore(previewing)}
          relativeLabel={relativeTime(previewing.createdAt, t)}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center h-6 px-2 rounded-md text-[10.5px] font-medium transition max-w-full ${
        active
          ? "bg-accent-soft text-accent ring-1 ring-[color:var(--accent)]/40"
          : "fg-muted hover:fg hover:bg-hover ring-1 ring-[color:var(--border)]"
      }`}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

const NATIVE_W = 1280;
const NATIVE_H = 800;

function VersionCard({
  item,
  isCurrent,
  showPageChip,
  pageLabel,
  disabled,
  pinBusy,
  renaming,
  onOpenPreview,
  onTogglePin,
  onStartRename,
  onCancelRename,
  onCommitRename,
}: {
  item: VersionItem;
  isCurrent: boolean;
  showPageChip: boolean;
  pageLabel: string;
  disabled: boolean;
  pinBusy: boolean;
  renaming: boolean;
  onOpenPreview: () => void;
  onTogglePin: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (name: string) => void;
}) {
  const t = useTranslations("panelsB");
  const [draft, setDraft] = useState(item.label);
  useEffect(() => {
    if (renaming) setDraft(item.label);
  }, [renaming, item.label]);

  return (
    <div
      className={`group relative rounded-lg ring-1 transition overflow-hidden ${
        isCurrent
          ? "ring-[color:var(--accent)]/60 bg-accent-soft/30"
          : "ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:shadow-card"
      }`}
    >
      <div className="relative">
        <VersionThumb
          projectId={item.projectId}
          versionId={item.id}
          label={item.label}
        />
        {/* Full-thumb hit target: opens the full-size preview overlay. */}
        <button
          type="button"
          onClick={onOpenPreview}
          disabled={disabled}
          aria-label={t("versions.view", { label: item.label })}
          className="absolute inset-0 cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] disabled:cursor-default"
        />
        {item.pinned && (
          <span className="absolute top-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-[color:var(--accent)] text-white shadow-coral pointer-events-none">
            <Pin size={11} />
          </span>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="flex items-start gap-1.5">
          <SourceBadge source={item.source} />
          {showPageChip && (
            <span className="shrink-0 inline-flex items-center px-1.5 h-[18px] rounded text-[9.5px] uppercase tracking-wider font-semibold ui-small bg-elev fg-muted ring-1 ring-[color:var(--border)] max-w-[88px]">
              <span className="truncate normal-case tracking-normal">
                {pageLabel}
              </span>
            </span>
          )}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onCommitRename(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommitRename(draft);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
              maxLength={120}
              aria-label={t("versions.rename")}
              className="flex-1 min-w-0 h-[22px] px-1.5 rounded ring-1 ring-[color:var(--accent)] outline-none bg-[color:var(--bg)] text-[12px] fg"
            />
          ) : (
            <span className="text-[12px] font-medium fg flex-1 leading-snug line-clamp-2">
              {item.label}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          <span className="text-[10.5px] fg-faint truncate">
            {relativeTime(item.createdAt, t)}
          </span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onStartRename}
              disabled={disabled || renaming}
              aria-label={t("versions.rename")}
              title={t("versions.rename")}
              className="inline-flex h-5.5 w-5.5 p-1 items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={onTogglePin}
              disabled={disabled || pinBusy}
              aria-label={item.pinned ? t("versions.unpin") : t("versions.pin")}
              title={item.pinned ? t("versions.unpin") : t("versions.pin")}
              aria-pressed={item.pinned}
              className={`inline-flex h-5.5 w-5.5 p-1 items-center justify-center rounded transition ${
                item.pinned
                  ? "text-accent"
                  : "fg-faint hover:fg hover:bg-hover opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              } disabled:opacity-30`}
            >
              {pinBusy ? (
                <Loader size={11} className="animate-spin" />
              ) : (
                <Pin size={11} />
              )}
            </button>
            {isCurrent ? (
              <span className="ml-0.5 text-[9.5px] uppercase tracking-wider text-accent font-semibold ui-small">
                {t("versions.current")}
              </span>
            ) : (
              <button
                type="button"
                onClick={onOpenPreview}
                disabled={disabled}
                className="ml-0.5 text-[10.5px] font-medium text-accent hover:underline disabled:opacity-40 disabled:no-underline"
              >
                {t("versions.restore")}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: VersionSource }) {
  const t = useTranslations("panelsB");
  const meta: Record<
    VersionSource,
    { label: string; color: string; bg: string }
  > = {
    initial: { label: t("versions.source.initial"), color: "fg-faint", bg: "bg-elev" },
    chat: { label: t("versions.source.chat"), color: "text-accent", bg: "bg-accent-soft" },
    publish: {
      label: t("versions.source.publish"),
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    restore: { label: t("versions.source.restore"), color: "fg-muted", bg: "bg-hover" },
    manual: { label: t("versions.source.manual"), color: "fg-muted", bg: "bg-hover" },
    "style-match": {
      label: t("versions.source.styleMatch"),
      color: "text-accent",
      bg: "bg-accent-soft",
    },
    reorder: {
      label: t("versions.source.reorder"),
      color: "text-accent",
      bg: "bg-accent-soft",
    },
    replace: {
      label: t("versions.source.replace"),
      color: "text-accent",
      bg: "bg-accent-soft",
    },
  };
  // Defensive: if a DB row has a source value we don't know about (e.g.
  // future enum additions before the UI ships), fall back to a generic
  // badge so the panel doesn't crash.
  const m = meta[source] ?? {
    label: source,
    color: "fg-muted",
    bg: "bg-hover",
  };
  return (
    <span
      className={`shrink-0 inline-flex items-center px-1.5 h-[18px] rounded text-[9.5px] uppercase tracking-wider font-semibold ui-small ${m.bg} ${m.color}`}
    >
      {m.label}
    </span>
  );
}

function VersionThumb({
  projectId,
  versionId,
  label,
}: {
  projectId: string;
  versionId: string;
  label: string;
}) {
  const t = useTranslations("panelsB");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    if (!wrapperRef.current || mounted) return;
    const el = wrapperRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const compute = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / NATIVE_W);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageHeight = NATIVE_H * scale;
  const iframeStyle: CSSProperties = {
    width: NATIVE_W,
    height: NATIVE_H,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    border: 0,
    pointerEvents: "none",
    opacity: loaded ? 1 : 0,
    transition: "opacity 380ms cubic-bezier(.2,.7,.2,1)",
    willChange: "transform",
  };

  return (
    <div
      ref={wrapperRef}
      className="relative overflow-hidden border-b bd"
      aria-label={t("versions.thumbnailOf", { label })}
    >
      <div
        ref={stageRef}
        className="relative bg-app"
        style={{ height: stageHeight > 0 ? stageHeight : NATIVE_H * 0.18 }}
      >
        <div
          aria-hidden
          className={`absolute inset-0 ${loaded ? "opacity-0" : "opacity-100"} transition-opacity duration-500 ease-out`}
          style={{
            background:
              "linear-gradient(110deg, color-mix(in oklch, var(--surface) 100%, transparent) 8%, color-mix(in oklch, var(--surface-elev) 100%, transparent) 18%, color-mix(in oklch, var(--surface) 100%, transparent) 33%)",
            backgroundSize: "200% 100%",
            animation: loaded ? "none" : "vThumbShimmer 1.6s ease-in-out infinite",
          }}
        />
        {mounted && scale > 0 && (
          <iframe
            src={`/api/projects/${projectId}/versions/${versionId}/raw`}
            title={t("versions.thumbnailTitle", { label })}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            style={iframeStyle}
          />
        )}
      </div>
      <style jsx>{`
        @keyframes vThumbShimmer {
          0% {
            background-position: 100% 0;
          }
          100% {
            background-position: -100% 0;
          }
        }
      `}</style>
    </div>
  );
}

// Full-size preview overlay — see exactly what you'd restore before
// committing. The restore is itself undoable (the current state is
// snapshotted first), and the note under the header says so.
function VersionPreviewModal({
  item,
  isCurrent,
  pageLabel,
  isRestoring,
  relativeLabel,
  error,
  onClose,
  onRestore,
}: {
  item: VersionItem;
  isCurrent: boolean;
  pageLabel: string;
  isRestoring: boolean;
  relativeLabel: string;
  error?: string | null;
  onClose: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("panelsB");
  // Portal to document.body so position:fixed isn't contained by any
  // ancestor with `transform`/`backdrop-filter`/`filter`/`perspective`.
  // The sidebar tree has such ancestors which previously trapped this
  // modal inside the sidebar viewport instead of overlaying the page.
  const [mounted, setMounted] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // ESC closes — unless mid-restore.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRestoring) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isRestoring]);
  const trapRef = useFocusTrap(mounted);
  if (!mounted) return null;

  const overlay = (
    <div
      className="workspace-v2 fixed inset-0 z-[100] flex bg-black/55 backdrop-blur-sm fade-in"
      onClick={() => {
        if (!isRestoring) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-preview-title"
        className="m-3 md:m-6 flex-1 min-w-0 flex flex-col rounded-xl bg-elev border bd shadow-elev overflow-hidden slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-3.5 py-2.5 border-b bd flex items-center gap-2 flex-wrap">
          <SourceBadge source={item.source} />
          <span className="shrink-0 inline-flex items-center px-1.5 h-[18px] rounded text-[10px] font-semibold ui-small bg-elev fg-muted ring-1 ring-[color:var(--border)]">
            {pageLabel}
          </span>
          <h3
            id="version-preview-title"
            className="text-[13px] font-semibold fg leading-tight truncate flex-1 min-w-[140px] font-display"
          >
            {item.label}
          </h3>
          <span className="text-[10.5px] fg-faint shrink-0">
            {relativeLabel}
          </span>
          {isCurrent ? (
            <span className="text-[9.5px] uppercase tracking-wider text-accent font-semibold ui-small px-1.5">
              {t("versions.current")}
            </span>
          ) : (
            <button
              type="button"
              onClick={onRestore}
              disabled={isRestoring}
              className="inline-flex items-center gap-1.5 h-7.5 px-3 py-1.5 rounded-md bg-[color:var(--accent)] text-white text-[12px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-60"
            >
              {isRestoring ? (
                <>
                  <Loader size={12} className="animate-spin" />
                  {t("versions.restoring")}
                </>
              ) : (
                <>
                  <Check size={12} />
                  {t("versions.previewRestore")}
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={isRestoring}
            aria-label={t("versions.previewClose")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md fg-muted hover:fg hover:bg-hover transition disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>
        {error && (
          <div className="shrink-0 px-3.5 py-1.5 border-b bd text-[11px] text-red-600 dark:text-red-400 bg-red-500/5">
            {error}
          </div>
        )}
        {!isCurrent && (
          <div className="shrink-0 px-3.5 py-1.5 border-b bd text-[10.5px] fg-faint bg-app">
            {t("versions.confirmNote")}
          </div>
        )}
        <div className="relative flex-1 min-h-0 bg-white">
          {!frameLoaded && (
            <div className="absolute inset-0 flex items-center justify-center fg-faint">
              <Loader size={18} className="animate-spin" />
            </div>
          )}
          <iframe
            src={`/api/projects/${item.projectId}/versions/${item.id}/raw`}
            title={item.label}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameLoaded(true)}
            className="w-full h-full"
            style={{ border: 0, opacity: frameLoaded ? 1 : 0, transition: "opacity 300ms ease" }}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function Skeletons() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] overflow-hidden animate-pulse"
        >
          <div className="h-[88px] bg-zinc-200/70 dark:bg-zinc-800/60" />
          <div className="px-2.5 py-2 space-y-2">
            <div className="h-3 w-2/3 rounded bg-zinc-200/70 dark:bg-zinc-800/60" />
            <div className="h-2.5 w-1/3 rounded bg-zinc-200/70 dark:bg-zinc-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

function relativeTime(
  iso: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const ms = Date.now() - date.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return t("time.justNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("time.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("time.hoursAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t("time.yesterday");
  if (d < 7) return t("time.daysAgo", { count: d });
  if (d < 30) return t("time.weeksAgo", { count: Math.floor(d / 7) });
  return date.toLocaleDateString();
}
