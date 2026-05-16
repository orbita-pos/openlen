"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Archive,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Grid3x3,
  Layers,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProjectStatus, ProjectSummary } from "@/lib/projects";

// ─────────────────────────────────────────────────────────────────────────────
// Projects page — toolbar + filters + grid/list + bulk actions.
// Navbar deliberately omitted (workspace top-bar is small + separate).
// ─────────────────────────────────────────────────────────────────────────────

type ViewMode = "grid" | "list";
type FilterId = "all" | "draft" | "published" | "archived";
type SortId = "edited" | "created" | "name" | "cost";

interface UsageInfo {
  plan: "free" | "pro";
  generate: Array<{ label: string; max: number; used: number; remaining: number }>;
}

const STATUS_TONE: Record<
  ProjectStatus,
  { dot: string; txt: string; bg: string; ring: string; label: string }
> = {
  published: {
    dot: "#10B981",
    txt: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    ring: "ring-emerald-200 dark:ring-emerald-500/30",
    label: "Published",
  },
  draft: {
    dot: "#F59E0B",
    txt: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    ring: "ring-amber-200 dark:ring-amber-500/30",
    label: "Draft",
  },
  archived: {
    dot: "#71717A",
    txt: "text-zinc-600 dark:text-zinc-400",
    bg: "bg-zinc-100 dark:bg-zinc-900",
    ring: "ring-zinc-200 dark:ring-zinc-800",
    label: "Archived",
  },
};

export function ProjectsView({ projects: initial }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const { data: session } = useSession();
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
  const [usageDismissed, setUsageDismissed] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    void fetch("/api/usage")
      .then((r) => (r.ok ? (r.json() as Promise<UsageInfo>) : null))
      .then((d) => setUsage(d))
      .catch(() => {});
  }, []);

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
    if (sort === "cost") out.sort((a, b) => b.costUsd - a.costUsd);
    return out;
  }, [projects, q, filter, sort]);

  const total = projects.length;
  const published = projects.filter((p) => p.status === "published").length;

  // — Actions —
  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const onDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this page? This cannot be undone.")) return;
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert(`Couldn't delete: ${res.statusText}`);
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      refresh();
    },
    [refresh],
  );

  const onArchive = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) {
        alert(`Couldn't archive: ${res.statusText}`);
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "archived" } : p)),
      );
      refresh();
    },
    [refresh],
  );

  const onRename = useCallback(
    async (id: string, currentTitle: string) => {
      const next = prompt("New name", currentTitle);
      if (!next || next.trim() === "" || next === currentTitle) return;
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next.trim() }),
      });
      if (!res.ok) {
        alert(`Couldn't rename: ${res.statusText}`);
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, title: next.trim() } : p)),
      );
      refresh();
    },
    [refresh],
  );

  const onDuplicate = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/projects/${id}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) {
        alert(`Couldn't duplicate: ${res.statusText}`);
        return;
      }
      refresh();
    },
    [refresh],
  );

  const onDownloadZip = useCallback(async (id: string) => {
    const proj = await fetch(`/api/projects/${id}`).then((r) =>
      r.ok ? r.json() : null,
    );
    if (!proj?.project?.data) {
      alert("Couldn't load project to export.");
      return;
    }
    const res = await fetch("/api/export/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proj.project.data),
    });
    if (!res.ok) {
      alert(`Couldn't build zip: ${res.statusText}`);
      return;
    }
    const blob = await res.blob();
    const filename = `${proj.project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`;
    triggerDownload(blob, filename);
  }, []);

  const onBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} pages? This cannot be undone.`)) return;
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) => fetch(`/api/projects/${id}`, { method: "DELETE" })),
    );
    setProjects((prev) => prev.filter((p) => !selected.has(p.id)));
    setSelected(new Set());
    refresh();
  }, [selected, refresh]);

  const onBulkArchive = useCallback(async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        }),
      ),
    );
    setProjects((prev) =>
      prev.map((p) => (selected.has(p.id) ? { ...p, status: "archived" } : p)),
    );
    setSelected(new Set());
    refresh();
  }, [selected, refresh]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-[#0a0a0a]">
      {/* Existing small top bar — intentionally minimal per user feedback. */}
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="relative inline-flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 rounded-md bg-coral-500" />
            <span className="relative font-bold text-white text-[13px] leading-none">
              い
            </span>
          </span>
          <span className="hidden sm:inline font-semibold tracking-tight text-[14px]">
            Inari Pages
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/new"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-coral-500 text-white text-[12px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
          >
            <Plus size={13} /> New page
          </Link>
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-zinc-500">
            <span>{session?.user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

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
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2">
            <div className="rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
              <div className="hidden md:flex items-center gap-3 px-4 h-9 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30 text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-semibold">
                <span className="w-5" />
                <span className="w-14" />
                <span className="flex-1">Name</span>
                <span className="hidden sm:block w-24">Status</span>
                <span className="hidden lg:block w-32">Tags</span>
                <span className="w-24 text-right">Edited</span>
                <span className="w-14 text-right">Cost</span>
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
            const id = menu.project.id;
            setMenu(null);
            void onDelete(id);
          }}
        />
      )}
    </div>
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
    { id: "all", label: "All pages" },
    { id: "draft", label: "Drafts" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" },
  ];
  const SORTS: { id: SortId; label: string }[] = [
    { id: "edited", label: "Last edited" },
    { id: "created", label: "Date created" },
    { id: "name", label: "Name (A → Z)" },
    { id: "cost", label: "Cost (high → low)" },
  ];

  const filterLabel = filter !== "all" ? STATUS_TONE[filter as ProjectStatus]?.label : null;

  return (
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-10 pb-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[34px] sm:text-[40px] font-semibold tracking-tight leading-[1.0]">
            My pages
          </h1>
          <p className="mt-1.5 text-[14px] text-zinc-500 dark:text-zinc-500">
            <span className="tabular-nums">{total}</span> page
            {total === 1 ? "" : "s"}
            {published > 0 && (
              <>
                {" "}
                · <span className="tabular-nums">{published}</span> published
              </>
            )}
            {filterLabel && (
              <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-inset ring-coral-200 dark:ring-coral-500/30 px-2 py-0.5 text-[11px] font-medium align-middle">
                Filter: {filterLabel}
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-coral-500/20"
                  aria-label="Clear filter"
                >
                  <X size={10} />
                </button>
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
            />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pages…"
              className="h-9 pl-8 pr-9 text-sm rounded-lg bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition w-44 sm:w-56"
            />
            <kbd className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 h-5 items-center px-1 rounded text-[10px] font-mono ring-1 ring-zinc-200 dark:ring-zinc-800 text-zinc-400 bg-white dark:bg-[#0a0a0a]">
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
              <ChevronDown size={11} className="text-zinc-400" />
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
              <ChevronDown size={11} className="text-zinc-400" />
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
                aria-label={v === "grid" ? "Grid view" : "List view"}
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
  const monthly = usage.generate.find((w) => w.label === "monthly");
  const remaining = monthly?.remaining ?? 0;
  const used = monthly?.used ?? 0;
  const max = monthly?.max ?? 0;
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 pb-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-coral-50 dark:bg-coral-500/10 ring-1 ring-coral-200/60 dark:ring-coral-500/30 text-coral-600 dark:text-coral-400">
            <Sparkles size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-semibold">
              Total
            </div>
            <div className="text-[13.5px] font-medium leading-tight">
              <span className="tabular-nums">{projectCount}</span> page
              {projectCount === 1 ? "" : "s"} in your workspace
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200/60 dark:ring-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            <Zap size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-semibold">
              This month
            </div>
            <div className="text-[13.5px] font-medium leading-tight tabular-nums">
              {used} / {max} generations
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] px-3.5 py-3 relative">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-200/60 dark:ring-indigo-500/30 text-indigo-600 dark:text-indigo-400">
            <Layers size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-semibold">
              {usage.plan === "free" ? "Free plan" : "Pro plan"}
            </div>
            <div className="text-[13.5px] font-medium leading-tight tabular-nums">
              {remaining} generation{remaining === 1 ? "" : "s"} left
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  remaining === 0 ? "bg-red-500" : "bg-indigo-500",
                )}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
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
  const t = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        t.bg,
        t.txt,
        t.ring,
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        {status === "published" && (
          <span
            className="absolute inset-0 rounded-full opacity-70 animate-ping"
            style={{ background: t.dot }}
          />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: t.dot }}
        />
      </span>
      {t.label}
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
}: {
  project: ProjectSummary;
  q: string;
  selected: boolean;
  onToggleSelect: () => void;
  onMenu: (rect: DOMRect) => void;
}) {
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
          aria-label="Project menu"
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

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 p-2 opacity-0 group-hover:opacity-100 transition pointer-events-none">
          <span className="pointer-events-auto inline-flex items-center gap-1 h-8 px-3 rounded-md bg-zinc-900/95 dark:bg-white/95 text-white dark:text-zinc-900 text-[12px] font-medium shadow-lg backdrop-blur">
            <ExternalLink size={12} /> Open
          </span>
        </div>
      </Link>

      <div className="px-3.5 py-3">
        <h3 className="text-[13.5px] font-semibold tracking-tight leading-snug line-clamp-1">
          <Highlight text={project.title} q={q} />
        </h3>
        <div className="mt-1 text-[11.5px] text-zinc-500 dark:text-zinc-500 flex items-center gap-1.5">
          <span>Edited {relativeTime(project.updatedAt)}</span>
          {project.deployUrl && (
            <>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <a
                href={`https://${project.deployUrl}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
              >
                <Globe size={10} /> {project.deployUrl}
              </a>
            </>
          )}
        </div>
        {project.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {project.tags.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 pt-2.5 text-[11.5px] text-zinc-500 dark:text-zinc-500">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1">
              <Zap size={11} className="text-coral-500" /> $
              {project.costUsd.toFixed(2)}
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span className="inline-flex items-center gap-1">
              <Layers size={11} /> {project.sectionCount} sections
            </span>
          </div>
          <ChevronRight
            size={13}
            className="text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-500 transition"
          />
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
}: {
  project: ProjectSummary;
  q: string;
  selected: boolean;
  onToggleSelect: () => void;
  onMenu: (rect: DOMRect) => void;
}) {
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
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium truncate">
          <Highlight text={project.title} q={q} />
        </div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate">
          {project.deployUrl ? (
            <span className="inline-flex items-center gap-1">
              <Globe size={10} /> {project.deployUrl}
            </span>
          ) : (
            "Not deployed"
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

      <div className="hidden md:block shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-500 w-24 truncate text-right">
        {relativeTime(project.updatedAt)}
      </div>

      <div className="hidden md:block shrink-0 text-[11.5px] text-zinc-500 dark:text-zinc-500 w-14 tabular-nums text-right">
        ${project.costUsd.toFixed(2)}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onMenu(e.currentTarget.getBoundingClientRect());
        }}
        aria-label="Project menu"
        className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
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
}: {
  anchor: DOMRect;
  project: ProjectSummary;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDownloadZip: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
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
    { icon: ExternalLink, label: "Open", onClick: () => window.location.assign(`/new?project=${project.id}`) },
    { icon: Copy, label: "Duplicate", onClick: onDuplicate },
    { icon: Pencil, label: "Rename", onClick: onRename },
    { icon: Download, label: "Download .zip", onClick: onDownloadZip },
    { icon: Share2, label: "Share link", onClick: () => alert("Share links — coming soon."), disabled: true, hint: "Soon" },
    { icon: Archive, label: project.status === "archived" ? "Archived" : "Archive", onClick: onArchive, disabled: project.status === "archived" },
    { icon: Trash2, label: "Delete", onClick: onDelete, danger: true },
  ];

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close menu"
        className="fixed inset-0 z-40"
      />
      <div
        ref={ref}
        style={style}
        className="fixed z-50 w-52 rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 shadow-xl p-1"
      >
        {items.map((it, i) => {
          const sep = i === 4;
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
                  <span className="text-[10px] text-zinc-400">{it.hint}</span>
                )}
              </button>
            </span>
          );
        })}
      </div>
    </>
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
            selected
          </span>
          <span className="h-5 w-px bg-zinc-800" />
          <button
            type="button"
            onClick={onArchive}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium hover:bg-zinc-900 transition"
          >
            <Archive size={12} /> Archive
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-red-300 hover:bg-red-500/15 transition"
          >
            <Trash2 size={12} /> Delete
          </button>
          <span className="h-5 w-px bg-zinc-800" />
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 px-2.5 items-center rounded-md text-[12px] text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const examples = [
    {
      title: "Stripe-based invoicing SaaS",
      brief:
        "A landing for a tool that helps freelancers track invoices and get paid faster.",
    },
    {
      title: "Designer portfolio in Mexico City",
      brief:
        "Personal site for a UI/UX designer with 6 case studies and an availability badge.",
    },
    {
      title: "Virtual conference event page",
      brief:
        "Event landing for a 2-day indie hacking conference, with speaker grid and tickets.",
    },
    {
      title: "Single-origin coffee subscription",
      brief:
        "E-commerce hero for a small-batch coffee subscription, delivered every Tuesday.",
    },
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-20 text-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-coral-50 dark:bg-coral-500/10 text-coral-700 dark:text-coral-300 ring-1 ring-inset ring-coral-200 dark:ring-coral-500/30 px-2.5 py-0.5 text-[11px] font-medium mb-5">
        <Sparkles size={11} /> Your workspace, fresh out of the box
      </div>
      <h2 className="text-[36px] sm:text-[48px] font-semibold tracking-tight leading-[1.0]">
        Your first page<br />in 60 seconds.
      </h2>
      <p className="mt-4 max-w-md mx-auto text-[15px] text-zinc-500 dark:text-zinc-500 leading-relaxed">
        Describe what you want. We&apos;ll generate the copy, the layout, the
        imagery, and the code.
      </p>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-2xl mx-auto">
        {examples.map((ex) => (
          <Link
            key={ex.title}
            href={`/new?brief=${encodeURIComponent(ex.brief)}`}
            className="group relative flex items-start gap-3 rounded-xl bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 hover:ring-coral-300 dark:hover:ring-coral-500/40 hover:shadow-sm transition p-3.5 text-left"
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 group-hover:bg-coral-50 group-hover:text-coral-600 dark:group-hover:bg-coral-500/10 dark:group-hover:text-coral-400 transition">
              <Sparkles size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-tight">
                {ex.title}
              </div>
              <div className="text-[12px] text-zinc-500 dark:text-zinc-500 mt-0.5 leading-snug line-clamp-2">
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
          Start from scratch <Sparkles size={14} />
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
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900 text-zinc-500 mb-4">
        <Search size={20} />
      </div>
      <div className="text-[16px] font-semibold tracking-tight">
        No pages match &quot;{q}&quot;
      </div>
      <p className="mt-1.5 text-[13px] text-zinc-500 dark:text-zinc-500">
        Try a different search, or start a fresh one.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 px-3 items-center rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] text-[13px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition"
        >
          Clear search
        </button>
        <Link
          href="/new"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-coral-500 text-white text-[13px] font-medium hover:bg-coral-600 btn-coral-shadow transition"
        >
          <Plus size={13} /> Create new
        </Link>
      </div>
    </div>
  );
}

function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d2 = Math.floor(h / 24);
  if (d2 === 1) return "yesterday";
  if (d2 < 7) return `${d2}d ago`;
  if (d2 < 30) return `${Math.floor(d2 / 7)}w ago`;
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
