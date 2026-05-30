// Versions mode panel — timeline of project snapshots with live iframe
// thumbnails. Auto-snapshots happen on:
//   - template clone / paste (source: "initial")
//   - chat-applied AI redesign (source: "chat", label = truncated prompt)
//   - publish (source: "publish", label = "Published to <sub>.openlen.com")
//   - restore — captures pre-restore state before overwriting current
//
// Click a card → confirm modal → POST .../restore → parent gets the new
// HTML via `onRestoreApplied` and refreshes the iframe.

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { HistoryIcon, Sparkles } from "../icons";
import { useFocusTrap } from "../use-focus-trap";

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
  createdAt: string;
}

interface VersionsPanelProps {
  /** Project the user is currently viewing. Null = no project loaded —
   *  Versions surfaces an empty state pointing the user at Pages. */
  currentProjectId?: string | null;
  /** Called after a successful restore with the new HTML. Parent updates
   *  `loadedProject.html` so the preview iframe refreshes. */
  onRestoreApplied?: (html: string) => void;
}

export function VersionsPanel({
  currentProjectId,
  onRestoreApplied,
}: VersionsPanelProps) {
  const t = useTranslations("panelsB");
  const [items, setItems] = useState<VersionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<VersionItem | null>(null);

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
        const data = (await res.json()) as { html: string; label: string };
        onRestoreApplied?.(data.html);
        // Refresh the timeline — the restore created a new "Before
        // restoring…" snapshot we want to show.
        const listRes = await fetch(
          `/api/projects/${currentProjectId}/versions`,
        );
        if (listRes.ok) {
          const fresh = (await listRes.json()) as { versions: VersionItem[] };
          setItems(fresh.versions);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t("versions.restoreError"),
        );
      } finally {
        setRestoring(null);
        setConfirming(null);
      }
    },
    [currentProjectId, onRestoreApplied],
  );

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
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("versions.title")}
        </div>
        <div className="text-[11px] fg-faint mt-0.5">
          {t("versions.subtitle")}
        </div>
      </div>
      {error && (
        <div className="mx-3 mt-1 mb-2 rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3">
        {items === null && <Skeletons />}
        {items !== null && items.length === 0 && !error && (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
              <Sparkles size={14} />
            </div>
            <p className="text-[12px] fg-muted leading-relaxed">
              {t("versions.empty")}
            </p>
            <p className="mt-1 text-[10.5px] fg-faint leading-relaxed">
              {t("versions.emptyHint")}
            </p>
          </div>
        )}
        {items !== null && items.length > 0 && (
          <div className="space-y-2.5">
            {items.map((item, idx) => (
              <VersionCard
                key={item.id}
                item={item}
                isCurrent={idx === 0}
                disabled={restoring !== null}
                onRestoreClick={() => setConfirming(item)}
              />
            ))}
          </div>
        )}
      </div>
      {confirming && (
        <ConfirmRestoreModal
          item={confirming}
          isRestoring={restoring === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void doRestore(confirming)}
        />
      )}
    </div>
  );
}

const NATIVE_W = 1280;
const NATIVE_H = 800;

function VersionCard({
  item,
  isCurrent,
  disabled,
  onRestoreClick,
}: {
  item: VersionItem;
  isCurrent: boolean;
  disabled: boolean;
  onRestoreClick: () => void;
}) {
  const t = useTranslations("panelsB");
  return (
    <div
      className={`group relative rounded-lg ring-1 transition overflow-hidden ${
        isCurrent
          ? "ring-[color:var(--accent)]/60 bg-accent-soft/30"
          : "ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:shadow-card"
      }`}
    >
      <VersionThumb projectId={item.projectId} versionId={item.id} label={item.label} />
      <div className="px-2.5 py-2">
        <div className="flex items-start gap-1.5">
          <SourceBadge source={item.source} />
          <span className="text-[12px] font-medium fg flex-1 leading-snug line-clamp-2">
            {item.label}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          <span className="text-[10.5px] fg-faint truncate">
            {relativeTime(item.createdAt, t)}
          </span>
          {isCurrent ? (
            <span className="text-[9.5px] uppercase tracking-wider text-accent font-semibold ui-small">
              {t("versions.current")}
            </span>
          ) : (
            <button
              type="button"
              onClick={onRestoreClick}
              disabled={disabled}
              className="text-[10.5px] font-medium text-accent hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {t("versions.restore")}
            </button>
          )}
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

function ConfirmRestoreModal({
  item,
  isRestoring,
  onCancel,
  onConfirm,
}: {
  item: VersionItem;
  isRestoring: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("panelsB");
  // Portal to document.body so position:fixed isn't contained by any
  // ancestor with `transform`/`backdrop-filter`/`filter`/`perspective`.
  // The sidebar tree has such ancestors which previously trapped this
  // modal inside the sidebar viewport instead of overlaying the page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // ESC cancels — unless mid-restore.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isRestoring) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, isRestoring]);
  const trapRef = useFocusTrap(mounted);
  if (!mounted) return null;

  const overlay = (
    <div
      className="workspace-v2 fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in"
      onClick={onCancel}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="restore-modal-title"
        className="w-[360px] max-w-[90vw] rounded-xl bg-elev border bd shadow-elev p-5 slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="restore-modal-title" className="text-[15px] font-semibold fg leading-tight font-display">
          {t("versions.confirmTitle")}
        </h3>
        <p className="mt-2 text-[12px] fg-muted leading-relaxed">
          {t("versions.confirmRollback")}
        </p>
        <p className="mt-1 text-[12.5px] fg leading-snug line-clamp-3 italic">
          &ldquo;{item.label}&rdquo;
        </p>
        <p className="mt-3 text-[11px] fg-faint leading-relaxed">
          {t("versions.confirmNote")}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isRestoring}
            className="inline-flex items-center h-8 px-3 rounded-md fg-muted hover:fg hover:bg-hover transition text-[12.5px] disabled:opacity-50"
          >
            {t("versions.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRestoring}
            className="inline-flex items-center h-8 px-3.5 rounded-md bg-[color:var(--accent)] text-white text-[12.5px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-60"
          >
            {isRestoring ? t("versions.restoring") : t("versions.restore")}
          </button>
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
