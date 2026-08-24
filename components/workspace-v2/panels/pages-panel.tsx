// Pages mode panel — quick-switcher across the user's projects, with a live
// iframe thumbnail per card. Real projects (not the old MOCK_PROJECTS array)
// from GET /api/projects; each thumbnail iframes the project's auth-gated
// /raw endpoint scaled down to card width.
//
// Engineering notes:
//   * Lazy-mount via IntersectionObserver (same pattern as
//     TemplatePreviewFrame) so the panel doesn't boot 30 iframes when the
//     tab opens — only cards near viewport get one.
//   * Native iframe width 1280 → transform-scale to card width so the
//     project renders at desktop breakpoints (responsive media queries hit
//     correctly).
//   * pointer-events: none on the iframe so the wrapping <button> handles
//     clicks (route to /new?project=<id>).
//   * Active project (matches `currentProjectId`) gets an accent ring +
//     "Active" pill. Click on the active card is a no-op.
//   * The unmount-on-tab-switch refetches on next open — captures any
//     deletes / renames the user did elsewhere without manual refresh.

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Plus, Sparkles } from "../icons";
import { Button, StatusDot } from "../ui";
import { publishedHost } from "@/lib/publish/base-host";

interface ProjectListItem {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  subdomain: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

interface PagesPanelProps {
  /** ID of the project currently loaded in the workspace, if any.
   *  Used to highlight the matching card as Active and to no-op its click. */
  currentProjectId?: string | null;
}

export function PagesPanel({ currentProjectId }: PagesPanelProps) {
  const t = useTranslations("panelsB");
  const router = useRouter();
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void fetch("/api/projects")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{
          projects: Array<{
            id: string;
            title: string;
            status: ProjectListItem["status"];
            subdomain: string | null;
            hasUnpublishedChanges: boolean;
            updatedAt: string | Date;
          }>;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(
          data.projects.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            subdomain: p.subdomain,
            hasUnpublishedChanges: p.hasUnpublishedChanges,
            updatedAt:
              typeof p.updatedAt === "string"
                ? p.updatedAt
                : p.updatedAt.toISOString(),
          })),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("pages.loadError"));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCardClick = useCallback(
    (id: string) => {
      if (id === currentProjectId) return;
      router.push(`/new?project=${id}`);
    },
    [currentProjectId, router],
  );

  const onNewPage = useCallback(() => {
    router.push("/new");
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center"
          onClick={onNewPage}
        >
          <Plus size={12} /> {t("pages.newPage")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3">
        {items === null && <Skeletons />}
        {items !== null && items.length === 0 && (
          <EmptyOrError onNewPage={onNewPage} error={error} />
        )}
        {items !== null && items.length > 0 && (
          <div className="space-y-2.5">
            {items.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                active={p.id === currentProjectId}
                onClick={() => onCardClick(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  active,
  onClick,
}: {
  project: ProjectListItem;
  active: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("panelsB");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full text-left rounded-lg ring-1 transition overflow-hidden ${
        active
          ? "ring-[color:var(--accent)]/60 bg-accent-soft/30"
          : "ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] hover:shadow-card"
      }`}
    >
      <ProjectThumb projectId={project.id} title={project.title} />
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-medium fg truncate flex-1">
            {project.title}
          </span>
          {active && (
            <span className="text-[9px] uppercase tracking-wider text-accent font-semibold ui-small shrink-0">
              {t("pages.active")}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-1.5">
          <span className="text-[10.5px] fg-faint truncate">
            {relativeTime(project.updatedAt, t)}
          </span>
          <StatusBadge project={project} />
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ project }: { project: ProjectListItem }) {
  const t = useTranslations("panelsB");
  if (project.subdomain) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] ui-small shrink-0 ${
          project.hasUnpublishedChanges
            ? "text-amber-600 dark:text-amber-400"
            : "text-emerald-600 dark:text-emerald-400"
        }`}
        title={
          project.hasUnpublishedChanges
            ? t("pages.publishedUnpublishedEdits")
            : t("pages.published")
        }
      >
        <StatusDot
          color={project.hasUnpublishedChanges ? "#F59E0B" : "#10B981"}
          pulse={!project.hasUnpublishedChanges}
        />
        <span className="truncate max-w-[120px]">
          {publishedHost(project.subdomain)}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 ui-small shrink-0">
      <StatusDot color="#F59E0B" /> {t("pages.draft")}
    </span>
  );
}

const NATIVE_W = 1280;
const NATIVE_H = 800;

function ProjectThumb({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
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
      aria-label={t("pages.thumbnailOf", { title })}
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
            animation: loaded ? "none" : "pgThumbShimmer 1.6s ease-in-out infinite",
          }}
        />
        {mounted && scale > 0 && (
          <iframe
            src={`/api/projects/${projectId}/raw`}
            title={t("pages.thumbnailTitle", { title })}
            // Sin allow-same-origin: es una miniatura, nadie le lee el
            // contentDocument ni le hace postMessage. Con la bandera, un
            // script dentro correría con el origen de openlen.com.
            sandbox="allow-scripts"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            style={iframeStyle}
          />
        )}
      </div>
      <style jsx>{`
        @keyframes pgThumbShimmer {
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

function EmptyOrError({
  onNewPage,
  error,
}: {
  onNewPage: () => void;
  error: string | null;
}) {
  const t = useTranslations("panelsB");
  return (
    <div className="px-2 py-8 text-center">
      <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev text-accent">
        <Sparkles size={14} />
      </div>
      <p className="text-[12px] fg-muted leading-relaxed">
        {error ? t("pages.loadFailed") : t("pages.empty")}
      </p>
      {error ? (
        <p className="mt-1 text-[10.5px] fg-faint leading-relaxed font-mono">
          {error}
        </p>
      ) : (
        <p className="mt-1 text-[10.5px] fg-faint leading-relaxed">
          {t("pages.emptyHint")}
        </p>
      )}
      <button
        type="button"
        onClick={onNewPage}
        className="mt-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[var(--accent-strong)] text-white text-[11.5px] font-medium hover:brightness-105 transition"
      >
        <Plus size={11} /> {t("pages.newPage")}
      </button>
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
