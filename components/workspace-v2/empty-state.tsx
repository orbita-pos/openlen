// Entry chooser shown when /new loads with no `?project=` query param
// and no entry mode picked yet. Three cards mirror the three create flows
// the workspace exposes: AI brief → orchestrator, curated template, or paste
// HTML straight from claude.ai (or anywhere). Picking one transitions the
// workspace into a "guided" state where only the relevant left-sidebar tab
// is unlocked — see `EntryMode` in /new/page.tsx for the state machine.
//
// A "Continue working" strip above the cards surfaces the user's most-recent
// drafts so coming back to the app doesn't require navigating to /projects.

"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { ChevronRight, FileText, PaletteIcon, Sparkles, Wand } from "./icons";
import { StatusDot } from "./ui";

interface EmptyStateProps {
  onPickAI: () => void;
  onPickTemplate: () => void;
  onPickPaste: () => void;
}

interface RecentProject {
  id: string;
  title: string;
  subdomain: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

interface CardSpec {
  id: "ai" | "template" | "paste";
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  detail: string;
  accent: string;
  onClick: () => void;
}

export function EmptyState({
  onPickAI,
  onPickTemplate,
  onPickPaste,
}: EmptyStateProps) {
  const t = useTranslations("wsChrome");
  const cards: CardSpec[] = [
    {
      id: "ai",
      Icon: Wand,
      title: t("empty.cards.ai.title"),
      description: t("empty.cards.ai.description"),
      detail: t("empty.cards.ai.detail"),
      accent: "var(--accent)",
      onClick: onPickAI,
    },
    {
      id: "template",
      Icon: PaletteIcon,
      title: t("empty.cards.template.title"),
      description: t("empty.cards.template.description"),
      detail: t("empty.cards.template.detail"),
      accent: "var(--accent)",
      onClick: onPickTemplate,
    },
    {
      id: "paste",
      Icon: FileText,
      title: t("empty.cards.paste.title"),
      description: t("empty.cards.paste.description"),
      detail: t("empty.cards.paste.detail"),
      accent: "var(--accent)",
      onClick: onPickPaste,
    },
  ];

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center bg-app overflow-y-auto">
      <div className="w-full max-w-5xl px-6 py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent-soft text-accent text-[11px] font-medium mb-5">
            <Sparkles size={11} />
            {t("empty.badge")}
          </div>
          <h1 className="text-[34px] md:text-[42px] font-semibold fg tracking-tight leading-[1.05]">
            {t("empty.heading")}
          </h1>
          <p className="mt-3 text-[14px] md:text-[15px] fg-muted max-w-xl mx-auto leading-relaxed">
            {t.rich("empty.subheading", {
              domain: (chunks) => <span className="fg">{chunks}</span>,
            })}
          </p>
        </div>

        <RecentStrip />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={c.onClick}
              className="group relative text-left rounded-xl ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] bg-[color:var(--bg)] hover:-translate-y-0.5 hover:shadow-card transition-all duration-200 p-5 flex flex-col"
            >
              <span
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-[color:var(--border)] bg-elev mb-4 transition group-hover:ring-[color:var(--accent)]"
                style={{ color: c.accent }}
              >
                <c.Icon size={17} />
              </span>
              <h3 className="text-[15px] font-semibold fg tracking-tight">
                {c.title}
              </h3>
              <p className="mt-1.5 text-[12.5px] fg-muted leading-relaxed flex-1">
                {c.description}
              </p>
              <div className="mt-4 flex items-center justify-between text-[11px] fg-faint">
                <span className="font-mono">{c.detail}</span>
                <span className="inline-flex items-center gap-0.5 fg-muted group-hover:text-accent transition-colors">
                  {t("empty.pickThis")}
                  <ChevronRight size={12} />
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center text-[12px] fg-faint">
          {t.rich("empty.browseProjects", {
            link: (chunks) => (
              <Link
                href="/projects"
                className="fg-muted hover:fg underline underline-offset-2 transition"
              >
                {chunks}
              </Link>
            ),
          })}
        </div>
      </div>
    </div>
  );
}

// "Continue working" strip — fetches GET /api/projects on mount, renders
// the four most-recent drafts as cards with iframe thumbnails. Hides itself
// entirely when the user has no projects yet (so the first-run flow stays
// clean). Clicking a card hard-navigates to the V2 workspace with the
// project loaded.
function RecentStrip() {
  const t = useTranslations("wsChrome");
  const router = useRouter();
  const [items, setItems] = useState<RecentProject[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/projects")
      .then(async (r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            projects?: Array<{
              id: string;
              title: string;
              subdomain: string | null;
              hasUnpublishedChanges: boolean;
              updatedAt: string | Date;
            }>;
          } | null,
        ) => {
          if (cancelled) return;
          // Resolve to an array unconditionally — when the API returns
          // null (401, network error), missing field, or an empty list
          // we still want to FLIP items out of the null/loading state so
          // the strip can hide itself instead of skeleton'ing forever.
          const list = data?.projects ?? [];
          setItems(
            list.slice(0, 4).map((p) => ({
              id: p.id,
              title: p.title,
              subdomain: p.subdomain,
              hasUnpublishedChanges: p.hasUnpublishedChanges,
              updatedAt:
                typeof p.updatedAt === "string"
                  ? p.updatedAt
                  : p.updatedAt.toISOString(),
            })),
          );
        },
      )
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Loaded, empty workspace → don't take up space with a header above
  // nothing. First-run flow stays clean.
  if (items !== null && items.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          <span>{t("empty.recent.title")}</span>
          {items === null && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-soft"
              aria-label={t("empty.recent.loading")}
            />
          )}
        </div>
        <Link
          href="/projects"
          className="text-[11px] fg-muted hover:fg transition inline-flex items-center gap-0.5"
        >
          {t("empty.recent.all")} <ChevronRight size={11} />
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items === null
          ? [0, 1, 2, 3].map((i) => <RecentSkeleton key={i} />)
          : items.map((p) => (
              <RecentCard
                key={p.id}
                project={p}
                onClick={() => router.push(`/new?project=${p.id}`)}
              />
            ))}
      </div>
    </div>
  );
}

function RecentSkeleton() {
  return (
    <div className="relative rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] overflow-hidden animate-pulse">
      <div className="h-[140px] border-b bd bg-zinc-200/70 dark:bg-zinc-800/60" />
      <div className="px-2.5 py-2 space-y-2">
        <div className="h-3 w-2/3 rounded bg-zinc-200/70 dark:bg-zinc-800/60" />
        <div className="flex items-center justify-between gap-1.5">
          <div className="h-2.5 w-1/3 rounded bg-zinc-200/70 dark:bg-zinc-800/60" />
          <div className="h-2.5 w-10 rounded bg-zinc-200/70 dark:bg-zinc-800/60" />
        </div>
      </div>
    </div>
  );
}

const NATIVE_W = 1280;
const NATIVE_H = 800;

function RecentCard({
  project,
  onClick,
}: {
  project: RecentProject;
  onClick: () => void;
}) {
  const t = useTranslations("wsChrome");
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
    <button
      type="button"
      onClick={onClick}
      className="group relative text-left rounded-lg ring-1 ring-[color:var(--border)] hover:ring-[color:var(--border-strong)] bg-[color:var(--bg)] hover:-translate-y-0.5 hover:shadow-card transition-all duration-200 overflow-hidden"
    >
      <div
        ref={wrapperRef}
        className="relative overflow-hidden border-b bd"
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
              animation: loaded
                ? "none"
                : "recentThumbShimmer 1.6s ease-in-out infinite",
            }}
          />
          {mounted && scale > 0 && (
            <iframe
              src={`/api/projects/${project.id}/raw`}
              title={t("empty.recent.thumbnail", { title: project.title })}
              sandbox="allow-scripts allow-same-origin"
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              style={iframeStyle}
            />
          )}
        </div>
      </div>
      <div className="px-2.5 py-2">
        <div className="text-[12.5px] font-medium fg truncate">
          {project.title}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-1.5">
          <span className="text-[10.5px] fg-faint truncate">
            {relativeTime(project.updatedAt, t)}
          </span>
          {project.subdomain ? (
            <span
              className={`inline-flex items-center gap-1 text-[10px] ui-small shrink-0 ${
                project.hasUnpublishedChanges
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
              title={
                project.hasUnpublishedChanges
                  ? t("empty.recent.publishedWithEdits")
                  : t("empty.recent.published")
              }
            >
              <StatusDot
                color={project.hasUnpublishedChanges ? "#F59E0B" : "#10B981"}
                pulse={!project.hasUnpublishedChanges}
              />
              <span>{t("empty.recent.live")}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 ui-small shrink-0">
              <StatusDot color="#F59E0B" /> {t("empty.recent.draft")}
            </span>
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes recentThumbShimmer {
          0% {
            background-position: 100% 0;
          }
          100% {
            background-position: -100% 0;
          }
        }
      `}</style>
    </button>
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
  if (s < 60) return t("empty.recent.time.justNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("empty.recent.time.minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("empty.recent.time.hours", { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t("empty.recent.time.yesterday");
  if (d < 7) return t("empty.recent.time.days", { count: d });
  if (d < 30) return t("empty.recent.time.weeks", { count: Math.floor(d / 7) });
  return date.toLocaleDateString();
}
