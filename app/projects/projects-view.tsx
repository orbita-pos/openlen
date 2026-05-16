"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Folder,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProjectSummary } from "@/lib/projects";

// ─────────────────────────────────────────────────────────────────────────────
// Projects list — grid of cards with hero thumbnails. Click opens the
// project in /new?project=<id>. Each card has a delete affordance behind a
// confirm prompt.
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectsView({
  projects: initial,
}: {
  projects: ProjectSummary[];
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [projects, setProjects] = useState(initial);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onDelete = async (id: string) => {
    if (!confirm("Delete this page? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // eslint-disable-next-line no-alert
        alert(`Couldn't delete: ${data.error ?? res.statusText}`);
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      startTransition(() => router.refresh());
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white/85 dark:bg-[#0a0a0a]/85 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              <span className="absolute inset-0 rounded-md bg-coral-500" />
              <span className="relative font-bold text-white text-[13px] leading-none">
                い
              </span>
            </span>
            <span className="font-semibold tracking-tight text-[14px]">
              Inari Pages
            </span>
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <span className="text-[14px] font-medium">My pages</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/new"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-coral-500 text-white text-[12px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
          >
            <Plus size={13} /> New page
          </Link>
          <div className="text-[11px] text-zinc-500 hidden sm:flex items-center gap-1">
            <span>{session?.user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="ml-1 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-8 max-w-6xl w-full mx-auto">
        <div className="flex items-end justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              My pages
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
              {projects.length === 0
                ? "Generate your first landing page to get started."
                : `${projects.length} ${projects.length === 1 ? "page" : "pages"} · auto-saved as you build`}
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onDelete={() => onDelete(p.id)}
                deleting={deletingId === p.id || pending}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({
  project,
  onDelete,
  deleting,
}: {
  project: ProjectSummary;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={cn(
        "group relative rounded-xl bg-white dark:bg-zinc-950 ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden transition hover:shadow-lg hover:ring-zinc-300 dark:hover:ring-zinc-700",
        deleting && "opacity-50 pointer-events-none",
      )}
    >
      <Link
        href={`/new?project=${project.id}`}
        className="block aspect-[16/10] relative bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 overflow-hidden"
      >
        {project.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.thumbnailUrl}
            alt={project.title}
            className="w-full h-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-300 dark:text-zinc-700">
            <Folder size={32} />
          </div>
        )}
      </Link>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/new?project=${project.id}`}
            className="flex-1 min-w-0"
          >
            <div className="text-[14px] font-semibold tracking-tight truncate">
              {project.title}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">
              {relativeTime(project.updatedAt)}
            </div>
          </Link>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Project menu"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10"
                  aria-label="Close menu"
                />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 bg-white dark:bg-[#0a0a0a] shadow-lg p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-md text-[12.5px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 p-12 flex flex-col items-center text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-coral-50 dark:bg-coral-500/10 ring-1 ring-coral-200 dark:ring-coral-500/30 text-coral-600 dark:text-coral-400 mb-4">
        <Sparkles size={20} />
      </span>
      <h2 className="text-[15px] font-semibold tracking-tight">
        No pages yet
      </h2>
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-500 max-w-sm">
        Describe your landing page in plain English and we&apos;ll generate
        copy, layout, imagery, and code in under a minute.
      </p>
      <Link
        href="/new"
        className="mt-5 inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-coral-500 text-white text-[13px] font-medium hover:bg-coral-600 active:bg-coral-700 btn-coral-shadow transition"
      >
        <Plus size={14} /> New page
      </Link>
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
  if (d2 < 7) return `${d2}d ago`;
  return date.toLocaleDateString();
}
