"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Globe,
  Grid3x3,
  Layers,
  List,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Store,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/workspace-v2/toast";
import { defaultLogoDataUrl } from "@/lib/branding/default-logo";
import type { ProjectStatus, ProjectSummary } from "@/lib/projects";
import VisibilityToggle from "@/components/community/visibility-toggle";
import HandleDialog from "@/components/community/handle-dialog";

// ─────────────────────────────────────────────────────────────────────────────
// Projects page — toolbar + filters + grid/list + bulk actions.
// Navbar deliberately omitted (workspace top-bar is small + separate).
// ─────────────────────────────────────────────────────────────────────────────

type ViewMode = "grid" | "list";
type FilterId = "all" | "draft" | "published" | "archived";
type SortId = "edited" | "created" | "name";

export interface BusinessOption {
  id: string;
  name: string;
  isDefault: boolean;
}

interface UsageInfo {
  plan: "free" | "pro";
  credits: { balance: number; allotment: number };
}

const STATUS_TONE: Record<
  ProjectStatus,
  { dot: string; txt: string; bg: string; ring: string }
> = {
  published: {
    dot: "#10B981",
    txt: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    ring: "ring-emerald-200 dark:ring-emerald-500/30",
  },
  draft: {
    dot: "#F59E0B",
    txt: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    ring: "ring-amber-200 dark:ring-amber-500/30",
  },
  archived: {
    dot: "#71717A",
    txt: "text-zinc-600 dark:text-zinc-400",
    bg: "bg-zinc-100 dark:bg-zinc-900",
    ring: "ring-zinc-200 dark:ring-zinc-800",
  },
};

type BillingErrorCode = "not_configured" | "checkout_failed" | "portal_failed";
type BillingNotice =
  | { kind: "success" }
  | { kind: "error"; code: BillingErrorCode };

const BILLING_ERROR_CODES: BillingErrorCode[] = [
  "not_configured",
  "checkout_failed",
  "portal_failed",
];

export function ProjectsView({
  projects: initial,
  profiles,
}: {
  projects: ProjectSummary[];
  profiles: BusinessOption[];
}) {
  const t = useTranslations("projects");
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState(initial);
  const [view, setView] = useState<ViewMode>("grid");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("edited");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{
    anchor: DOMRect;
    project: ProjectSummary;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState<ProjectSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [usageDismissed, setUsageDismissed] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [billingNotice, setBillingNotice] = useState<BillingNotice | null>(null);
  const [handleOpen, setHandleOpen] = useState(false);
  // The toggle that asked for a handle — re-fired once the handle is saved so
  // "Make public" is one-shot instead of forcing a second click.
  const pendingRetryRef = useRef<null | (() => void)>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    void fetch("/api/usage")
      .then((r) => (r.ok ? (r.json() as Promise<UsageInfo>) : null))
      .then((d) => setUsage(d))
      .catch(() => {});
  }, []);

  // Polar checkout/portal returns here with ?upgraded=1 on success or
  // ?billing_error=<code> on failure. Show a banner, then strip the param
  // so a refresh doesn't re-trigger it.
  useEffect(() => {
    const upgraded = searchParams.get("upgraded");
    const errorParam = searchParams.get("billing_error");
    let notice: BillingNotice | null = null;
    if (upgraded === "1") notice = { kind: "success" };
    else if (errorParam && BILLING_ERROR_CODES.includes(errorParam as BillingErrorCode))
      notice = { kind: "error", code: errorParam as BillingErrorCode };
    if (!notice) return;
    setBillingNotice(notice);
    router.replace("/projects");
  }, [searchParams, router]);

  // Keyboard: ⌘F focuses search, Esc clears selection or search.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName) && e.key !== "Escape") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (selected.size > 0) setSelected(new Set());
        else if (q) setQ("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, q]);

  // Derived list — search + filter + sort.
  const filtered = useMemo(() => {
    let out = projects;
    const qLower = q.toLowerCase().trim();
    if (qLower) {
      out = out.filter(
        (p) =>
          p.title.toLowerCase().includes(qLower) ||
          p.tags.some((t) => t.toLowerCase().includes(qLower)),
      );
    }
    if (filter !== "all") out = out.filter((p) => p.status === filter);
    out = [...out];
    if (sort === "edited")
      out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    if (sort === "created")
      out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (sort === "name") out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }, [projects, q, filter, sort]);

  const total = projects.length;
  const published = projects.filter((p) => p.status === "published").length;

  // — Actions —
  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const onDelete = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("toast.deleteError"));
        return false;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success(t("toast.deleted"));
      refresh();
      return true;
    },
    [refresh, t, toast],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const ok = await onDelete(deleteTarget.id);
      if (ok) setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, onDelete]);

  const onArchive = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) {
        toast.error(t("toast.archiveError"));
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "archived" } : p)),
      );
      toast.success(t("toast.archived"));
      refresh();
    },
    [refresh, t, toast],
  );

  const onMove = useCallback(
    async (id: string, profileId: string) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) {
        toast.error(t("toast.moveError"));
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, profileId } : p)),
      );
      setMoveTarget(null);
      const business = profiles.find((b) => b.id === profileId)?.name?.trim();
      toast.success(t("toast.moved", { business: business || "—" }));
    },
    [t, toast, profiles],
  );

  const onRename = useCallback(
    async (id: string, currentTitle: string) => {
      const next = prompt(t("actions.renamePrompt"), currentTitle);
      if (!next || next.trim() === "" || next === currentTitle) return;
      const trimmed = next.trim();
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        toast.error(t("toast.renameError"));
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, title: trimmed } : p)),
      );
      toast.success(t("toast.renamed", { name: trimmed }));
      refresh();
    },
    [refresh, t, toast],
  );

  const onDuplicate = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/projects/${id}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) {
        toast.error(t("toast.duplicateError"));
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        project?: ProjectSummary;
      } | null;
      if (data?.project) {
        const created = data.project;
        const newProject: ProjectSummary = {
          ...created,
          createdAt: new Date(created.createdAt),
          updatedAt: new Date(created.updatedAt),
          publishedAt: created.publishedAt ? new Date(created.publishedAt) : null,
        };
        setProjects((prev) => [newProject, ...prev]);
      }
      toast.success(t("toast.duplicated"));
      refresh();
    },
    [refresh, t, toast],
  );

  const onDownloadZip = useCallback(async (id: string) => {
    const proj = await fetch(`/api/projects/${id}`).then((r) =>
      r.ok ? r.json() : null,
    );
    if (!proj?.project?.data) {
      toast.error(t("toast.exportLoadError"));
      return;
    }
    const res = await fetch("/api/export/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proj.project.data),
    });
    if (!res.ok) {
      toast.error(t("toast.zipError"));
      return;
    }
    const blob = await res.blob();
    const filename = `${proj.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`;
    triggerDownload(blob, filename);
    toast.success(t("toast.downloadStarted"));
  }, [t, toast]);

  const onBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(t("actions.bulkDeleteConfirm", { count: selected.size }))) return;
    const ids = Array.from(selected);
    const count = ids.length;
    try {
      const results = await Promise.all(
        ids.map((id) => fetch(`/api/projects/${id}`, { method: "DELETE" })),
      );
      if (!results.every((r) => r.ok)) {
        toast.error(t("toast.somethingWrong"));
        return;
      }
    } catch {
      toast.error(t("toast.somethingWrong"));
      return;
    }
    setProjects((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    toast.success(t("toast.bulkDeleted", { count }));
    refresh();
  }, [selected, refresh, t, toast]);

  const onBulkArchive = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const count = ids.length;
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/projects/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "archived" }),
          }),
        ),
      );
      if (!results.every((r) => r.ok)) {
        toast.error(t("toast.somethingWrong"));
        return;
      }
    } catch {
      toast.error(t("toast.somethingWrong"));
      return;
    }
    setProjects((prev) =>
      prev.map((p) => (selected.has(p.id) ? { ...p, status: "archived" } : p)),
    );
    setSelected(new Set());
    toast.success(t("toast.bulkArchived", { count }));
    refresh();
  }, [selected, refresh, t, toast]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {billingNotice && (
        <BillingBanner
          notice={billingNotice}
          onDismiss={() => setBillingNotice(null)}
        />
      )}

      <Toolbar
        total={total}
        published={published}
        q={q}
        setQ={setQ}
        searchRef={searchRef}
        filter={filter}
        setFilter={setFilter}
        sort={sort}
        setSort={setSort}
        view={view}
        setView={setView}
      />

      {!usageDismissed && total > 0 && usage && (
        <UsageStrip
          usage={usage}
          projectCount={projects.length}
          onDismiss={() => setUsageDismissed(true)}
        />
      )}

      <main className="flex-1 pb-32">
        {total === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 && q ? (
          <NoResults q={q} onClear={() => setQ("")} />
        ) : view === "grid" ? (
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {filtered.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  q={q}
                  selected={selected.has(p.id)}
                  onToggleSelect={() => toggleSelect(p.id)}
                  onMenu={(rect) => setMenu({ anchor: rect, project: p })}
                  onNeedHandle={(retry) => { pendingRetryRef.current = retry; setHandleOpen(true); }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2">
            <div className="rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
              <div className="hidden md:flex items-center gap-3 px-4 h-9 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30 text-[10.5px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">
                <span className="w-5" />
                <span className="w-14" />
                <span className="flex-1">{t("list.name")}</span>
                <span className="hidden sm:block w-24">{t("list.status")}</span>
                <span className="hidden lg:block w-32">{t("list.tags")}</span>
                <span className="w-24 text-right">{t("list.edited")}</span>
                <span className="w-7" />
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {filtered.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    q={q}
                    selected={selected.has(p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onMenu={(rect) => setMenu({ anchor: rect, project: p })}
                    onNeedHandle={(retry) => { pendingRetryRef.current = retry; setHandleOpen(true); }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <BulkBar
        count={selected.size}
        onCancel={() => setSelected(new Set())}
        onDelete={onBulkDelete}
        onArchive={onBulkArchive}
      />

      {menu && (
        <MenuDropdown
          anchor={menu.anchor}
          project={menu.project}
          onClose={() => setMenu(null)}
          onRename={() => {
            const p = menu.project;
            setMenu(null);
            void onRename(p.id, p.title);
          }}
          onDuplicate={() => {
            const id = menu.project.id;
            setMenu(null);
            void onDuplicate(id);
          }}
          onDownloadZip={() => {
            const id = menu.project.id;
            setMenu(null);
            void onDownloadZip(id);
          }}
          onArchive={() => {
            const id = menu.project.id;
            setMenu(null);
            void onArchive(id);
          }}
          onDelete={() => {
            const p = menu.project;
            setMenu(null);
            setDeleteTarget(p);
          }}
          canMove={profiles.length >= 2}
          onMove={() => {
            const p = menu.project;
            setMenu(null);
            setMoveTarget(p);
          }}
        />
      )}

      {moveTarget && (
        <MoveToBusinessModal
          project={moveTarget}
          profiles={profiles}
          onPick={(profileId) => void onMove(moveTarget.id, profileId)}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteProjectDialog
          project={deleteTarget}
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <HandleDialog
        open={handleOpen}
        onClose={() => setHandleOpen(false)}
        onSaved={() => {
          setHandleOpen(false);
          const retry = pendingRetryRef.current;
          pendingRetryRef.current = null;
          retry?.();
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar
// ─────────────────────────────────────────────────────────────────────────────

function Toolbar({
  total,
  published,
  q,
  setQ,
  searchRef,
  filter,
  setFilter,
  sort,
  setSort,
  view,
  setView,
}: {
  total: number;
  published: number;
  q: string;
  setQ: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  filter: FilterId;
  setFilter: (v: FilterId) => void;
  sort: SortId;
  setSort: (v: SortId) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  const t = useTranslations("projects");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
      if (sortRef.current && !sortRef.current.contains(e.target as Node))
        setSortOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const FILTERS: { id: FilterId; label: string }[] = [
    { id: "all", label: t("toolbar.filters.all") },
    { id: "draft", label: t("toolbar.filters.draft") },
    { id: "published", label: t("toolbar.filters.published") },
    { id: "archived", label: t("toolbar.filters.archived") },
  ];
  const SORTS: { id: SortId; label: string }[] = [
    { id: "edited", label: t("toolbar.sorts.edited") },
    { id: "created", label: t("toolbar.sorts.created") },
    { id: "name", label: t("toolbar.sorts.name") },
  ];

  const filterLabel =
    filter !== "all" ? t(`status.${filter as ProjectStatus}`) : null;

  return (
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-10 pb-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[34px] sm:text-[40px] font-semibold tracking-tight leading-[1.0]">
            {t("toolbar.title")}
          </h1>
          <p className="mt-1.5 text-[14px] text-zinc-500 dark:text-zinc-400">
            <span className="tabular-nums">{t("toolbar.pages", { count: total })}</span>
            {published > 0 && (
              <>
                {" "}
                · <span className="tabular-nums">{t("toolbar.publishedCount", { count: published })}</span>
              </>
            )}
            {filterLabel && (
              <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-inset ring-coral-200 dark:ring-coral-500/30 px-2 py-0.5 text-[11px] font-medium align-middle">
                {t("toolbar.filterLabel", { label: filterLabel })}
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-coral-500/20"
                  aria-label={t("toolbar.clearFilter")}
                >
                  <X size={10} />
                </button>
              </span>
            )}
          </p>
          <Link
            href="/explore"
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
          >
            <Compass size={12} /> Explore
          </Link>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 pointer-events-none"
            />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("toolbar.searchPlaceholder")}
              className="h-9 pl-8 pr-9 text-sm rounded-lg bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition w-44 sm:w-56"
            />
            <kbd className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 h-5 items-center px-1 rounded text-[10px] font-mono ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-500 dark:text-zinc-400 bg-white dark:bg-[#0a0a0a]">
              ⌘F
            </kbd>
          </div>

          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] hover:bg-zinc-50 dark:hover:bg-zinc-900 transition text-[13px]"
            >
              <SlidersHorizontal size={13} />
              <span className="hidden sm:inline">
                {FILTERS.find((f) => f.id === filter)?.label}
              </span>
              <ChevronDown size={11} className="text-zinc-500 dark:text-zinc-400" />
            </button>
            {filterOpen && (
              <div className="absolute right-0 mt-1.5 w-44 rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl p-1 z-30">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFilter(f.id);
                      setFilterOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between w-full text-left px-2.5 py-1.5 rounded-md text-[13px]",
                      filter === f.id
                        ? "bg-coral-50 text-coral-700 dark:bg-coral-500/10 dark:text-coral-300"
                        : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900",
                    )}
                  >
                    {f.label}
                    {filter === f.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setSortOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] hover:bg-zinc-50 dark:hover:bg-zinc-900 transition text-[13px]"
            >
              <ArrowUpDown size={13} />
              <span className="hidden sm:inline">
                {SORTS.find((s) => s.id === sort)?.label}
              </span>
              <ChevronDown size={11} className="text-zinc-500 dark:text-zinc-400" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl p-1 z-30">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSort(s.id);
                      setSortOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between w-full text-left px-2.5 py-1.5 rounded-md text-[13px]",
                      sort === s.id
                        ? "bg-coral-50 text-coral-700 dark:bg-coral-500/10 dark:text-coral-300"
                        : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900",
                    )}
                  >
                    {s.label}
                    {sort === s.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-0.5">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-label={v === "grid" ? t("toolbar.gridView") : t("toolbar.listView")}
                className={cn(
                  "inline-flex h-7 w-8 items-center justify-center rounded-md transition",
                  view === v
                    ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
                )}
              >
                {v === "grid" ? <Grid3x3 size={14} /> : <List size={14} />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing banner — checkout/portal result from Polar (?upgraded / ?billing_error)
// ─────────────────────────────────────────────────────────────────────────────

function BillingBanner({
  notice,
  onDismiss,
}: {
  notice: BillingNotice;
  onDismiss: () => void;
}) {
  const t = useTranslations("projects");
  const isSuccess = notice.kind === "success";
  const message = isSuccess
    ? t("billing.success")
    : t(`billing.errors.${notice.code}`);
  return (
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-4">
      <div
        role={isSuccess ? "status" : "alert"}
        className={cn(
          "flex items-start gap-3 rounded-xl ring-1 ring-inset px-3.5 py-3 text-[13px]",
          isSuccess
            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-500/30"
            : "bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-200 ring-red-200 dark:ring-red-500/30",
        )}
      >
        {isSuccess ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
        )}
        <span className="min-w-0 flex-1 leading-snug">{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("billing.dismissBanner")}
          className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage strip (3 cards) — real numbers from /api/usage
// ─────────────────────────────────────────────────────────────────────────────

function UsageStrip({
  usage,
  projectCount,
  onDismiss,
}: {
  usage: UsageInfo;
  projectCount: number;
  onDismiss: () => void;
}) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const { balance, allotment } = usage.credits;
  const used = Math.max(0, allotment - balance);
  const pct = allotment > 0 ? Math.round((used / allotment) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-coral-50 dark:bg-coral-500/10 ring-1 ring-coral-200/60 dark:ring-coral-500/30 text-coral-600 dark:text-coral-400">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">
              {t("usage.total")}
            </div>
            <div className="text-[13.5px] font-medium leading-tight tabular-nums">
              {t("usage.totalPages", { count: projectCount })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200/60 dark:ring-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            <Zap size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">
              {t("usage.thisMonth")}
            </div>
            <div className="text-[13.5px] font-medium leading-tight tabular-nums">
              {t("usage.creditsUsed", { used, allotment })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3 relative">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-200/60 dark:ring-indigo-500/30 text-indigo-600 dark:text-indigo-400">
            <Layers size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">
              {usage.plan === "free" ? t("usage.freePlan") : t("usage.proPlan")}
            </div>
            <div className="text-[13.5px] font-medium leading-tight tabular-nums">
              {t("usage.creditsLeft", { count: balance })}
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  balance === 0 ? "bg-red-500" : "bg-indigo-500",
                )}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {usage.plan === "free" && (
              <a
                href={`/api/billing/checkout?locale=${locale}`}
                title={t("billing.upgradeHint")}
                className="mt-2 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-coral-500 text-white text-[12px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
              >
                <Sparkles size={12} /> {t("billing.upgradeCta")}
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("usage.dismiss")}
            className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ProjectStatus }) {
  const t = useTranslations("projects");
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tone.bg,
        tone.txt,
        tone.ring,
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {status === "published" && (
          <span
            className="absolute inset-0 rounded-full opacity-70 animate-ping"
            style={{ background: tone.dot }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: tone.dot }}
        />
      </span>
      {t(`status.${status}`)}
    </span>
  );
}

function ProjectLogoBadge({
  logoUrl,
  title,
  className,
  size = "md",
}: {
  logoUrl: string | null;
  title: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur shadow-sm overflow-hidden",
        px,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl || defaultLogoDataUrl(title)}
        alt=""
        className="w-full h-full object-contain"
      />
    </span>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ring-zinc-200/60 dark:ring-zinc-800">
      {children}
    </span>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  try {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${safe})`, "ig");
    const parts = text.split(re);
    return (
      <>
        {parts.map((p, i) =>
          re.test(p) ? (
            <mark
              key={i}
              className="bg-coral-100 dark:bg-coral-500/30 text-coral-900 dark:text-coral-100 rounded px-0.5"
            >
              {p}
            </mark>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

function ProjectCard({
  project,
  q,
  selected,
  onToggleSelect,
  onMenu,
  onNeedHandle,
}: {
  project: ProjectSummary;
  q: string;
  selected: boolean;
  onToggleSelect: () => void;
  onMenu: (rect: DOMRect) => void;
  onNeedHandle: (retry: () => void) => void;
}) {
  const t = useTranslations("projects");
  return (
    <article
      className={cn(
        "group relative rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 transition",
        selected
          ? "ring-coral-500 shadow-[0_0_0_3px_rgba(255,90,54,0.12)]"
          : "ring-zinc-200 dark:ring-zinc-800 hover:ring-zinc-300 dark:hover:ring-zinc-700",
      )}
    >
      <Link
        href={`/new?project=${project.id}`}
        className="block relative aspect-[16/10] overflow-hidden rounded-t-xl bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950"
      >
        <label
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute top-2 left-2 z-20 transition",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <span
            className={cn(
              "relative inline-flex h-5 w-5 items-center justify-center rounded-md ring-1 transition cursor-pointer",
              selected
                ? "bg-coral-500 ring-coral-500 text-white"
                : "bg-white/95 dark:bg-zinc-950/95 ring-zinc-300 dark:ring-zinc-700 hover:ring-zinc-400",
            )}
          >
            {selected && <Check size={12} strokeWidth={3} />}
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </span>
        </label>

        {!selected && (
          <div className="absolute top-2 left-2 z-10 group-hover:opacity-0 transition">
            <span className="bg-white/90 dark:bg-zinc-950/90 backdrop-blur rounded-full shadow-sm">
              <StatusPill status={project.status} />
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onMenu(e.currentTarget.getBoundingClientRect());
          }}
          aria-label={t("card.projectMenu")}
          className="absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 dark:bg-zinc-950/90 backdrop-blur ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal size={14} />
        </button>

        {project.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.thumbnailUrl}
            alt={project.title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 dark:text-zinc-700">
            <Sparkles size={32} />
          </div>
        )}

        {/* The thumbnail is the last PUBLISHED render (refreshed on publish, not
            on draft edits) — flag it so a just-added image that isn't in the
            preview yet doesn't read as broken. Fades on hover so it never fights
            the "Open" affordance. */}
        {project.subdomain && project.hasUnpublishedChanges && (
          <div className="absolute bottom-2 right-2 z-10 max-w-[70%] group-hover:opacity-0 transition pointer-events-none">
            <span className="inline-flex items-center rounded-full bg-zinc-900/80 text-white/95 backdrop-blur px-2 py-0.5 text-[9.5px] font-medium leading-tight ring-1 ring-white/10">
              {t("card.previewStale")}
            </span>
          </div>
        )}

        <ProjectLogoBadge
          logoUrl={project.logoUrl}
          title={project.title}
          className="absolute bottom-2 left-2 z-10"
        />

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 p-2 opacity-0 group-hover:opacity-100 transition pointer-events-none">
          <span className="pointer-events-auto inline-flex items-center gap-1 h-8 px-3 rounded-md bg-zinc-900/95 dark:bg-white/95 text-white dark:text-zinc-900 text-[12px] font-medium shadow-lg backdrop-blur">
            <ExternalLink size={12} /> {t("card.open")}
          </span>
        </div>
      </Link>

      <div className="px-3.5 py-3">
        <h3 className="text-[13.5px] font-semibold tracking-tight leading-snug line-clamp-1 flex items-center gap-1.5">
          {project.subdomain && (
            <span
              aria-label={t("card.published")}
              title={t("card.published")}
              className="relative inline-flex h-1.5 w-1.5 shrink-0"
            >
              <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
          <span className="truncate">
            <Highlight text={project.title} q={q} />
          </span>
          {project.subdomain && project.hasUnpublishedChanges && (
            <span className="ml-1 inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-500/30 px-1.5 py-0 text-[9.5px] font-medium uppercase tracking-wider whitespace-nowrap">
              {t("card.unpublishedChanges")}
            </span>
          )}
        </h3>
        <div className="mt-1 text-[11.5px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
          <span suppressHydrationWarning>{t("card.editedAgo", { time: relativeTime(project.updatedAt, t) })}</span>
          {project.subdomain ? (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <a
                href={`https://${project.subdomain}.openlen.com`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
              >
                <Globe size={10} /> {project.subdomain}.openlen.com
              </a>
            </>
          ) : project.deployUrl ? (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <a
                href={`https://${project.deployUrl}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
              >
                <Globe size={10} /> {project.deployUrl}
              </a>
            </>
          ) : null}
        </div>
        {project.subdomain &&
          (project.stats &&
          (project.stats.views > 0 || project.stats.leads > 0) ? (
            <div
              className="mt-2 flex items-center gap-3 text-[11px]"
              title={t("stats.rangeTip")}
            >
              <span
                className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400"
                aria-label={t("stats.views")}
              >
                <Eye size={12} /> {project.stats.views}
              </span>
              {project.stats.leads > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-coral-600 dark:text-coral-400 font-medium"
                  aria-label={t("stats.messages")}
                >
                  <Mail size={12} /> {project.stats.leads}
                </span>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              {t("stats.none")}
            </div>
          ))}
        {project.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {project.tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 pt-2.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Layers size={11} /> {t("card.sections", { count: project.sectionCount })}
          </span>
          <div className="flex items-center gap-2">
            <VisibilityToggle
              projectId={project.id}
              initial={project.visibility ?? "private"}
              onNeedHandle={onNeedHandle}
            />
            <ChevronRight
              size={13}
              className="text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-500 transition"
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function ProjectRow({
  project,
  q,
  selected,
  onToggleSelect,
  onMenu,
  onNeedHandle,
}: {
  project: ProjectSummary;
  q: string;
  selected: boolean;
  onToggleSelect: () => void;
  onMenu: (rect: DOMRect) => void;
  onNeedHandle: (retry: () => void) => void;
}) {
  const t = useTranslations("projects");
  return (
    <Link
      href={`/new?project=${project.id}`}
      className={cn(
        "group relative flex items-center gap-3 px-3 sm:px-4 h-14 transition",
        selected
          ? "bg-coral-50/60 dark:bg-coral-500/10"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50",
      )}
    >
      <label
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        className={cn(
          "shrink-0 relative inline-flex h-5 w-5 items-center justify-center rounded-md ring-1 transition cursor-pointer",
          selected
            ? "bg-coral-500 ring-coral-500 text-white"
            : "bg-white dark:bg-[#0a0a0a] ring-zinc-300 dark:ring-zinc-700 group-hover:ring-zinc-400 opacity-0 group-hover:opacity-100",
        )}
      >
        {selected && <Check size={12} strokeWidth={3} />}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>

      <div className="shrink-0 h-9 w-14 rounded-md overflow-hidden ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-zinc-950 relative">
        {project.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-300 dark:text-zinc-700">
            <Sparkles size={14} />
          </div>
        )}
        <ProjectLogoBadge
          logoUrl={project.logoUrl}
          title={project.title}
          className="absolute -bottom-1 -right-1 z-10"
          size="sm"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium truncate flex items-center gap-1.5">
          {project.subdomain && (
            <span
              aria-label={t("card.published")}
              title={t("card.published")}
              className="relative inline-flex h-1.5 w-1.5 shrink-0"
            >
              <span className="absolute inset-0 rounded-full bg-emerald-500 opacity-70 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
          <span className="truncate">
            <Highlight text={project.title} q={q} />
          </span>
          {project.subdomain && project.hasUnpublishedChanges && (
            <span className="ml-1 inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-500/30 px-1.5 py-0 text-[9.5px] font-medium uppercase tracking-wider whitespace-nowrap">
              {t("card.unpublishedChanges")}
            </span>
          )}
        </div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
          {project.subdomain ? (
            <span className="inline-flex items-center gap-1">
              <Globe size={10} /> {project.subdomain}.openlen.com
            </span>
          ) : project.deployUrl ? (
            <span className="inline-flex items-center gap-1">
              <Globe size={10} /> {project.deployUrl}
            </span>
          ) : (
            t("list.notDeployed")
          )}
        </div>
      </div>

      <div className="hidden sm:block shrink-0">
        <StatusPill status={project.status} />
      </div>

      <div className="hidden lg:flex shrink-0 gap-1 w-32">
        {project.tags.slice(0, 2).map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>

      {project.subdomain &&
        project.stats &&
        (project.stats.views > 0 || project.stats.leads > 0) && (
          <div
            className="hidden md:flex shrink-0 items-center gap-2.5 text-[11px] w-20 justify-end"
            title={t("stats.rangeTip")}
          >
            <span
              className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400"
              aria-label={t("stats.views")}
            >
              <Eye size={12} /> {project.stats.views}
            </span>
            {project.stats.leads > 0 && (
              <span
                className="inline-flex items-center gap-1 text-coral-600 dark:text-coral-400 font-medium"
                aria-label={t("stats.messages")}
              >
                <Mail size={12} /> {project.stats.leads}
              </span>
            )}
          </div>
        )}

      <div
        suppressHydrationWarning
        className="hidden md:block shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-400 w-24 truncate text-right"
      >
        {relativeTime(project.updatedAt, t)}
      </div>

      <div
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        className="shrink-0"
      >
        <VisibilityToggle
          projectId={project.id}
          initial={project.visibility ?? "private"}
          onNeedHandle={onNeedHandle}
        />
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onMenu(e.currentTarget.getBoundingClientRect());
        }}
        aria-label={t("card.projectMenu")}
        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
      >
        <MoreHorizontal size={14} />
      </button>
    </Link>
  );
}

function MenuDropdown({
  anchor,
  project,
  onClose,
  onRename,
  onDuplicate,
  onDownloadZip,
  onArchive,
  onDelete,
  canMove,
  onMove,
}: {
  anchor: DOMRect;
  project: ProjectSummary;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDownloadZip: () => void;
  onArchive: () => void;
  onDelete: () => void;
  canMove: boolean;
  onMove: () => void;
}) {
  const t = useTranslations("projects");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const style: React.CSSProperties = {
    top: Math.min(anchor.bottom + 6, window.innerHeight - 320),
    right: Math.max(8, window.innerWidth - anchor.right),
  };

  const items: Array<{
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
    hint?: string;
  }> = [
    { icon: ExternalLink, label: t("menu.open"), onClick: () => window.location.assign(`/new?project=${project.id}`) },
    { icon: Copy, label: t("menu.duplicate"), onClick: onDuplicate },
    { icon: Pencil, label: t("menu.rename"), onClick: onRename },
    { icon: Download, label: t("menu.downloadZip"), onClick: onDownloadZip },
    ...(canMove
      ? [{ icon: Store, label: t("menu.moveToBusiness"), onClick: onMove }]
      : []),
    // Session 11 — replaces the disabled "Share link — Soon" stub. Two
    // variants: an outbound link to the live subdomain when published, or
    // a route into the workspace with publish=1 to auto-open the modal.
    project.subdomain
      ? {
          icon: Globe,
          label: t("menu.openPublished"),
          onClick: () =>
            window.open(
              `https://${project.subdomain}.openlen.com`,
              "_blank",
              "noopener,noreferrer",
            ),
        }
      : {
          icon: Globe,
          label: t("menu.publish"),
          onClick: () =>
            window.location.assign(`/new?project=${project.id}`),
        },
    { icon: Archive, label: project.status === "archived" ? t("menu.archived") : t("menu.archive"), onClick: onArchive, disabled: project.status === "archived" },
    { icon: Trash2, label: t("menu.delete"), onClick: onDelete, danger: true },
  ];

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("menu.closeMenu")}
        className="fixed inset-0 z-40"
      />
      <div
        ref={ref}
        style={style}
        className="fixed z-50 w-52 rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl p-1"
      >
        {items.map((it, i) => {
          const sep = i === (canMove ? 5 : 4);
          return (
            <span key={i}>
              {sep && (
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-900" />
              )}
              <button
                type="button"
                onClick={it.onClick}
                disabled={it.disabled}
                className={cn(
                  "flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] transition",
                  it.disabled && "opacity-50 cursor-not-allowed",
                  it.danger && !it.disabled
                    ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                    : !it.disabled && "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900",
                )}
              >
                <it.icon size={14} className="opacity-70" />
                <span className="flex-1">{it.label}</span>
                {it.hint && (
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{it.hint}</span>
                )}
              </button>
            </span>
          );
        })}
      </div>
    </>
  );
}

function MoveToBusinessModal({
  project,
  profiles,
  onPick,
  onClose,
}: {
  project: ProjectSummary;
  profiles: BusinessOption[];
  onPick: (profileId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("projects");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("move.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl p-5">
        <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
          {t("move.title")}
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          {t("move.subtitle")}
        </p>
        <div className="mt-4 space-y-1 max-h-72 overflow-y-auto">
          {profiles.map((b) => {
            const current = b.id === project.profileId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onPick(b.id)}
                className={cn(
                  "flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-lg text-[13.5px] transition ring-1",
                  current
                    ? "ring-zinc-300 dark:ring-zinc-700 bg-zinc-50 dark:bg-zinc-900"
                    : "ring-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900",
                )}
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 shrink-0">
                  <Store size={14} />
                </span>
                <span className="flex-1 truncate font-medium text-zinc-800 dark:text-zinc-200">
                  {b.name?.trim() || "—"}
                </span>
                {current && (
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t("move.current")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
          >
            {t("move.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteProjectDialog({
  project,
  busy,
  onConfirm,
  onClose,
}: {
  project: ProjectSummary;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("projects");
  const [typed, setTyped] = useState("");
  const name = project.title.trim();
  const match = typed.trim() === name;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label={t("deleteDialog.cancel")} onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{t("deleteDialog.title")}</h2>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">{t("deleteDialog.body", { name })}</p>
              {project.subdomain && (
                <p className="text-[12.5px] text-red-600 dark:text-red-400 mt-1.5 leading-snug">
                  {t("deleteDialog.publishedNote", { domain: `${project.subdomain}.openlen.com` })}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-[12px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{t("deleteDialog.confirmLabel", { name })}</label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name}
              className="w-full px-3 h-11 rounded-lg bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 focus:ring-2 focus:ring-red-500 focus:outline-none text-[14px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
            />
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition">{t("deleteDialog.cancel")}</button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!match || busy}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} {t("deleteDialog.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BulkBar({
  count,
  onCancel,
  onDelete,
  onArchive,
}: {
  count: number;
  onCancel: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const t = useTranslations("projects");
  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
        count > 0 ? "" : "pointer-events-none",
      )}
    >
      <div
        className={cn(
          "transition-all duration-300",
          count > 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
        )}
      >
        <div className="flex items-center gap-2 rounded-2xl bg-zinc-950 dark:bg-zinc-900 ring-1 ring-zinc-800 text-zinc-100 px-3 py-2 shadow-2xl">
          <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-zinc-900 dark:bg-zinc-800 text-[12px]">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-coral-500 text-white text-[11px] font-semibold tabular-nums">
              {count}
            </span>
            {t("bulk.selected")}
          </span>
          <span className="h-5 w-px bg-zinc-800" />
          <button
            type="button"
            onClick={onArchive}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium hover:bg-zinc-900 transition"
          >
            <Archive size={12} /> {t("bulk.archive")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-red-300 hover:bg-red-500/15 transition"
          >
            <Trash2 size={12} /> {t("bulk.delete")}
          </button>
          <span className="h-5 w-px bg-zinc-800" />
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 px-2.5 items-center rounded-md text-[12px] text-zinc-500 dark:text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
          >
            {t("bulk.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("projects");
  const examples = [
    {
      title: t("empty.examples.invoicing.title"),
      brief: t("empty.examples.invoicing.brief"),
    },
    {
      title: t("empty.examples.portfolio.title"),
      brief: t("empty.examples.portfolio.brief"),
    },
    {
      title: t("empty.examples.conference.title"),
      brief: t("empty.examples.conference.brief"),
    },
    {
      title: t("empty.examples.coffee.title"),
      brief: t("empty.examples.coffee.brief"),
    },
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-20 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-inset ring-coral-200 dark:ring-coral-500/30 px-2.5 py-0.5 text-[11px] font-medium mb-5">
        <Sparkles size={11} /> {t("empty.badge")}
      </div>
      <h2 className="text-[36px] sm:text-[48px] font-semibold tracking-tight leading-[1.0]">
        {t.rich("empty.title", { br: () => <br /> })}
      </h2>
      <p className="mt-4 max-w-md mx-auto text-[15px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
        {t("empty.subtitle")}
      </p>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-2xl mx-auto">
        {examples.map((ex) => (
          <Link
            key={ex.title}
            href={`/new?mode=ai&brief=${encodeURIComponent(ex.brief)}`}
            className="group relative flex items-start gap-3 rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 hover:ring-coral-300 dark:hover:ring-coral-500/40 hover:shadow-sm transition p-3.5 text-left"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 group-hover:bg-coral-50 group-hover:text-coral-600 dark:group-hover:bg-coral-500/10 dark:group-hover:text-coral-400 transition">
              <Sparkles size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-tight">
                {ex.title}
              </div>
              <div className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug line-clamp-2">
                &quot;{ex.brief}&quot;
              </div>
            </div>
            <ChevronRight
              size={14}
              className="text-zinc-300 dark:text-zinc-700 mt-2 shrink-0 group-hover:translate-x-0.5 group-hover:text-coral-500 transition"
            />
          </Link>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-center gap-3">
        <Link
          href="/new"
          className="inline-flex items-center gap-1.5 h-11 px-5 rounded-lg bg-coral-500 text-white text-[14px] font-medium hover:bg-coral-600 btn-coral-shadow transition"
        >
          {t("empty.startFromScratch")} <Sparkles size={14} />
        </Link>
      </div>
    </div>
  );
}

function NoResults({
  q,
  onClear,
}: {
  q: string;
  onClear: () => void;
}) {
  const t = useTranslations("projects");
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 text-zinc-500 mb-4">
        <Search size={20} />
      </div>
      <div className="text-[16px] font-semibold tracking-tight">
        {t("noResults.title", { query: q })}
      </div>
      <p className="mt-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">
        {t("noResults.subtitle")}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 px-3 items-center rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] text-[13px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
        >
          {t("noResults.clearSearch")}
        </button>
        <Link
          href="/new"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-coral-500 text-white text-[13px] font-medium hover:bg-coral-600 btn-coral-shadow transition"
        >
          <Plus size={13} /> {t("noResults.createNew")}
        </Link>
      </div>
    </div>
  );
}

function relativeTime(
  d: Date | string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return t("relativeTime.justNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("relativeTime.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("relativeTime.hoursAgo", { count: h });
  const d2 = Math.floor(h / 24);
  if (d2 === 1) return t("relativeTime.yesterday");
  if (d2 < 7) return t("relativeTime.daysAgo", { count: d2 });
  if (d2 < 30) return t("relativeTime.weeksAgo", { count: Math.floor(d2 / 7) });
  return date.toLocaleDateString();
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
